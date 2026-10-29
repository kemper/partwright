// The feasibility estimate a plan carries (#1209): how hard the task is, how
// confident the planner is, how many tool rounds the build should take, and
// what it can't do well. The model supplies those; the app turns the rounds
// into dollars (the model can't price itself), holds the build to the
// estimate with a checkpoint, and keeps a record of estimate vs actual so the
// next plan can correct for being optimistic. Pure: no DOM, no storage.

import type { ChatMessage } from './types';

const PLAN_DIFFICULTIES = ['easy', 'medium', 'hard', 'research'] as const;
export type PlanDifficulty = typeof PLAN_DIFFICULTIES[number];

/** Upper bound on a plan's round estimate — past this it isn't an estimate. */
const PLAN_MAX_ROUNDS = 200;

export interface PlanEstimate {
  difficulty: PlanDifficulty;
  /** Chance (0–100) the build lands at `quality` within `roundsMax` rounds. */
  confidence?: number;
  roundsMin: number;
  roundsMax: number;
  /** What the result will realistically look like. */
  quality?: string;
  /** Tools that are missing or weak for this task. */
  gaps: string[];
  /** What is most likely to go wrong. */
  risks: string[];
}

const DIFFICULTY_LABEL: Record<PlanDifficulty, string> = {
  easy: 'Easy', medium: 'Medium', hard: 'Hard', research: 'Research',
};

export function difficultyLabel(d: PlanDifficulty): string {
  return DIFFICULTY_LABEL[d];
}

function isRoundCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= PLAN_MAX_ROUNDS;
}

function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map(x => x.trim()) : [];
}

/** Why a proposePlan `estimate` is malformed, or null when it is fine (or
 *  absent — the estimate is optional so small models can still plan). */
export function planEstimateInputError(raw: unknown): string | null {
  if (raw === undefined) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'proposePlan: `estimate` must be an object.';
  const e = raw as Record<string, unknown>;
  if (typeof e.difficulty !== 'string' || !(PLAN_DIFFICULTIES as readonly string[]).includes(e.difficulty)) {
    return `proposePlan: estimate.difficulty must be one of ${PLAN_DIFFICULTIES.join(', ')}.`;
  }
  if (!isRoundCount(e.roundsMin) || !isRoundCount(e.roundsMax)) {
    return `proposePlan: estimate.roundsMin and estimate.roundsMax must be whole numbers from 1 to ${PLAN_MAX_ROUNDS}.`;
  }
  if (e.roundsMax < e.roundsMin) return 'proposePlan: estimate.roundsMax must be at least estimate.roundsMin.';
  if (e.confidence !== undefined && (typeof e.confidence !== 'number' || !Number.isFinite(e.confidence) || e.confidence < 0 || e.confidence > 100)) {
    return 'proposePlan: estimate.confidence must be a number from 0 to 100.';
  }
  for (const key of ['gaps', 'risks'] as const) {
    if (e[key] !== undefined && (!Array.isArray(e[key]) || (e[key] as unknown[]).some(s => typeof s !== 'string'))) {
      return `proposePlan: estimate.${key} must be an array of strings.`;
    }
  }
  if (e.quality !== undefined && typeof e.quality !== 'string') return 'proposePlan: estimate.quality must be a string.';
  return null;
}

/** A proposePlan `estimate`, or null when it is absent or malformed (history
 *  can hold calls from before the field existed). */
export function parsePlanEstimate(raw: unknown): PlanEstimate | null {
  if (raw === undefined || planEstimateInputError(raw) !== null) return null;
  const e = raw as Record<string, unknown>;
  const quality = typeof e.quality === 'string' && e.quality.trim() ? e.quality.trim() : undefined;
  return {
    difficulty: e.difficulty as PlanDifficulty,
    ...(typeof e.confidence === 'number' ? { confidence: Math.round(e.confidence) } : {}),
    roundsMin: e.roundsMin as number,
    roundsMax: e.roundsMax as number,
    ...(quality ? { quality } : {}),
    gaps: stringList(e.gaps),
    risks: stringList(e.risks),
  };
}

export function roundsLabel(e: Pick<PlanEstimate, 'roundsMin' | 'roundsMax'>): string {
  return e.roundsMin === e.roundsMax ? `${e.roundsMax} rounds` : `${e.roundsMin}–${e.roundsMax} rounds`;
}

/** The estimate as Markdown lines — appended to the plan text Build hands
 *  back to the model, so the build knows the budget it agreed to. */
export function planEstimateMarkdown(e: PlanEstimate): string[] {
  const head = [`Difficulty: ${difficultyLabel(e.difficulty)}`, `estimated ${roundsLabel(e)}`];
  if (e.confidence !== undefined) head.push(`confidence ${e.confidence}%`);
  const lines = ['Estimate: ' + head.join(' · ')];
  if (e.quality) lines.push(`Expected quality: ${e.quality}`);
  if (e.gaps.length > 0) lines.push('Capability gaps:', ...e.gaps.map(g => `- ${g}`));
  if (e.risks.length > 0) lines.push('Risks:', ...e.risks.map(r => `- ${r}`));
  return lines;
}

