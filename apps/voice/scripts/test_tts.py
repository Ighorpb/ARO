import logging, sys, time, wave
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))
logging.basicConfig(level=logging.INFO, format="[%(name)s] %(message)s")
import numpy as np
from aro_voice.tts import KokoroTTS

t = time.time()
tts = KokoroTTS()
print("load: %.1fs" % (time.time() - t))

for voice in ("pm_alex", "pf_dora", "pm_santa"):
    tts.voice = voice
    t = time.time()
    samples, rate = tts.synthesize("Oi, Ighor. Sao dezoito e quarenta e dois de uma quarta-feira. Ainda da tempo de fazer alguma coisa util hoje.")
    dur = len(samples) / rate
    print(f"{voice}: {dur:.1f}s de audio em {time.time() - t:.2f}s (rate {rate})")
    with wave.open(f"models/sample_{voice}.wav", "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
        w.writeframes((np.clip(samples, -1, 1) * 32767).astype(np.int16).tobytes())
print("wavs salvos em apps/voice/models/sample_*.wav")
