import { describe, expect, it } from 'vitest';
import {
  WORKER_EXCLUDED_TOOLS, buildWorkerBrief, delegateToolDefinition, delegationAvailable,
  formatWorkerReport, parseDelegateInput, resolveWorkerModel, workerToggles,
} from '../../src/ai/delegate';
import { applyPreset, loadSettings, setToggles } from '../../src/ai/settings';
import { WORKER_TOOL_EXCLUSIONS, turnToolList } from '../../src/ai/chatLoop';
import { CONFIRM_REQUIRED_TOOLS } from '../../src/ai/tools';

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
  it('is off when the scope toggles let nothing change the model', () => {
    const t = base();
    const none = { ...t, scope: { ...t.scope, runCode: false, saveVersions: false, paintFaces: false } };
    expect(delegationAvailable(none, true)).toBe(false);
    expect(delegationAvailable({ ...none, scope: { ...none.scope, paintFaces: true } }, true)).toBe(true);
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
  it('never thinks more than the user chose to save money on', () => {
    expect(workerToggles({ ...base(), thinking: 'off' }, 'm').thinking).toBe('off');
    expect(workerToggles({ ...base(), thinking: 'low' }, 'm').thinking).toBe('low');
    expect(workerToggles({ ...base(), thinking: 'max' }, 'm').thinking).toBe('medium');
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
    const out = formatWorkerReport({ model: 'claude-sonnet-5-5', steps: 4, toolCalls: 6, costUsd: 0.4123, reason: 'end_turn', report: 'x'.repeat(50), reportIsFinal: true }, 10);
    expect(out.isError).toBe(false);
    expect(out.content).toContain('[Worker claude-sonnet-5-5 finished · 4 steps · 6 tool calls · $0.412]');
    expect(out.content).toContain('xxxxxxxxxx\n[report truncated]');
  });

  it('flags a cut-off worker\'s last message as not a final report', () => {
    const out = formatWorkerReport({ model: 'm', steps: 15, toolCalls: 20, costUsd: 0.3, reason: 'iteration_cap', report: 'Let me try r=4.2 next.', reportIsFinal: false }, 1000);
    expect(out.content).toContain('stopped at its step cap');
    expect(out.content).toContain('not a final report');
    expect(out.content).toContain('Let me try r=4.2 next.');
  });

  it('marks a failed worker as an error and fills in a missing report', () => {
    const out = formatWorkerReport({ model: 'm', steps: 1, toolCalls: 0, costUsd: 0, reason: 'error', report: '', reportIsFinal: false, errorMessage: 'HTTP 529' }, 100);
    expect(out.isError).toBe(true);
    expect(out.content).toContain('Error: HTTP 529');
    expect(out.content).toContain('ended without a written report');
  });

  it('never lets a worker delegate or ask the user', () => {
    expect([...WORKER_EXCLUDED_TOOLS].sort()).toEqual(['askUser', 'delegateTask', 'proposePlan']);
    const def = delegateToolDefinition();
    expect(def.input_schema.required).toEqual(['task', 'acceptance']);
    // Static, so editing a setting never changes the cached tool prefix.
    expect(JSON.stringify(delegateToolDefinition())).toBe(JSON.stringify(def));
  });
});

describe('worker tool list', () => {
  it('drops delegateTask, user-facing and confirm-gated tools from what the main agent has', () => {
    const full = { ...applyPreset(loadSettings(), 'full').toggles, planFirst: false };
    const main = turnToolList(full, []).map(t => t.name);
    expect(main).toContain('delegateTask');
    expect(main.some(n => CONFIRM_REQUIRED_TOOLS.has(n))).toBe(true);
    const worker = turnToolList(full, [], WORKER_TOOL_EXCLUSIONS).map(t => t.name);
    expect(worker).not.toContain('delegateTask');
    expect(worker).not.toContain('askUser');
    expect(worker.filter(n => CONFIRM_REQUIRED_TOOLS.has(n))).toEqual([]);
    expect(worker.length).toBeGreaterThan(20);
  });
});
