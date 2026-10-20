// USD cost calculation. Pricing flows from the models.dev snapshot via
// src/ai/catalog.ts, which is refreshed at build time so we never have to
// chase price changes by hand. A handful of older ids that have aged out of
// the snapshot window are pinned in KNOWN_MODEL_PRICING.
//
// Anything else — a model newer than the deployed snapshot, picked from the
// live "Load models from your key" list, or a hand-typed id — has NO price.
// We deliberately don't guess: a guessed median rate over-reported a Gemini
// Flash session ~4× against the real Google bill. Unpriced turns return
// `null` from turnCostUsd, the transcript shows "cost unknown", and the panel
// asks the user to authorize the model before spending on it (the $ cap
// can't bound what it can't measure). See hasKnownPricing().
//
// Cache costs use the catalog's explicit `cache_read` / `cache_write` rates
// when present; otherwise we estimate at the historical Anthropic ratios
// (10% / 125% of input) since that's the only provider that meters cache
// separately for the cost meter. OpenAI and Gemini report the cached subset
// of the prompt (`cached_tokens` / `cachedContentTokenCount`), which the
// provider files split out as `cacheReadInputTokens`.
//
// Tiered pricing (Gemini's >200k context bracket) is picked per-turn based
// on the actual input-token count for the turn — see pricingTierFor().
//
// Local-provider turns are free at the API level (the user paid for the
// download + electricity), so all local cost functions return 0. The cost
// meter still tracks total tokens so users can compare model verbosity.

import type { TurnUsage } from './types';
import type { Provider } from './types';
import { getPricing, pricingTierFor, type CatalogPricing } from './catalog';

const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

/** Explicit prices for known cheap models the build-time catalog snapshot
 *  doesn't carry (it's filtered to the last year of releases, so an
 *  older-but-still-used id drops out). Without these, a catalog miss leaves
 *  the model unpriced.
 *  Pin real published rates only — never an estimate. Compaction's
 *  per-provider cheap model (`COMPACTION_MODEL` in compaction.ts) is the main
 *  caller: all three of its ids are pinned here so the summarize cost stays
 *  right as they age out of the snapshot window.
 *  Keyed `provider/model`; rates are USD per 1M tokens. */
const KNOWN_MODEL_PRICING: Record<string, CatalogPricing> = {
  // gpt-4o-mini: $0.15 in / $0.60 out, cached input $0.075.
  'openai/gpt-4o-mini': { input: 0.15, output: 0.6, cacheRead: 0.075 },
  // gemini-2.5-flash-lite: $0.10 in / $0.40 out, cached input $0.01.
  'gemini/gemini-2.5-flash-lite': { input: 0.1, output: 0.4, cacheRead: 0.01 },
  // claude-haiku-4-5: $1 in / $5 out, cache read $0.10 / write $1.25.
  'anthropic/claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  // The GPT-5 trio (gpt-5-mini is DEFAULT_OPENAI_MODEL) and Gemini 2.5
  // Flash/Pro are still offered by settings.ts but have aged out of the
  // snapshot. Rates copied from earlier models.dev snapshots of
  // src/ai/generated/modelsCatalog.json.
  'openai/gpt-5': { input: 1.25, output: 10, cacheRead: 0.125 },
  'openai/gpt-5-mini': { input: 0.25, output: 2, cacheRead: 0.025 },
  'openai/gpt-5-nano': { input: 0.05, output: 0.4, cacheRead: 0.005 },
  'gemini/gemini-2.5-flash': { input: 0.3, output: 2.5, cacheRead: 0.03 },
  'gemini/gemini-2.5-pro': {
    input: 1.25, output: 10, cacheRead: 0.125,
    tiers: [{ thresholdTokens: 200_000, input: 2.5, output: 15, cacheRead: 0.25 }],
  },
};

function pricingFor(provider: string, model: string): CatalogPricing | null {
  // The catalog is keyed by our internal Provider type; cast through string
  // because the call sites pass `provider` as a raw string (the same way
  // the rest of the cost meter does).
  return getPricing(provider as Provider, model) ?? KNOWN_MODEL_PRICING[`${provider}/${model}`] ?? null;
}

/** Local (WebGPU) and custom (self-hosted OpenAI-compatible endpoint) turns
 *  are free at the API level — the user paid for the hardware/electricity. */
function isFreeProvider(provider: string): boolean {
  return provider === 'local' || provider === 'custom';
}

/** True when we can put a real dollar figure on this model's turns: it's a
 *  free (local/custom) provider, or a hosted model with catalog/pinned
 *  pricing. False means the cost meter and the $ spend cap can't track it. */
export function hasKnownPricing(provider: string, model: string): boolean {
  return isFreeProvider(provider) || pricingFor(provider, model) !== null;
}

/** USD cost of one turn, or `null` when the model has no known pricing
 *  (see hasKnownPricing) — callers must surface that as "unknown", never
 *  as $0 or a guess. */
export function turnCostUsd(provider: string, model: string, usage: TurnUsage): number | null {
  if (isFreeProvider(provider)) return 0;
  const p = pricingFor(provider, model);
  if (!p) return null;
  // Pick the pricing tier from the *non-cache-replay* portion of this turn:
  // fresh prompt tokens plus any cache-creation (the first time a prefix is
  // sent to be cached, those are billed as fresh tokens too). Cache-read
  // tokens are the cheap-replay portion and are billed at the cache_read
  // rate independently of tier — including them in the threshold sum would
  // push long-cached OpenAI sessions (gpt-5.5 has a 272k tier) into the
  // higher bracket even when the fresh prompt is small.
  const tieredInput = usage.inputTokens + usage.cacheCreationInputTokens;
  const rate = pricingTierFor(p, tieredInput);
  const inputCost = (usage.inputTokens * rate.input) / 1_000_000;
  const outputCost = (usage.outputTokens * rate.output) / 1_000_000;
  // Prefer the catalog's explicit cache rates; fall back to the historical
  // Anthropic multipliers when the catalog doesn't surface them (older
  // entries, or providers that don't price cache separately).
  const cacheReadRate = rate.cacheRead ?? rate.input * CACHE_READ_MULTIPLIER;
  const cacheWriteRate = rate.cacheWrite ?? rate.input * CACHE_WRITE_MULTIPLIER;
  const cacheReadCost = (usage.cacheReadInputTokens * cacheReadRate) / 1_000_000;
  const cacheWriteCost = (usage.cacheCreationInputTokens * cacheWriteRate) / 1_000_000;
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
): number | null {
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
