import { describe, expect, it } from 'vitest';
import {
  anthropicThinkingFamily,
  anthropicThinkingPlan,
  customReasoningFields,
  geminiThinkingConfig,
  openaiReasoningEffort,
} from '../../src/ai/thinkingLevels';
import { THINKING_LEVELS, parseThinkingLevel } from '../../src/ai/types';

const BUDGETS = { low: 2048, medium: 8192, high: 16384 };

describe('anthropicThinkingFamily', () => {
  it.each([
    ['claude-haiku-4-5', 'budget'],
    ['claude-haiku-4-5-20251001', 'budget'],
    ['claude-sonnet-4-5-20250929', 'budget'],
    ['claude-opus-4-1-20250805', 'budget'],
    ['claude-opus-4-20250514', 'budget'],
    ['claude-3-5-sonnet-latest', 'budget'],
    ['claude-sonnet-4-6', 'adaptive46'],
    ['claude-opus-4-6', 'adaptive46'],
    ['claude-opus-4-7', 'adaptive'],
    ['claude-opus-4-8', 'adaptive'],
    ['claude-sonnet-5', 'adaptive'],
    ['claude-opus-5', 'alwaysOn'],
    ['claude-opus-5-5', 'alwaysOn'],
    ['claude-fable-5', 'alwaysOn'],
    ['claude-fable-5-1', 'alwaysOn'],
    ['claude-mythos-5-1', 'alwaysOn'],
  ] as const)('%s → %s', (model, family) => {
    expect(anthropicThinkingFamily(model)).toBe(family);
  });
});

describe('anthropicThinkingPlan', () => {
  it('older models keep budget_tokens; xhigh/max clamp to the high budget', () => {
    expect(anthropicThinkingPlan('claude-haiku-4-5', 'off', BUDGETS)).toEqual({ active: false, budgetTokens: 0 });
    expect(anthropicThinkingPlan('claude-haiku-4-5', 'default', BUDGETS)).toEqual({ active: false, budgetTokens: 0 });
    expect(anthropicThinkingPlan('claude-haiku-4-5', 'medium', BUDGETS).thinking).toEqual({ type: 'enabled', budget_tokens: 8192 });
    expect(anthropicThinkingPlan('claude-haiku-4-5', 'max', BUDGETS).thinking).toEqual({ type: 'enabled', budget_tokens: 16384 });
    expect(anthropicThinkingPlan('claude-haiku-4-5', 'max', BUDGETS).effort).toBeUndefined();
  });

  it('Opus 4.7 never gets budget_tokens (the API 400s on it)', () => {
    for (const level of Object.keys(THINKING_LEVELS) as (keyof typeof THINKING_LEVELS)[]) {
      const plan = anthropicThinkingPlan('claude-opus-4-7', level, BUDGETS);
      expect(plan.thinking?.type).not.toBe('enabled');
      expect(plan.budgetTokens).toBe(0);
    }
  });

  it('Opus 4.7: adaptive + effort + summarized display; off disables; default omits', () => {
    expect(anthropicThinkingPlan('claude-opus-4-7', 'high', BUDGETS)).toEqual({
      thinking: { type: 'adaptive', display: 'summarized' }, effort: 'high', active: true, budgetTokens: 0,
    });
    expect(anthropicThinkingPlan('claude-opus-4-7', 'xhigh', BUDGETS).effort).toBe('xhigh');
    expect(anthropicThinkingPlan('claude-opus-4-7', 'max', BUDGETS).effort).toBe('max');
    expect(anthropicThinkingPlan('claude-opus-4-7', 'off', BUDGETS)).toEqual({ thinking: { type: 'disabled' }, active: false, budgetTokens: 0 });
    expect(anthropicThinkingPlan('claude-opus-4-7', 'default', BUDGETS)).toEqual({ active: false, budgetTokens: 0 });
  });

  it('Claude 4.6: no display override, xhigh rounds down to high', () => {
    expect(anthropicThinkingPlan('claude-sonnet-4-6', 'xhigh', BUDGETS)).toEqual({
      thinking: { type: 'adaptive' }, effort: 'high', active: true, budgetTokens: 0,
    });
    expect(anthropicThinkingPlan('claude-sonnet-4-6', 'max', BUDGETS).effort).toBe('max');
  });

  it('Sonnet 5 thinks by default, so Default still asks to see it', () => {
    expect(anthropicThinkingPlan('claude-sonnet-5', 'default', BUDGETS)).toEqual({
      thinking: { type: 'adaptive', display: 'summarized' }, active: true, budgetTokens: 0,
    });
    expect(anthropicThinkingPlan('claude-sonnet-5', 'off', BUDGETS).thinking).toEqual({ type: 'disabled' });
  });

  it('always-on models: Off is lowest effort (never disabled), Default sends no effort', () => {
    for (const model of ['claude-opus-5', 'claude-opus-5-5', 'claude-fable-5-1']) {
      const off = anthropicThinkingPlan(model, 'off', BUDGETS);
      expect(off).toEqual({ thinking: { type: 'adaptive', display: 'summarized' }, effort: 'low', active: true, budgetTokens: 0 });
      const def = anthropicThinkingPlan(model, 'default', BUDGETS);
      expect(def.effort).toBeUndefined();
      expect(def.active).toBe(true);
    }
  });
});

