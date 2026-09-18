import asyncio
import logging
import re
import threading
import time
import unicodedata
from typing import Awaitable, Callable

import numpy as np

from . import config
from .mic import FRAME_MS, Mic
from .stt import WhisperModel

log = logging.getLogger("wake")

MAX_SEGMENT_S = 2.6
END_SILENCE_MS = 320
MIN_SPEECH_MS = 320
PRE_ROLL_MS = 240
MAX_CONCENTRATION = 0.6  # >60% da energia em 30ms = clique/batida, não voz
MIN_WORD_PROB = 0.05     # so descarta token quase nulo (a palavra e rara, a prob e baixa mesmo em fala real)
MAX_NO_SPEECH = 0.5


def _energy_concentration(audio: np.ndarray, window: int = 480, hop: int = 160) -> float:
    """Fracao da energia total que cabe na janela de 30ms mais alta."""
    e = audio.astype(np.float64) ** 2
    total = float(e.sum()) + 1e-9
    if len(e) <= window:
        return 1.0
    c = np.cumsum(np.concatenate([[0.0], e]))
    sums = c[window::hop] - c[: len(c) - window : hop]
    return float(sums.max()) / total


def _fold(text: str) -> str:
    text = unicodedata.normalize("NFD", text.lower())
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9 ]+", " ", text)


class WakeWord:
    """Detector de "ARO" usando o Whisper tiny na GPU.
    Segmenta fala curta por energia, transcreve (~0.1s) e procura a palavra.
    Se vier comando junto ("ARO, que horas são"), entrega o áudio depois do nome."""

    def __init__(
        self,
        mic: Mic,
        loop: asyncio.AbstractEventLoop,
        on_wake: Callable[[np.ndarray | None], Awaitable[None]],
        is_busy: Callable[[], bool],
    ) -> None:
        self.mic = mic
        self.loop = loop
        self.on_wake = on_wake
        self.is_busy = is_busy
        self.enabled = config.WAKE_ENABLED
        self.words = [_fold(w).strip() for w in config.WAKE_WORDS]
        # "aro" e como o whisper costuma errar: arro, aru, arou, haro...
        self._loose = re.compile(r"a+r+[ou]+")
        # sem initial_prompt de proposito: com "aro" no prompt o Whisper alucina "aro" em qualquer ruido
        self._model: WhisperModel | None = None
        self._pre: list[np.ndarray] = []
        self._seg: list[np.ndarray] = []
        self._in_speech = False
        self._speech_ms = 0
        self._silence_ms = 0
        self._checking = False
        self._blocked_until = 0.0

    def start(self) -> None:
        if not self.enabled:
            return
        device, compute = ("cuda", "float16") if config.WHISPER_DEVICE != "cpu" else ("cpu", "int8")
        try:
            self._model = WhisperModel(config.WAKE_MODEL, device=device, compute_type=compute)
        except Exception as err:  # noqa: BLE001
            log.warning("wake em %s falhou (%s), tentando cpu", device, err)
            self._model = WhisperModel(config.WAKE_MODEL, device="cpu", compute_type="int8")
        self.mic.subscribe(self._on_frame)
        log.info("wake word ligada: %s (%s)", ", ".join(config.WAKE_WORDS), config.WAKE_MODEL)

    # ── thread de áudio ───────────────────────────────────────────

    def _on_frame(self, mono: np.ndarray, rms: float) -> None:
        if not self.enabled or self._checking or self.is_busy() or time.monotonic() < self._blocked_until:
            self._reset()
            return

        threshold = max(self.mic.noise_floor * 3.5, 0.012)
        pre_frames = PRE_ROLL_MS // FRAME_MS
        self._pre.append(mono)
        if len(self._pre) > pre_frames:
            self._pre.pop(0)

        if not self._in_speech:
            if rms > threshold:
                self._in_speech = True
                self._seg = list(self._pre)
                self._speech_ms = FRAME_MS
                self._silence_ms = 0
            return

        self._seg.append(mono)
        total_ms = len(self._seg) * FRAME_MS
        if rms > threshold:
            self._speech_ms += FRAME_MS
            self._silence_ms = 0
        else:
            self._silence_ms += FRAME_MS

        if self._silence_ms >= END_SILENCE_MS or total_ms >= MAX_SEGMENT_S * 1000:
            audio = np.concatenate(self._seg)
            speech_ms = self._speech_ms
            self._reset()
            if speech_ms >= MIN_SPEECH_MS:
                self._checking = True
                threading.Thread(target=self._check, args=(audio,), daemon=True).start()

    def _reset(self) -> None:
        self._in_speech = False
        self._seg = []
        self._speech_ms = 0
        self._silence_ms = 0

    # ── thread de checagem ────────────────────────────────────────

    def _check(self, audio: np.ndarray) -> None:
        try:
            # som impulsivo (tecla, clique, batida) nem vai pro modelo
            if _energy_concentration(audio) > MAX_CONCENTRATION:
                return
            segments, _ = self._model.transcribe(
                audio,
                language="pt",
                beam_size=1,
                word_timestamps=True,
                vad_filter=True,
                vad_parameters={"min_silence_duration_ms": 200, "speech_pad_ms": 120},
            )
            segs = list(segments)
            words = [w for s in segs for w in (s.words or [])]
            no_speech = max((s.no_speech_prob for s in segs), default=1.0)
        except Exception as err:  # noqa: BLE001
            log.warning("wake check falhou: %s", err)
            return
        finally:
            self._checking = False

        if not words or no_speech > MAX_NO_SPEECH:
            return
        text = _fold(" ".join(w.word for w in words))

        # acha a palavra que casou (com confiança) pra saber onde ela termina
        wake_end = None
        for w in words:
            token = _fold(w.word).strip()
            if (token in self.words or self._loose.fullmatch(token)) and w.probability >= MIN_WORD_PROB:
                wake_end = w.end
                break
        if wake_end is None:
            log.debug("wake descartada: %r", text.strip())
            return
        # comando junto? so se tiver fala de verdade depois do nome (nao so o silencio do fim)
        rest: np.ndarray | None = None
        after = audio[int((wake_end + 0.05) * config.SAMPLE_RATE) :]
        if len(after) > config.SAMPLE_RATE * 0.5:
            frame = config.SAMPLE_RATE * FRAME_MS // 1000
            loud = sum(1 for i in range(0, len(after) - frame, frame) if np.sqrt(np.mean(after[i : i + frame] ** 2)) > 0.012)
            if loud * FRAME_MS >= 250:
                rest = after
        log.info("wake: %r%s", text.strip(), " (+comando)" if rest is not None else "")
        self._blocked_until = time.monotonic() + 1.5
        asyncio.run_coroutine_threadsafe(self.on_wake(rest), self.loop)
