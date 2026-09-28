// Pure, dependency-free mapping from the shared Thinking level (the 🧠 pill)
// to each hosted provider's wire format. Lives apart from the provider
// transports so the unit tier can pin every model-family × level combination
// without a browser (tests/unit/thinkingLevels.test.ts).
//
// The levels:
//   off      — thinking disabled where the model allows it; on models that
//              always think (Claude Opus 5.x, Fable, Mythos; OpenAI reasoning
//              models) the lowest effort instead.
//   default  — send nothing about depth; the model/provider default applies.
//   low … max — an explicit effort, clamped to the nearest level the model
//              supports (e.g. xhigh → high on Claude 4.6 / older OpenAI).

import type { ThinkingLevel } from './types';

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

/** How a Claude model accepts thinking configuration.
 *  - `budget`: pre-4.6 models (Haiku 4.5, Sonnet/Opus 4.5 and older) —
 *    `thinking: {type: 'enabled', budget_tokens}` is the only way to think.
 *  - `adaptive46`: Opus/Sonnet 4.6 — adaptive thinking + effort low…max
 *    (no xhigh); thinking off unless requested; thinking shown by default.
 *  - `adaptive`: Opus 4.7/4.8, Sonnet 5 — adaptive + effort low…max incl.
 *    xhigh; `budget_tokens` is REJECTED (400); thinking hidden by default.
 *    Sonnet 5 thinks when `thinking` is omitted; Opus 4.7/4.8 don't.
 *  - `alwaysOn`: Opus 5.x, Fable, Mythos — think by default (Opus 5.5 /
 *    Fable / Mythos can't be disabled at all), effort is the only control;
 *    thinking hidden by default. */
export type AnthropicThinkingFamily = 'budget' | 'adaptive46' | 'adaptive' | 'alwaysOn';

const CLAUDE_ID = /^claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d+))?/;

function parseClaudeId(model: string): { tier: string; major: number; minor: number } | null {
  const m = CLAUDE_ID.exec(model.trim().toLowerCase());
  if (!m) return null; // unknown / legacy naming (claude-3-5-sonnet-…)
  // A dated snapshot suffix (…-4-20250514) is not a minor version.
  const minorRaw = m[3] !== undefined ? Number(m[3]) : 0;
  return { tier: m[1], major: Number(m[2]), minor: minorRaw >= 100 ? 0 : minorRaw };
}

export function anthropicThinkingFamily(model: string): AnthropicThinkingFamily {
  const id = parseClaudeId(model);
  if (!id) return 'budget';
  const { tier, major, minor } = id;
  if (tier === 'fable' || tier === 'mythos') return 'alwaysOn';
  if (tier === 'opus' && major >= 5) return 'alwaysOn';
  if (major >= 5) return 'adaptive'; // Sonnet 5+, a future Haiku 5+
  if (major === 4 && minor >= 7) return 'adaptive';
  if (major === 4 && minor === 6 && tier !== 'haiku') return 'adaptive46';
  return 'budget';
}

/** Anthropic `output_config.effort` values. */
export type AnthropicEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AnthropicThinkingBudgets {
  low: number;
  medium: number;
  high: number;
}

export interface AnthropicThinkingPlan {
  /** Value for the request's `thinking` field; undefined = omit it. */
  thinking?:
    | { type: 'enabled'; budget_tokens: number }
    | { type: 'adaptive'; display?: 'summarized' }
    | { type: 'disabled' };
  /** Value for `output_config.effort`; undefined = omit it. */
  effort?: AnthropicEffort;
  /** True when the model will think on this request. Drives thinking-block
   *  replay (tool loops 400 without it) and the output-token ceiling. */
  active: boolean;
  /** `budget_tokens` sent, or 0. Callers keep `max_tokens` above it. */
  budgetTokens: number;
  /** Ask the API to drop, not reject, replayed thinking blocks whose
   *  conversation prefix changed (`thinking.block_binding.
   *  prefix_mismatch_behavior: "drop_block"`, beta header
   *  THINKING_BINDING_BETA). Set for always-on models: Opus 5.5 / Fable 5.1
   *  bind each thinking block to the exact history before it, and newer
   *  accounts get a 400 when that history was edited — which Partwright does
   *  on purpose (render-image trimming, keep-tail compaction, switching
   *  models mid-chat). Models that don't run the check accept the field. */
  dropMismatchedThinking?: boolean;
}

/** Beta that unlocks `thinking.block_binding` (see dropMismatchedThinking). */
export const THINKING_BINDING_BETA = 'thinking-binding-controls-2026-08-01';

