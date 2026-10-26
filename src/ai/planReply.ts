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

/** True when a plan-mode reply ends by asking the user something: its last
 *  line is a question, a question list is followed only by a one-line closer,
 *  or its final section is a "Questions" / "Clarifications" list with at
 *  least one question in it. */
export function planAwaitsAnswers(text: string): boolean {
  const lines = text.trim().split('\n').map(l => l.trim());
  const nonEmpty = lines.filter(Boolean);
  if (nonEmpty.length === 0) return false;

  // The last paragraph ends with a question.
  if (isQuestionLine(nonEmpty[nonEmpty.length - 1])) return true;

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

/** The text of the latest assistant reply at or after `fromIndex` — the plan
 *  (or questions) a planning turn ended on. '' when there is none. */
export function latestAssistantText(history: ChatMessage[], fromIndex: number): string {
  for (let i = history.length - 1; i >= Math.max(0, fromIndex); i--) {
    const m = history[i];
    if (m.role !== 'assistant') continue;
    const text = m.blocks
      .map(b => (b.type === 'text' ? b.text : ''))
      .join('\n')
      .trim();
    if (text) return text;
  }
  return '';
}
