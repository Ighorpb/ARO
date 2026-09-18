import logging
import time
from dataclasses import dataclass, field
from typing import Iterator, Protocol

import numpy as np

from . import config

log = logging.getLogger("tts")


@dataclass
class Word:
    at: float  # segundos desde o inicio do audio
    text: str


@dataclass
class Speech:
    samples: np.ndarray
    rate: int
    words: list[Word] = field(default_factory=list)  # vazio se o motor nao da tempo por palavra


# Pedacos de uma fala em streaming:
#   ("words", list[Word])            palavras com tempo conhecidas ate agora (acumulado)
#   ("audio", (np.ndarray, rate))    proximo trecho de audio
#   ("end", None)                    acabou
Piece = tuple[str, object]


class TTSEngine(Protocol):
    def synthesize(self, text: str) -> Speech: ...
    def stream(self, text: str) -> Iterator[Piece]: ...


def stream_from_speech(engine: TTSEngine, text: str) -> Iterator[Piece]:
    """Streaming de mentira pra motor que so sabe sintetizar inteiro."""
    speech = engine.synthesize(text)
    yield ("words", speech.words)
    yield ("audio", (speech.samples, speech.rate))
    yield ("end", None)


class FallbackTTS:
    """Tenta o motor principal; se falhar (sem internet, API mudou), usa o reserva por um tempo."""

    RETRY_AFTER_S = 30

    def __init__(self, primary: TTSEngine, fallback: TTSEngine, primary_name: str, fallback_name: str) -> None:
        self.primary = primary
        self.fallback = fallback
        self.primary_name = primary_name
        self.fallback_name = fallback_name
        self._primary_down_until = 0.0

    def _mark_down(self, err: Exception) -> None:
        self._primary_down_until = time.monotonic() + self.RETRY_AFTER_S
        log.warning("%s falhou (%s) - usando %s por %ss", self.primary_name, err, self.fallback_name, self.RETRY_AFTER_S)

    def synthesize(self, text: str) -> Speech:
        if time.monotonic() >= self._primary_down_until:
            try:
                return self.primary.synthesize(text)
            except Exception as err:  # noqa: BLE001
                self._mark_down(err)
        return self.fallback.synthesize(text)

    def stream(self, text: str) -> Iterator[Piece]:
        if time.monotonic() >= self._primary_down_until:
            started = False
            try:
                for piece in self.primary.stream(text):
                    if piece[0] == "audio":
                        started = True
                    yield piece
                return
            except Exception as err:  # noqa: BLE001
                self._mark_down(err)
                if started:
                    # ja tocou parte: nao repete a frase no outro motor
                    yield ("end", None)
                    return
        yield from self.fallback.stream(text)


def create_tts() -> TTSEngine:
    from .tts_kokoro import KokoroTTS

    kokoro = KokoroTTS()
    if config.TTS_ENGINE != "edge":
        return kokoro

    from .tts_edge import EdgeTTS

    return FallbackTTS(EdgeTTS(), kokoro, "edge", "kokoro")
