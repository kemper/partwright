import { describe, expect, test } from 'vitest';
import {
  calibrationRecord, checkpointExtension, estimateCostRange, parsePlanEstimate, perRoundCostUsd,
  planEstimateInputError, remainingRounds, startBuildBudget, summarizeCalibration, type CalibrationRecord,
} from '../../src/ai/planEstimate';
import { parseProposedPlan, planMarkdown } from '../../src/ai/planReply';
import { PLAN_ASSESS_PREFIX, PLAN_COMPARE_PREFIX, PLAN_FIRST_PREFIX, planRequestPrefix, planTurn, userWords } from '../../src/ai/userWords';
import { loadSettings, setPlanStylePrefs } from '../../src/ai/settings';
import type { ChatMessage } from '../../src/ai/types';

const EST = { difficulty: 'hard', confidence: 55, roundsMin: 10, roundsMax: 20, quality: 'recognisable, stylised', gaps: ['no hair kit'], risks: ['likeness'] };

describe('plan estimate input', () => {
  test('an absent estimate is fine; a valid one parses', () => {
    expect(planEstimateInputError(undefined)).toBeNull();
    expect(planEstimateInputError(EST)).toBeNull();
    expect(parsePlanEstimate(EST)).toEqual(EST);
  });

  test('rejects bad difficulty, rounds and confidence', () => {
    expect(planEstimateInputError({ ...EST, difficulty: 'trivial' })).toContain('difficulty');
    expect(planEstimateInputError({ ...EST, roundsMin: 0 })).toContain('roundsMin');
    expect(planEstimateInputError({ ...EST, roundsMax: 5 })).toContain('at least');
    expect(planEstimateInputError({ ...EST, roundsMax: 2.5 })).toContain('whole numbers');
    expect(planEstimateInputError({ ...EST, confidence: 140 })).toContain('confidence');
    expect(planEstimateInputError({ ...EST, gaps: 'none' })).toContain('gaps');
    expect(planEstimateInputError([])).toContain('object');
  });

  test('a malformed estimate on an old call parses as null, not a broken plan', () => {
    const plan = parseProposedPlan({ summary: 'S', steps: ['a'], estimate: { difficulty: 'x' } });
    expect(plan?.estimate).toBeNull();
    expect(parsePlanEstimate({ difficulty: 'easy', roundsMin: 2, roundsMax: 4 })).toEqual({ difficulty: 'easy', roundsMin: 2, roundsMax: 4, gaps: [], risks: [] });
  });

  test('the plan markdown Build sends carries the estimate', () => {
    const md = planMarkdown(parseProposedPlan({ summary: 'S', steps: ['a'], estimate: EST })!);
    expect(md).toContain('Estimate: Difficulty: Hard · estimated 10–20 rounds · confidence 55%');
    expect(md).toContain('Capability gaps:\n- no hair kit');
    expect(md).toContain('Risks:\n- likeness');
  });
});

describe('plan cost and budget', () => {
  const msg = (role: 'user' | 'assistant', costUsd?: number, costUnknown?: boolean): ChatMessage =>
    ({ id: Math.random().toString(), sessionId: 's', role, blocks: [], createdAt: 0, seq: 0, costUsd, costUnknown });

  test('per-round cost averages the most recent priced rounds', () => {
    const history = [msg('assistant', 1), msg('user'), msg('assistant', 0.2), msg('assistant', 0.4), msg('assistant', 5, true), msg('assistant', 0)];
    expect(perRoundCostUsd(history, 2)).toBeCloseTo(0.3);
    expect(perRoundCostUsd(history, 10)).toBeCloseTo((1 + 0.2 + 0.4) / 3);
    expect(perRoundCostUsd([msg('user')], 5)).toBeNull();
  });

  test('cost range scales the rounds; unpriced gives none', () => {
    expect(estimateCostRange({ roundsMin: 4, roundsMax: 10 }, 0.05)).toEqual({ low: 0.2, high: 0.5 });
    expect(estimateCostRange({ roundsMin: 4, roundsMax: 10 }, null)).toBeNull();
  });

  test('checkpoint extension: a fraction of the max, never below the minimum', () => {
    expect(checkpointExtension(20, 0.5, 4)).toBe(10);
    expect(checkpointExtension(3, 0.5, 4)).toBe(4);
    expect(checkpointExtension(7, 0.5, 0)).toBe(4);
  });

  test('the build budget starts at the estimated max and always allows a round', () => {
    const b = startBuildBudget('b1', parsePlanEstimate(EST)!, null, 'anthropic', 'm');
    expect(remainingRounds(b)).toBe(20);
    b.used = 20;
    expect(remainingRounds(b)).toBe(1);
    b.limit = 30;
    expect(remainingRounds(b)).toBe(10);
  });
});

