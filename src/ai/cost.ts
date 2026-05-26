// USD cost calculation. Pricing flows from the models.dev snapshot via
// src/ai/catalog.ts, which is refreshed at build time so we never have to
// chase price changes by hand. For ids the snapshot doesn't carry — custom
// dated snapshots the user types in, or models too new to have been ingested
// yet — we fall back to FALLBACK_PRICING so the cost meter still tracks
// something rather than reading $0 and lying.
//
// Cache costs use the catalog's explicit `cache_read` / `cache_write` rates
// when present; otherwise we estimate at the historical Anthropic ratios
// (10% / 125% of input) since that's the only provider that meters cache
// separately for the cost meter. OpenAI applies its cache discount server-
// side, and Gemini's streaming endpoint surfaces no cache metric at all.
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

/** Conservative fallback for custom model ids the snapshot doesn't carry.
 *  Picked to be in the median tier (Sonnet-ish) so the cost meter doesn't
 *  lie by reading "$0" when the user has typed in a new dated snapshot. */
const FALLBACK_PRICING: CatalogPricing = { input: 3.0, output: 15.0 };

function pricingFor(provider: string, model: string): CatalogPricing | null {
  if (provider === 'local') return null;
  // The catalog is keyed by our internal Provider type; cast through string
  // because the call sites pass `provider` as a raw string (the same way
  // the rest of the cost meter does).
  const fromCatalog = getPricing(provider as Provider, model);
  if (fromCatalog) return fromCatalog;
  // Hosted provider but unknown id — use the median fallback rather than
  // reporting $0, so the cost meter is conservative on novel snapshots.
  if (provider === 'anthropic' || provider === 'openai' || provider === 'gemini') {
    return FALLBACK_PRICING;
  }
  return null;
}

export function turnCostUsd(provider: string, model: string, usage: TurnUsage): number {
  const p = pricingFor(provider, model);
  if (!p) return 0;
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
