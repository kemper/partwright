// Cost-formula regression tests focused on the bugs the recent audit
// surfaced. catalog.test.ts already covers happy-path pricing and tier
// selection from the models.dev snapshot; this file pins the no-double-
// count contract (input + cache_read on the SAME turn) and a few formatUsd
// edge cases the snapshot can't drift.

import { describe, test, expect } from 'vitest';
import { turnCostUsd, formatUsd } from '../../src/ai/cost';
import { getPricing, getModelOptions } from '../../src/ai/catalog';

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
