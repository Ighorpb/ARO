import type Anthropic from "@anthropic-ai/sdk";

/** USD por milhão de tokens. Cache: leitura 0.1x, escrita 5m 1.25x, escrita 1h 2x. */
interface Price {
  input: number;
  output: number;
}

const PRICES: Record<string, Price> = {
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

const WEB_SEARCH_PER_1000 = 10;

type Usage = Anthropic.Beta.BetaUsage | Anthropic.Usage;

function priceFor(model: string): Price {
  const key = Object.keys(PRICES).find((k) => model.startsWith(k));
  return key ? PRICES[key]! : PRICES["claude-opus-5"]!;
}

/** Custo em USD de uma chamada, a partir do `usage` da resposta. */
export function costOf(model: string, usage: Usage, defaultTtl: "5m" | "1h"): number {
  const p = priceFor(model);
  const perTok = (n: number, perM: number) => (n / 1_000_000) * perM;

  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const creation = (usage as Anthropic.Beta.BetaUsage).cache_creation;
  const write5m = creation?.ephemeral_5m_input_tokens ?? (defaultTtl === "5m" ? (usage.cache_creation_input_tokens ?? 0) : 0);
  const write1h = creation?.ephemeral_1h_input_tokens ?? (defaultTtl === "1h" ? (usage.cache_creation_input_tokens ?? 0) : 0);
  const searches = (usage as Anthropic.Beta.BetaUsage).server_tool_use?.web_search_requests ?? 0;

  return (
    perTok(usage.input_tokens, p.input) +
    perTok(usage.output_tokens, p.output) +
    perTok(cacheRead, p.input * 0.1) +
    perTok(write5m, p.input * 1.25) +
    perTok(write1h, p.input * 2) +
    (searches / 1000) * WEB_SEARCH_PER_1000
  );
}

export function fmtUsd(usd: number): string {
  if (usd < 0.001) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}
