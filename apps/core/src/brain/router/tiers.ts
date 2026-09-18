export type Tier = "fast" | "main" | "deep";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface TierProfile {
  model: string;
  effort: Effort;
}

function effort(raw: string | undefined, fallback: Effort): Effort {
  const ok: Effort[] = ["low", "medium", "high", "xhigh", "max"];
  return ok.includes(raw as Effort) ? (raw as Effort) : fallback;
}

/** Perfil de cada tier — modelo e esforço, configuráveis por env. */
export const TIERS: Record<Tier, TierProfile> = {
  fast: {
    model: process.env.ARO_MODEL_FAST ?? "claude-sonnet-5",
    effort: effort(process.env.ARO_EFFORT_FAST, "low"),
  },
  main: {
    model: process.env.ARO_MODEL_MAIN ?? "claude-opus-5",
    effort: effort(process.env.ARO_EFFORT_MAIN, "medium"),
  },
  deep: {
    model: process.env.ARO_MODEL_DEEP ?? "claude-opus-5",
    effort: effort(process.env.ARO_EFFORT_DEEP, "high"),
  },
};

export const CLASSIFIER_MODEL = process.env.ARO_MODEL_CLASSIFIER ?? "claude-haiku-4-5";

/** Tier rápido sem thinking: hora/clima/nota respondem na hora. ARO_FAST_THINKING=on liga de volta. */
const FAST_THINKING = (process.env.ARO_FAST_THINKING ?? "off").toLowerCase() === "on";

/** Força um tier (debug) — "auto" deixa o roteador decidir. */
export const FORCED_TIER: Tier | null = (() => {
  const raw = process.env.ARO_ROUTER;
  return raw === "fast" || raw === "main" || raw === "deep" ? raw : null;
})();

/**
 * Parâmetros de request que variam por modelo.
 * Fallback server-side só existe pro Opus 5; compaction vale pros dois.
 */
export function tierRequestParams(tier: Tier) {
  const { model, effort } = TIERS[tier];
  const isOpus = model.startsWith("claude-opus");
  const noThinking = tier === "fast" && !FAST_THINKING && !isOpus;
  return {
    model,
    output_config: { effort },
    thinking: noThinking ? ({ type: "disabled" } as const) : ({ type: "adaptive", display: "summarized" } as const),
    betas: isOpus ? ["server-side-fallback-2026-07-01", "compact-2026-01-12"] : ["compact-2026-01-12"],
    ...(isOpus ? { fallbacks: "default" as const } : {}),
  };
}
