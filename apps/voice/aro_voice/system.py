"""Corpo no Windows: teclas de mídia/volume e janela em foco. Só ctypes, sem dependência."""

import ctypes
import ctypes.wintypes as wt
import logging
import os
import time

log = logging.getLogger("system")

user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32

VK = {
    "play_pause": 0xB3,
    "next": 0xB0,
    "previous": 0xB1,
    "volume_up": 0xAF,
    "volume_down": 0xAE,
    "mute": 0xAD,
}
KEYEVENTF_KEYUP = 0x0002


def _tap(vk: int) -> None:
    user32.keybd_event(vk, 0, 0, 0)
    user32.keybd_event(vk, 0, KEYEVENTF_KEYUP, 0)


def media(action: str, value: int | None = None) -> str:
    if action == "set_volume":
        if value is None:
            raise ValueError("set_volume precisa de value 0-100")
        # sem CoreAudio: zera com 50 toques pra baixo e sobe o tanto certo (cada toque = 2%)
        for _ in range(50):
            _tap(VK["volume_down"])
        for _ in range(max(0, min(50, round(value / 2)))):
            _tap(VK["volume_up"])
        return f"Volume em {value}%."
    vk = VK.get(action)
    if vk is None:
        raise ValueError(f"ação desconhecida: {action}")
    _tap(vk)
    return {
        "play_pause": "Alternei play/pause.",
        "next": "Próxima faixa.",
        "previous": "Faixa anterior.",
        "volume_up": "Volume mais alto.",
        "volume_down": "Volume mais baixo.",
        "mute": "Alternei o mudo.",
    }[action]


def foreground_window() -> tuple[str, str]:
    """(título, nome do executável) da janela em foco."""
    hwnd = user32.GetForegroundWindow()
    if not hwnd:
        return "", ""
    length = user32.GetWindowTextLengthW(hwnd)
    buf = ctypes.create_unicode_buffer(length + 1)
    user32.GetWindowTextW(hwnd, buf, length + 1)
    title = buf.value

    pid = wt.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    app = ""
    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid.value)
    if handle:
        try:
            size = wt.DWORD(1024)
            path = ctypes.create_unicode_buffer(size.value)
            if kernel32.QueryFullProcessImageNameW(handle, 0, path, ctypes.byref(size)):
                app = os.path.splitext(os.path.basename(path.value))[0]
        finally:
            kernel32.CloseHandle(handle)
    return title, app


class WindowWatcher:
    """Manda a janela em foco pro hub quando muda (checa a cada `every` s)."""

    def __init__(self, send, every: float = 2.0) -> None:
        self.send = send
        self.every = every
        self._last = ("", "")

    async def run(self) -> None:
        import asyncio

        while True:
            try:
                title, app = foreground_window()
                # ignora o próprio ARO e janelas sem título
                if title and app.lower() not in ("electron", "aro") and (title, app) != self._last:
                    self._last = (title, app)
                    await self.send({"type": "context.window", "title": title[:120], "app": app})
            except Exception as err:  # noqa: BLE001
                log.debug("janela em foco falhou: %s", err)
            await asyncio.sleep(self.every)


if __name__ == "__main__":
    print(foreground_window())
    time.sleep(0.2)
