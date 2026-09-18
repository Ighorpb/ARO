import importlib
import logging
import os

import numpy as np

from . import config

log = logging.getLogger("stt")


def _add_nvidia_dlls() -> None:
    """cuBLAS/cuDNN vêm via pip; no Windows precisam entrar no caminho de DLL antes do ctranslate2."""
    for pkg in ("nvidia.cublas", "nvidia.cudnn"):
        try:
            mod = importlib.import_module(pkg)
        except ImportError:
            continue
        for root in getattr(mod, "__path__", []):
            bin_dir = os.path.join(root, "bin")
            if os.path.isdir(bin_dir):
                os.add_dll_directory(bin_dir)
                os.environ["PATH"] = bin_dir + os.pathsep + os.environ["PATH"]


_add_nvidia_dlls()

from faster_whisper import WhisperModel  # noqa: E402


class STT:
    def __init__(self) -> None:
        self.model = self._load()

    def _load(self) -> WhisperModel:
        attempts = []
        if config.WHISPER_DEVICE in ("auto", "cuda"):
            attempts.append(("cuda", "float16"))
        if config.WHISPER_DEVICE in ("auto", "cpu"):
            attempts.append(("cpu", "int8"))

        last_err: Exception | None = None
        for device, compute in attempts:
            try:
                log.info("carregando %s em %s/%s…", config.WHISPER_MODEL, device, compute)
                model = WhisperModel(config.WHISPER_MODEL, device=device, compute_type=compute)
                # aquece — erro de CUDA às vezes só aparece na primeira inferência
                list(model.transcribe(np.zeros(config.SAMPLE_RATE // 2, dtype=np.float32), language="pt")[0])
                log.info("whisper pronto (%s)", device)
                return model
            except Exception as err:  # noqa: BLE001 — qualquer falha de CUDA cai pra CPU
                last_err = err
                log.warning("falhou em %s: %s", device, err)
        raise RuntimeError(f"não consegui carregar o Whisper: {last_err}")

    def transcribe(self, audio: np.ndarray) -> str:
        return self.transcribe_detailed(audio)[0]

    def transcribe_detailed(self, audio: np.ndarray) -> tuple[str, float, float]:
        """(texto, no_speech_prob maximo, avg_logprob minimo) — pra descartar transcricao duvidosa."""
        segments, _ = self.model.transcribe(
            audio,
            language="pt",
            beam_size=config.WHISPER_BEAM,
            vad_filter=True,
            condition_on_previous_text=False,
            initial_prompt=config.WHISPER_PROMPT,
        )
        segs = list(segments)
        text = " ".join(s.text.strip() for s in segs).strip()
        no_speech = max((s.no_speech_prob for s in segs), default=1.0)
        logprob = min((s.avg_logprob for s in segs), default=-9.0)
        return text, no_speech, logprob
