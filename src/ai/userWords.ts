// Text the app adds to a user turn around the user's own words — "Plan first"
// instructions and "[UI · app note]" lines. Kept in a leaf so code that reads
// the history back (the review's userConversation) can tell the app's text
// apart from what the user actually wrote.

import type { ChatBlock } from './types';

/** Every "[UI · app note] user applied …" line starts with this, so it reads
 *  as app-generated context — never as words the user typed. */
export const UI_APPLIED_NOTE_PREFIX = '[UI · app note]';

/** Prepended to the user's request on the first planning turn. */
export const PLAN_FIRST_PREFIX =
  'Before doing anything, write a concise plan for the following request. '
  + 'Describe your approach, key steps, and any design decisions. '
  + 'You may use the read-only inspection tools (getCode, getSessionContext, listVersions, geometry queries, readDoc, etc.) to ground the plan in the actual session state — but only when it would meaningfully improve the plan; skip inspection on greenfield requests. '
  + 'Do NOT mutate the session, execute code, or start building yet — I will approve or reject your plan first.\n\n'
  + '---\n\n';

/** Prepended to a message sent while a plan awaits approval. */
export const PLAN_REFINE_PREFIX = '[Plan refinement — revise or extend the plan only. Inspect with the read-only tools if useful, but do not mutate the session or start building]: ';

/** The whole user turn the Approve button sends. */
export const PLAN_APPROVED_TEXT = 'Plan approved. Please proceed.';

/** The user's own words in a stored user turn's blocks: UI app notes are
 *  dropped, plan-mode prefixes removed, and the approval turn (no words of
 *  the user's) becomes ''. Images are ignored. */
export function userWords(blocks: ChatBlock[]): string {
  return blocks
    .filter((b): b is Extract<ChatBlock, { type: 'text' }> => b.type === 'text' && !b.text.startsWith(UI_APPLIED_NOTE_PREFIX))
    .map(b => stripPlanWrapping(b.text))
    .filter(Boolean)
    .join('\n')
    .trim();
}

function stripPlanWrapping(text: string): string {
  if (text === PLAN_APPROVED_TEXT) return '';
  if (text.startsWith(PLAN_FIRST_PREFIX)) return text.slice(PLAN_FIRST_PREFIX.length).trim();
  if (text.startsWith(PLAN_REFINE_PREFIX)) return text.slice(PLAN_REFINE_PREFIX.length).trim();
  return text;
}
