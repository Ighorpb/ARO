"""Testa o detector de palmas com áudio sintético (sem mic)."""
import asyncio, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import numpy as np
from aro_voice.clap import ClapDetector
from aro_voice.mic import FRAME, Mic

rng = np.random.default_rng(0)


def frames(seconds, impulses=(), sustained=()):
    n = int(seconds * 1000 / 20)
    for i in range(n):
        t = i * 0.02
        mono = rng.normal(0, 0.003, FRAME).astype(np.float32)
        for at, amp, dur in impulses:
            if at <= t < at + dur:
                mono += rng.normal(0, amp, FRAME).astype(np.float32)
        for at, amp, dur in sustained:
            if at <= t < at + dur:
                mono += (amp * np.sin(2 * np.pi * 220 * (np.arange(FRAME) + i * FRAME) / 16000)).astype(np.float32)
        yield mono, float(np.sqrt(np.mean(mono**2)))


async def run(name, gen, expect):
    fired = []
    mic = Mic()
    loop = asyncio.get_running_loop()
    det = ClapDetector(mic, loop, lambda: _fire(fired))
    det._blocked_until = 0
    for mono, rms in gen:
        mic._on_audio(mono.reshape(-1, 1), FRAME, None, None)
        det._on_frame(mono, rms)
    await asyncio.sleep(0.05)
    ok = (len(fired) > 0) == expect
    print(f"{'ok ' if ok else 'ERR'} {name}: disparou={len(fired) > 0} (esperado {expect})")
    return ok


async def _fire(fired):
    fired.append(time.monotonic())


async def main():
    results = [
        await run("duas palmas (300ms)", frames(2, impulses=[(0.5, 0.4, 0.04), (0.8, 0.4, 0.04)]), True),
        await run("uma palma só", frames(2, impulses=[(0.5, 0.4, 0.04)]), False),
        await run("duas palmas longe demais (1.5s)", frames(3, impulses=[(0.5, 0.4, 0.04), (2.0, 0.4, 0.04)]), False),
        await run("voz sustentada", frames(2, sustained=[(0.5, 0.3, 0.6), (1.2, 0.3, 0.5)]), False),
        await run("três palmas rápidas (ambíguo)", frames(2, impulses=[(0.5, 0.4, 0.04), (0.7, 0.4, 0.04), (0.9, 0.4, 0.04)]), False),
        await run("digitação (8 teclas)", frames(2.5, impulses=[(0.4 + i * 0.16, 0.25, 0.02) for i in range(8)]), False),
        await run("tecla fraca x2", frames(2, impulses=[(0.5, 0.05, 0.02), (0.8, 0.05, 0.02)]), False),
        await run("clique antes das palmas", frames(2.5, impulses=[(0.4, 0.3, 0.02), (0.7, 0.4, 0.04), (1.0, 0.4, 0.04)]), False),
        await run("duas palmas depois de silêncio", frames(2.5, impulses=[(1.0, 0.4, 0.04), (1.35, 0.4, 0.04)]), True),
    ]
    print(f"\n{sum(results)}/{len(results)}")


asyncio.run(main())
