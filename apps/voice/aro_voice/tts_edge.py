import asyncio
import io
import logging
import queue
import threading
from typing import Iterator

import av
import edge_tts
import numpy as np

from . import config
from .tts import Piece, Speech, Word, stream_from_speech

log = logging.getLogger("tts.edge")

RATE = 24000
CHUNK_S = 0.2


def _decode_mp3(data: bytes) -> np.ndarray:
    """MP3 (bytes) -> float32 mono 24kHz via PyAV (já vem com o faster-whisper)."""
    chunks: list[np.ndarray] = []
    with av.open(io.BytesIO(data)) as container:
        resampler = av.AudioResampler(format="fltp", layout="mono", rate=RATE)
        for frame in container.decode(audio=0):
            for out in resampler.resample(frame):
                chunks.append(out.to_ndarray()[0])
        for out in resampler.resample(None):
            chunks.append(out.to_ndarray()[0])
    if not chunks:
        return np.zeros(0, dtype=np.float32)
    return np.concatenate(chunks).astype(np.float32)


class _QueueReader:
    """Arquivo de mentira: o PyAV lê MP3 daqui enquanto o Edge ainda está mandando."""

    def __init__(self, q: "queue.Queue[bytes | Exception | None]") -> None:
        self.q = q
        self._buf = b""
        self._eof = False

    def read(self, size: int = -1) -> bytes:
        while not self._eof and (size < 0 or len(self._buf) < size):
            item = self.q.get()
            if item is None:
                self._eof = True
            elif isinstance(item, Exception):
                raise item
            else:
                self._buf += item
        if size < 0:
            out, self._buf = self._buf, b""
        else:
            out, self._buf = self._buf[:size], self._buf[size:]
        return out


class EdgeTTS:
    """Vozes neurais da Microsoft (API não-oficial). Precisa de internet."""

    def __init__(self) -> None:
        self.voice = config.EDGE_VOICE
        self.rate = config.EDGE_RATE
        self.pitch = config.EDGE_PITCH
        log.info("edge pronto (voz %s, rate %s)", self.voice, self.rate)

    def _communicate(self, text: str) -> edge_tts.Communicate:
        return edge_tts.Communicate(
            text, self.voice, rate=self.rate, pitch=self.pitch, boundary="WordBoundary", connect_timeout=5, receive_timeout=20
        )

    async def _fetch(self, text: str) -> tuple[bytes, list[Word]]:
        buffer = bytearray()
        words: list[Word] = []
        async for chunk in self._communicate(text).stream():
            if chunk["type"] == "audio":
                buffer.extend(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                words.append(Word(at=chunk["offset"] / 10_000_000, text=str(chunk["text"])))
        return bytes(buffer), words

    def synthesize(self, text: str) -> Speech:
        data, words = asyncio.run(self._fetch(text))
        if not data:
            raise RuntimeError("edge-tts devolveu áudio vazio")
        return Speech(_decode_mp3(data), RATE, words)

    def stream(self, text: str) -> Iterator[Piece]:
        """Decodifica enquanto baixa: primeiro áudio sai em ~0.3s em vez de esperar a frase toda."""
        q: "queue.Queue[bytes | Exception | None]" = queue.Queue()
        words: list[Word] = []
        words_lock = threading.Lock()
        got_audio = False

        async def run() -> None:
            nonlocal got_audio
            async for chunk in self._communicate(text).stream():
                if chunk["type"] == "audio":
                    got_audio = True
                    q.put(chunk["data"])
                elif chunk["type"] == "WordBoundary":
                    with words_lock:
                        words.append(Word(at=chunk["offset"] / 10_000_000, text=str(chunk["text"])))

        def producer() -> None:
            try:
                asyncio.run(run())
                if not got_audio:
                    q.put(RuntimeError("edge-tts devolveu áudio vazio"))
                q.put(None)
            except Exception as err:  # noqa: BLE001
                q.put(err)

        threading.Thread(target=producer, daemon=True, name="edge-fetch").start()

        try:
            reader = _QueueReader(q)
            container = av.open(reader, format="mp3", buffer_size=2048, options={"probesize": "4096", "analyzeduration": "0"})
        except Exception:
            # sem streaming (ex: PyAV não gostou do fluxo) — cai pro modo inteiro
            log.debug("stream do edge indisponível, usando modo inteiro")
            yield from stream_from_speech(self, text)
            return

        sent_words = 0
        pending: list[np.ndarray] = []
        pending_len = 0
        resampler = av.AudioResampler(format="fltp", layout="mono", rate=RATE)
        try:
            with container:
                for frame in container.decode(audio=0):
                    with words_lock:
                        if len(words) > sent_words:
                            sent_words = len(words)
                            yield ("words", list(words))
                    for out in resampler.resample(frame):
                        arr = out.to_ndarray()[0].astype(np.float32)
                        pending.append(arr)
                        pending_len += len(arr)
                    if pending_len >= RATE * CHUNK_S:
                        yield ("audio", (np.concatenate(pending), RATE))
                        pending, pending_len = [], 0
                for out in resampler.resample(None):
                    pending.append(out.to_ndarray()[0].astype(np.float32))
        finally:
            with words_lock:
                if len(words) > sent_words:
                    yield ("words", list(words))
        if pending:
            yield ("audio", (np.concatenate(pending), RATE))
        yield ("end", None)
