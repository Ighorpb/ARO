import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv(path: Path) -> None:
    """Le o .env da raiz do repo sem dependencia extra. Env real tem prioridade."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("\"").strip("'"))


_load_dotenv(ROOT.parent.parent / ".env")

HUB_URL = os.environ.get("ARO_HUB_URL", f"ws://localhost:{os.environ.get('ARO_PORT', '7777')}")

# Nível de log da voz: info | debug
LOG_LEVEL = os.environ.get("ARO_LOG", "info").upper()

# ElevenLabs: com chave, vira o ouvido (Scribe Realtime) e a boca (Flash) principais
ELEVEN_API_KEY = os.environ.get("ELEVENLABS_API_KEY", "").strip()
ELEVEN_VOICE = os.environ.get("ARO_ELEVEN_VOICE", "kd1lRcSdRGIfyKxQKjmH")  # Ale Garcia (PT-BR)
ELEVEN_MODEL = os.environ.get("ARO_ELEVEN_MODEL", "eleven_flash_v2_5")

# STT: elevenlabs (streaming, texto ~0.3s depois que você para) | whisper (local, fallback)
STT_ENGINE = os.environ.get("ARO_STT", "elevenlabs" if ELEVEN_API_KEY else "whisper")
WHISPER_MODEL = os.environ.get("ARO_WHISPER_MODEL", "large-v3-turbo")
WHISPER_DEVICE = os.environ.get("ARO_WHISPER_DEVICE", "auto")  # auto | cuda | cpu
WHISPER_BEAM = int(os.environ.get("ARO_WHISPER_BEAM", "1"))
# Contexto pro Whisper: nomes e termos que voce usa (melhora reconhecimento)
WHISPER_PROMPT = os.environ.get(
    "ARO_WHISPER_PROMPT",
    "Conversa em portugues do Brasil com o ARO, assistente do Ighor. Disrupty, TypeScript, Next.js, Electron, deploy, commit.",
)
SAMPLE_RATE = 16000

# Detecção de fala por energia. Nível mínimo (RMS) que conta como voz — mic com ganho baixo precisa de menos
MIC_MIN_LEVEL = float(os.environ.get("ARO_MIC_MIN_LEVEL", "0.006"))
SILENCE_MS = int(os.environ.get("ARO_SILENCE_MS", "500"))
MAX_RECORD_S = int(os.environ.get("ARO_MAX_RECORD_S", "30"))
# Ativou (wake/atalho) e ninguém falou: desiste depois disso
NO_SPEECH_TIMEOUT_S = float(os.environ.get("ARO_NO_SPEECH_S", "4"))
# Conversa continua: depois de responder, fica ouvindo esse tanto sem precisar ativar (0 = off)
FOLLOW_UP_S = float(os.environ.get("ARO_FOLLOW_UP_S", "4"))

# TTS
TTS_VOICE = os.environ.get("ARO_TTS_VOICE", "pm_alex")  # pf_dora | pm_alex | pm_santa
TTS_SPEED = float(os.environ.get("ARO_TTS_SPEED", "1.05"))
KOKORO_MODEL = ROOT / "models" / "kokoro-v1.0.onnx"
KOKORO_VOICES = ROOT / "models" / "voices-v1.0.bin"

# always = fala toda resposta | voice = só responde falando quando você falou
SPEAK_MODE = os.environ.get("ARO_SPEAK", "always")

# Dispositivos de áudio: parte do nome (ex: "HyperX"). Vazio = padrão do Windows.
INPUT_DEVICE = os.environ.get("ARO_INPUT_DEVICE", "")
OUTPUT_DEVICE = os.environ.get("ARO_OUTPUT_DEVICE", "")

# Bipe curto quando ativa pela wake word
CHIME_ENABLED = os.environ.get("ARO_CHIME", "on").lower() in ("on", "1", "true", "yes")

# Motor de voz: elevenlabs (Edge assume se cair) | edge (Microsoft, Kokoro assume se cair) | kokoro (local)
TTS_ENGINE = os.environ.get("ARO_TTS", "elevenlabs" if ELEVEN_API_KEY else "edge")
EDGE_VOICE = os.environ.get("ARO_EDGE_VOICE", "pt-BR-AntonioNeural")
EDGE_RATE = os.environ.get("ARO_EDGE_RATE", "+12%")
EDGE_PITCH = os.environ.get("ARO_EDGE_PITCH", "+0Hz")

# Barge-in por voz: voce comeca a falar enquanto ele fala -> ele cala e ouve.
# Deixe off com caixa de som (ele se escutaria). Com fone, on.
BARGE_IN = os.environ.get("ARO_BARGE_IN", "off").lower() in ("on", "1", "true", "yes")
BARGE_IN_LEVEL = float(os.environ.get("ARO_BARGE_IN_LEVEL", "0.45"))
BARGE_IN_MS = int(os.environ.get("ARO_BARGE_IN_MS", "350"))

# Wake word: fala "ARO" pra ativar. Detector = Whisper na GPU.
WAKE_ENABLED = os.environ.get("ARO_WAKE", "on").lower() in ("on", "1", "true", "yes")
WAKE_MODEL = os.environ.get("ARO_WAKE_MODEL", "base")
WAKE_WORDS = [w.strip() for w in os.environ.get("ARO_WAKE_WORDS", "aro,arô").split(",") if w.strip()]

# Filler falado enquanto pensa em pergunta pesada (tier deep)
FILLERS = [f.strip() for f in os.environ.get("ARO_FILLERS", "Deixa eu ver.|Um segundo.|Deixa eu pensar.").split("|") if f.strip()]
