import asyncio
import json
import logging
from typing import Awaitable, Callable

import websockets

log = logging.getLogger("hub")

Handler = Callable[[dict], Awaitable[None]]


class HubClient:
    """Cliente do hub. Reconecta sozinho; envia `client.hello` ao conectar."""

    def __init__(self, url: str, on_event: Handler, on_connect: Handler | None = None):
        self.url = url
        self.on_event = on_event
        self.on_connect = on_connect
        self._ws: websockets.ClientConnection | None = None

    async def run(self) -> None:
        delay = 1
        while True:
            try:
                async with websockets.connect(self.url, max_size=4 * 1024 * 1024) as ws:
                    self._ws = ws
                    delay = 1
                    log.info("conectado em %s", self.url)
                    await self.send({"type": "client.hello", "kind": "voice"})
                    if self.on_connect:
                        await self.on_connect({})
                    async for raw in ws:
                        try:
                            event = json.loads(raw)
                        except json.JSONDecodeError:
                            continue
                        await self.on_event(event)
            except (OSError, websockets.WebSocketException) as err:
                log.warning("hub fora (%s) — tentando em %ss", err.__class__.__name__, delay)
            finally:
                self._ws = None
            await asyncio.sleep(delay)
            delay = min(delay * 2, 8)

    async def send(self, event: dict) -> None:
        if self._ws is None:
            return
        try:
            await self._ws.send(json.dumps(event, ensure_ascii=False))
        except websockets.WebSocketException:
            pass
