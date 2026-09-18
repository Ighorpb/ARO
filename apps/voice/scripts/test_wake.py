"""Testa o detector de wake word com frases sintetizadas pelo Edge."""
import asyncio, logging, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
logging.basicConfig(level=logging.WARNING)
import numpy as np
from aro_voice import config
from aro_voice.mic import Mic
from aro_voice.tts_edge import EdgeTTS
from aro_voice.wake import WakeWord

PHRASES = [
    ("ARO, que horas são?", True),
    ("Aro", True),
    ("Ei ARO, abre o Spotify", True),
    ("Oi, tudo bem?", False),
    ("Isso é raro demais", False),
    ("Caro amigo, bom dia", False),
]

def noise_burst(kind):
    """ruidos que nao sao fala: clique, digitacao, chiado"""
    rng = np.random.default_rng(1)
    a = rng.normal(0, 0.002, 16000).astype(np.float32)
    if kind == "clique":
        a[6000:6200] += rng.normal(0, 0.5, 200).astype(np.float32)
    elif kind == "digitacao":
        for i in range(6):
            s = 3000 + i * 1800
            a[s:s+150] += rng.normal(0, 0.3, 150).astype(np.float32)
    elif kind == "chiado":
        a += rng.normal(0, 0.04, 16000).astype(np.float32)
    return a

def to16k(samples, rate):
    n = int(len(samples) * 16000 / rate)
    return np.interp(np.linspace(0, len(samples) - 1, n), np.arange(len(samples)), samples).astype(np.float32)

async def main():
    tts = EdgeTTS()
    loop = asyncio.get_running_loop()
    results = []
    got = {}
    async def on_wake(rest):
        got["rest"] = rest if rest is not None else "none"
    wake = WakeWord(Mic(), loop, on_wake, is_busy=lambda: False)
    wake.enabled = True
    from aro_voice.stt import WhisperModel
    wake._model = WhisperModel(config.WAKE_MODEL, device="cuda", compute_type="float16")
    cases = [(p, e, None) for p, e in PHRASES] + [(f"[ruido: {k}]", False, noise_burst(k)) for k in ("clique", "digitacao", "chiado")]
    for phrase, expected, pre in cases:
        if pre is None:
            sp = await asyncio.to_thread(tts.synthesize, phrase)
            audio = to16k(sp.samples, sp.rate)
        else:
            audio = pre
        got.clear(); wake._blocked_until = 0
        t = time.time(); wake._check(audio); await asyncio.sleep(0.2)
        fired = "rest" in got
        ok = fired == expected
        extra = ""
        if fired and isinstance(got["rest"], np.ndarray):
            extra = f" +comando {len(got['rest'])/16000:.1f}s"
        results.append(ok)
        print(f"{'ok ' if ok else 'ERR'} {phrase!r:32} disparou={fired}{extra}  ({(time.time()-t)*1000:.0f}ms)")
    print(f"\n{sum(results)}/{len(results)}")

asyncio.run(main())
