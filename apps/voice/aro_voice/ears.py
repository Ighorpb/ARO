import asyncio
import logging
import time
from typing import Awaitable, Callable

import numpy as np

from . import config
from .mic import FRAME_MS, Mic
from .stt import STT

log = logging.getLogger("ears")

LEVEL_EVERY = 5
# Whisper inventa isso em áudio quase mudo
HALLUCINATIONS = ("amara.org", "legendas pela comunidade", "obrigado por assistir")
MAX_NO_SPEECH = 0.6
MIN_LOGPROB_SHORT = -1.0  # frase de 1-2 palavras precisa de mais confiança


class Ears:
    """Grava o mic até você parar de falar, transcreve e entrega o texto."""

    def __init__(
        self,
        mic: Mic,
        stt: STT,
        loop: asyncio.AbstractEventLoop,
        on_text: Callable[[str], Awaitable[None]],
        on_state: Callable[[str], Awaitable[None]],
        on_level: Callable[[float], Awaitable[None]],
    ) -> None:
        self.mic = mic
        self.stt = stt
        self.loop = loop
        self.on_text = on_text
        self.on_state = on_state
        self.on_level = on_level
        self._active = False
        self._busy = False
        self._reset()

    @property
    def listening(self) -> bool:
        return self._active

    @property
    def busy(self) -> bool:
        """Ouvindo ou transcrevendo."""
        return self._active or self._busy

    def _reset(self) -> None:
        self._frames: list[np.ndarray] = []
        self._threshold = 0.0
        self._speech_started = False
        self._silence_frames = 0
        self._frame_count = 0
        self._started_at = 0.0

    def start(self, preroll: np.ndarray | None = None, follow_up: bool = False) -> None:
        """preroll: áudio já capturado (comando dito junto com a wake word).
        follow_up: escuta curta depois de uma resposta, sem bipe; desiste rápido se ninguém falar."""
        if self._active or self._busy:
            return
        self._reset()
        self._threshold = max(self.mic.noise_floor * 3.5, 0.012)
        self._started_at = time.monotonic()
        self._no_speech_timeout = config.FOLLOW_UP_S if follow_up else config.NO_SPEECH_TIMEOUT_S
        self.follow_up = follow_up
        if preroll is not None and len(preroll):
            self._frames.append(preroll.astype(np.float32))
            self._speech_started = True
        self._active = True
        self.mic.subscribe(self._on_frame)
        self._emit(self.on_state, "hearing" if self._speech_started else "listening")
        log.info("ouvindo... (limiar %.4f)", self._threshold)

    def stop(self) -> None:
        """Parada manual (segundo aperto no atalho)."""
        self._finish()

    # ── thread de áudio ───────────────────────────────────────────

    def _on_frame(self, mono: np.ndarray, rms: float) -> None:
        if not self._active:
            return
        self._frames.append(mono)
        self._frame_count += 1

        if self._frame_count % LEVEL_EVERY == 0:
            db_over = 20 * np.log10(rms / self._threshold)
            level = float(np.clip(db_over / 30, 0.0, 1.0))
            self._emit(self.on_level, round(level, 3))

        elapsed = time.monotonic() - self._started_at
        if rms > self._threshold:
            if not self._speech_started:
                self._speech_started = True
                self._emit(self.on_state, "hearing")
            self._silence_frames = 0
        elif self._speech_started:
            self._silence_frames += 1
            if self._silence_frames * FRAME_MS >= config.SILENCE_MS:
                self._schedule_finish()
                return

        if elapsed >= config.MAX_RECORD_S or (not self._speech_started and elapsed >= self._no_speech_timeout):
            self._schedule_finish()

    def _schedule_finish(self) -> None:
        self._active = False
        self.loop.call_soon_threadsafe(self._finish)

    # ── loop principal ────────────────────────────────────────────

    def _finish(self) -> None:
        if not self._active and not self._frames:
            return
        self._active = False
        self.mic.unsubscribe(self._on_frame)

        audio = np.concatenate(self._frames) if self._frames else np.zeros(0, dtype=np.float32)
        self._frames = []
        duration = len(audio) / config.SAMPLE_RATE
        if not self._speech_started or duration < 0.4:
            log.info("nada ouvido")
            self._emit(self.on_state, "idle")
            return

        self._busy = True
        self.loop.create_task(self._transcribe(audio))

    async def _transcribe(self, audio: np.ndarray) -> None:
        await self.on_state("transcribing")
        try:
            text, no_speech, logprob = await asyncio.to_thread(self.stt.transcribe_detailed, audio)
        except Exception as err:  # noqa: BLE001
            log.warning("transcrição falhou: %s", err)
            text, no_speech, logprob = "", 1.0, -9.0
        finally:
            self._busy = False
        await self.on_state("idle")
        if any(junk in text.lower() for junk in HALLUCINATIONS):
            text = ""
        if text and (no_speech > MAX_NO_SPEECH or (len(text.split()) <= 2 and logprob < MIN_LOGPROB_SHORT)):
            log.info("descartei transcrição duvidosa: %r (no_speech=%.2f, logprob=%.2f)", text, no_speech, logprob)
            text = ""
        if text:
            log.info("ouvi: %s", text)
            await self.on_text(text)
        else:
            log.info("transcrição vazia")

    def _emit(self, fn, value) -> None:
        asyncio.run_coroutine_threadsafe(fn(value), self.loop)