describe('openaiReasoningEffort', () => {
  it('off and default → omitted (provider default), low/medium/high pass through', () => {
    // No single "lowest" effort is valid on every reasoning model (-pro models
    // reject low, gpt-5.1+ default to none), so Off leaves the field out.
    expect(openaiReasoningEffort('gpt-5-mini', 'off')).toBeNull();
    expect(openaiReasoningEffort('gpt-5-pro', 'off')).toBeNull();
    expect(openaiReasoningEffort('gpt-5-mini', 'default')).toBeNull();
    expect(openaiReasoningEffort('o3', 'medium')).toBe('medium');
  });

  it('xhigh/max clamp to what the model supports', () => {
    expect(openaiReasoningEffort('gpt-5', 'xhigh')).toBe('high');
    expect(openaiReasoningEffort('o3', 'max')).toBe('high');
    expect(openaiReasoningEffort('gpt-5.5', 'xhigh')).toBe('xhigh');
    expect(openaiReasoningEffort('gpt-5.5', 'max')).toBe('xhigh');
    expect(openaiReasoningEffort('gpt-5.6-sol', 'max')).toBe('max');
    expect(openaiReasoningEffort('gpt-6-astra', 'max')).toBe('max');
  });
});

describe('customReasoningFields', () => {
  it('visibility only unless the user opted into reasoning_effort', () => {
    expect(customReasoningFields('off', false)).toEqual({});
    expect(customReasoningFields('high', false)).toEqual({ include_reasoning: true });
    expect(customReasoningFields('default', false)).toEqual({ include_reasoning: true });
  });

  it('opted in: Low → Max pass through; off and default send no effort', () => {
    expect(customReasoningFields('xhigh', true)).toEqual({ include_reasoning: true, reasoning_effort: 'xhigh' });
    // 'none' would mean "thinking disabled", which Opus 5.5 / Fable reject.
    expect(customReasoningFields('off', true)).toEqual({});
    expect(customReasoningFields('default', true)).toEqual({ include_reasoning: true });
  });
});

describe('geminiThinkingConfig', () => {
  it('off hides thoughts, default lets the model pick, max uses the high budget', () => {
    expect(geminiThinkingConfig('off', BUDGETS)).toEqual({ includeThoughts: false });
    expect(geminiThinkingConfig('default', BUDGETS)).toEqual({ includeThoughts: true });
    expect(geminiThinkingConfig('low', BUDGETS)).toEqual({ includeThoughts: true, thinkingBudget: 2048 });
    expect(geminiThinkingConfig('max', BUDGETS)).toEqual({ includeThoughts: true, thinkingBudget: 16384 });
  });
});

describe('parseThinkingLevel', () => {
  it('accepts every level (old saved values stay valid) and rejects junk', () => {
    for (const l of ['off', 'low', 'medium', 'high', 'default', 'xhigh', 'max']) expect(parseThinkingLevel(l)).toBe(l);
    expect(parseThinkingLevel('ultra')).toBeNull();
    expect(parseThinkingLevel(undefined)).toBeNull();
    expect(parseThinkingLevel('toString')).toBeNull();
  });
});
