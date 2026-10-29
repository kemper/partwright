import { describe, expect, it } from 'vitest';
import {
  WORKER_EXCLUDED_TOOLS, buildWorkerBrief, delegateToolDefinition, delegationAvailable,
  formatWorkerReport, parseDelegateInput, resolveWorkerModel, workerToggles,
} from '../../src/ai/delegate';
import { loadSettings, setToggles } from '../../src/ai/settings';

const base = () => setToggles(loadSettings(), { provider: 'anthropic', anthropicModel: 'claude-opus-5-5', thinking: 'high', autoResume: true, planFirst: false, autoReview: true }).toggles;

describe('resolveWorkerModel', () => {
  it('drops Opus to Sonnet on Anthropic', () => {
    expect(resolveWorkerModel('anthropic', 'claude-opus-5-5')).toBe('claude-sonnet-5-5');
  });
  it('keeps the main model when the default worker is not cheaper', () => {
    expect(resolveWorkerModel('anthropic', 'claude-haiku-5-5')).toBe('claude-haiku-5-5');
    expect(resolveWorkerModel('anthropic', 'claude-sonnet-5-5')).toBe('claude-sonnet-5-5');
  });
  it('reuses an unpriced main model rather than guess', () => {
    expect(resolveWorkerModel('anthropic', 'claude-unknown-9')).toBe('claude-unknown-9');
  });
  it('offers nothing for Local / Custom', () => {
    expect(resolveWorkerModel('local', 'x')).toBeNull();
    expect(resolveWorkerModel('custom', 'x')).toBeNull();
  });
});

describe('delegationAvailable', () => {
  it('is on for hosted providers outside plan mode, when enabled', () => {
    const t = base();
    expect(delegationAvailable(t, true)).toBe(true);
    expect(delegationAvailable(t, false)).toBe(false);
    expect(delegationAvailable({ ...t, planFirst: true }, true)).toBe(false);
    expect(delegationAvailable({ ...t, provider: 'local' }, true)).toBe(false);
  });
});

describe('parseDelegateInput', () => {
  it('requires task and acceptance, and caps maxSteps', () => {
    expect(parseDelegateInput({ task: 'x' }, 15)).toHaveProperty('error');
    expect(parseDelegateInput({ acceptance: 'y' }, 15)).toHaveProperty('error');
    expect(parseDelegateInput({ task: ' t ', acceptance: ' a ' }, 15)).toEqual({ task: 't', acceptance: 'a', context: '', maxSteps: 15 });
    expect(parseDelegateInput({ task: 't', acceptance: 'a', maxSteps: 40 }, 15)).toMatchObject({ maxSteps: 15 });
    expect(parseDelegateInput({ task: 't', acceptance: 'a', maxSteps: 4 }, 15)).toMatchObject({ maxSteps: 4 });
  });
  it('rejects bad maxSteps and unknown keys', () => {
    expect(parseDelegateInput({ task: 't', acceptance: 'a', maxSteps: 0 }, 15)).toHaveProperty('error');
    expect(parseDelegateInput({ task: 't', acceptance: 'a', maxSteps: 2.5 }, 15)).toHaveProperty('error');
    expect(parseDelegateInput({ task: 't', acceptance: 'a', acceptence: 'typo' }, 15)).toHaveProperty('error');
  });
});

describe('workerToggles', () => {
  it('swaps the model, runs at Medium, and turns off everything that waits on a person', () => {
    const w = workerToggles(base(), 'claude-sonnet-5-5');
    expect(w.anthropicModel).toBe('claude-sonnet-5-5');
    expect(w).toMatchObject({ thinking: 'medium', autoResume: false, planFirst: false, autoReview: false, provider: 'anthropic' });
  });
});

describe('worker brief, report and schema', () => {
  it('puts the task, acceptance, context and step budget in the brief', () => {
    const brief = buildWorkerBrief({ task: 'Tune the mask', acceptance: 'IoU >= 0.85', context: 'Start from v15', maxSteps: 7 });
    expect(brief).toContain('TASK:\nTune the mask');
    expect(brief).toContain('ACCEPTANCE:\nIoU >= 0.85');
    expect(brief).toContain('CONTEXT FROM THE MAIN AGENT:\nStart from v15');
    expect(brief).toContain('at most 7 steps');
  });

  it('heads the report with the run summary and truncates long reports', () => {
    const out = formatWorkerReport({ model: 'claude-sonnet-5-5', steps: 15, toolCalls: 22, costUsd: 0.4123, reason: 'iteration_cap', report: 'x'.repeat(50) }, 10);
    expect(out.isError).toBe(false);
    expect(out.content).toContain('[Worker claude-sonnet-5-5 stopped at its step cap · 15 steps · 22 tool calls · $0.412]');
    expect(out.content).toContain('xxxxxxxxxx\n[report truncated]');
  });

  it('marks a failed worker as an error and fills in a missing report', () => {
    const out = formatWorkerReport({ model: 'm', steps: 1, toolCalls: 0, costUsd: 0, reason: 'error', report: '', errorMessage: 'HTTP 529' }, 100);
    expect(out.isError).toBe(true);
    expect(out.content).toContain('Error: HTTP 529');
    expect(out.content).toContain('ended without a written report');
  });

  it('never lets a worker delegate or ask the user', () => {
    expect([...WORKER_EXCLUDED_TOOLS].sort()).toEqual(['askUser', 'delegateTask', 'proposePlan']);
    const def = delegateToolDefinition(15);
    expect(def.input_schema.required).toEqual(['task', 'acceptance']);
    expect((def.input_schema.properties.maxSteps as { maximum: number }).maximum).toBe(15);
  });
});
