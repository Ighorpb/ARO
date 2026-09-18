"""ARO voz: ouvido (mic -> Whisper) e boca (Edge/Kokoro) plugados no hub."""

import asyncio
import logging
import math
import threading

import numpy as np

from aro_voice import config
from aro_voice.audio import chime, select_devices
from aro_voice.clap import ClapDetector
from aro_voice.ears import Ears
from aro_voice.hub import HubClient
from aro_voice.mic import Mic
from aro_voice.mouth import Mouth
from aro_voice.stt import STT
from aro_voice.system import WindowWatcher, media
from aro_voice.tts import create_tts
from aro_voice.wake import WakeWord

logging.basicConfig(level=config.LOG_LEVEL, format="[%(name)s] %(message)s")
for noisy in ("httpx", "huggingface_hub", "faster_whisper", "phonemizer"):
    logging.getLogger(noisy).setLevel(logging.WARNING)
log = logging.getLogger("voice")


async def main() -> None:
    loop = asyncio.get_running_loop()
    select_devices()

    stt = await asyncio.to_thread(STT)
    tts = await asyncio.to_thread(create_tts)

    hub: HubClient
    ears: Ears
    mouth: Mouth
    turn = {"channel": "text", "done": True, "tier": "main"}
    last_state = {"v": "idle"}

    # ── saída pro hub ─────────────────────────────────────────────

    def voice_state(state: str) -> None:
        asyncio.run_coroutine_threadsafe(send_state(state), loop)

    def voice_level(level: float) -> None:
        asyncio.run_coroutine_threadsafe(hub.send({"type": "voice.level", "level": round(level, 3)}), loop)

    def voice_chunk(text: str, words: list[tuple[float, str]]) -> None:
        payload = {"type": "voice.chunk", "text": text, "words": [{"t": round(t, 3), "w": w} for t, w in words]}
        asyncio.run_coroutine_threadsafe(hub.send(payload), loop)

    async def send_state(state: str, source: str | None = None) -> None:
        prev, last_state["v"] = last_state["v"], state
        payload: dict = {"type": "voice.state", "state": state}
        if source:
            payload["source"] = source
        await hub.send(payload)
        if state == "transcribing" and config.CHIME_ENABLED and not ears.follow_up:
            threading.Thread(target=chime, args=("end",), daemon=True).start()
        # conversa contínua: ele acabou de falar uma resposta de voz → fica ouvindo um pouco, sem bipe
        if state == "idle" and prev == "speaking" and turn["done"] and turn["channel"] == "voice" and config.FOLLOW_UP_S > 0:
            loop.call_later(0.4, lambda: ears.start(follow_up=True) if not ears.busy and not mouth.speaking else None)

    async def send_level(level: float) -> None:
        await hub.send({"type": "voice.level", "level": level})

    async def heard(text: str) -> None:
        await hub.send({"type": "user.message", "text": text, "channel": "voice"})

    def should_speak() -> bool:
        return config.SPEAK_MODE == "always" or turn["channel"] == "voice"

    # ── ativação ──────────────────────────────────────────────────

    async def listen(source: str, with_chime: bool, preroll: np.ndarray | None = None) -> None:
        if ears.busy:
            return
        mouth.stop()
        if with_chime and config.CHIME_ENABLED and preroll is None:
            await asyncio.to_thread(chime)
        ears.start(preroll=preroll, source=source)

    async def on_clap() -> None:
        await listen("clap", with_chime=True)

    async def on_wake(rest: np.ndarray | None) -> None:
        await listen("wake", with_chime=True, preroll=rest)

    # ── eventos do hub ────────────────────────────────────────────

    async def on_event(event: dict) -> None:
        kind = event.get("type")

        if kind == "voice.listen.start":
            await listen("hotkey", with_chime=False)
        elif kind == "voice.listen.stop":
            ears.stop()
        elif kind == "voice.mute":
            mouth.muted = bool(event.get("muted"))
            if mouth.muted:
                mouth.stop()
        elif kind == "turn.start":
            turn["channel"] = event.get("channel", "text")
            turn["tier"] = event.get("tier", "main")
            turn["done"] = False
            mouth.begin()
            if turn["tier"] == "deep" and should_speak():
                mouth.filler()
        elif kind == "text.delta":
            if should_speak():
                mouth.feed(event.get("text", ""))
        elif kind == "turn.done":
            turn["done"] = True
            if should_speak():
                mouth.flush()
            if not mouth.speaking:
                await send_state("idle")
        elif kind == "reminder.fired":
            turn["channel"] = "text"
            turn["done"] = True
            mouth.say(f"Lembrete: {event.get('text', '')}")
        elif kind == "error":
            turn["done"] = True
            mouth.stop()
        elif kind == "sys.request" and event.get("kind") == "media":
            args = event.get("args") or {}
            try:
                msg = await asyncio.to_thread(media, str(args.get("action")), args.get("value"))
                await hub.send({"type": "sys.result", "id": event["id"], "ok": True, "data": msg})
            except Exception as err:  # noqa: BLE001
                await hub.send({"type": "sys.result", "id": event["id"], "ok": False, "error": str(err)})

    async def on_connect(_: dict) -> None:
        await send_state("idle")

    hub = HubClient(config.HUB_URL, on_event, on_connect)
    mouth = Mouth(tts, voice_state, voice_level, voice_chunk)

    mic = Mic()
    mic.start()
    ears = Ears(mic, stt, loop, heard, send_state, send_level)

    if config.CLAP_ENABLED:
        ClapDetector(mic, loop, on_clap).start()

    if config.WAKE_ENABLED:
        wake = WakeWord(mic, loop, on_wake, is_busy=lambda: ears.busy or mouth.speaking)
        await asyncio.to_thread(wake.start)

    # presença: fora da escuta, manda o nível ambiente (~8Hz) quando tem som acima do ruído
    ambient = {"n": 0, "last": 0.0, "loud_ms": 0}

    def on_ambient(_mono, rms: float) -> None:
        ambient["n"] += 1
        if ears.busy:
            return
        floor = max(mic.noise_floor, 1e-4)
        level = 0.0
        if rms > floor * 3:
            level = min(1.0, max(0.0, (20 * math.log10(rms / floor) - 9.5) / 30))

        # barge-in: fala alta e sustentada enquanto ele fala -> interrompe e ouve
        if config.BARGE_IN and mouth.speaking:
            ambient["loud_ms"] = ambient["loud_ms"] + 20 if level >= config.BARGE_IN_LEVEL else 0
            if ambient["loud_ms"] >= config.BARGE_IN_MS:
                ambient["loud_ms"] = 0
                asyncio.run_coroutine_threadsafe(listen("barge_in", with_chime=False), loop)
                return

        if ambient["n"] % 6:
            return
        if level > 0.02 or ambient["last"] > 0.02:
            ambient["last"] = level
            asyncio.run_coroutine_threadsafe(hub.send({"type": "voice.level", "level": round(level, 3)}), loop)

    mic.subscribe(on_ambient)

    log.info("voz pronta")
    await asyncio.gather(hub.run(), WindowWatcher(hub.send).run())


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
