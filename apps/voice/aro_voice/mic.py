import logging
import threading
from typing import Callable

import numpy as np
import sounddevice as sd

from . import config

log = logging.getLogger("mic")

FRAME_MS = 20
FRAME = config.SAMPLE_RATE * FRAME_MS // 1000

Listener = Callable[[np.ndarray, float], None]


class Mic:
    """Stream único do microfone, sempre aberto. Quem quiser áudio assina.
    Mantém estimativa do ruído de fundo (sobe devagar, desce rápido)."""

    def __init__(self) -> None:
        self._listeners: list[Listener] = []
        self._lock = threading.Lock()
        self._stream: sd.InputStream | None = None
        self.noise_floor = 0.005

    def start(self) -> None:
        self._stream = sd.InputStream(
            samplerate=config.SAMPLE_RATE,
            channels=1,
            dtype="float32",
            blocksize=FRAME,
            callback=self._on_audio,
        )
        self._stream.start()
        log.info("mic aberto (%d ms/frame)", FRAME_MS)

    def subscribe(self, fn: Listener) -> None:
        with self._lock:
            if fn not in self._listeners:
                self._listeners.append(fn)

    def unsubscribe(self, fn: Listener) -> None:
        with self._lock:
            if fn in self._listeners:
                self._listeners.remove(fn)

    def _on_audio(self, indata: np.ndarray, _frames: int, _time, status) -> None:
        if status:
            log.debug("status do mic: %s", status)
        mono = indata[:, 0].copy()
        rms = float(np.sqrt(np.mean(mono**2)) + 1e-9)

        if rms < self.noise_floor:
            self.noise_floor = 0.8 * self.noise_floor + 0.2 * rms
        elif rms < self.noise_floor * 2.5:
            self.noise_floor = 0.995 * self.noise_floor + 0.005 * rms

        with self._lock:
            listeners = list(self._listeners)
        for fn in listeners:
            fn(mono, rms)
