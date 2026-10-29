// Worker delegation: the main agent hands one self-contained task to a
// cheaper model of the same provider, which runs its own short agent loop
// against the same session and hands back a text report.
//
// Why: on a hard modeling problem most of the spend is the iterate-to-a-score
// loop (run → render → measure → tweak), and on the main model every one of
// those steps re-reads the whole conversation and bills output at the top
// rate. A worker starts from an empty history, runs on a model that costs a
// fraction as much, and its renders and tool chatter never enter the main
// conversation — only its report does.
//
// This module is the pure half (schema, model choice, toggles, brief, report)
// so the unit tier can test it; the loop itself is chatLoop.runWorkerTask.

import { ASK_USER_TOOL, PROPOSE_PLAN_TOOL } from './planReply';
import { outputRateUsd } from './cost';
import type { ChatToggles, ImageSource, Provider } from './types';

export const DELEGATE_TASK_TOOL = 'delegateTask';

/** Tools a worker never gets: it can't delegate again, and there's no user on
 *  the other end to answer a question card or approve a plan. */
export const WORKER_EXCLUDED_TOOLS: ReadonlySet<string> = new Set([
  DELEGATE_TASK_TOOL,
  ASK_USER_TOOL,
  PROPOSE_PLAN_TOOL,
]);

/** Cheaper default worker per hosted provider. Local and Custom have no
 *  second tier to drop to, so they don't delegate. */
const DEFAULT_WORKER_MODEL: Partial<Record<Provider, string>> = {
  anthropic: 'claude-sonnet-5-5',
  openai: 'gpt-5-mini',
  gemini: 'gemini-flash-latest',
};

/** The model a worker runs on: the provider's cheaper default, unless the
 *  main model already costs no more than that (then the worker just reuses it
 *  — a fresh small context still saves the re-reads) or either price is
 *  unknown (reuse the main model rather than guess). null = no delegation
 *  for this provider. */
export function resolveWorkerModel(provider: Provider, mainModel: string | null): string | null {
  const fallback = DEFAULT_WORKER_MODEL[provider];
  if (!fallback || !mainModel) return null;
  if (mainModel === fallback) return fallback;
  const mainRate = outputRateUsd(provider, mainModel);
  const workerRate = outputRateUsd(provider, fallback);
  if (mainRate === null || workerRate === null) return mainModel;
  return workerRate < mainRate ? fallback : mainModel;
}

/** Whether the main agent is offered delegateTask this turn. */
export function delegationAvailable(toggles: ChatToggles, enabled: boolean): boolean {
  if (!enabled || toggles.planFirst) return false;
  return DEFAULT_WORKER_MODEL[toggles.provider] !== undefined;
}

export interface DelegateRequest {
  task: string;
  acceptance: string;
  context: string;
  maxSteps: number;
}

/** Validate a delegateTask call. Unknown keys are rejected like every other
 *  tool input, so a typo doesn't silently drop the acceptance check. */
export function parseDelegateInput(input: Record<string, unknown>, stepCap: number): DelegateRequest | { error: string } {
  const allowed = new Set(['task', 'acceptance', 'context', 'maxSteps']);
  const unknown = Object.keys(input).filter(k => !allowed.has(k));
  if (unknown.length > 0) return { error: `delegateTask: unknown field(s) ${unknown.join(', ')}. Allowed: task, acceptance, context, maxSteps.` };
  const task = typeof input.task === 'string' ? input.task.trim() : '';
  const acceptance = typeof input.acceptance === 'string' ? input.acceptance.trim() : '';
  if (!task) return { error: 'delegateTask: `task` is required — a self-contained instruction; the worker sees nothing of this chat.' };
  if (!acceptance) return { error: 'delegateTask: `acceptance` is required — the concrete check that says the task is done (e.g. "componentCount === 3 and isManifold").' };
  if (input.context !== undefined && typeof input.context !== 'string') return { error: 'delegateTask: `context` must be a string.' };
  let maxSteps = stepCap;
  if (input.maxSteps !== undefined) {
    if (typeof input.maxSteps !== 'number' || !Number.isInteger(input.maxSteps) || input.maxSteps < 1) {
      return { error: 'delegateTask: `maxSteps` must be a positive integer.' };
    }
    maxSteps = Math.min(input.maxSteps, stepCap);
  }
  return { task, acceptance, context: typeof input.context === 'string' ? input.context.trim() : '', maxSteps };
}

/** The worker's toggles: the main chat's, on the worker model, at Medium
 *  thinking, with nothing that waits on a person (auto-continue, plan mode,
 *  end-of-task review). */
