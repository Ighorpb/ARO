"""Boca com TTS falso: mede buracos entre frases (pipeline deve ~zerar)."""
import sys, time, threading
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import numpy as np
from aro_voice import mouth as mouth_mod
from aro_voice.tts import Speech, stream_from_speech

SYNTH_S, AUDIO_S = 0.4, 0.8
events = []

class FakeTTS:
    def synthesize(self, text):
        time.sleep(SYNTH_S)
        return Speech(np.zeros(int(24000 * AUDIO_S), dtype=np.float32), 24000)
    def stream(self, text):
        yield from stream_from_speech(self, text)

class FakeOut:
    def __init__(self, **kw): pass
    def start(self): pass
    def stop(self): pass
    def close(self): pass
    def write(self, piece): time.sleep(len(piece) / 24000)

mouth_mod.sd.OutputStream = FakeOut  # nao toca de verdade
m = mouth_mod.Mouth(FakeTTS(), lambda s: events.append((time.time(), s)), lambda l: None, lambda t, w: None)

t0 = time.time()
m.begin()
for word in "Primeira frase aqui, com uma virgula no meio. Segunda frase curta demais. Terceira frase pra fechar o teste todo.".split(" "):
    m.feed(word + " "); time.sleep(0.05)
m.flush()
while not (events and events[-1][1] == "idle"):
    time.sleep(0.05)
    if time.time() - t0 > 15: print("timeout"); break
for t, s in events:
    print(f"{t - t0:5.2f}s {s}")
print("frases ~3, sintese 0.4s cada, audio 0.8s cada")
print("serial daria ~3.6s falando; pipeline deve dar ~2.4s + primeira sintese")
