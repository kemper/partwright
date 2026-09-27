// Cost-formula regression tests focused on the bugs the recent audit
// surfaced. catalog.test.ts already covers happy-path pricing and tier
// selection from the models.dev snapshot; this file pins the no-double-
// count contract (input + cache_read on the SAME turn) and a few formatUsd
// edge cases the snapshot can't drift.

import { describe, test, expect } from 'vitest';
import { turnCostUsd, formatUsd } from '../../src/ai/cost';
import { getPricing, getModelOptions, getFamilyPricing } from '../../src/ai/catalog';

describe('turnCostUsd no-double-count contract', () => {
  // The bug we're guarding against: OpenAI / Gemini provider files used to
  // pass through `prompt_tokens` (a TOTAL that already included cached) as
  // `inputTokens`, and then cost.ts ALSO added `cacheReadInputTokens` — so
  // cached tokens got charged 1.0× via input + 0.1× via cache_read = 1.1×
  // for every cache-heavy turn. The fix normalizes at the provider boundary
  // so `inputTokens` consistently means "uncached input only" across
  // providers. This test pins the formula: cost(uncached, cached) must
  // equal cost(uncached, 0) + cost(0, cached).
  for (const provider of ['openai', 'gemini', 'anthropic'] as const) {
    test(`${provider}: uncached + cached on the same turn = sum of the parts`, () => {
      const opts = getModelOptions(provider);
      if (opts.length === 0) return; // tolerate an empty snapshot for the provider
      // Pick the first non-tiered model so tier crossover doesn't confuse the
      // additivity check. Most options are flat-rate; a tiered one would
      // make uncached pricing depend on the combined tier sum.
      const flat = opts.find((o) => {
        const p = getPricing(provider, o.id);
        return p && (!p.tiers || p.tiers.length === 0);
      });
      if (!flat) return;
      const uncachedOnly = turnCostUsd(provider, flat.id, {
        inputTokens: 100_000,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      });
      const cachedOnly = turnCostUsd(provider, flat.id, {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 900_000,
      });
      const combined = turnCostUsd(provider, flat.id, {
        inputTokens: 100_000,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 900_000,
      });
      expect(combined).toBeCloseTo(uncachedOnly + cachedOnly, 6);
      // Sanity: the combined cost must NOT charge cached at the full input
      // rate (the pre-fix bug). Combined cost should be strictly less than
      // pricing the full 1M as fresh input + the cached rate again.
      const pricing = getPricing(provider, flat.id)!;
      const doubleCount = (1_000_000 * pricing.input + 900_000 * (pricing.cacheRead ?? pricing.input * 0.1)) / 1_000_000;
      expect(combined).toBeLessThan(doubleCount);
    });
  }
});

describe('known-model pricing for out-of-snapshot compaction models', () => {
  // The bug we're guarding against: gpt-4o-mini is the OpenAI compaction model
  // but isn't in the build-time catalog snapshot (filtered to last-year
  // releases). A catalog miss fell through to the Sonnet-tier FALLBACK_PRICING
  // ($3/$15 per 1M), over-reporting the summarize call ~5–40×. cost.ts now
  // carries an explicit KNOWN_MODEL_PRICING entry for it.
  test('gpt-4o-mini priced at its real (cheap) rate, not the Sonnet fallback', () => {
    const usage = {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    };
    const cost = turnCostUsd('openai', 'gpt-4o-mini', usage);
    // Real gpt-4o-mini: $0.15 in + $0.60 out per 1M = $0.75.
    expect(cost).toBeCloseTo(0.75, 6);
    // Must be far below the $3 + $15 = $18 Sonnet-tier fallback.
    const fallback = turnCostUsd('openai', 'totally-unknown-model-xyz', usage);
    expect(fallback).toBeGreaterThan(cost * 10);
  });

  test('cached gpt-4o-mini input uses the discounted cache-read rate', () => {
    const cost = turnCostUsd('openai', 'gpt-4o-mini', {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 1_000_000,
    });
    // cacheRead $0.075 per 1M.
    expect(cost).toBeCloseTo(0.075, 6);
  });
});

describe('family pricing for ids newer than the snapshot', () => {
  // The bug we're guarding against: a deployed build's snapshot predates a
  // model the user picked from the live "Load models from your key" list
  // (production shipped without `gemini-3.8-flash`). The catalog miss fell
  // through to the Sonnet-tier FALLBACK_PRICING ($3/$15), reporting a Flash
  // session at ~4× its real Google bill. An unknown id in a recognizable
  // family now borrows the newest same-family catalog price.
  const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
  const newestFlash = () => getModelOptions('gemini')
    .find((o) => /(^|-)flash($|-)/.test(o.id) && !/lite|image|live|audio|tts/.test(o.id) && getPricing('gemini', o.id));

  test('unknown gemini flash id is priced like the newest catalog flash', () => {
    const donor = newestFlash();
    if (!donor) return; // tolerate a snapshot without a flash model
    const p = getPricing('gemini', donor.id)!;
    const cost = turnCostUsd('gemini', 'gemini-99.9-flash', usage);
    expect(cost).toBeCloseTo(p.input + p.output, 6);
    expect(cost).toBeLessThan(turnCostUsd('gemini', 'totally-unknown-model-xyz', usage));
  });

  test('flash-lite does not borrow full-flash pricing (and vice versa)', () => {
    const lite = getFamilyPricing('gemini', 'gemini-99.9-flash-lite');
    const flash = getFamilyPricing('gemini', 'gemini-99.9-flash');
    if (!lite || !flash) return;
    expect(lite.output).toBeLessThan(flash.output);
  });

  test('specialty variants and family-less ids fall through', () => {
    expect(getFamilyPricing('gemini', 'gemini-99.9-flash-image')).toBeNull();
    expect(getFamilyPricing('gemini', 'gemini-99.9-flash-live-preview')).toBeNull();
    expect(getFamilyPricing('openai', 'totally-made-up-id')).toBeNull();
    // `flashy` is not the `flash` family — tokens match whole segments only.
    expect(getFamilyPricing('gemini', 'gemini-flashy')).toBeNull();
  });

  test('unknown anthropic haiku id is priced as haiku, not the Sonnet fallback', () => {
    const cost = turnCostUsd('anthropic', 'claude-haiku-9-9', usage);
    expect(cost).toBeLessThan(18);
  });
});

describe('pinned compaction-model pricing', () => {
  // gemini-2.5-flash-lite (Gemini's compaction model) had already aged out of
  // the snapshot, so every Gemini /compact was priced at $3/$15 — ~30× over.
  test('gemini-2.5-flash-lite priced at $0.10 / $0.40', () => {
    const cost = turnCostUsd('gemini', 'gemini-2.5-flash-lite', {
      inputTokens: 1_000_000, outputTokens: 1_000_000, cacheCreationInputTokens: 0, cacheReadInputTokens: 0,
    });
    expect(cost).toBeCloseTo(0.5, 6);
  });
});

describe('formatUsd', () => {
  test('zero shows as $0', () => {
    expect(formatUsd(0)).toBe('$0');
  });

  test('sub-1mill values show <$0.001', () => {
    expect(formatUsd(0.0001)).toBe('<$0.001');
  });

  test('sub-cent values use 4 decimals', () => {
    expect(formatUsd(0.0009)).toBe('$0.0009');
    expect(formatUsd(0.005)).toMatch(/^\$0\.005/);
  });

  test('cents-scale uses 3 decimals', () => {
    expect(formatUsd(0.123)).toBe('$0.123');
  });

  test('dollars-scale uses 2 decimals', () => {
    expect(formatUsd(12.345)).toBe('$12.35');
  });
});