export function workerToggles(main: ChatToggles, workerModel: string): ChatToggles {
  const t: ChatToggles = {
    ...main,
    thinking: 'medium',
    autoResume: false,
    planFirst: false,
    autoReview: false,
  };
  if (main.provider === 'anthropic') t.anthropicModel = workerModel as ChatToggles['anthropicModel'];
  else if (main.provider === 'openai') t.openaiModel = workerModel as ChatToggles['openaiModel'];
  else if (main.provider === 'gemini') t.geminiModel = workerModel as ChatToggles['geminiModel'];
  return t;
}

/** The worker's only user message. It sees none of the main conversation, so
 *  everything it needs has to be in here. */
export function buildWorkerBrief(req: DelegateRequest): string {
  return [
    'You are a worker agent. The main Partwright agent handed you ONE task. There is no user to talk to: never ask questions, and if you are blocked, stop and say why.',
    `You have at most ${req.maxSteps} steps (one step = one reply, with or without tool calls). Iterate against the acceptance check; measure, don't guess. Save a version (runAndSave) whenever you reach a better result, so your best state is never lost.`,
    'When you finish or run out of steps, reply with a SHORT report and no tool calls: what you changed (version labels), the final numbers for the acceptance check, whether it passed, and anything left undone. The main agent reads only this report.',
    '',
    `TASK:\n${req.task}`,
    '',
    `ACCEPTANCE:\n${req.acceptance}`,
    ...(req.context ? ['', `CONTEXT FROM THE MAIN AGENT:\n${req.context}`] : []),
  ].join('\n');
}

export interface WorkerOutcome {
  model: string;
  steps: number;
  toolCalls: number;
  costUsd: number;
  /** TurnOutcomeReason of the worker's loop. */
  reason: string;
  /** The worker's final reply text ('' when it ended without one). */
  report: string;
  errorMessage?: string;
  /** The last image any of its tools returned (a render), if any. */
  lastImage?: ImageSource;
}

/** The tool result the main agent sees. */
export function formatWorkerReport(o: WorkerOutcome, maxReportChars: number): { content: string; isError: boolean } {
  const ended = o.reason === 'end_turn' ? 'finished'
    : o.reason === 'iteration_cap' ? 'stopped at its step cap'
      : o.reason === 'spend_cap' ? 'stopped at its spend cap'
        : o.reason === 'aborted' ? 'was stopped by the user'
          : o.reason === 'error' ? 'failed'
            : `stopped (${o.reason})`;
  const head = `[Worker ${o.model} ${ended} · ${o.steps} step${o.steps === 1 ? '' : 's'} · ${o.toolCalls} tool call${o.toolCalls === 1 ? '' : 's'} · $${o.costUsd.toFixed(3)}]`;
  const report = o.report.trim();
  const body = report.length > maxReportChars ? `${report.slice(0, maxReportChars)}\n[report truncated]` : report;
  const parts = [head];
  if (o.errorMessage) parts.push(`Error: ${o.errorMessage}`);
  parts.push(body || '(The worker ended without a written report — check getSessionContext / the latest saved version to see what it did.)');
  if (o.lastImage) parts.push('[The image is the last render the worker made.]');
  return { content: parts.join('\n\n'), isError: o.reason === 'error' };
}

/** delegateTask's schema, offered to the main agent next to its other tools. */
export function delegateToolDefinition(stepCap: number): { name: string; description: string; input_schema: { type: 'object'; properties: Record<string, unknown>; required: string[] } } {
  return {
    name: DELEGATE_TASK_TOOL,
    description:
      'Hand ONE self-contained, measurable sub-task to a cheaper worker model. It works on the same session (same code, versions, imports, tools) in its own fresh context and returns only a short report plus its last render. '
      + 'Use it for iterate-to-a-number work where each step is run → render/measure → tweak: tuning parameters until a photoMatch / evalAgainstImport score or a componentCount / isManifold / clearance gate passes, part-detection clean-up, paint passes, parameter sweeps. '
      + 'Keep design decisions, anything ambiguous, and anything needing the user\'s input for yourself. '
      + 'The worker sees NOTHING of this chat: put every requirement, number and file/version name it needs into `task` and `context`. Verify its result (stats or one render) before telling the user it worked.',
    input_schema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'The complete instruction, written for someone who has not seen this conversation.' },
        acceptance: { type: 'string', description: 'The concrete check that means done, e.g. "isManifold, componentCount === 1, photoMatch silhouetteIoU >= 0.85".' },
        context: { type: 'string', description: 'Facts the worker needs: dimensions, decisions already made, version labels to start from, what was already tried.' },
        maxSteps: { type: 'integer', minimum: 1, maximum: stepCap, description: `Step budget (default and max ${stepCap}).` },
      },
      required: ['task', 'acceptance'],
    },
  };
}
