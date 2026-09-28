import { describe, expect, it } from 'vitest';
import {
  AUTO_REVIEW_FOLLOWUP_TAG,
  buildFixPrompt,
  countModelChangingCalls,
  latestUserRequest,
  requestText,
  parseReviewVerdict,
  resolveReviewer,
  shouldActOnReview,
  shouldAutoReview,
} from '../../src/ai/autoReview';
import type { ChatMessage, ChatToggles } from '../../src/ai/types';

const ON = { provider: 'same' as const, model: '', fixRounds: 1 };

describe('parseReviewVerdict', () => {
  it.each([
    ['Verdict: pass\nLooks right.', 'pass'],
    ['verdict: Minor issues\n…', 'minor'],
    ['Verdict: minor issue — the fillet is small', 'minor'],
    ['**Verdict:** needs rework\nHoles are blind.', 'rework'],
    ['Some preamble\nVerdict - needs rework', 'rework'],
  ] as const)('%j → %s', (text, v) => {
    expect(parseReviewVerdict(text)).toBe(v);
  });

  it('returns null without a verdict line (review is then advisory only)', () => {
    expect(parseReviewVerdict('Close, but the holes are blind.')).toBeNull();
  });
});

describe('shouldAutoReview', () => {
  const base = { enabled: true, reason: 'end_turn' as const, modelChangingToolCalls: 2, planning: false, hadError: false, spentUsd: 0.2, spendCapUsd: 2 };
  it('reviews a clean turn that changed the model', () => expect(shouldAutoReview(base)).toBe(true));
  it('skips when off, planning, errored, capped, inspect-only, or over the spend cap', () => {
    expect(shouldAutoReview({ ...base, enabled: false })).toBe(false);
    expect(shouldAutoReview({ ...base, planning: true })).toBe(false);
    expect(shouldAutoReview({ ...base, hadError: true })).toBe(false);
    expect(shouldAutoReview({ ...base, reason: 'iteration_cap' })).toBe(false);
    expect(shouldAutoReview({ ...base, modelChangingToolCalls: 0 })).toBe(false);
    expect(shouldAutoReview({ ...base, spentUsd: 2 })).toBe(false);
    expect(shouldAutoReview({ ...base, spendCapUsd: Infinity, spentUsd: 99 })).toBe(true);
  });
});

describe('countModelChangingCalls', () => {
  it('counts only model-changing calls made during the current round', () => {
    const call = (name: string) => ({ id: name, name, input: {} });
    const history = [
      { id: 'a', sessionId: 's', role: 'assistant', blocks: [], toolCalls: [call('runAndSave')], createdAt: 50, seq: 1 },
      { id: 'b', sessionId: 's', role: 'assistant', blocks: [], toolCalls: [call('getCode'), call('renderViews')], createdAt: 150, seq: 2 },
      { id: 'c', sessionId: 's', role: 'assistant', blocks: [], toolCalls: [call('runAndSave'), call('paintByLabel')], createdAt: 160, seq: 3 },
    ] as unknown as ChatMessage[];
    const changing = (n: string) => n === 'runAndSave' || n === 'paintByLabel';
    expect(countModelChangingCalls(history, 100, changing)).toBe(2);
    expect(countModelChangingCalls(history, 0, changing)).toBe(3);
  });
});

describe('shouldActOnReview', () => {
  it('acts on non-passing verdicts while rounds remain', () => {
    expect(shouldActOnReview('rework', 0, 1)).toBe(true);
    expect(shouldActOnReview('minor', 0, 2)).toBe(true);
    expect(shouldActOnReview('rework', 1, 1)).toBe(false);
    expect(shouldActOnReview('pass', 0, 3)).toBe(false);
    expect(shouldActOnReview(null, 0, 3)).toBe(false);
    expect(shouldActOnReview('rework', 0, 0)).toBe(false);
  });
});

describe('resolveReviewer', () => {
  const toggles = { provider: 'anthropic', anthropicModel: 'claude-sonnet-4-6' } as unknown as ChatToggles;
  it('same → the chat provider/model', () => {
    expect(resolveReviewer(ON, toggles)).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-6' });
  });
  it('explicit reviewer, or a skip reason when its model is blank', () => {
    expect(resolveReviewer({ ...ON, provider: 'openai', model: 'gpt-5.5' }, toggles)).toEqual({ provider: 'openai', model: 'gpt-5.5' });
    expect(resolveReviewer({ ...ON, provider: 'openai', model: ' ' }, toggles)).toHaveProperty('skip');
  });
  it('a local chat model never reviews (the prompt overflows its window)', () => {
    const local = { provider: 'local', localModel: 'x-MLC' } as unknown as ChatToggles;
    expect(resolveReviewer(ON, local)).toHaveProperty('skip');
  });
});

describe('latestUserRequest / buildFixPrompt / requestText', () => {
  const msg = (role: 'user' | 'assistant', text: string, seq: number, extra: Partial<ChatMessage> = {}): ChatMessage => ({
    id: String(seq), sessionId: 's', role, blocks: text ? [{ type: 'text', text }] : [], createdAt: seq, seq, ...extra,
  });
  it('finds the human request, skipping tool-result carriers, nudges and review follow-ups', () => {
    const fix = buildFixPrompt('Anthropic / claude-haiku-4-5');
    expect(fix.startsWith(AUTO_REVIEW_FOLLOWUP_TAG)).toBe(true);
    expect(fix).toContain('review above');
    const history = [
      msg('user', 'Make a bracket', 1),
      msg('assistant', 'ok', 2),
      msg('user', '', 3),
      msg('user', 'Keep going — call finish when done', 4, { autoResumeNudge: true }),
      msg('user', fix, 5),
    ];
    expect(latestUserRequest(history)).toBe('Make a bracket');
  });
  it('requestText joins text blocks and ignores images', () => {
    expect(requestText([{ type: 'text', text: ' a ' }, { type: 'image', source: { data: 'x', mediaType: 'image/png' } }, { type: 'text', text: 'b' }])).toBe('a \nb');
  });
});