/** Average cost of this chat's most recent priced rounds (assistant messages
 *  with a known, non-zero cost), or null when none are priced (local models,
 *  unpriced ids, a brand-new chat). */
export function perRoundCostUsd(history: ChatMessage[], sample: number): number | null {
  const costs: number[] = [];
  for (let i = history.length - 1; i >= 0 && costs.length < sample; i--) {
    const m = history[i];
    if (m.role !== 'assistant' || m.costUnknown || typeof m.costUsd !== 'number' || !(m.costUsd > 0)) continue;
    costs.push(m.costUsd);
  }
  if (costs.length === 0) return null;
  return costs.reduce((a, b) => a + b, 0) / costs.length;
}

/** The estimate's round range in dollars at `perRound`, or null without a price. */
export function estimateCostRange(e: Pick<PlanEstimate, 'roundsMin' | 'roundsMax'>, perRound: number | null): { low: number; high: number } | null {
  if (perRound === null || !(perRound > 0)) return null;
  return { low: e.roundsMin * perRound, high: e.roundsMax * perRound };
}

/** Rounds a "Keep going" at a plan checkpoint grants. */
export function checkpointExtension(roundsMax: number, fraction: number, minRounds: number): number {
  return Math.max(Math.max(1, Math.round(minRounds)), Math.ceil(roundsMax * fraction));
}

// ── Build budget ─────────────────────────────────────────────────────────────

/** The round budget an approved plan's build runs under. `limit` starts at the
 *  plan's estimated maximum and grows by each checkpoint "Keep going"; it
 *  overrides the toolbar's iteration cap for the whole build. */
export interface BuildBudget {
  /** Ties checkpoint notices to the build they belong to. */
  id: string;
  estimate: PlanEstimate;
  /** Estimated cost range when the build started (null if unpriced). */
  estCost: { low: number; high: number } | null;
  limit: number;
  used: number;
  spentUsd: number;
  checkpoints: number;
  provider: string;
  model: string;
}

export function startBuildBudget(id: string, estimate: PlanEstimate, estCost: BuildBudget['estCost'], provider: string, model: string): BuildBudget {
  return { id, estimate, estCost, limit: estimate.roundsMax, used: 0, spentUsd: 0, checkpoints: 0, provider, model };
}

/** Rounds left before the checkpoint (at least 1, so a run always makes progress). */
export function remainingRounds(b: BuildBudget): number {
  return Math.max(1, b.limit - b.used);
}

// ── Calibration (estimate vs actual) ────────────────────────────────────────

export type BuildOutcome = 'completed' | 'accepted' | 'abandoned';

export interface CalibrationRecord {
  at: number;
  provider: string;
  model: string;
  difficulty: PlanDifficulty;
  roundsMin: number;
  roundsMax: number;
  confidence?: number;
  actualRounds: number;
  estCostHigh?: number;
  actualCostUsd: number;
  checkpoints: number;
  outcome: BuildOutcome;
}

export function calibrationRecord(b: BuildBudget, outcome: BuildOutcome, at: number): CalibrationRecord {
  return {
    at,
    provider: b.provider,
    model: b.model,
    difficulty: b.estimate.difficulty,
    roundsMin: b.estimate.roundsMin,
    roundsMax: b.estimate.roundsMax,
    ...(b.estimate.confidence !== undefined ? { confidence: b.estimate.confidence } : {}),
    actualRounds: b.used,
    ...(b.estCost ? { estCostHigh: b.estCost.high } : {}),
    actualCostUsd: b.spentUsd,
    checkpoints: b.checkpoints,
    outcome,
  };
}

function ratioText(r: number): string {
  return `${r.toFixed(1)}×`;
}

/** A one-paragraph summary of past builds against their estimates, or null
 *  when there are fewer than `minBuilds` that ran at all. Shown on the plan
 *  card and sent to the planner so it can correct its next estimate. */
export function summarizeCalibration(records: CalibrationRecord[], minBuilds: number): string | null {
  const ran = records.filter(r => r.actualRounds > 0 && r.roundsMax > 0);
  if (ran.length < Math.max(1, minBuilds)) return null;
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const overall = mean(ran.map(r => r.actualRounds / r.roundsMax));
  const within = ran.filter(r => r.outcome === 'completed' && r.actualRounds <= r.roundsMax).length;
  const parts = [`Past plan-mode builds (${ran.length}): actual rounds averaged ${ratioText(overall)} the planned maximum`];
  const byDifficulty = PLAN_DIFFICULTIES
    .map(d => ({ d, rs: ran.filter(r => r.difficulty === d) }))
    .filter(x => x.rs.length >= 2)
    .map(x => `${x.d} ${ratioText(mean(x.rs.map(r => r.actualRounds / r.roundsMax)))}`);
  if (byDifficulty.length > 1) parts[0] += ` (${byDifficulty.join(', ')})`;
  parts.push(`${within} of ${ran.length} finished within the estimate`);
  const stopped = ran.filter(r => r.outcome !== 'completed').length;
  if (stopped > 0) parts.push(`${stopped} ended at a checkpoint or were abandoned`);
  return parts.join('; ') + '.';
}
