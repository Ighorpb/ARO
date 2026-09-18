import type { Tier } from "./tiers";

/**
 * Heurísticas baratas. Só decidem quando a intenção é óbvia;
 * o resto vai pro classificador.
 */

const FAST_INTENT = [
  /\b(que|qual)\s+horas?\b/i,
  /\bque dia\b|\bdata de hoje\b|\bhoje é\b/i,
  /\b(clima|tempo|previs[ãa]o|chov(e|er|endo)|chuva|temperatura|calor|frio)\b/i,
  /\babr(e|a|ir|indo)\b/i,
  /\b(anota|anote|nota|notas|lembra|lembre|lembrete|lembretes|to-?do|tarefa|tarefas|lista)\b/i,
  /\b(pesquisa|procura|busca)\b/i,
  /^(oi|olá|ola|e a[ií]|eai|fala|bom dia|boa tarde|boa noite|valeu|obrigad[oa]|vlw|ok|beleza|blz|show|top|certo|entendi|tá|ta bom|perfeito)\b/i,
];

const DEEP_INTENT = [
  /\b(analis[ae]|compar[ae]|planej[ae]|arquitetura|estrat[ée]gia|trade-?offs?|prós e contras|pr[óo]s\s+e\s+contras)\b/i,
  /\b(pensa|pense)\s+(bem|com calma|direito|a fundo)\b/i,
  /\b(detalhad[oa]|aprofund[ae]|em profundidade|passo a passo)\b/i,
  /\b(refator|debug|implementa|c[óo]digo|fun[çc][ãa]o|classe|bug|erro no)\b/i,
  /```/,
];

const FAST_MAX_LEN = 120;
const DEEP_MIN_LEN = 800;

export function routeByRules(text: string): Tier | null {
  const t = text.trim();

  if (DEEP_INTENT.some((re) => re.test(t)) || t.length >= DEEP_MIN_LEN) return "deep";
  if (t.length <= FAST_MAX_LEN && FAST_INTENT.some((re) => re.test(t))) return "fast";

  return null;
}
