// Cost controls for long thinking turns: the 1-hour prompt cache, its
// pricing, the call log's cache-write fields + per-tab persistence, the
// one-step-lower Thinking retry, and the Medium default migration.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cacheControlFor, cacheTtlForThinking, withHistoryCacheBreakpoints } from '../../src/ai/anthropicCache';
import { turnCostUsd } from '../../src/ai/cost';
import { getPricing } from '../../src/ai/catalog';
import { usageEventFields } from '../../src/ai/diagnostics';
import { lowerThinkingLevel } from '../../src/ai/thinkingLevels';
import { isLegacyDefaultThinking } from '../../src/ai/settings';

describe('1-hour prompt cache', () => {
  it('uses the 1-hour cache only at High+ thinking, and only when enabled', () => {
    expect(cacheTtlForThinking('high', true)).toBe('1h');
    expect(cacheTtlForThinking('xhigh', true)).toBe('1h');
    expect(cacheTtlForThinking('max', true)).toBe('1h');
    for (const level of ['off', 'default', 'low', 'medium'] as const) expect(cacheTtlForThinking(level, true)).toBe('5m');
    expect(cacheTtlForThinking(undefined, true)).toBe('5m');
    expect(cacheTtlForThinking('max', false)).toBe('5m');
  });

  it('keeps the 5-minute marker byte-identical to the pre-TTL request', () => {
    expect(cacheControlFor('5m')).toEqual({ type: 'ephemeral' });
    expect(cacheControlFor('1h')).toEqual({ type: 'ephemeral', ttl: '1h' });
    const out = withHistoryCacheBreakpoints([{ role: 'user', content: 'hi' }]);
    expect(out[0].content).toEqual([{ type: 'text', text: 'hi', cache_control: { type: 'ephemeral' } }]);
  });

  it('puts the TTL on every history breakpoint', () => {
    const out = withHistoryCacheBreakpoints([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
    ], '1h');
    const markers = out.flatMap(m => Array.isArray(m.content)
      ? m.content.map(b => ('cache_control' in b ? b.cache_control : null)).filter(Boolean)
      : []);
    expect(markers).toEqual([{ type: 'ephemeral', ttl: '1h' }, { type: 'ephemeral', ttl: '1h' }]);
  });

  it('prices 1-hour cache writes at 2× input and 5-minute writes at the 5m rate', () => {
    const model = 'claude-opus-5-5';
    const p = getPricing('anthropic', model);
    expect(p).not.toBeNull();
    const base = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0 };
    const fiveMin = turnCostUsd('anthropic', model, { ...base, cacheCreationInputTokens: 1_000_000 })!;
    const oneHour = turnCostUsd('anthropic', model, { ...base, cacheCreationInputTokens: 1_000_000, cacheCreation1hInputTokens: 1_000_000 })!;
    expect(fiveMin).toBeCloseTo(p!.cacheWrite ?? p!.input * 1.25, 6);
    expect(oneHour).toBeCloseTo(p!.input * 2, 6);
    // A split write bills each part at its own rate.
    const split = turnCostUsd('anthropic', model, { ...base, cacheCreationInputTokens: 1_000_000, cacheCreation1hInputTokens: 400_000 })!;
    expect(split).toBeCloseTo(fiveMin * 0.6 + oneHour * 0.4, 6);
  });
});

describe('AI call log usage fields', () => {
  it('records cache writes, the 1-hour part, and the cost', () => {
    expect(usageEventFields({ inputTokens: 2, outputTokens: 334, cacheReadInputTokens: 0, cacheCreationInputTokens: 158_000, cacheCreation1hInputTokens: 158_000 }, 1.26)).toEqual({
      inputTokens: 2, outputTokens: 334, cachedTokens: 0, cacheWriteTokens: 158_000, cacheWrite1hTokens: 158_000, costUsd: 1.26,
    });
  });

  it('leaves out zero writes and an unpriced cost', () => {
    expect(usageEventFields({ inputTokens: 5, outputTokens: 1, cacheReadInputTokens: 160_092, cacheCreationInputTokens: 0 }, null)).toEqual({
      inputTokens: 5, outputTokens: 1, cachedTokens: 160_092,
    });
  });
});

