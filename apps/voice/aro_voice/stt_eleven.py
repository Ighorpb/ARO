"""Scribe Realtime (ElevenLabs): transcreve enquanto você fala; quando para, só falta o commit (~0.3s)."""

import asyncio
import base64
import json
import logging

import numpy as np
import websockets

from . import config

log = logging.getLogger("stt.eleven")

URL = (
    "wss://api.elevenlabs.io/v1/speech-to-text/realtime"
    "?model_id=scribe_v2_realtime&audio_format=pcm_16000&language_code=pt&commit_strategy=manual"
)
SEND_EVERY = 5  # frames de 20ms por mensagem (100ms)
COMMIT_TIMEOUT_S = 4.0
SILENCE = bytes(640)  # 20ms, pra commit sem áudio pendente


class ScribeStream:
    """Uma sessão por escuta. feed() vem do thread de áudio; finish() devolve o texto final."""

    def __init__(self, loop: asyncio.AbstractEventLoop) -> None:
        self.loop = loop
        self._q: asyncio.Queue[bytes | None] = asyncio.Queue()
        self._future = asyncio.run_coroutine_threadsafe(self._run(), loop)

    def feed(self, mono: np.ndarray) -> None:
        pcm = (np.clip(mono, -1, 1) * 32767).astype(np.int16).tobytes()
        self.loop.call_soon_threadsafe(self._q.put_nowait, pcm)

    async def finish(self) -> str:
        self._q.put_nowait(None)
        return await asyncio.wait_for(asyncio.wrap_future(self._future), COMMIT_TIMEOUT_S + 2)

    def cancel(self) -> None:
        self._future.cancel()

    async def _run(self) -> str:
        headers = {"xi-api-key": config.ELEVEN_API_KEY}
        async with websockets.connect(URL, additional_headers=headers, open_timeout=5) as ws:
            hello = json.loads(await ws.recv())
            if hello.get("message_type") != "session_started":
                raise RuntimeError(f"scribe não abriu: {hello}")

            buf, frames = b"", 0
            while True:
                chunk = await self._q.get()
                commit = chunk is None
                if not commit:
                    buf += chunk
                    frames += 1
                    if frames < SEND_EVERY:
                        continue
                await ws.send(json.dumps({
                    "message_type": "input_audio_chunk",
                    "audio_base_64": base64.b64encode(buf or SILENCE).decode(),
                    "commit": commit,
                    "sample_rate": config.SAMPLE_RATE,
                }))
                buf, frames = b"", 0
                if commit:
                    break

            while True:
                msg = json.loads(await asyncio.wait_for(ws.recv(), COMMIT_TIMEOUT_S))
                kind = msg.get("message_type")
                if kind == "committed_transcript":
                    return str(msg.get("text", "")).strip()
                if kind == "insufficient_audio_activity":
                    return ""
                if kind not in ("partial_transcript", "warning"):
                    raise RuntimeError(f"{kind}: {msg.get('error')}")