/** Whether an adaptive plan runs at the top efforts (xhigh/max), which need
 *  a larger output ceiling than the other levels. */
export function isDeepEffort(plan: AnthropicThinkingPlan): boolean {
  return plan.effort === 'xhigh' || plan.effort === 'max';
}

/** Canonical effort order, lowest first. */
const EFFORT_ORDER = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

/** Nearest level to `level` among `allowed` (a model's effort list, e.g. its
 *  catalog `reasoning_options`); ties go to the cheaper side. null when
 *  `allowed` holds none of the canonical levels. */
export function clampEffort<T extends string>(level: T, allowed: readonly string[], order: readonly string[] = EFFORT_ORDER): T | null {
  if (allowed.includes(level)) return level;
  const want = order.indexOf(level);
  let best: string | null = null;
  let bestDist = Infinity;
  for (const cand of order) {
    if (!allowed.includes(cand)) continue;
    const dist = Math.abs(order.indexOf(cand) - want);
    if (dist < bestDist) { best = cand; bestDist = dist; }
  }
  return best as T | null;
}

/** Levels assumed for an adaptive model the catalog doesn't describe. */
function defaultAnthropicEfforts(family: AnthropicThinkingFamily): readonly string[] {
  // Claude 4.6 has no xhigh (it arrived with Opus 4.7).
  return family === 'adaptive46' ? ['low', 'medium', 'high', 'max'] : EFFORT_ORDER;
}

/** What the caller knows about the model beyond its id: the thinking shape
 *  it accepts (from the catalog snapshot, or learned from the API's own 400 —
 *  see anthropicThinking.ts) and its catalog effort levels. */
export interface AnthropicShapeHint {
  mode: 'budget' | 'adaptive';
  effortLevels: readonly string[] | null;
  /** Learned from a 400: this model rejects `thinking: {type: 'disabled'}`. */
  cannotDisable?: boolean;
}

/** Map a Thinking level onto an Anthropic request for `model`. `shape`
 *  (catalog / learned) overrides what the id alone implies. */
export function anthropicThinkingPlan(
  model: string,
  level: ThinkingLevel,
  budgets: AnthropicThinkingBudgets,
  shape?: AnthropicShapeHint,
): AnthropicThinkingPlan {
  const idFamily = anthropicThinkingFamily(model);
  const mode = shape?.mode ?? (idFamily === 'budget' ? 'budget' : 'adaptive');

  if (mode === 'budget') {
    if (level === 'off' || level === 'default') return { active: false, budgetTokens: 0 };
    // xhigh / max clamp to the high budget: older models cap output at
    // 32k–64k tokens, so a bigger budget risks a max_tokens 400.
    const budget = level === 'low' ? budgets.low : level === 'medium' ? budgets.medium : budgets.high;
    return { thinking: { type: 'enabled', budget_tokens: budget }, active: true, budgetTokens: budget };
  }

  // Adaptive. An id our heuristics call "budget" but the catalog / API says
  // is adaptive is a newer model we don't know by name: plain adaptive.
  const family: AnthropicThinkingFamily = shape?.cannotDisable ? 'alwaysOn' : idFamily === 'budget' ? 'adaptive' : idFamily;
  const efforts = shape?.effortLevels ?? defaultAnthropicEfforts(family);
  // 4.7+ hide thinking by default ("omitted"): the stream is silent until the
  // answer, which the stall watchdog reads as a dead connection and the user
  // sees as an empty thinking box. Ask for the summary whenever thinking runs.
  const adaptive = { type: 'adaptive' as const, display: 'summarized' as const };
  const drop = family === 'alwaysOn' ? { dropMismatchedThinking: true } : {};

  if (level === 'off') {
    // Always-on models: thinking can't be (reliably) disabled — Opus 5.5 /
    // Fable reject it, and Opus 5 with thinking disabled can leak tool calls
    // into visible text. The documented cheap path is adaptive at low effort.
    if (family === 'alwaysOn') {
      const low = clampEffort('low', efforts);
      return { thinking: adaptive, ...(low ? { effort: low } : {}), active: true, budgetTokens: 0, ...drop };
    }
    return { thinking: { type: 'disabled' }, active: false, budgetTokens: 0 };
  }
  if (level === 'default') {
    // No depth override. Models that think when `thinking` is omitted still
    // get the adaptive block so their reasoning is visible (same behaviour,
    // summary on); the rest keep their default of not thinking.
    // (Sonnet 5+ runs adaptive when `thinking` is omitted; Opus 4.7/4.8 don't.)
    const thinksByDefault = family === 'alwaysOn' || (family === 'adaptive' && (parseClaudeId(model)?.major ?? 0) >= 5);
    return thinksByDefault ? { thinking: adaptive, active: true, budgetTokens: 0, ...drop } : { active: false, budgetTokens: 0 };
  }
  const effort = clampEffort(level, efforts);
  return { thinking: adaptive, ...(effort ? { effort } : {}), active: true, budgetTokens: 0, ...drop };
}

