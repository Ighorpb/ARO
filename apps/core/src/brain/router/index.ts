import type Anthropic from "@anthropic-ai/sdk";
import type { Channel, TranscriptEntry } from "@aro/shared";
import { classify } from "./classifier";
import { routeByRules } from "./rules";
import { CLASSIFIER_MODEL, FORCED_TIER, TIERS, type Tier } from "./tiers";
import { costOf } from "../pricing";

export type RouteSource = "forced" | "rule" | "classifier" | "fallback" | "voice";

export interface Route {
  tier: Tier;
  model: string;
  source: RouteSource;
  reason?: string;
  costUsd: number;
}

const CLASSIFIER_TIMEOUT_MS = 4000;
const VOICE_SHORT_LEN = 60;

/** Regras primeiro (0ms). Sem match → classificador. Erro/timeout → main. */
export async function route(client: Anthropic, text: string, recent: TranscriptEntry[], channel: Channel = "text"): Promise<Route> {
  if (FORCED_TIER) return { tier: FORCED_TIER, model: TIERS[FORCED_TIER].model, source: "forced", costUsd: 0 };

  const byRule = routeByRules(text);
  if (byRule) return { tier: byRule, model: TIERS[byRule].model, source: "rule", costUsd: 0 };

  // fala curta: pula o classificador (latência) — quase sempre é coisa simples
  if (channel === "voice" && text.trim().length <= VOICE_SHORT_LEN) {
    return { tier: "fast", model: TIERS.fast.model, source: "voice", costUsd: 0 };
  }

  try {
    const decision = await Promise.race([
      classify(client, text, recent),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("classificador demorou demais")), CLASSIFIER_TIMEOUT_MS),
      ),
    ]);
    return {
      tier: decision.tier,
      model: TIERS[decision.tier].model,
      source: "classifier",
      reason: decision.reason,
      costUsd: costOf(CLASSIFIER_MODEL, decision.usage, "5m"),
    };
  } catch (err) {
    console.warn("[router] classificador falhou, indo de main:", (err as Error).message);
    return { tier: "main", model: TIERS.main.model, source: "fallback", costUsd: 0 };
  }
}

export { TIERS, type Tier } from "./tiers";
