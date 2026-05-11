// USD cost calculation per Anthropic public list pricing (Apr 2026 cache).
// Prices in $ per million tokens. Cache reads are billed at ~10% of input,
// cache writes (5-min TTL) at ~125% of input. We don't expose 1h-TTL caching.
//
// Local-provider turns are free at the API level (the user paid for the
// download + electricity), so all local cost functions return 0. The cost
// meter still tracks total tokens so users can compare model verbosity.

import type { AnthropicModelId, TurnUsage } from './types';

interface ModelPricing {
  /** USD per 1M input tokens (uncached). */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
}

const PRICING: Record<AnthropicModelId, ModelPricing> = {
  'claude-haiku-4-5': { input: 1.0, output: 5.0 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-opus-4-7': { input: 5.0, output: 25.0 },
};

const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

function isAnthropicModel(model: string): model is AnthropicModelId {
  return model in PRICING;
}

export function turnCostUsd(model: string, usage: TurnUsage): number {
  if (!isAnthropicModel(model)) return 0;
  const p = PRICING[model];
  const inputCost = (usage.inputTokens * p.input) / 1_000_000;
  const cacheReadCost = (usage.cacheReadInputTokens * p.input * CACHE_READ_MULTIPLIER) / 1_000_000;
  const cacheWriteCost = (usage.cacheCreationInputTokens * p.input * CACHE_WRITE_MULTIPLIER) / 1_000_000;
  const outputCost = (usage.outputTokens * p.output) / 1_000_000;
  return inputCost + cacheReadCost + cacheWriteCost + outputCost;
}

/** Pre-turn estimate. Treats the cached prefix as cache-read (~0.1x), the
 *  per-turn user content as fresh input, and assumes a moderate output size.
 *  Used to render the "~$0.03/turn" hint next to the send button. */
export function estimateTurnCostUsd(
  model: string,
  cachedPrefixTokens: number,
  freshInputTokens: number,
  expectedOutputTokens: number = 800,
): number {
  if (!isAnthropicModel(model)) return 0;
  return turnCostUsd(model, {
    inputTokens: freshInputTokens,
    outputTokens: expectedOutputTokens,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: cachedPrefixTokens,
  });
}

export function formatUsd(amount: number): string {
  if (amount === 0) return '$0';
  if (amount < 0.0005) return '<$0.001';
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  if (amount < 1) return `$${amount.toFixed(3)}`;
  return `$${amount.toFixed(2)}`;
}
