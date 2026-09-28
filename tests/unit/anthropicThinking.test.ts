import { afterEach, describe, expect, test } from 'vitest';
import {
  anthropicCannotDisable,
  anthropicEffortLevels,
  learnAnthropicCannotDisable,
  learnAnthropicThinkingMode,
  resetLearnedThinkingModes,
  resolveAnthropicThinkingMode,
  thinkingModeFromError,
} from '../../src/ai/anthropicThinking';
import { getCapabilities, getModelOptions } from '../../src/ai/catalog';
import { anthropicThinkingPlan } from '../../src/ai/thinkingLevels';
import { THINKING_LEVELS } from '../../src/ai/types';

afterEach(() => resetLearnedThinkingModes());

describe('resolveAnthropicThinkingMode', () => {
  test('ids missing from the snapshot fall back to the name heuristic', () => {
    // Legacy families take budget_tokens…
    for (const id of [
      'claude-3-7-sonnet-latest',
      'claude-haiku-4-5-20251001',
      'claude-sonnet-4-5',
      'claude-opus-4-1',
      'claude-opus-4-20250514',
    ]) {
      if (getCapabilities('anthropic', id)) continue; // catalog wins when present
      expect(resolveAnthropicThinkingMode(id), id).toBe('budget');
    }
    // …everything newer (incl. unreleased ids) is adaptive — the Opus 5.5
    // regression: `thinking.type.enabled` 400s on it.
    for (const id of ['claude-opus-5-5', 'claude-sonnet-6', 'claude-opus-4-9', 'claude-fable-6']) {
      if (getCapabilities('anthropic', id)) continue;
      expect(resolveAnthropicThinkingMode(id), id).toBe('adaptive');
    }
  });

  test('catalog reasoning_options drive the shape when present', () => {
    for (const { id } of getModelOptions('anthropic')) {
      const caps = getCapabilities('anthropic', id)!;
      if (caps.budgetTokens) expect(resolveAnthropicThinkingMode(id), id).toBe('budget');
      else if (caps.effortLevels) expect(resolveAnthropicThinkingMode(id), id).toBe('adaptive');
    }
  });

  test('a learned override beats the catalog and the heuristic', () => {
    learnAnthropicThinkingMode('claude-haiku-4-5', 'adaptive');
    expect(resolveAnthropicThinkingMode('claude-haiku-4-5')).toBe('adaptive');
  });
});

// Refresh guard: the weekly models.dev refresh PR runs this suite, so a new
// Claude reasoning model whose snapshot entry records neither thinking shape
// fails here — surfacing an API change at refresh time instead of as a 400 in
// someone's chat.
describe('catalog thinking coverage', () => {
  test('every Anthropic reasoning model records a thinking shape we can send', () => {
    const gaps: string[] = [];
    for (const { id } of getModelOptions('anthropic')) {
      const caps = getCapabilities('anthropic', id)!;
      if (!caps.reasoning) continue;
      if (!caps.budgetTokens && !caps.effortLevels) gaps.push(id);
    }
    expect(gaps).toEqual([]);
  });

  test('adaptive models are only ever sent an effort level they list', () => {
    const budgets = { low: 2048, medium: 8192, high: 16384 };
    for (const { id } of getModelOptions('anthropic')) {
      const mode = resolveAnthropicThinkingMode(id);
      if (mode !== 'adaptive') continue;
      const effortLevels = anthropicEffortLevels(id);
      for (const level of Object.keys(THINKING_LEVELS) as (keyof typeof THINKING_LEVELS)[]) {
        const plan = anthropicThinkingPlan(id, level, budgets, { mode, effortLevels });
        if (plan.effort && effortLevels) expect(effortLevels, `${id} ${level}`).toContain(plan.effort);
        expect(plan.thinking?.type, `${id} ${level}`).not.toBe('enabled');
      }
    }
  });

  test('a model learned to reject "disabled" runs Off at its lowest effort', () => {
    expect(anthropicCannotDisable('claude-sonnet-5')).toBe(false);
    learnAnthropicCannotDisable('claude-sonnet-5');
    expect(anthropicCannotDisable('claude-sonnet-5')).toBe(true);
    const plan = anthropicThinkingPlan('claude-sonnet-5', 'off', { low: 1, medium: 1, high: 1 }, {
      mode: 'adaptive', effortLevels: anthropicEffortLevels('claude-sonnet-5'), cannotDisable: true,
    });
    expect(plan.thinking?.type).toBe('adaptive');
    expect(plan.effort).toBe('low');
  });
});

describe('thinkingModeFromError', () => {
  test('recognizes the adaptive-only rejection', () => {
    const msg = '"thinking.type.enabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort" to control thinking behavior.';
    expect(thinkingModeFromError(msg, 'budget')).toBe('adaptive');
  });

  test('recognizes the reverse rejection', () => {
    expect(thinkingModeFromError('adaptive thinking is not supported on this model', 'adaptive')).toBe('budget');
  });

  test('ignores unrelated 400s', () => {
    expect(thinkingModeFromError('messages: text content blocks must be non-empty', 'budget')).toBeNull();
    expect(thinkingModeFromError('prompt is too long', 'adaptive')).toBeNull();
  });
});
