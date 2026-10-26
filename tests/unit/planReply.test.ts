import { describe, it, expect } from 'vitest';
import { CARD_TOOL_ACK, answersText, derivePendingPlan, latestPlanReply, parseAskUser, parseProposedPlan, pendingAskUser, planAwaitsAnswers, planMarkdown } from '../../src/ai/planReply';
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

  it('treats a lone polite question after a plan as a plan', () => {
    const plan = '## Plan\n1. Revolve the profile.\n2. Hollow it.\n\n## Assumptions\n- Units are mm.';
    expect(planAwaitsAnswers(`${plan}\n\nDoes this plan look good to you?`)).toBe(false);
    expect(planAwaitsAnswers(`${plan}\n\nWant me to adjust anything before building?`)).toBe(false);
    // …but not when the list itself is questions.
    expect(planAwaitsAnswers('1. How tall?\n2. What colour?\n\nAnything else I should know?')).toBe(true);
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

describe('latestPlanReply', () => {
  const m = (role: 'user' | 'assistant', text: string, seq: number, extra: Partial<ChatMessage> = {}): ChatMessage => ({
    id: `m${seq}`, sessionId: 's', role, blocks: text ? [{ type: 'text', text }] : [], createdAt: seq, seq, ...extra,
  });

  it('joins the reply after the last user message, from fromIndex on', () => {
    const history = [m('assistant', 'old plan', 0), m('user', 'plan it', 1), m('assistant', 'new plan', 2), m('assistant', '', 3), m('assistant', 'Ready when you are.', 4)];
    expect(latestPlanReply(history, 1).text).toBe('new plan\n\nReady when you are.');
    expect(latestPlanReply([m('assistant', 'old plan', 0), m('user', 'x', 1)], 1).text).toBe('');
  });

  it('skips error bubbles, falling back to the previous reply', () => {
    const history = [
      m('user', 'plan it', 0), m('assistant', 'the plan', 1),
      m('user', 'make it taller', 2), m('assistant', 'Anthropic API error 529', 3, { errored: true }),
    ];
    expect(latestPlanReply(history, 0).text).toBe('the plan');
  });

  it('ignores tool-result carriers and compaction summaries', () => {
    const toolCarrier: ChatMessage = { id: 't', sessionId: 's', role: 'user', blocks: [], toolResults: [{ toolUseId: 'x', content: 'ok', isError: false }], createdAt: 2, seq: 2 };
    const history = [m('user', 'plan it', 0), m('assistant', 'part one', 1), toolCarrier, m('assistant', 'summary', 3, { compacted: true }), m('assistant', 'part two', 4)];
    expect(latestPlanReply(history, 0).text).toBe('part one\n\npart two');
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

const msg = (role: 'user' | 'assistant', text: string, seq: number, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `c${seq}`, sessionId: 's', role, blocks: text ? [{ type: 'text', text }] : [], createdAt: seq, seq, ...extra,
});
const ASK = { questions: [
  { question: 'How tall?', options: [{ label: '60 mm (recommended)' }, { label: '100 mm', description: 'needs a wider base' }] },
  { question: 'Which features?', options: [{ label: 'Handle' }, { label: 'Spout' }, { label: '' }], multiSelect: true },
  { question: '' },
] };
const PLAN_INPUT = { summary: 'A 60 mm vase.', steps: ['Revolve the profile.', 'Hollow it.'], assumptions: ['Units are mm.'] };

describe('card tools', () => {
  it('parses askUser input, dropping malformed entries', () => {
    expect(parseAskUser(ASK)).toEqual([
      { question: 'How tall?', options: [{ label: '60 mm (recommended)' }, { label: '100 mm', description: 'needs a wider base' }], multiSelect: false },
      { question: 'Which features?', options: [{ label: 'Handle' }, { label: 'Spout' }], multiSelect: true },
    ]);
    expect(parseAskUser({})).toEqual([]);
  });

  it('parses a plan and formats it as Markdown', () => {
    const plan = parseProposedPlan(PLAN_INPUT);
    expect(plan).toEqual(PLAN_INPUT);
    expect(planMarkdown(plan!)).toBe('A 60 mm vase.\n\n1. Revolve the profile.\n2. Hollow it.\n\nAssumptions:\n- Units are mm.');
    expect(parseProposedPlan({ summary: 'x', steps: [] })).toBeNull();
  });

  it('formats answers, stripping "(recommended)" and adding typed text', () => {
    const qs = parseAskUser(ASK);
    expect(answersText(qs, [[0], [0, 1]], '')).toBe('- How tall? → 60 mm\n- Which features? → Handle, Spout');
    expect(answersText(qs, [[1], []], ' Make it blue ')).toBe('- How tall? → 100 mm\n\nMake it blue');
    expect(answersText(qs, [[], []], 'just text')).toBe('just text');
    expect(answersText(qs, [[], []], '  ')).toBe('');
  });

  it('reads cards ahead of text in the latest reply', () => {
    const planned = [msg('user', 'plan it', 0), msg('assistant', 'Here it is.', 1, { toolCalls: [{ id: 'p', name: 'proposePlan', input: PLAN_INPUT }] })];
    expect(latestPlanReply(planned, 0)).toEqual({ text: planMarkdown(parseProposedPlan(PLAN_INPUT)!), awaitingAnswers: false });
    const asked = [msg('user', 'plan it', 0), msg('assistant', '', 1, { toolCalls: [{ id: 'a', name: 'askUser', input: ASK }] })];
    expect(latestPlanReply(asked, 0)).toEqual({ text: '- How tall?\n- Which features?', awaitingAnswers: true });
  });
});

describe('pendingAskUser', () => {
  const ask = msg('assistant', '', 1, { toolCalls: [{ id: 'a', name: 'askUser', input: ASK }] });
  const carrier: ChatMessage = { id: 'r', sessionId: 's', role: 'user', blocks: [], toolResults: [{ toolUseId: 'a', content: CARD_TOOL_ACK, isError: false }], createdAt: 2, seq: 2 };

  it('is the askUser card in the latest reply until the user types', () => {
    expect(pendingAskUser([msg('user', 'hi', 0), ask, carrier])?.call.id).toBe('a');
    expect(pendingAskUser([msg('user', 'hi', 0), ask, carrier, msg('user', '60 mm', 3)])).toBeNull();
    expect(pendingAskUser([msg('user', 'hi', 0), ask, carrier, msg('assistant', 'more', 3)])).toBeNull();
  });
});

describe('derivePendingPlan', () => {
  it('finds the plan request behind the latest revisions', () => {
    const history = [
      msg('user', 'earlier chat', 0),
      msg('assistant', 'ok', 1),
      { ...msg('user', `${PLAN_FIRST_PREFIX}Make a vase`, 2), blocks: [{ type: 'text' as const, text: `${PLAN_FIRST_PREFIX}Make a vase` }, { type: 'image' as const, source: { mediaType: 'image/png', data: 'AAAA' } as never }] },
      msg('assistant', 'How tall?', 3),
      msg('user', `${PLAN_REFINE_PREFIX}60 mm`, 4),
      msg('assistant', 'Plan: …', 5),
    ];
    const pending = derivePendingPlan(history);
    expect(pending?.requestIndex).toBe(2);
    expect(pending?.requestWords).toBe('Make a vase');
    expect(pending?.requestImages).toHaveLength(1);
  });

  it('is null once the plan is approved, or when the last message is ordinary', () => {
    expect(derivePendingPlan([msg('user', `${PLAN_FIRST_PREFIX}Vase`, 0), msg('assistant', 'Plan', 1), msg('user', planApprovalText('Plan'), 2)])).toBeNull();
    expect(derivePendingPlan([msg('user', `${PLAN_FIRST_PREFIX}Vase`, 0), msg('assistant', 'Plan', 1), msg('user', planApprovalText('Plan'), 2), msg('user', 'thanks', 3)])).toBeNull();
    expect(derivePendingPlan([msg('user', `${PLAN_REFINE_PREFIX}taller`, 0)])).toBeNull();
    expect(derivePendingPlan([])).toBeNull();
  });
});
