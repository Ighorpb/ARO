import logging

import sounddevice as sd

from . import config

log = logging.getLogger("audio")


def _find(name_part: str, kind: str) -> int | None:
    if not name_part:
        return None
    key = f"max_{kind}_channels"
    for index, device in enumerate(sd.query_devices()):
        if name_part.lower() in device["name"].lower() and device[key] > 0:
            return index
    log.warning("dispositivo de %s com '%s' não encontrado — usando padrão", kind, name_part)
    return None


def select_devices() -> None:
    """Aplica ARO_INPUT_DEVICE / ARO_OUTPUT_DEVICE e loga o que ficou."""
    current = list(sd.default.device)
    chosen_in = _find(config.INPUT_DEVICE, "input")
    chosen_out = _find(config.OUTPUT_DEVICE, "output")
    if chosen_in is not None:
        current[0] = chosen_in
    if chosen_out is not None:
        current[1] = chosen_out
    sd.default.device = current

    log.info("mic: %s", sd.query_devices(kind="input")["name"])
    log.info("saída: %s", sd.query_devices(kind="output")["name"])


def chime(kind: str = "start") -> None:
    """start: dois tons subindo ('te ouvi'). end: um tom curto descendo ('peguei').
    Bloqueia ~150ms — chame antes de abrir o ouvido."""
    import numpy as np

    rate = 24000
    parts = []
    for freq in (660, 880) if kind == "start" else (880, 660):
        t = np.arange(int(rate * 0.07)) / rate
        tone = 0.18 * np.sin(2 * np.pi * freq * t)
        fade = np.minimum(1, np.minimum(np.arange(len(t)), len(t) - np.arange(len(t))) / (rate * 0.01))
        parts.append(tone * fade)
    signal = np.concatenate(parts).astype("float32")
    try:
        sd.play(signal, rate, blocking=True)
    except sd.PortAudioError as err:
        log.warning("bipe falhou: %s", err)