// ---------------------------------------------------------------------------
// OpenAI (reasoning models: gpt-5 family, o-series)
// ---------------------------------------------------------------------------

/** GPT generation as major/minor (gpt-5 → 5.0, gpt-5.5-mini → 5.5,
 *  gpt-6-astra → 6.0), or null for other ids (o-series). */
function gptVersion(model: string): { major: number; minor: number } | null {
  const m = /^gpt-(\d+)(?:\.(\d+))?(?![\d.])/.exec(model.trim().toLowerCase());
  if (!m) return null;
  return { major: Number(m[1]), minor: m[2] !== undefined ? Number(m[2]) : 0 };
}

/** Map a Thinking level onto OpenAI `reasoning.effort` / `reasoning_effort`
 *  for a reasoning model. null = omit the field (provider default).
 *  Off also omits it: there is no single "lowest" value every reasoning model
 *  accepts (gpt-5.1+ default to 'none', gpt-5 takes 'minimal', the -pro
 *  models reject low, o1-mini rejects the field), so the provider default is
 *  the only safe floor. Every reasoning model accepts low/medium/high; xhigh
 *  arrived with gpt-5.2 and max with gpt-5.6, so higher asks clamp down on
 *  older models. */
export function openaiReasoningEffort(model: string, level: ThinkingLevel, catalogLevels?: readonly string[] | null): string | null {
  if (level === 'default') return null;
  if (catalogLevels && catalogLevels.length > 0) {
    // The catalog lists exactly what this model accepts: Off → 'none' where
    // offered (gpt-5.1+), else the provider default; everything else clamps
    // to the nearest listed level (gpt-5-pro takes only 'high').
    if (level === 'off') return catalogLevels.includes('none') ? 'none' : null;
    return clampEffort(level, catalogLevels);
  }
  if (level === 'off') return null;
  if (level === 'low' || level === 'medium' || level === 'high') return level;
  const v = gptVersion(model);
  const atLeast = (major: number, minor: number) => v !== null && (v.major > major || (v.major === major && v.minor >= minor));
  const hasXhigh = atLeast(5, 2);
  const hasMax = atLeast(5, 6);
  if (level === 'max' && hasMax) return 'max';
  if (hasXhigh) return 'xhigh';
  return 'high';
}

// ---------------------------------------------------------------------------
// Custom (OpenAI-compatible endpoint, e.g. CLIProxyAPI)
// ---------------------------------------------------------------------------

/** Extra Chat Completions fields for the Custom provider.
 *  `include_reasoning` (visibility only — unknown-field servers ignore it) is
 *  sent whenever thinking isn't Off. `reasoning_effort` is sent only when the
 *  user opted in (Custom tab), since some servers (Ollama) map it to "think"
 *  and error on non-thinking models. Low → Max pass through as-is — the point
 *  of the opt-in is reaching xhigh/max through a bridge like CLIProxyAPI, which
 *  clamps per model. Off and Default send nothing: 'none' would become
 *  "thinking disabled", which always-on models (Opus 5.5, Fable) reject. */
export function customReasoningFields(level: ThinkingLevel, sendEffort: boolean): { include_reasoning?: true; reasoning_effort?: string } {
  const out: { include_reasoning?: true; reasoning_effort?: string } = {};
  if (level !== 'off') out.include_reasoning = true;
  if (sendEffort && level !== 'off' && level !== 'default') out.reasoning_effort = level;
  return out;
}

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

export interface GeminiThinkingBudgets {
  low: number;
  medium: number;
  high: number;
}

/** Map a Thinking level onto Gemini `generationConfig.thinkingConfig`.
 *  'off' only hides thoughts — it deliberately does NOT force
 *  `thinkingBudget: 0` (Gemini 3 / 2.5 Pro reject a zero budget). 'default'
 *  shows thoughts and lets the model pick its own (dynamic) budget. Gemini
 *  tops out at "high", so xhigh/max use the high budget. */
export function geminiThinkingConfig(level: ThinkingLevel, budgets: GeminiThinkingBudgets): Record<string, unknown> {
  if (level === 'off') return { includeThoughts: false };
  if (level === 'default') return { includeThoughts: true };
  const budget = level === 'low' ? budgets.low : level === 'medium' ? budgets.medium : budgets.high;
  return { includeThoughts: true, thinkingBudget: budget };
}
