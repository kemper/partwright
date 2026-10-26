import { describe, it, expect } from 'vitest';
import { latestAssistantText, planAwaitsAnswers } from '../../src/ai/planReply';
import { PLAN_APPROVED_PREFIX, PLAN_APPROVED_TEXT, PLAN_FIRST_PREFIX, PLAN_REFINE_PREFIX, planApprovalText, planTurn } from '../../src/ai/userWords';
import type { ChatMessage } from '../../src/ai/types';

describe('planAwaitsAnswers', () => {
  it('is true when the reply ends with a question', () => {
    expect(planAwaitsAnswers('Happy to plan this.\n\nHow tall should the vase be?')).toBe(true);
    expect(planAwaitsAnswers('1. Which wall thickness — 2 mm or 3 mm?**')).toBe(true);
    expect(planAwaitsAnswers('Do you want a lid (default: no)?)')).toBe(true);
    expect(planAwaitsAnswers('1. How tall? (default 60 mm)')).toBe(true);
    expect(planAwaitsAnswers('2. Lid or no lid? — default: no lid')).toBe(true);
  });

  it('is true for a trailing questions section with a closing line', () => {
    const reply = [
      'Before I plan this I need a few details.',
      '',
      '## Questions',
      '1. How big should the box be? (default 60 mm)',
      '2. Should the lid snap on or slide? (default snap)',
      '',
      "Once you answer, I'll write the plan.",
    ].join('\n');
    expect(planAwaitsAnswers(reply)).toBe(true);
    expect(planAwaitsAnswers(reply.replace('## Questions', '**Clarifying questions:**'))).toBe(true);
  });

  it('is true for a question list followed by a one-line closer', () => {
    const reply = 'A few questions first:\n\n1. How tall? (default 60 mm)\n2. Lid or no lid?\n\nLet me know and I will write the plan.';
    expect(planAwaitsAnswers(reply)).toBe(true);
  });

  it('is false for a plan', () => {
    const plan = [
      '## Plan',
      '1. Build the base as a 60×40 rounded box.',
      '2. Cut the cavity, leaving 2 mm walls.',
      '',
      '## Assumptions',
      '- Units are mm.',
    ].join('\n');
    expect(planAwaitsAnswers(plan)).toBe(false);
    expect(planAwaitsAnswers(`${plan}\n\nLet me know if this looks good.`)).toBe(false);
  });

  it('ignores questions that are not in the final section', () => {
    const reply = '## Questions\nShould it be hollow?\n\n## Plan\n1. Make it solid.\n2. Fillet the edges.';
    expect(planAwaitsAnswers(reply)).toBe(false);
  });

  it('is false for empty text', () => {
    expect(planAwaitsAnswers('')).toBe(false);
    expect(planAwaitsAnswers('  \n ')).toBe(false);
  });
});

describe('latestAssistantText', () => {
  const m = (role: 'user' | 'assistant', text: string, seq: number): ChatMessage => ({
    id: `m${seq}`, sessionId: 's', role, blocks: text ? [{ type: 'text', text }] : [], createdAt: seq, seq,
  });

  it('returns the last assistant reply with text at or after fromIndex', () => {
    const history = [m('assistant', 'old plan', 0), m('user', 'plan it', 1), m('assistant', 'new plan', 2), m('assistant', '', 3)];
    expect(latestAssistantText(history, 1)).toBe('new plan');
    expect(latestAssistantText(history, 3)).toBe('');
    expect(latestAssistantText([m('assistant', 'old plan', 0), m('user', 'x', 1)], 1)).toBe('');
  });
});

describe('plan-mode user turns', () => {
  it('approval carries the plan, or falls back to the plain approval', () => {
    expect(planApprovalText('  1. Do it  ')).toBe(`${PLAN_APPROVED_PREFIX}1. Do it`);
    expect(planApprovalText('   ')).toBe(PLAN_APPROVED_TEXT);
  });

  it('classifies plan turns and extracts the user words', () => {
    expect(planTurn(`${PLAN_FIRST_PREFIX}Make a vase`)).toEqual({ kind: 'request', words: 'Make a vase' });
    expect(planTurn(`${PLAN_REFINE_PREFIX}Taller`)).toEqual({ kind: 'refine', words: 'Taller' });
    expect(planTurn(planApprovalText('Plan'))).toEqual({ kind: 'approved', words: '' });
    expect(planTurn(PLAN_APPROVED_TEXT)).toEqual({ kind: 'approved', words: '' });
    expect(planTurn('Make a vase')).toBeNull();
  });
});
