import logging, sys, time
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))
logging.basicConfig(level=logging.INFO, format="[%(name)s] %(message)s")
import numpy as np
from aro_voice.stt import STT
t = time.time()
stt = STT()
print("device:", stt.model.model.device, "compute:", stt.model.model.compute_type, "load+warmup: %.1fs" % (time.time() - t))
# 2s de tom senoidal: não é fala, só mede latência do pipeline
audio = (0.1 * np.sin(2 * np.pi * 440 * np.arange(32000) / 16000)).astype(np.float32)
t = time.time()
print("texto:", repr(stt.transcribe(audio)), "em %.2fs" % (time.time() - t))
