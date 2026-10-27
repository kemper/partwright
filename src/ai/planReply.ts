// Reading a plan-mode reply: is the model waiting on answers, or is this a
// plan ready to build? A text heuristic, so it works for every provider and
// model (local and custom endpoints included). It only picks which plan-bar
// prompt and button lead; Build stays available either way, so a wrong guess
// costs a label, never a turn.

import type { ChatMessage } from './types';

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

/** A user message the person (or the app on their behalf) actually sent —
 *  not a tool-result carrier or an auto-continue nudge. */
function isTypedUserMessage(m: ChatMessage): boolean {
  return m.role === 'user' && !m.autoResumeNudge && m.blocks.some(b => b.type === 'text' || b.type === 'image');
}

/** Assistant text that is the model's reply — not an error bubble, a stop
 *  notice or a compaction summary. */
function replyText(m: ChatMessage): string {
  if (m.role !== 'assistant' || m.errored || m.stopNotice || m.compacted) return '';
  return m.blocks.map(b => (b.type === 'text' ? b.text : '')).join('\n').trim();
}

/** The plan (or questions) the planning exchange from `fromIndex` on ended
 *  with: all reply text after the last user message that got one (a plan
 *  written, checked with a render, then signed off spans several messages).
 *  A turn that only errored falls back to the reply before it. '' when there
 *  is none. */
export function latestAssistantText(history: ChatMessage[], fromIndex: number): string {
  const start = Math.max(0, fromIndex);
  let end = history.length;
  for (let i = history.length - 1; i >= start; i--) {
    if (!isTypedUserMessage(history[i])) continue;
    const text = history.slice(i + 1, end).map(replyText).filter(Boolean).join('\n\n');
    if (text) return text;
    end = i;
  }
  return history.slice(start, end).map(replyText).filter(Boolean).join('\n\n');
}
