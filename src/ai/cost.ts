// USD cost calculation. Pricing comes from each provider's public list
// prices (mid-2026 cache). Prices in $ per million tokens. Cache reads
// are billed at ~10% of input, cache writes (5-min TTL) at ~125% of
// input — Anthropic only; OpenAI shows cached tokens in usage but
// auto-applies the discount on their end. Gemini has no surfaced cache
// metric in the streaming endpoint we use.
//
// Local-provider turns are free at the API level (the user paid for the
// download + electricity), so all local cost functions return 0. The cost
// meter still tracks total tokens so users can compare model verbosity.

import type { TurnUsage } from './types';

interface ModelPricing {
  /** USD per 1M input tokens (uncached). */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
}

const ANTHROPIC_PRICING: Record<string, ModelPricing> = {
  'claude-haiku-4-5': { input: 1.0, output: 5.0 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-opus-4-7': { input: 5.0, output: 25.0 },
};

const OPENAI_PRICING: Record<string, ModelPricing> = {
  // gpt-5.5 rates are a best-effort estimate (pinned to the gpt-5 tier)
  // until OpenAI publishes them; the cost meter is explicitly "estimated".
  'gpt-5.5':       { input: 5.00, output: 25.00 },
  'gpt-5':         { input: 5.00, output: 25.00 },
  'gpt-5-mini':    { input: 0.50, output:  2.00 },
  'gpt-5-nano':    { input: 0.10, output:  0.40 },
  'o3':            { input: 2.00, output:  8.00 },
  'gpt-4.1':       { input: 2.00, output:  8.00 },
  'gpt-4o':        { input: 2.50, output: 10.00 },
  'gpt-4o-mini':   { input: 0.15, output:  0.60 },
};

// Approximate per-tier pricing. Preview/`-latest` ids don't publish
// stable rates, so these are best-effort by tier (pro / flash / lite);
// the cost meter is explicitly "estimated" and any id we don't list
// falls back to FALLBACK_PRICING.
const GEMINI_PRICING: Record<string, ModelPricing> = {
  // Pro tier
  'gemini-3.1-pro-preview': { input: 2.00, output: 12.00 },
  'gemini-3-pro-preview':   { input: 2.00, output: 12.00 },
  'gemini-pro-latest':      { input: 2.00, output: 12.00 },
  'gemini-2.5-pro':         { input: 1.25, output: 10.00 },
  // Flash (balanced) tier
  'gemini-3.5-flash':       { input: 0.40, output:  3.00 },
  'gemini-3-flash-preview': { input: 0.40, output:  3.00 },
  'gemini-flash-latest':    { input: 0.40, output:  3.00 },
  'gemini-2.5-flash':       { input: 0.30, output:  2.50 },
  // Flash-Lite (cheap/fast) tier
  'gemini-flash-lite-latest':  { input: 0.10, output: 0.40 },
  'gemini-3.1-flash-lite':     { input: 0.10, output: 0.40 },
  'gemini-2.5-flash-lite':     { input: 0.10, output: 0.40 },
};

const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

/** Conservative fallback for custom model ids we don't have an entry for.
 *  Picked to be in the median tier (Sonnet-ish) so the cost meter
 *  doesn't lie by reading "$0" when the user has typed in a new dated
 *  snapshot we haven't curated yet. */
const FALLBACK_PRICING: ModelPricing = { input: 3.0, output: 15.0 };

/** Where pricing lives keyed by provider. Local has no pricing —
 *  cost = 0 regardless. */
const PROVIDER_PRICING: Record<string, Record<string, ModelPricing>> = {
  anthropic: ANTHROPIC_PRICING,
  openai: OPENAI_PRICING,
  gemini: GEMINI_PRICING,
};

function pricingFor(provider: string, model: string): ModelPricing | null {
  if (provider === 'local') return null;
  const table = PROVIDER_PRICING[provider];
  if (!table) return null;
  return table[model] ?? FALLBACK_PRICING;
}

export function turnCostUsd(provider: string, model: string, usage: TurnUsage): number {
  const p = pricingFor(provider, model);
  if (!p) return 0;
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
  provider: string,
  model: string,
  cachedPrefixTokens: number,
  freshInputTokens: number,
  expectedOutputTokens: number = 800,
): number {
  return turnCostUsd(provider, model, {
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
