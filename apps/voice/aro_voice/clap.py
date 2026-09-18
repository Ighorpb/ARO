import asyncio
import logging
from typing import Awaitable, Callable

import numpy as np

from . import config
from .mic import FRAME_MS, Mic

log = logging.getLogger("clap")

MAX_IMPULSE_MS = 120
MIN_GAP_S = 0.12
MAX_SPAN_S = 0.9
REFRACTORY_S = 1.5
ABS_MIN = 0.09      # palma perto do mic é alta; tecla/clique fica bem abaixo
ONSET_RATIO = 4.0
QUIET_BEFORE_S = 0.5  # sem outro impulso antes da primeira palma (digitação tem vários)
QUIET_AFTER_S = 0.35  # e sem um terceiro logo depois


class ClapDetector:
    """Conta palmas: pico abrupto e curto, bem acima do ruído.
    N palmas dentro da janela disparam o gatilho."""

    def __init__(self, mic: Mic, loop: asyncio.AbstractEventLoop, on_trigger: Callable[[], Awaitable[None]]) -> None:
        self.mic = mic
        self.loop = loop
        self.on_trigger = on_trigger
        self.enabled = True
        self.count = config.CLAP_COUNT
        self.sensitivity = config.CLAP_SENSITIVITY
        self._prev_rms = 0.0
        self._in_impulse = False
        self._impulse_frames = 0
        self._claps: list[float] = []
        self._blocked_until = 0.0
        self._t = 0.0  # relógio em segundos, avança por frame
        self._last_impulse = -10.0
        self._armed_at: float | None = None

    def start(self) -> None:
        self.mic.subscribe(self._on_frame)
        log.info("detector ligado: %d palmas, sensibilidade %.1f", self.count, self.sensitivity)

    def _on_frame(self, _mono: np.ndarray, rms: float) -> None:
        self._t += FRAME_MS / 1000
        now = self._t
        if not self.enabled or now < self._blocked_until:
            self._prev_rms = rms
            return

        # armado: N palmas contadas, esperando um pouco de silêncio pra confirmar que não é digitação
        if self._armed_at is not None and now - self._armed_at >= QUIET_AFTER_S:
            self._armed_at = None
            self._claps.clear()
            self._blocked_until = now + REFRACTORY_S
            log.info("palmas detectadas")
            asyncio.run_coroutine_threadsafe(self.on_trigger(), self.loop)

        threshold = max(self.mic.noise_floor * 10, ABS_MIN) / self.sensitivity

        if not self._in_impulse:
            if rms > threshold and rms > self._prev_rms * ONSET_RATIO:
                self._in_impulse = True
                self._impulse_frames = 0
        else:
            self._impulse_frames += 1
            if rms < threshold * 0.35:
                self._in_impulse = False
                if self._impulse_frames * FRAME_MS <= MAX_IMPULSE_MS:
                    self._register(now)
            elif self._impulse_frames * FRAME_MS > MAX_IMPULSE_MS:
                # som sustentado (voz, ruído) — não é palma
                self._in_impulse = False

        self._prev_rms = rms

    def _register(self, now: float) -> None:
        if self._armed_at is not None:
            # terceiro impulso logo depois: é digitação/ruído, não palma
            self._armed_at = None
            self._claps.clear()
            self._last_impulse = now
            return
        if self._claps and now - self._claps[-1] < MIN_GAP_S:
            return
        self._claps = [t for t in self._claps if now - t <= MAX_SPAN_S]
        if not self._claps and now - self._last_impulse < QUIET_BEFORE_S:
            # tinha barulho logo antes: não conta como primeira palma
            self._last_impulse = now
            return
        self._claps.append(now)
        self._last_impulse = now
        log.debug("palma %d/%d", len(self._claps), self.count)
        if len(self._claps) >= self.count:
            self._armed_at = now
