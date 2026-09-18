"""Gera amostras das vozes Edge em PT-BR e mede latência."""
import logging, sys, time, wave
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
logging.basicConfig(level=logging.WARNING)
import numpy as np
from aro_voice import config
from aro_voice.tts_edge import EdgeTTS

TEXT = "Oi, Igão. São dezoito e quarenta e dois de uma quarta-feira. Ainda dá tempo de fazer alguma coisa útil hoje, ou você prefere que eu te lembre disso amanhã de manhã?"
VOICES = [
    "pt-BR-AntonioNeural",
    "pt-BR-FranciscaNeural",
    "pt-BR-ThalitaMultilingualNeural",
    "en-US-AndrewMultilingualNeural",
    "en-US-BrianMultilingualNeural",
]

tts = EdgeTTS()
for voice in VOICES:
    tts.voice = voice
    t = time.time()
    try:
        samples, rate = tts.synthesize(TEXT)
    except Exception as err:
        print(f"{voice}: falhou ({err})")
        continue
    took = time.time() - t
    out = Path("models") / f"sample_edge_{voice.split('-')[2].replace('Neural', '').replace('Multilingual', '')}.wav"
    with wave.open(str(out), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
        w.writeframes((np.clip(samples, -1, 1) * 32767).astype(np.int16).tobytes())
    print(f"{voice}: {len(samples) / rate:.1f}s de audio em {took:.2f}s -> {out.name}")
