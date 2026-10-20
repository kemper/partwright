// Cost-formula regression tests focused on the bugs the recent audit
// surfaced. catalog.test.ts already covers happy-path pricing and tier
// selection from the models.dev snapshot; this file pins the no-double-
// count contract (input + cache_read on the SAME turn) and a few formatUsd
// edge cases the snapshot can't drift.

import { describe, test, expect } from 'vitest';
import { turnCostUsd, formatUsd, hasKnownPricing, estimateTurnCostUsd } from '../../src/ai/cost';
import { getPricing, getModelOptions } from '../../src/ai/catalog';
import { ANTHROPIC_MODEL_OPTIONS, OPENAI_MODEL_OPTIONS, GEMINI_MODEL_OPTIONS } from '../../src/ai/settings';

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
  // releases). A catalog miss used to fall through to a guessed $3/$15
  // rate, over-reporting the summarize call ~5–40×. cost.ts now carries an
  // explicit KNOWN_MODEL_PRICING entry for it.
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

describe('unknown model pricing is reported as unknown, never guessed', () => {
  // The bug we're guarding against: a deployed build's snapshot predates a
  // model the user picked from the live "Load models from your key" list
  // (production shipped without `gemini-3.8-flash`). The catalog miss used a
  // guessed $3/$15 median rate, reporting a Flash session at ~4× its real
  // Google bill. Unpriced models now return null so the UI can say "cost
  // unknown" and ask the user to authorize them.
  const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };

  for (const provider of ['anthropic', 'openai', 'gemini'] as const) {
    test(`${provider}: an id missing from the catalog has no price`, () => {
      expect(turnCostUsd(provider, 'model-from-the-future-9000', usage)).toBeNull();
      expect(estimateTurnCostUsd(provider, 'model-from-the-future-9000', 1000, 500)).toBeNull();
      expect(hasKnownPricing(provider, 'model-from-the-future-9000')).toBe(false);
    });
  }

  test('catalog models are priced', () => {
    const opt = getModelOptions('gemini').find((o) => getPricing('gemini', o.id));
    if (!opt) return;
    expect(hasKnownPricing('gemini', opt.id)).toBe(true);
    expect(turnCostUsd('gemini', opt.id, usage)).toBeGreaterThan(0);
  });

  test('local and custom providers are free, not unknown', () => {
    for (const provider of ['local', 'custom']) {
      expect(hasKnownPricing(provider, 'anything')).toBe(true);
      expect(turnCostUsd(provider, 'anything', usage)).toBe(0);
    }
  });
});

describe('every model the app offers is priced', () => {
  // An unpriced model makes the panel ask the user to authorize it, so any
  // id we ship as a default or picker option must carry real pricing —
  // otherwise every new user hits the prompt (gpt-5-mini, the OpenAI
  // default, had aged out of the snapshot).
  test('defaults and picker options', () => {
    const offered: Array<[string, string]> = [
      ['openai', 'gpt-5-mini'],
      ['gemini', 'gemini-flash-latest'],
      ...ANTHROPIC_MODEL_OPTIONS.map((o) => ['anthropic', o.id] as [string, string]),
      ...OPENAI_MODEL_OPTIONS.map((o) => ['openai', o.id] as [string, string]),
      ...GEMINI_MODEL_OPTIONS.map((o) => ['gemini', o.id] as [string, string]),
    ];
    const unpriced = offered.filter(([p, id]) => !hasKnownPricing(p, id)).map(([p, id]) => `${p}/${id}`);
    expect(unpriced).toEqual([]);
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
