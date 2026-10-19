"""ElevenLabs Flash: voz natural, PCM direto (sem decodificar) e tempo por caractere pro karaokê."""

import base64
import json
import logging
import urllib.error
import urllib.request
from typing import Iterator

import numpy as np

from . import config
from .tts import Piece, Speech, Word

log = logging.getLogger("tts.eleven")

RATE = 24000
URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice}/stream/with-timestamps?output_format=pcm_24000"


def _words(chars: list[str], starts: list[float]) -> list[Word]:
    words: list[Word] = []
    current, at = "", 0.0
    for ch, t in zip(chars, starts):
        if ch.isspace():
            if current:
                words.append(Word(at=at, text=current))
            current = ""
        else:
            if not current:
                at = t
            current += ch
    if current:
        words.append(Word(at=at, text=current))
    return words


class ElevenTTS:
    def __init__(self) -> None:
        self.voice = config.ELEVEN_VOICE
        self.model = config.ELEVEN_MODEL
        # frase anterior: mantém a entonação contínua entre os pedaços que o Mouth manda
        self._previous = ""
        log.info("elevenlabs pronto (voz %s, %s)", self.voice, self.model)

    def _open(self, text: str):
        body: dict = {"text": text, "model_id": self.model, "language_code": "pt"}
        if self._previous and self.model != "eleven_v3":  # v3 recusa previous_text
            body["previous_text"] = self._previous
        self._previous = text
        req = urllib.request.Request(
            URL.format(voice=self.voice),
            data=json.dumps(body).encode(),
            headers={"xi-api-key": config.ELEVEN_API_KEY, "Content-Type": "application/json"},
        )
        try:
            return urllib.request.urlopen(req, timeout=10)
        except urllib.error.HTTPError as err:
            raise RuntimeError(f"elevenlabs {err.code}: {err.read()[:200]!r}") from None

    def stream(self, text: str) -> Iterator[Piece]:
        chars: list[str] = []
        starts: list[float] = []
        carry = b""  # PCM 16-bit pode vir cortado no meio de uma amostra
        got_audio = False
        with self._open(text) as resp:
            for line in resp:
                if not line.strip():
                    continue
                chunk = json.loads(line)
                alignment = chunk.get("alignment")
                if alignment:
                    chars += alignment["characters"]
                    starts += alignment["character_start_times_seconds"]
                    yield ("words", _words(chars, starts))
                data = carry + base64.b64decode(chunk.get("audio_base64") or "")
                cut = len(data) - len(data) % 2
                data, carry = data[:cut], data[cut:]
                if data:
                    got_audio = True
                    yield ("audio", (np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768, RATE))
        if not got_audio:
            raise RuntimeError("elevenlabs devolveu áudio vazio")
        yield ("end", None)

    def synthesize(self, text: str) -> Speech:
        audio: list[np.ndarray] = []
        words: list[Word] = []
        for kind, payload in self.stream(text):
            if kind == "audio":
                audio.append(payload[0])  # type: ignore[index]
            elif kind == "words":
                words = payload  # type: ignore[assignment]
        return Speech(np.concatenate(audio), RATE, words)
