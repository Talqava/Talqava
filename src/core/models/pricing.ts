// What a model call cost, estimated from the tokens it used.
import type { ModelUsage, Prices } from "./types.ts";

// Anthropic list prices per million tokens, as of November 2026. Estimates
// for budgeting only: the provider's bill is the real figure.
export const CLAUDE_PRICES: Record<string, Prices> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-fable-5-2": { input: 8, output: 40, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

export const FREE: Prices = { input: 0, output: 0 };

/** Dollars spent on one call. Cache writes cost 1.25x input; cache reads 0.1x unless listed. */
export function costOf(prices: Prices, usage: ModelUsage): number {
  const perToken = (perMillion: number) => perMillion / 1_000_000;
  return (
    usage.input * perToken(prices.input) +
    (usage.cacheWrite ?? 0) * perToken(prices.cacheWrite ?? prices.input * 1.25) +
    (usage.cacheRead ?? 0) * perToken(prices.cacheRead ?? prices.input * 0.1) +
    usage.output * perToken(prices.output)
  );
}
