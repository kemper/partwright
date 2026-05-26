import { describe, test, expect } from 'vitest';
import {
  getModelOptions,
  getCatalogModel,
  getPricing,
  getCapabilities,
  getLimits,
  hasModel,
  pricingTierFor,
  type CatalogPricing,
} from '../../src/ai/catalog';
import { turnCostUsd, estimateTurnCostUsd } from '../../src/ai/cost';
import catalogJson from '../../src/ai/generated/modelsCatalog.json' with { type: 'json' };

// These tests cover the catalog accessor layer and the cost meter's
// catalog-driven pricing. They run against the committed snapshot under
// src/ai/generated/modelsCatalog.json, which the build-time Vite plugin
// refreshes from models.dev — so the assertions intentionally exercise
// shape and behavior rather than locked-in price values that would drift.

describe('catalog snapshot shape', () => {
  test('contains the three providers we wire up', () => {
    const ids = Object.keys(catalogJson as Record<string, unknown>).sort();
    expect(ids).toEqual(['anthropic', 'google', 'openai']);
  });

  test('every model has a release_date inside the rolling year window', () => {
    const cutoff = Date.now() - 365 * 86_400_000;
    const slack = 7 * 86_400_000; // tolerate week-of-day variance vs script run
    const cat = catalogJson as Record<string, { models: Record<string, { release_date: string }> }>;
    for (const [providerId, provider] of Object.entries(cat)) {
      for (const [modelId, model] of Object.entries(provider.models)) {
        const m = model.release_date.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
        expect(m, `${providerId}/${modelId}: release_date should match YYYY-MM[-DD]`).toBeTruthy();
        const date = Date.UTC(+m![1], +m![2] - 1, +(m![3] ?? '01'));
        expect(date, `${providerId}/${modelId}: ${model.release_date} is older than the rolling window`).toBeGreaterThan(cutoff - slack);
      }
    }
  });

  test('every model surfaces a usable cost and limit block', () => {
    const cat = catalogJson as Record<string, { models: Record<string, { cost?: { input?: number; output?: number }; limit?: { context?: number; output?: number }; tool_call?: boolean }> }>;
    for (const [providerId, provider] of Object.entries(cat)) {
      for (const [modelId, model] of Object.entries(provider.models)) {
        const where = `${providerId}/${modelId}`;
        expect(model.tool_call, `${where}: must be a tool-capable model`).toBe(true);
        expect(model.cost?.input, `${where}: cost.input`).toBeGreaterThan(0);
        expect(model.cost?.output, `${where}: cost.output`).toBeGreaterThan(0);
        expect(model.limit?.context, `${where}: limit.context`).toBeGreaterThan(0);
        expect(model.limit?.output, `${where}: limit.output`).toBeGreaterThan(0);
      }
    }
  });
});

describe('getModelOptions', () => {
  test('returns sorted newest-first for each hosted provider', () => {
    for (const p of ['anthropic', 'openai', 'gemini'] as const) {
      const opts = getModelOptions(p);
      expect(opts.length, `${p} options`).toBeGreaterThan(0);
      // The previous release_date should be >= the next one (descending).
      for (let i = 1; i < opts.length; i++) {
        const prev = getCatalogModel(p, opts[i - 1].id)!.releaseDate;
        const curr = getCatalogModel(p, opts[i].id)!.releaseDate;
        expect(prev >= curr, `${p}: ${opts[i - 1].id} (${prev}) should sort before ${opts[i].id} (${curr})`).toBe(true);
      }
    }
  });

  test('returns [] for the local provider', () => {
    expect(getModelOptions('local')).toEqual([]);
  });

  test("maps Partwright's 'gemini' to models.dev's 'google' bucket", () => {
    // If this drifts the picker would go empty — guard the mapping explicitly.
    const opts = getModelOptions('gemini');
    expect(opts.some((o) => o.id.startsWith('gemini-'))).toBe(true);
  });
});

describe('per-model accessors', () => {
  test('hasModel / getCatalogModel / getPricing / getCapabilities / getLimits agree', () => {
    const opts = getModelOptions('anthropic');
    expect(opts.length).toBeGreaterThan(0);
    const sample = opts[0].id;
    expect(hasModel('anthropic', sample)).toBe(true);
    const model = getCatalogModel('anthropic', sample);
    expect(model).not.toBeNull();
    expect(model!.id).toBe(sample);
    expect(getPricing('anthropic', sample)?.input).toBeGreaterThan(0);
    expect(getCapabilities('anthropic', sample)?.toolCall).toBe(true);
    expect(getLimits('anthropic', sample)?.context).toBeGreaterThan(0);
  });

  test('unknown ids return null across all accessors', () => {
    const fake = 'not-a-real-model-id-123';
    expect(hasModel('openai', fake)).toBe(false);
    expect(getCatalogModel('openai', fake)).toBeNull();
    expect(getPricing('openai', fake)).toBeNull();
    expect(getCapabilities('openai', fake)).toBeNull();
    expect(getLimits('openai', fake)).toBeNull();
  });

  test('local provider returns null for any model id', () => {
    expect(getPricing('local', 'some-local-model')).toBeNull();
    expect(getCapabilities('local', 'some-local-model')).toBeNull();
    expect(getLimits('local', 'some-local-model')).toBeNull();
  });

  test('OpenAI reasoning capability is data-driven, not regex-driven', () => {
    // gpt-5 family is reasoning-capable. The capability flag is what
    // isReasoningModel() reads to decide between /v1/responses (reasoning)
    // and /v1/chat/completions (non-reasoning), so a least one current
    // gpt-5* model must be marked reasoning=true.
    const opts = getModelOptions('openai');
    const reasoners = opts.filter((o) => getCapabilities('openai', o.id)?.reasoning === true);
    const gpt5Reasoner = reasoners.find((o) => /^gpt-5(\.\d+)?$/i.test(o.id));
    expect(gpt5Reasoner, 'expected at least one gpt-5* model with reasoning=true').toBeTruthy();
  });
});

