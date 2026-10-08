// Automatic end-of-task review — the decision logic, kept pure so the unit
// tier can pin it. The panel (src/ui/aiPanel.ts) runs the review itself via
// runReview (src/ai/review.ts) once a turn has truly ended.
//
// Flow: after a turn that CHANGED THE MODEL ends cleanly, a reviewer with a
// fresh context — the user's request, the final code, geometry stats and a
// 4-view render, none of the agent's own reasoning — grades the result and
// suggests fixes. If it doesn't pass and fix rounds remain, the agent is
// asked to address the review (which is already in the transcript) in a
// follow-up turn.

import type { AutoReviewSettings } from './settings';
import type { ChatBlock, ChatMessage, ChatToggles, Provider, TurnOutcomeReason } from './types';
import { activeModel } from './types';

export type ReviewVerdict = 'pass' | 'minor' | 'rework';

/** Read the reviewer's leading "Verdict: …" line. null when absent — the
 *  panel then treats the review as advisory (posts it, doesn't act on it). */
export function parseReviewVerdict(text: string): ReviewVerdict | null {
  const m = /^\s*\**\s*verdict\s*\**\s*[:\-–]\s*\**\s*(pass|minor issues?|needs rework|rework)\b/im.exec(text);
  if (!m) return null;
  const v = m[1].toLowerCase();
  if (v === 'pass') return 'pass';
  if (v.startsWith('minor')) return 'minor';
  return 'rework';
}

/** Whether a finished turn should be reviewed: the switch is on, the turn
 *  ended cleanly (not capped, aborted or errored), it wasn't a planning turn
 *  (nothing is built yet), the agent actually changed the model (inspecting
 *  or answering has nothing to grade), and the session is under its cap. */
export function shouldAutoReview(opts: {
  enabled: boolean;
  reason: TurnOutcomeReason;
  modelChangingToolCalls: number;
  planning: boolean;
  hadError: boolean;
  spentUsd: number;
  spendCapUsd: number;
}): boolean {
  if (!opts.enabled || opts.planning) return false;
  if (opts.reason !== 'end_turn' || opts.hadError) return false;
  if (opts.modelChangingToolCalls <= 0) return false;
  return !overSpendCap(opts.spentUsd, opts.spendCapUsd);
}

/** Whether the session has reached its $ cap (∞ = never). */
export function overSpendCap(spentUsd: number, spendCapUsd: number): boolean {
  return Number.isFinite(spendCapUsd) && spentUsd >= spendCapUsd;
}

/** Whether the agent should get another round to act on this review. */
export function shouldActOnReview(verdict: ReviewVerdict | null, roundsUsed: number, maxRounds: number): boolean {
  if (verdict === null || verdict === 'pass') return false;
  return roundsUsed < maxRounds;
}

/** The reviewer to use — the configured one, or the chat's own — or why
 *  there is none. A local (WebGPU) chat model can't review: the prompt (full
 *  code + stats + an image) overflows its small window. */
export function resolveReviewer(settings: AutoReviewSettings, toggles: ChatToggles): { provider: Provider; model: string } | { skip: string } {
  if (settings.provider !== 'same') {
    const model = settings.model.trim();
    return model ? { provider: settings.provider, model } : { skip: 'choose a reviewer model in ⚙ AI Settings → Automatic review' };
  }
  if (toggles.provider === 'local') {
    return { skip: 'local models can’t review (the review prompt overflows their window) — choose a hosted reviewer in ⚙ AI Settings → Automatic review' };
  }
  const model = activeModel(toggles);
  return model ? { provider: toggles.provider, model: String(model) } : { skip: 'no chat model is active' };
}

/** Model-changing tool calls made in assistant messages created at or after
 *  `since` (ms) — i.e. during the current round. `isChanging` is
 *  `isModelChangingTool` from tools.ts (injected to keep this module pure). */
export function countModelChangingCalls(history: ChatMessage[], since: number, isChanging: (name: string) => boolean): number {
  let n = 0;
  for (const m of history) {
    if (m.role !== 'assistant' || m.createdAt < since || !m.toolCalls) continue;
    for (const c of m.toolCalls) if (isChanging(c.name)) n++;
  }
  return n;
}

/** Prefix marking the follow-up turn that asks the agent to act on a review. */
export const AUTO_REVIEW_FOLLOWUP_TAG = '[Automatic review]';

/** The request text a set of user blocks carries ('' for image-only). */
export function requestText(blocks: ChatBlock[]): string {
  return blocks
    .filter((b): b is Extract<ChatBlock, { type: 'text' }> => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();
}

/** Fallback when the caller didn't pin the request: the most recent human
 *  message, skipping tool-result carriers, auto-continue nudges and our own
 *  review follow-ups. */
export function latestUserRequest(history: ChatMessage[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role !== 'user' || m.autoResumeNudge) continue;
    const text = requestText(m.blocks);
    if (text && !text.startsWith(AUTO_REVIEW_FOLLOWUP_TAG)) return text;
  }
  return '';
}

/** The follow-up user turn that asks the agent to act on a review. The review
 *  itself is already in the history (every provider replays review blocks as
 *  "[Review from …]"), so it's referenced, not repeated. */
export function buildFixPrompt(reviewerLabel: string): string {
  return `${AUTO_REVIEW_FOLLOWUP_TAG} The review above (${reviewerLabel}) found issues. `
    + 'Work through its numbered findings in order: fix each one, or — only when the reviewer plainly misread '
    + 'the render or stats — say in one sentence why that finding is wrong. Don\'t stop after the first fix. '
    + 'Then re-render, including the view where each problem showed, to confirm it is gone, and save the result.';
}
