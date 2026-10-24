// Text the panel wraps around the user's words in "Plan first" mode. Kept in a
// leaf so code that reads the history back (the review's userConversation)
// can tell the app's instructions apart from what the user actually wrote.

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

/** The user's own words from a stored user message: plan-mode prefixes are
 *  removed, and the approval turn (no words of the user's) becomes ''. */
export function stripPlanWrapping(text: string): string {
  if (text === PLAN_APPROVED_TEXT) return '';
  if (text.startsWith(PLAN_FIRST_PREFIX)) return text.slice(PLAN_FIRST_PREFIX.length).trim();
  if (text.startsWith(PLAN_REFINE_PREFIX)) return text.slice(PLAN_REFINE_PREFIX.length).trim();
  return text;
}
