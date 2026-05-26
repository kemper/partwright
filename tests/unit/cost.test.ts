// Unit tests for the per-provider USD cost calculation. The cost meter
// matters because it gates the session spend cap and shows users an estimate
// before each send. A double-count of cached tokens silently inflates both.

import { describe, test, expect } from 'vitest';
import { turnCostUsd, estimateTurnCostUsd, formatUsd } from '../../src/ai/cost';

describe('turnCostUsd', () => {
  test('Anthropic: input/output billed at list price, cache reads at 10%', () => {
    // claude-sonnet-4-6 = $3 input / $15 output per 1M
    const cost = turnCostUsd('anthropic', 'claude-sonnet-4-6', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    });
    expect(cost).toBeCloseTo(3 + 15, 6);
  });

  test('Anthropic: cache reads at 10x discount (~10% of input)', () => {
    // 1M cached read = 1M * $3 * 0.1 = $0.30
    const cost = turnCostUsd('anthropic', 'claude-sonnet-4-6', {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(0.30, 6);
  });

  test('OpenAI: inputTokens is uncached only (post-fix), so no double-charge', () => {
    // gpt-5 = $5 / $25 per 1M
    // 200k uncached + 1.8M cached = $5*0.2 + $5*0.1*1.8 = $1.00 + $0.90 = $1.90
    // Pre-fix bug: treated 2M as uncached -> $10 + $0.90 cache = $10.90 (+10%)
    const cost = turnCostUsd('openai', 'gpt-5', {
      inputTokens: 200_000,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 1_800_000,
    });
    expect(cost).toBeCloseTo(1.90, 6);
  });

  test('Gemini: inputTokens is uncached only (post-fix)', () => {
    // gemini-3-pro-preview = $2 / $12 per 1M
    // 100k uncached + 900k cached = $2*0.1 + $2*0.1*0.9 = $0.20 + $0.18 = $0.38
    const cost = turnCostUsd('gemini', 'gemini-3-pro-preview', {
      inputTokens: 100_000,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 900_000,
    });
    expect(cost).toBeCloseTo(0.38, 6);
  });

  test('local: always free', () => {
    expect(turnCostUsd('local', 'qwen-anything', {
      inputTokens: 1_000_000_000,
      outputTokens: 1_000_000_000,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    })).toBe(0);
  });

  test('unknown OpenAI model falls back to a non-zero estimate', () => {
    // Don't tie the test to the fallback's exact rate — just make sure we
    // don't silently bill $0 for a typo'd model id (the meter would lie).
    const cost = turnCostUsd('openai', 'gpt-future-100x', {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    });
    expect(cost).toBeGreaterThan(0);
  });

  test('cache write multiplier (Anthropic) is ~125% of input', () => {
    // 1M cache-write = 1M * $3 * 1.25 = $3.75
    const cost = turnCostUsd('anthropic', 'claude-sonnet-4-6', {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 1_000_000,
      cacheReadInputTokens: 0,
    });
    expect(cost).toBeCloseTo(3.75, 6);
  });
});

describe('estimateTurnCostUsd', () => {
  test('treats cached prefix as cache reads, fresh input as full price', () => {
    // gpt-5 = $5 / $25 per 1M, expected output 1k = $0.025
    // 100k cached -> $5 * 0.1 * 0.1 = $0.05
    // 10k fresh   -> $5 * 0.01     = $0.05
    // total ~ $0.10 + $0.025 = $0.125
    const cost = estimateTurnCostUsd('openai', 'gpt-5', 100_000, 10_000, 1_000);
    expect(cost).toBeCloseTo(0.125, 4);
  });
});

describe('formatUsd', () => {
  test('zero shows as $0', () => {
    expect(formatUsd(0)).toBe('$0');
  });

  test('sub-cent values get extra precision', () => {
    expect(formatUsd(0.0001)).toBe('<$0.001');
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
