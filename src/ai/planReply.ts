// Reading the conversation for the plan / question flow. Models with tool
// calling end a turn with a card tool — askUser (questions) or proposePlan (a
// plan). For the rest (small local or custom endpoints that don't get those
// tools) a text heuristic decides whether a plan-mode reply is questions or a
// plan. That only picks which plan-bar prompt and button lead; Build stays
// available either way, so a wrong guess costs a label, never a turn.

import type { ChatMessage, ImageSource, PersistedToolCall } from './types';
import { planTurn } from './userWords';

/** Ask the user questions as a card with clickable answers (any mode). */
export const ASK_USER_TOOL = 'askUser';
/** Present a plan as a card for the user to build / revise / discard (plan mode). */
export const PROPOSE_PLAN_TOOL = 'proposePlan';
/** The tool result a card tool returns — also how the transcript recognises
 *  (and hides) that result. */
export const CARD_TOOL_ACK = '[Shown to the user as a card. Their reply arrives as the next user message — your turn ends here]';

/** A markdown heading, or a line that is entirely bold ("**Questions:**"). */
const HEADING_RE = /^(#{1,6}\s+.+|\*\*[^*]+\*\*:?|__[^_]+__:?)$/;
/** A heading that introduces questions for the user. */
const QUESTION_HEADING_RE = /question|clarif|need to know|before i (start|plan|build)|to confirm|please confirm/i;

/** Trailing markdown/punctuation that can follow a question mark ("…size?**",
 *  "(…?)", "…?`"). */
function stripTrailingMarkup(line: string): string {
  return line.replace(/[\s*_`)\]"'’”]+$/u, '');
}

/** A question, optionally followed by its suggested default — "…tall? (default
 *  60 mm)" or "…lid? — default: no", the shape the plan prompt asks for. */
function isQuestionLine(line: string): boolean {
  const bare = stripTrailingMarkup(line);
  return bare.endsWith('?') || /\?\**\s*(\(|\[|—|–|-\s)/.test(bare);
}

/** A list item ("1. …", "- …", "* …"). */
const LIST_ITEM_RE = /^(\d+[.)]|[-*•])\s+/;

/** True when a plan-mode reply ends by asking the user something: its last
 *  line is a question, a question list is followed only by a one-line closer,
 *  or its final section is a "Questions" / "Clarifications" list with at
 *  least one question in it. A plan that merely closes with one polite
 *  question ("Does this look good?") is still a plan. */
export function planAwaitsAnswers(text: string): boolean {
  const lines = text.trim().split('\n').map(l => l.trim());
  const nonEmpty = lines.filter(Boolean);
  if (nonEmpty.length === 0) return false;

  // The last paragraph ends with a question — unless it is the only question
  // and follows a list of steps that aren't questions (a plan's sign-off).
  if (isQuestionLine(nonEmpty[nonEmpty.length - 1])) {
    const body = nonEmpty.slice(0, -1);
    const politeCloser = !body.some(isQuestionLine)
      && body.some(l => LIST_ITEM_RE.test(l) && !isQuestionLine(l));
    return !politeCloser;
  }

  // A question list followed by a one-line closer ("Let me know and I'll
  // write the plan.").
  const paragraphs = text.trim().split(/\n\s*\n/).map(p => p.trim().split('\n').map(l => l.trim()).filter(Boolean));
  if (paragraphs.length >= 2 && paragraphs[paragraphs.length - 1].length === 1
    && paragraphs[paragraphs.length - 2].some(isQuestionLine)) return true;

  // The final section (after the last heading) is a questions section.
  let headingIdx = -1;
  for (let i = nonEmpty.length - 1; i >= 0; i--) {
    if (HEADING_RE.test(nonEmpty[i])) { headingIdx = i; break; }
  }
  if (headingIdx < 0) return false;
  const heading = nonEmpty[headingIdx];
  return QUESTION_HEADING_RE.test(heading) && nonEmpty.slice(headingIdx + 1).some(l => l.includes('?'));
}

export interface AskUserOption { label: string; description?: string }
export interface AskUserQuestion { question: string; options: AskUserOption[]; multiSelect: boolean }

/** An askUser call's questions, dropping malformed entries (the tool's
 *  validator already rejected bad input; this keeps old/odd history safe). */
export function parseAskUser(input: Record<string, unknown>): AskUserQuestion[] {
  const qs = Array.isArray(input.questions) ? input.questions : [];
  const out: AskUserQuestion[] = [];
  for (const raw of qs) {
    const q = raw as Record<string, unknown> | null;
    if (!q || typeof q.question !== 'string' || !q.question.trim()) continue;
    const options: AskUserOption[] = [];
    for (const o of Array.isArray(q.options) ? q.options : []) {
      const opt = o as Record<string, unknown> | null;
      if (!opt || typeof opt.label !== 'string' || !opt.label.trim()) continue;
      options.push(typeof opt.description === 'string' && opt.description.trim()
        ? { label: opt.label.trim(), description: opt.description.trim() }
        : { label: opt.label.trim() });
    }
    out.push({ question: q.question.trim(), options, multiSelect: q.multiSelect === true });
  }
  return out;
}

export interface ProposedPlan { summary: string; steps: string[]; assumptions: string[] }

/** A proposePlan call's plan, or null when it has no summary or steps. */
export function parseProposedPlan(input: Record<string, unknown>): ProposedPlan | null {
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map(x => x.trim()) : []);
  const summary = typeof input.summary === 'string' ? input.summary.trim() : '';
  const steps = strings(input.steps);
  if (!summary || steps.length === 0) return null;
  return { summary, steps, assumptions: strings(input.assumptions) };
}

/** A plan as Markdown — what Build sends back to the model, and what Copy copies. */
export function planMarkdown(plan: ProposedPlan): string {
  const parts = [plan.summary, '', ...plan.steps.map((s, i) => `${i + 1}. ${s}`)];
  if (plan.assumptions.length > 0) parts.push('', 'Assumptions:', ...plan.assumptions.map(a => `- ${a}`));
  return parts.join('\n');
}

/** "(recommended)" is a hint for the user, not part of their answer. */
function answerLabel(label: string): string {
  return label.replace(/\s*\(recommended\)\s*/i, ' ').trim();
}

/** The user message a question card sends: one line per answered question
 *  (selections are option indices per question), then anything they typed. */
export function answersText(questions: AskUserQuestion[], selections: number[][], typed: string): string {
  const lines: string[] = [];
  questions.forEach((q, i) => {
    const picked = (selections[i] ?? []).map(j => q.options[j]).filter(Boolean).map(o => answerLabel(o.label));
    if (picked.length > 0) lines.push(`- ${q.question} → ${picked.join(', ')}`);
  });
  const extra = typed.trim();
  if (lines.length === 0) return extra;
  return extra ? `${lines.join('\n')}\n\n${extra}` : lines.join('\n');
}

function cardCall(m: ChatMessage, name: string): PersistedToolCall | undefined {
  return m.toolCalls?.find(tc => tc.name === name);
}

/** A user message the person (or the app on their behalf) actually sent —
 *  not a tool-result carrier or an auto-continue nudge. */
function isTypedUserMessage(m: ChatMessage): boolean {
  return m.role === 'user' && !m.autoResumeNudge && m.blocks.some(b => b.type === 'text' || b.type === 'image');
}

/** Assistant replies — not error bubbles, stop notices or compaction
 *  summaries. */
function isReply(m: ChatMessage): boolean {
  return m.role === 'assistant' && !m.errored && !m.stopNotice && !m.compacted;
}

function replyText(m: ChatMessage): string {
  return m.blocks.map(b => (b.type === 'text' ? b.text : '')).join('\n').trim();
}

/** What one exchange's replies amount to: a proposePlan card is the plan, an
 *  askUser card is questions, otherwise all their text (a plan written,
 *  checked with a render, then signed off spans several messages) goes
 *  through the heuristic. null when they hold nothing. */
function readReplies(replies: ChatMessage[]): { text: string; awaitingAnswers: boolean } | null {
  for (let i = replies.length - 1; i >= 0; i--) {
    const planCall = cardCall(replies[i], PROPOSE_PLAN_TOOL);
    const plan = planCall ? parseProposedPlan(planCall.input) : null;
    if (plan) return { text: planMarkdown(plan), awaitingAnswers: false };
    const askCall = cardCall(replies[i], ASK_USER_TOOL);
    const questions = askCall ? parseAskUser(askCall.input) : [];
    if (questions.length > 0) return { text: questions.map(q => `- ${q.question}`).join('\n'), awaitingAnswers: true };
  }
  const text = replies.map(replyText).filter(Boolean).join('\n\n');
  return text ? { text, awaitingAnswers: planAwaitsAnswers(text) } : null;
}

/** The plan (or questions) the planning exchange from `fromIndex` on ended
 *  with: the replies after the last user message that got one, as text, and
 *  whether they wait on the user's answers. A turn that only errored falls
 *  back to the reply before it. */
export function latestPlanReply(history: ChatMessage[], fromIndex: number): { text: string; awaitingAnswers: boolean } {
  const start = Math.max(0, fromIndex);
  let end = history.length;
  for (let i = history.length - 1; i >= start; i--) {
    if (!isTypedUserMessage(history[i])) continue;
    const read = readReplies(history.slice(i + 1, end).filter(isReply));
    if (read) return read;
    end = i;
  }
  return readReplies(history.slice(start, end).filter(isReply)) ?? { text: '', awaitingAnswers: false };
}

/** The askUser card the conversation is waiting on: in the latest assistant
 *  message, with nothing typed since. Its message id + call, or null. */
export function pendingAskUser(history: ChatMessage[]): { messageId: string; call: PersistedToolCall } | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (isTypedUserMessage(m)) return null;
    if (m.role !== 'assistant') continue;
    const call = cardCall(m, ASK_USER_TOOL);
    return call ? { messageId: m.id, call } : null;
  }
  return null;
}

function planKind(m: ChatMessage): ReturnType<typeof planTurn> {
  for (const b of m.blocks) {
    if (b.type !== 'text') continue;
    const turn = planTurn(b.text);
    if (turn) return turn;
  }
  return null;
}

/** The plan awaiting the user's decision, read from the transcript: the last
 *  typed user message is a plan request or revision. Returns the request
 *  message's index (everything from there on is the planning exchange), its
 *  words and images — or null when no plan is pending. Lets the plan bar
 *  survive a reload or another tab taking control. */
export function derivePendingPlan(history: ChatMessage[]): { requestIndex: number; requestWords: string; requestImages: ImageSource[] } | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (!isTypedUserMessage(m)) continue;
    const turn = planKind(m);
    if (!turn || turn.kind === 'approved') return null;
    if (turn.kind === 'request') {
      const requestImages = m.blocks.flatMap(b => (b.type === 'image' ? [b.source] : []));
      return { requestIndex: i, requestWords: turn.words, requestImages };
    }
  }
  // Revisions with no request before them (e.g. the request was compacted away).
  return null;
}
