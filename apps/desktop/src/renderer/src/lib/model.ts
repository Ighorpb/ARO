import type { Tier } from "@aro/shared";

/** "claude-opus-5" → "opus 5", "claude-haiku-4-5" → "haiku 4.5" */
export function modelName(id: string): string {
  return id
    .replace(/^claude-/, "")
    .replace(/-(\d+)-(\d+)$/, " $1.$2")
    .replace(/-(\d+)$/, " $1");
}

export const TIER_LABEL: Record<Tier, string> = {
  fast: "rápido",
  main: "normal",
  deep: "profundo",
};

export function fmtUsd(usd: number): string {
  if (usd < 0.001) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}
