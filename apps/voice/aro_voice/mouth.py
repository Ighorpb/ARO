import logging
import queue
import random
import threading
from typing import Callable

import numpy as np
import sounddevice as sd

from . import config
from .text import clean_for_speech, split_sentences
from .tts import TTSEngine

log = logging.getLogger("mouth")

SLICE_MS = 100

# item da fila de audio: (geracao, id da frase, texto, tipo, payload)
AudioItem = tuple[int, int, str, str, object]


class Mouth:
    """Fala frase por frase enquanto o texto ainda chega.
    Um thread sintetiza (em streaming) adiantado, outro toca — sem buraco entre frases.
    Interrompivel a qualquer momento."""

    def __init__(
        self,
        tts: TTSEngine,
        on_state: Callable[[str], None],
        on_level: Callable[[float], None],
        on_chunk: Callable[[str, list[tuple[float, str]]], None],
    ) -> None:
        self.tts = tts
        self.on_state = on_state
        self.on_level = on_level
        self.on_chunk = on_chunk
        self.muted = False
        self._buffer = ""
        self._spoke_this_turn = False
        self._text_q: queue.Queue[tuple[int, int, str]] = queue.Queue()
        self._audio_q: queue.Queue[AudioItem] = queue.Queue()
        self._stop = threading.Event()
        self._generation = 0
        self._seq = 0
        self._pending = 0  # frases enfileiradas cujo audio ainda nao terminou de chegar
        self._speaking = False
        self._lock = threading.Lock()
        threading.Thread(target=self._synth_loop, daemon=True, name="mouth-synth").start()
        threading.Thread(target=self._play_loop, daemon=True, name="mouth-play").start()

    @property
    def speaking(self) -> bool:
        return self._speaking

    # ── entrada de texto ──────────────────────────────────────────

    def begin(self) -> None:
        """Novo turno: descarta o que sobrou do anterior."""
        self.stop()
        self._buffer = ""
        self._spoke_this_turn = False

    def filler(self) -> None:
        """'Deixa eu ver.' enquanto pensa em coisa pesada."""
        if config.FILLERS:
            self._enqueue(random.choice(config.FILLERS))

    def feed(self, delta: str) -> None:
        self._buffer += delta
        sentences, self._buffer = split_sentences(self._buffer, eager=not self._spoke_this_turn)
        for s in sentences:
            self._enqueue(s)

    def flush(self) -> None:
        if self._buffer.strip():
            self._enqueue(self._buffer)
        self._buffer = ""

    def say(self, text: str) -> None:
        self.begin()
        self._enqueue(text)

    def stop(self) -> None:
        """Barge-in: cala na hora e esvazia as filas."""
        with self._lock:
            self._generation += 1
            self._pending = 0
        self._stop.set()
        for q in (self._text_q, self._audio_q):
            while True:
                try:
                    q.get_nowait()
                except queue.Empty:
                    break

    # ── interno ───────────────────────────────────────────────────

    def _enqueue(self, text: str) -> None:
        if self.muted:
            return
        text = clean_for_speech(text)
        if not text:
            return
        self._spoke_this_turn = True
        with self._lock:
            self._pending += 1
            self._seq += 1
            self._text_q.put((self._generation, self._seq, text))

    def _set_speaking(self, value: bool) -> None:
        with self._lock:
            if self._speaking == value:
                return
            self._speaking = value
        self.on_state("speaking" if value else "idle")

    def _maybe_idle(self) -> None:
        if self._audio_q.empty() and self._pending == 0:
            self._set_speaking(False)

    def _synth_loop(self) -> None:
        while True:
            generation, seq, text = self._text_q.get()
            if generation != self._generation:
                continue
            ended = False
            try:
                for kind, payload in self.tts.stream(text):
                    if generation != self._generation:
                        break
                    if kind == "end":
                        ended = True
                        self._done_pending(generation)
                    self._audio_q.put((generation, seq, text, kind, payload))
            except Exception as err:  # noqa: BLE001
                log.warning("tts falhou: %s", err)
            if not ended and generation == self._generation:
                self._done_pending(generation)
                self._audio_q.put((generation, seq, text, "end", None))

    def _done_pending(self, generation: int) -> None:
        with self._lock:
            if generation == self._generation:
                self._pending = max(0, self._pending - 1)

    def _play_loop(self) -> None:
        current_seq = -1
        out: sd.OutputStream | None = None
        words_sent: list[tuple[float, str]] = []

        def close() -> None:
            nonlocal out
            if out is not None:
                try:
                    out.stop()
                    out.close()
                except sd.PortAudioError:
                    pass
                out = None

        while True:
            generation, seq, text, kind, payload = self._audio_q.get()
            if generation != self._generation:
                close()
                with self._lock:
                    self._speaking = False
                continue

            if seq != current_seq:
                close()
                current_seq = seq
                words_sent = []
                self._stop.clear()

            if kind == "words":
                words = [(w.at, w.text) for w in payload]  # type: ignore[union-attr]
                if words != words_sent:
                    words_sent = words
                    self.on_chunk(text, words)
            elif kind == "audio":
                samples, rate = payload  # type: ignore[misc]
                if out is None:
                    self._set_speaking(True)
                    if not words_sent:
                        self.on_chunk(text, [])
                    try:
                        out = sd.OutputStream(samplerate=rate, channels=1, dtype="float32")
                        out.start()
                    except sd.PortAudioError as err:
                        log.warning("saida de audio falhou: %s", err)
                        continue
                self._write(out, samples, rate)
            elif kind == "end":
                close()
                self.on_level(0.0)
                if generation == self._generation:
                    self._maybe_idle()

    def _write(self, out: sd.OutputStream, samples: np.ndarray, rate: int) -> None:
        step = int(rate * SLICE_MS / 1000)
        for i in range(0, len(samples), step):
            if self._stop.is_set():
                return
            piece = samples[i : i + step]
            rms = float(np.sqrt(np.mean(piece**2)) + 1e-9)
            self.on_level(float(np.clip((20 * np.log10(rms) + 40) / 30, 0.0, 1.0)))
            try:
                out.write(piece.reshape(-1, 1))
            except sd.PortAudioError as err:
                log.warning("saida de audio falhou: %s", err)
                return