describe('AI call log survives a reload (per-tab sessionStorage)', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    });
    vi.resetModules();
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('restores recorded events in a fresh module instance and forgets them on Clear', async () => {
    const first = await import('../../src/ai/diagnostics');
    first.recordEvent({ provider: 'anthropic', model: 'claude-opus-5-5', kind: 'streamTurn', durationMs: 310_759, status: 'ok', stopReason: 'max_tokens', outputTokens: 32_768 });
    vi.resetModules();
    const reloaded = await import('../../src/ai/diagnostics');
    const events = reloaded.listEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ model: 'claude-opus-5-5', outputTokens: 32_768, stopReason: 'max_tokens' });
    reloaded.clearEvents();
    vi.resetModules();
    expect((await import('../../src/ai/diagnostics')).listEvents()).toEqual([]);
  });

  it('ignores a corrupt saved log', async () => {
    store.set('partwright.aiCallLog', '{not json');
    expect((await import('../../src/ai/diagnostics')).listEvents()).toEqual([]);
    store.set('partwright.aiCallLog', JSON.stringify([{ nope: 1 }, { id: 'x', timestamp: 1 }]));
    vi.resetModules();
    expect((await import('../../src/ai/diagnostics')).listEvents().map(e => e.id)).toEqual(['x']);
  });
});

describe('lowerThinkingLevel', () => {
  it('steps one level down, and offers nothing below Low', () => {
    expect(lowerThinkingLevel('max')).toBe('xhigh');
    expect(lowerThinkingLevel('xhigh')).toBe('high');
    expect(lowerThinkingLevel('high')).toBe('medium');
    expect(lowerThinkingLevel('medium')).toBe('low');
    expect(lowerThinkingLevel('default')).toBe('low');
    expect(lowerThinkingLevel('low')).toBeNull();
    expect(lowerThinkingLevel('off')).toBeNull();
  });
});

describe('default Thinking level', () => {
  const KEY = 'partwright-ai-settings-v1';
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    });
    vi.resetModules();
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  async function thinkingFor(stored: unknown): Promise<string> {
    if (stored === undefined) store.delete(KEY); else store.set(KEY, JSON.stringify(stored));
    // Fresh module per read: settings are cached per tab, and a reload keeps
    // this tab's toggles by design (cross-tab isolation).
    vi.resetModules();
    const s = await import('../../src/ai/settings');
    return s.loadSettings().toggles.thinking;
  }

  it('is Medium for a fresh install', async () => {
    expect(await thinkingFor(undefined)).toBe('medium');
  });

  it('lowers a pre-rev-2 High (the old default) once, on any preset', async () => {
    expect(await thinkingFor({ preset: 'standard', toggles: { thinking: 'high' }, settingsRev: 1 })).toBe('medium');
    expect(await thinkingFor({ preset: 'custom', toggles: { thinking: 'high' } })).toBe('medium');
  });

  it('keeps any other level, and a High picked after the change', async () => {
    expect(await thinkingFor({ preset: 'full', toggles: { thinking: 'xhigh' }, settingsRev: 1 })).toBe('xhigh');
    expect(await thinkingFor({ preset: 'custom', toggles: { thinking: 'low' }, settingsRev: 1 })).toBe('low');
    expect(await thinkingFor({ preset: 'custom', toggles: { thinking: 'high' }, settingsRev: 2 })).toBe('high');
  });
});

describe('session toggle snapshots', () => {
  it('treats a High saved without a rev (or below rev 2) as the old default', () => {
    expect(isLegacyDefaultThinking('high', undefined)).toBe(true);
    expect(isLegacyDefaultThinking('high', 1)).toBe(true);
    expect(isLegacyDefaultThinking('high', 2)).toBe(false);
    expect(isLegacyDefaultThinking('xhigh', undefined)).toBe(false);
    expect(isLegacyDefaultThinking('low', undefined)).toBe(false);
  });
});
