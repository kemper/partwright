// Which extended-thinking request shape a Claude model accepts.
//
// Anthropic has two mutually-exclusive wire shapes:
//   - 'budget'   → thinking: { type: 'enabled', budget_tokens: N }
//                  (Haiku 4.5, Sonnet/Opus ≤ 4.5; still accepted on 4.6)
//   - 'adaptive' → thinking: { type: 'adaptive' } + output_config: { effort }
//                  (4.6+; the ONLY shape on Opus 4.7+, Sonnet 5, Opus 5.x,
//                  Fable — those 400 on `budget_tokens`)
//
// Resolution order, most to least authoritative:
//   1. A shape learned this session from the API's own 400 (see
//      `thinkingModeFromError`) — self-heals models whose rules change.
//   2. The models.dev catalog snapshot's `reasoning_options`, refreshed
//      weekly — a listed `budget_tokens` option means 'budget'; an
//      effort-only entry means 'adaptive'.
//   3. A name heuristic for ids the snapshot doesn't carry yet (brand-new
//      releases, dated snapshots): known legacy families → 'budget',
//      everything else → 'adaptive', since every new Claude model since 4.6
//      is adaptive-first.

import { getCapabilities } from './catalog';
import type { ChatToggles } from './types';

export type AnthropicThinkingMode = 'budget' | 'adaptive';

/** Claude families that predate adaptive thinking: Claude 2/3.x, and the
 *  4.0–4.5 generation (incl. dated snapshots like claude-opus-4-20250514 and
 *  claude-haiku-4-5-20251001). 4.6+ and every later family fall through to
 *  'adaptive'. */
const LEGACY_BUDGET_MODEL = /^claude-(?:instant|2|3)|^claude-(?:opus|sonnet|haiku)-4(?:-[0-5])?(?:-\d{8})?$/;

const learned = new Map<string, AnthropicThinkingMode>();

export function resolveAnthropicThinkingMode(modelId: string): AnthropicThinkingMode {
  const override = learned.get(modelId);
  if (override) return override;
  const caps = getCapabilities('anthropic', modelId);
  if (caps?.budgetTokens) return 'budget';
  if (caps?.effortLevels) return 'adaptive';
  return LEGACY_BUDGET_MODEL.test(modelId) ? 'budget' : 'adaptive';
}

/** Remember the shape the API told us to use for this model, for the rest of
 *  the page session. */
export function learnAnthropicThinkingMode(modelId: string, mode: AnthropicThinkingMode): void {
  learned.set(modelId, mode);
}

/** Test hook: forget every learned override. */
export function resetLearnedThinkingModes(): void {
  learned.clear();
}

/** Map the shared thinking level onto an `output_config.effort` value for an
 *  adaptive model. Returns undefined when the catalog lists the model's effort
 *  levels and this one isn't among them — omitting effort falls back to the
 *  model's own default rather than risking a 400. Low/medium/high are
 *  supported by every adaptive model, so unknown models get them as-is. */
export function anthropicEffort(
  modelId: string,
  level: Exclude<ChatToggles['thinking'], 'off'>,
): 'low' | 'medium' | 'high' | undefined {
  const levels = getCapabilities('anthropic', modelId)?.effortLevels;
  if (levels && !levels.includes(level)) return undefined;
  return level;
}

/** Given a 400 message, return the thinking shape the API is asking for, or
 *  null when the error isn't about the thinking shape. Matches e.g.
 *  `"thinking.type.enabled" is not supported for this model. Use
 *  "thinking.type.adaptive" …` (→ 'adaptive') and the reverse
 *  "adaptive thinking is not supported" family (→ 'budget'). */
export function thinkingModeFromError(message: string, current: AnthropicThinkingMode): AnthropicThinkingMode | null {
  if (!/thinking/i.test(message)) return null;
  if (current === 'budget' && /adaptive|budget_tokens|thinking\.type\.enabled/i.test(message)) return 'adaptive';
  if (current === 'adaptive' && /adaptive|output_config|effort/i.test(message)) return 'budget';
  return null;
}
