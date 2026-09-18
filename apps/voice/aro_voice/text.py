import re

_SENTENCE_END = re.compile(r"(?<=[.!?…])\s+|\n+")
_CLAUSE_END = re.compile(r"(?<=[,;:])\s+")
_URL = re.compile(r"https?://\S+")
_MARKDOWN = re.compile(r"[*_`#>]+")
_SPACES = re.compile(r"[ \t]+")

MIN_CHUNK = 14
EAGER_MIN = 28


def clean_for_speech(text: str) -> str:
    text = _URL.sub("um link", text)
    text = _MARKDOWN.sub("", text)
    text = text.replace("—", ", ").replace("–", ", ")
    return _SPACES.sub(" ", text).strip()


def split_sentences(buffer: str, eager: bool = False) -> tuple[list[str], str]:
    """Separa frases completas do que ainda esta sendo escrito.
    Frases curtinhas ("Ok.") esperam a proxima pra nao soar picotado.
    `eager`: sem frase fechada ainda, solta a primeira oracao na virgula
    pra primeira fala sair mais cedo."""
    parts = _SENTENCE_END.split(buffer)
    if len(parts) <= 1:
        if eager:
            clauses = _CLAUSE_END.split(buffer, maxsplit=1)
            if len(clauses) == 2 and len(clauses[0]) >= EAGER_MIN:
                return [clauses[0].strip()], clauses[1]
        return [], buffer

    complete, rest = parts[:-1], parts[-1]
    merged: list[str] = []
    for piece in complete:
        piece = piece.strip()
        if not piece:
            continue
        if merged and len(merged[-1]) < MIN_CHUNK:
            merged[-1] = f"{merged[-1]} {piece}"
        else:
            merged.append(piece)

    if merged and len(merged[-1]) < MIN_CHUNK:
        rest = f"{merged.pop()} {rest}"

    return merged, rest
