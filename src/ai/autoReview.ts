// Automatic end-of-task review — the decision logic, kept pure so the unit
// tier can pin it. The panel (src/ui/aiPanel.ts) runs the review itself via
// runReview (src/ai/review.ts) once a turn has truly ended.
//
// Flow: after a turn that did work (called tools) ends cleanly, a reviewer
// with a FRESH context — the user's request, the final code, geometry stats
// and a 4-view render, none of the agent's own reasoning — grades the result
// and suggests fixes. If it doesn't pass and fix rounds remain, the review is
// handed back to the agent as a follow-up turn.

import type { AutoReviewSettings } from './settings';
import type { ChatMessage, ChatToggles, Provider, TurnOutcomeReason } from './types';
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

/** Whether a finished turn should be reviewed: the feature is on, the turn
 *  ended cleanly (not capped, aborted, errored, or awaiting an answer), and
 *  the agent actually did something (a pure chat reply has nothing to grade). */
export function shouldAutoReview(opts: {
  settings: AutoReviewSettings;
  reason: TurnOutcomeReason;
  toolCalls: number;
  hadError: boolean;
  spentUsd: number;
  spendCapUsd: number;
}): boolean {
  if (!opts.settings.enabled) return false;
  if (opts.reason !== 'end_turn' || opts.hadError) return false;
  if (opts.toolCalls <= 0) return false;
  if (Number.isFinite(opts.spendCapUsd) && opts.spentUsd >= opts.spendCapUsd) return false;
  return true;
}

/** Whether the agent should get another round to act on this review. */
export function shouldActOnReview(verdict: ReviewVerdict | null, roundsUsed: number, maxRounds: number): boolean {
  if (verdict === null || verdict === 'pass') return false;
  return roundsUsed < maxRounds;
}

/** The reviewer to use: the configured one, or the chat's own. null when
 *  'same' is chosen but no chat model is active. */
export function resolveReviewer(settings: AutoReviewSettings, toggles: ChatToggles): { provider: Provider; model: string } | null {
  if (settings.provider !== 'same') {
    return settings.model.trim() ? { provider: settings.provider, model: settings.model.trim() } : null;
  }
  const model = activeModel(toggles);
  return model ? { provider: toggles.provider, model: String(model) } : null;
}

/** Text of the most recent human request (what the review grades against). */
export function latestUserRequest(history: ChatMessage[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role !== 'user') continue;
    const text = m.blocks.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('\n').trim();
    // Skip tool-result carriers and our own automatic follow-ups.
    if (text && !text.startsWith(AUTO_REVIEW_FOLLOWUP_TAG)) return text;
  }
  return '';
}

/** Prefix marking the follow-up turn that hands a review back to the agent. */
export const AUTO_REVIEW_FOLLOWUP_TAG = '[Automatic review]';

/** The follow-up user turn that asks the agent to act on a review. The review
 *  text is inlined (not just referenced) so every provider sees it verbatim. */
export function buildFixPrompt(reviewText: string, reviewerLabel: string): string {
  return `${AUTO_REVIEW_FOLLOWUP_TAG} ${reviewerLabel} reviewed your result:\n\n${reviewText.trim()}\n\n`
    + 'Address the findings that are genuinely wrong, verify the fix with a render, and save the result. '
    + 'If you disagree with a finding, say why in one sentence instead of changing the model.';
}