describe('pricingTierFor', () => {
  const base: CatalogPricing = {
    input: 2,
    output: 12,
    cacheRead: 0.2,
    tiers: [
      { thresholdTokens: 200_000, input: 4, output: 18, cacheRead: 0.4 },
    ],
  };

  test('under the threshold returns base rates', () => {
    expect(pricingTierFor(base, 100_000)).toEqual({ input: 2, output: 12, cacheRead: 0.2, cacheWrite: undefined });
  });

  test('exactly at the threshold picks the tier rate', () => {
    expect(pricingTierFor(base, 200_000)).toEqual({ input: 4, output: 18, cacheRead: 0.4, cacheWrite: undefined });
  });

  test('well above the threshold picks the tier rate', () => {
    expect(pricingTierFor(base, 500_000)).toEqual({ input: 4, output: 18, cacheRead: 0.4, cacheWrite: undefined });
  });

  test('models without tiers return base rates regardless of input', () => {
    const flat: CatalogPricing = { input: 1, output: 5 };
    expect(pricingTierFor(flat, 1_000_000)).toEqual({ input: 1, output: 5, cacheRead: undefined, cacheWrite: undefined });
  });
});

describe('turnCostUsd', () => {
  test('returns 0 for local provider regardless of usage', () => {
    expect(turnCostUsd('local', 'qwen2.5-coder', { inputTokens: 100_000, outputTokens: 5_000, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 })).toBe(0);
  });

  test('respects catalog pricing for a known model', () => {
    // Pick the cheapest current Anthropic model for a stable shape check.
    // Whatever Haiku tier ships, $X for 1M input + $Y for 1M output yields X+Y total.
    const opts = getModelOptions('anthropic');
    const haiku = opts.find((o) => /haiku/i.test(o.label)) ?? opts[opts.length - 1];
    const price = getPricing('anthropic', haiku.id)!;
    const cost = turnCostUsd('anthropic', haiku.id, {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    });
    expect(cost).toBeCloseTo(price.input + price.output, 6);
  });

  test('falls back to median pricing for an unknown hosted id', () => {
    // FALLBACK_PRICING is { input: 3, output: 15 } — see cost.ts.
    const cost = turnCostUsd('openai', 'totally-made-up-id', {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    });
    expect(cost).toBeCloseTo(3, 6);
  });

  test('uses the catalog cache_read rate when present', () => {
    // Haiku 4.5 carries explicit cache_read = 0.10, so a 1M cache read = $0.10.
    const opts = getModelOptions('anthropic');
    const haiku = opts.find((o) => /haiku/i.test(o.label));
    if (!haiku) return; // tolerate snapshots that don't include Haiku
    const price = getPricing('anthropic', haiku.id)!;
    if (price.cacheRead === undefined) return;
    const cost = turnCostUsd('anthropic', haiku.id, {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(price.cacheRead, 6);
  });
});

describe('turnCostUsd tier selection', () => {
  test('a heavy cache-read load does NOT push the turn into a higher tier', () => {
    // Gemini 3 Pro Preview is the canonical tiered model: base $2 / $12 below
    // 200k, tier $4 / $18 above. A turn with 100k fresh input + 250k cache
    // reads must price the fresh portion at the *base* rate ($2/M = $0.20),
    // not the tier rate. Cache-replay tokens are billed at cache_read
    // independently of the input tier.
    const opts = getModelOptions('gemini');
    const tieredOpt = opts.find((o) => o.id === 'gemini-3-pro-preview');
    if (!tieredOpt) return; // tolerate snapshots that don't include this preview
    const pricing = getPricing('gemini', tieredOpt.id)!;
    if (!pricing.tiers || pricing.tiers.length === 0) return;
    const cost = turnCostUsd('gemini', tieredOpt.id, {
      inputTokens: 100_000,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 250_000,
    });
    // Base input rate × 100k fresh + cache_read × 250k.
    const baseInput = pricing.input * 100_000 / 1_000_000;
    const cacheRead = (pricing.cacheRead ?? pricing.input * 0.1) * 250_000 / 1_000_000;
    expect(cost).toBeCloseTo(baseInput + cacheRead, 6);
  });
});

describe('estimateTurnCostUsd', () => {
  test('treats the cached prefix as cache-read and the fresh input as fresh', () => {
    const opts = getModelOptions('anthropic');
    const haiku = opts.find((o) => /haiku/i.test(o.label));
    if (!haiku) return;
    const price = getPricing('anthropic', haiku.id)!;
    const cost = estimateTurnCostUsd('anthropic', haiku.id, 1_000_000, 0, 0);
    // 1M cache_read tokens × cacheRead rate (or 0.1× input if absent).
    const expected = price.cacheRead ?? price.input * 0.1;
    expect(cost).toBeCloseTo(expected, 6);
  });
});
