import logging

import numpy as np
from kokoro_onnx import Kokoro

from . import config
from typing import Iterator

from .tts import Piece, Speech, stream_from_speech

log = logging.getLogger("tts")


class KokoroTTS:
    def __init__(self) -> None:
        if not config.KOKORO_MODEL.exists() or not config.KOKORO_VOICES.exists():
            raise FileNotFoundError("modelos do Kokoro não encontrados — roda `pnpm --filter @aro/voice setup`")
        self.kokoro = Kokoro(str(config.KOKORO_MODEL), str(config.KOKORO_VOICES))
        self.voice = config.TTS_VOICE
        self.speed = config.TTS_SPEED
        log.info("kokoro pronto (voz %s)", self.voice)

    def synthesize(self, text: str) -> Speech:
        samples, rate = self.kokoro.create(text, voice=self.voice, speed=self.speed, lang="pt-br")
        return Speech(samples.astype(np.float32), rate)

    def stream(self, text: str) -> Iterator[Piece]:
        yield from stream_from_speech(self, text)
