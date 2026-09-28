import { describe, expect, it } from 'vitest';
import {
  AUTO_REVIEW_FOLLOWUP_TAG,
  buildFixPrompt,
  latestUserRequest,
  parseReviewVerdict,
  resolveReviewer,
  shouldActOnReview,
  shouldAutoReview,
} from '../../src/ai/autoReview';
import type { ChatMessage, ChatToggles } from '../../src/ai/types';

const ON = { enabled: true, provider: 'same' as const, model: '', fixRounds: 1 };

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
  const base = { settings: ON, reason: 'end_turn' as const, toolCalls: 3, hadError: false, spentUsd: 0.2, spendCapUsd: 2 };
  it('reviews a clean turn that did work', () => expect(shouldAutoReview(base)).toBe(true));
  it('skips when off, errored, capped, tool-free, or over the spend cap', () => {
    expect(shouldAutoReview({ ...base, settings: { ...ON, enabled: false } })).toBe(false);
    expect(shouldAutoReview({ ...base, hadError: true })).toBe(false);
    expect(shouldAutoReview({ ...base, reason: 'iteration_cap' })).toBe(false);
    expect(shouldAutoReview({ ...base, toolCalls: 0 })).toBe(false);
    expect(shouldAutoReview({ ...base, spentUsd: 2 })).toBe(false);
    expect(shouldAutoReview({ ...base, spendCapUsd: Infinity, spentUsd: 99 })).toBe(true);
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
  it('explicit reviewer, or null when its model is blank', () => {
    expect(resolveReviewer({ ...ON, provider: 'openai', model: 'gpt-5.5' }, toggles)).toEqual({ provider: 'openai', model: 'gpt-5.5' });
    expect(resolveReviewer({ ...ON, provider: 'openai', model: ' ' }, toggles)).toBeNull();
  });
});

describe('latestUserRequest / buildFixPrompt', () => {
  const msg = (role: 'user' | 'assistant', text: string, seq: number): ChatMessage => ({
    id: String(seq), sessionId: 's', role, blocks: text ? [{ type: 'text', text }] : [], createdAt: seq, seq,
  });
  it('finds the human request, skipping tool-result carriers and review follow-ups', () => {
    const fix = buildFixPrompt('Verdict: needs rework\nHoles are blind.', 'Anthropic / claude-haiku-4-5');
    expect(fix.startsWith(AUTO_REVIEW_FOLLOWUP_TAG)).toBe(true);
    expect(fix).toContain('Holes are blind.');
    const history = [msg('user', 'Make a bracket', 1), msg('assistant', 'ok', 2), msg('user', '', 3), msg('user', fix, 4)];
    expect(latestUserRequest(history)).toBe('Make a bracket');
  });
});