describe('calibration', () => {
  const rec = (difficulty: CalibrationRecord['difficulty'], roundsMax: number, actualRounds: number, outcome: CalibrationRecord['outcome'] = 'completed'): CalibrationRecord =>
    ({ at: 0, provider: 'p', model: 'm', difficulty, roundsMin: 1, roundsMax, actualRounds, actualCostUsd: 0, checkpoints: 0, outcome });

  test('needs enough builds before it says anything', () => {
    expect(summarizeCalibration([rec('easy', 4, 4)], 3)).toBeNull();
    expect(summarizeCalibration([rec('easy', 4, 4), rec('easy', 4, 0), rec('easy', 4, 2)], 3)).toBeNull();
  });

  test('reports the overrun ratio, per difficulty when there are several', () => {
    const text = summarizeCalibration([
      rec('easy', 4, 4), rec('easy', 4, 4), rec('hard', 10, 20, 'accepted'), rec('hard', 10, 30, 'abandoned'),
    ], 3)!;
    expect(text).toContain('Past plan-mode builds (4)');
    expect(text).toContain('1.8× the planned maximum');
    expect(text).toContain('easy 1.0×, hard 2.5×');
    expect(text).toContain('2 of 4 finished within the estimate');
    expect(text).toContain('2 ended at a checkpoint or were abandoned');
  });

  test('a finished budget becomes a record', () => {
    const b = startBuildBudget('b1', parsePlanEstimate(EST)!, { low: 1, high: 2 }, 'anthropic', 'm');
    b.used = 25; b.spentUsd = 2.5; b.checkpoints = 1;
    expect(calibrationRecord(b, 'completed', 7)).toEqual({
      at: 7, provider: 'anthropic', model: 'm', difficulty: 'hard', roundsMin: 10, roundsMax: 20, confidence: 55,
      actualRounds: 25, estCostHigh: 2, actualCostUsd: 2.5, checkpoints: 1, outcome: 'completed',
    });
  });
});

describe('planning styles', () => {
  test('each style has its own prefix and reads back as a request', () => {
    expect(planRequestPrefix('quick')).toBe(PLAN_FIRST_PREFIX);
    expect(planTurn(PLAN_ASSESS_PREFIX + 'a dog')).toEqual({ kind: 'request', words: 'a dog', style: 'assess' });
    expect(planTurn(PLAN_COMPARE_PREFIX + 'a box')).toEqual({ kind: 'request', words: 'a box', style: 'compare' });
    expect(planTurn(PLAN_FIRST_PREFIX + 'a cup')?.style).toBe('quick');
    expect(userWords([{ type: 'text', text: PLAN_ASSESS_PREFIX + 'a dog' }])).toBe('a dog');
  });

  test('style preferences default to ask-each-time quick plans and validate', () => {
    const s = loadSettings();
    expect(s.planStyle).toBe('quick');
    expect(s.askPlanStyle).toBe(true);
    const next = setPlanStylePrefs(s, { planStyle: 'assess', askPlanStyle: false });
    expect([next.planStyle, next.askPlanStyle]).toEqual(['assess', false]);
    expect(setPlanStylePrefs(next, { planStyle: 'bogus' as never }).planStyle).toBe('assess');
  });
});
