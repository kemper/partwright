// Main agent loop: assembles the request, streams the response, executes
// tools, persists everything, and loops until the model hits end_turn.
//
// Dispatch by provider:
//   anthropic → src/ai/anthropic.ts   (hosted Claude over HTTPS)
//   openai    → src/ai/openai.ts      (hosted GPT over HTTPS)
//   gemini    → src/ai/gemini.ts      (hosted Gemini over HTTPS)
//   local     → src/ai/local.ts       (WebLLM, in-browser WebGPU)
// All providers return the same `StreamResult` shape; chatLoop is
// otherwise agnostic to which one is in play.

import { generateId } from '../storage/db';
import { streamTurn, buildApiMessages, anthropicThinkingActive, type StreamCallbacks as AnthropicStreamCallbacks } from './anthropic';
import { streamLocalTurn, resolveLocalModel, type StreamCallbacks as LocalStreamCallbacks } from './local';
import { streamTurn as streamTurnOpenai, type StreamCallbacks as OpenaiStreamCallbacks } from './openai';
import { streamTurn as streamTurnGemini, type StreamCallbacks as GeminiStreamCallbacks } from './gemini';
import { streamTurn as streamTurnCustom } from './custom';
import { getKey, recordUsage, putMessages } from './db';
import { resolveCustomApiKey } from './customEndpoints';
import { recordEvent, usageEventFields } from './diagnostics';
import { buildToolList, executeTool, type ToolDefinition, CONFIRM_REQUIRED_TOOLS, CONFIRM_UNAVAILABLE_MESSAGE, RETRY_SAFE_TOOLS, declinedToolMessage, preConfirmToolResult, unofferedToolMessage, LEGACY_TOOL_ALIASES, TURN_ENDING_TOOLS, type ToolExecResult } from './tools';
import { buildLocalSystemPrompt, buildMediumLocalSystemPrompt, buildSystemPrompt, loadAiMd, toggleSuffix } from './systemPrompt';
import { loadSettings } from './settings';
import { turnCostUsd } from './cost';
import { cacheTtlForThinking } from './anthropicCache';
import { activeModel, ITERATION_CAP, MAX_TOKENS_WHILE_THINKING, SPEND_CAP_USD, type ChatBlock, type ChatMessage, type ChatToggles, type PersistedToolCall, type PersistedToolResult, type Provider, type TurnOutcomeReason } from './types';
import { getConfig } from '../config/appConfig';
import { isTransientError, isTransientToolFailure } from './transientError';
import { elideStaleToolImages, providerCachesHistory, pruneStaleToolPayloads } from './historyElision';
import { REDUCED_TOOLS_NOTE, resolveCustomPromptTier, toolsForCustomTier } from './customContext';
import { LOAD_TOOLS_TOOL, loadToolsDefinition, loadToolsResult, loadedToolGroups, selectOfferedTools, toolGroupsSuffix } from './toolGroups';

/** Look up the stored API key for a hosted provider. Returns null when
 *  no key is stored; chatLoop turns that into an "open AI Settings to
 *  connect" error so the panel can guide the user. */
async function getApiKey(provider: Provider): Promise<string | null> {
  const record = await getKey(provider);
  return record?.apiKey ?? null;
}

/** Yield to the browser between heavy synchronous work blocks.
 *
 *  Worker context: document doesn't exist; use a minimal setTimeout so
 *  the Worker's own task queue can process incoming abort/queue messages
 *  between tool calls without blocking.
 *
 *  Main thread, hidden tab: nothing to paint and Chrome suppresses "page
 *  unresponsive" for hidden tabs — skip the yield entirely so the loop
 *  runs at full speed (the original rAF stall fix).
 *
 *  Main thread, visible: prefer scheduler.yield() (Chrome 129+) then
 *  fall back to MessageChannel — both are unthrottled unlike rAF. */
function yieldToBrowser(): Promise<void> {
  if (typeof document === 'undefined') {
    // Worker: yield so the event loop can process abort/queue messages.
    return new Promise(r => setTimeout(r, 0));
  }
  if (document.hidden) return Promise.resolve();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sched = (globalThis as any).scheduler;
  if (typeof sched !== 'undefined' && typeof sched.yield === 'function') {
    return sched.yield() as Promise<void>;
  }
  return new Promise<void>(resolve => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => { port1.close(); resolve(); };
    port2.postMessage(undefined);
    port2.close();
  });
}

/** Log tool execution time. Anything over this threshold is flagged in
 *  the console so we can pinpoint the slow op if the page freezes — the
 *  most common culprits are commitPaintFromSet (re-renders all 4 iso
 *  views per call) and Manifold boolean ops on complex meshes. */
function getSlowToolMs(): number { return getConfig().ai.slowToolMs; }

/** The sentinel tool the model calls to end its turn in auto-continue mode.
 *  Defined here (not imported from tools.ts) so chatLoop stays the single
 *  source of truth for the loop-control semantics. */
const FINISH_TOOL = 'finish';

/** Synthetic user prompt injected to resume a turn that ended without calling
 *  `finish`. Persisted as a normal user turn (so provider history stays valid)
 *  but flagged `autoResumeNudge` for subtle rendering. */
const AUTO_RESUME_PROMPT =
  'Your previous turn ended without calling the `finish` tool, so the task is NOT yet marked complete. '
  + 'If you believe the request is already fully done and verified, do NOT just say so in text — '
  + 'call the `finish` tool now (optionally pass a one-line `summary`). That is the only way to end the turn. '
  + 'Otherwise, keep working: take the next concrete step toward completing the request.';

/** Synthetic user prompt after a malformed tool call while tool groups are
 *  active: the usual cause is calling a tool whose group isn't loaded. */
const TOOL_GROUP_NUDGE =
  'Your last tool call could not be made. Most likely that tool is not in your current tool list because its group is not loaded: '
  + 'call `loadTools` with the group (the loadTools description lists which group holds each tool), then retry the call. '
  + 'If the tool is already loaded, check that its arguments are valid JSON and retry.';

/** Hard ceiling on CONSECUTIVE auto-resume nudges that make no progress (no
 *  tool call, no `finish`). Resets to 0 whenever the model calls a tool. This
 *  bounds the degenerate "model keeps ending its turn but never calls finish or
 *  acts" case even when both the iteration and spend caps are set to infinity —
 *  without limiting a genuinely productive long run (which keeps calling
 *  tools). Hitting it just falls through to the normal end_turn outcome (a
 *  resumable Keep-going notice), never an infinite loop. */
function getMaxConsecutiveAutoResumes(): number { return getConfig().ai.maxConsecutiveAutoResumes; }

/** Exponential backoff with full jitter, capped. attempt is 1-based. */
function transientBackoffMs(attempt: number): number {
  const cfg = getConfig().ai;
  const ceiling = Math.min(cfg.transientRetryBaseMs * 2 ** (attempt - 1), cfg.transientRetryMaxMs);
  return Math.round(Math.random() * ceiling);
}

/** Sleep that resolves early if the abort signal fires, so a queued backoff
 *  doesn't keep a stopped turn alive. */
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal?.aborted) { resolve(); return; }
    const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); resolve(); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface RunTurnInput {
  /** Hosted-provider API key. Required only when toggles.provider === 'anthropic'. */
  apiKey?: string;
  toggles: ChatToggles;
  /** sessionId for the current chat bucket. */
  sessionId: string;
  /** Prior conversation, oldest first. */
  history: ChatMessage[];
  /** The user's new message blocks (text + any pending image attachments). */
  userBlocks: ChatBlock[];
  /** Optional abort signal — when fired, the in-flight stream and the
   *  agent loop both stop at the next safe seam. Any partial assistant
   *  text that was streamed is preserved as `aborted: true`. */
  signal?: AbortSignal;
  /** Optional drain hook — called once per loop iteration, right after the
   *  tool_result user message is persisted and before the next assistant
   *  request goes out. If it returns blocks, they're appended to the
   *  just-persisted user turn so the model sees them as part of the next
   *  iteration. This is how mid-run "queued" messages from the human get
   *  delivered at the next natural pause without aborting the agent. */
  onDrainQueuedBlocks?: () => ChatBlock[];
  /** Override for tool execution. Defaults to the real `executeTool` from
   *  tools.ts. The Agent Worker substitutes a postMessage-based proxy so
   *  tool dispatch round-trips back to the main thread where
   *  window.partwright lives, while the loop itself stays in the Worker. */
  executeToolFn?: (name: string, input: Record<string, unknown>) => Promise<import('./tools').ToolExecResult>;
  /** The UI tool catalogue for openTool's id enum (buildUiToolCatalog). The
   *  agent Worker has no tool registry, so the Worker client snapshots it on
   *  the main thread and passes it here; omitted = read the live registry. */
  uiTools?: import('./tools').UiToolCatalogEntry[];
  /** Tool groups implied by the session state (paint regions, an imported
   *  mesh — see sessionToolGroups in aiPanel), loaded from the first request
   *  so the model doesn't spend a step on loadTools. Main-thread state, so the
   *  caller computes it; the agent Worker can't. */
  preloadToolGroups?: string[];
  /** Round limit for this turn that replaces the ⟲ iteration cap — set while
   *  building an approved plan, so the build stops at the plan's estimate
   *  (a checkpoint) instead of the toolbar cap. */
  iterationLimit?: number;
}

/** Whether this turn sends the core tool set plus loaded groups
 *  (toolGroups.ts) instead of every tool. Hosted providers and Full-tier
 *  Custom endpoints only: plan mode keeps its own read-only subset, and Local
 *  and the Custom Medium / Slim tiers have their own trimmed lists. */
function toolGroupsActive(toggles: ChatToggles): boolean {
  if (!getConfig().ai.onDemandToolGroups || toggles.planFirst) return false;
  if (toggles.provider === 'local') return false;
  if (toggles.provider === 'custom' && resolveCustomPromptTier(toggles) !== 'full') return false;
  return true;
}

const LOAD_TOOLS_DEF: ToolDefinition = loadToolsDefinition();

/** The schemas one request sends, and the matching per-turn suffix line.
 *  Recomputed every iteration: a loadTools call (or a readDoc, or a grouped
 *  tool the model called anyway) widens the list for the next step. Shared
 *  with the panel's context meter so it counts what is really sent. */
export function toolsForRequest(
  toggles: ChatToggles,
  gatedTools: ToolDefinition[],
  history: readonly ChatMessage[],
  preloadToolGroups: readonly string[] = [],
): { tools: ToolDefinition[]; suffixLine: string } {
  if (toolGroupsActive(toggles)) {
    const loaded = loadedToolGroups(history, preloadToolGroups);
    return {
      tools: selectOfferedTools(gatedTools, loaded, LOAD_TOOLS_DEF),
      suffixLine: toolGroupsSuffix(loaded, new Set(gatedTools.map(t => t.name))),
    };
  }
  if (toggles.provider === 'custom') return { tools: toolsForCustomTier(gatedTools, resolveCustomPromptTier(toggles)), suffixLine: '' };
  return { tools: gatedTools, suffixLine: '' };
}

export interface RunTurnCallbacks {
  /** Called once with the persisted user-message record so the panel can
   *  show it immediately. */
  onUserPersisted?: (msg: ChatMessage) => void;
  /** Called once per assistant turn (a single API round). The panel uses
   *  this to render an in-progress bubble that subsequent text deltas
   *  populate. */
  onAssistantStart?: (id: string) => void;
  /** Streamed text deltas for the active assistant bubble. */
  onAssistantText?: (delta: string) => void;
  /** Streamed reasoning deltas (thinking models). Drives the panel's live
   *  thinking preview; the box collapses once answer text / a tool starts. */
  onAssistantThinking?: (delta: string) => void;
  /** A tool call has begun streaming — render a "calling X..." chip. */
  onToolStart?: (toolUseId: string, toolName: string) => void;
  /** A tool has finished executing. Render the result bubble. */
  onToolResult?: (toolUseId: string, toolName: string, result: PersistedToolResult) => void;
  /** Persisted assistant message at the end of one round (post-tools). */
  onAssistantPersisted?: (msg: ChatMessage) => void;
  /** The just-persisted tool_result user turn had queued user blocks
   *  merged into it. The UI uses this to refresh the in-memory copy and
   *  re-render the transcript so the user sees their queued message land
   *  immediately, without waiting for the turn to fully complete. */
  onUserMessageUpdated?: (msg: ChatMessage) => void;
  /** The tool_result user turn for a completed tool batch has been
   *  persisted, carrying any images the tools returned (renderView /
   *  renderViews snapshots, slice profiles, paint previews). The panel
   *  drops the result bubbles into the live transcript here so the user
   *  sees what the agent saw as it works — without this, tool results
   *  (and their renderings) only surface after a session reload. */
  onToolResultsPersisted?: (msg: ChatMessage) => void;
  /** Auto-continue mode injected a synthetic "keep going" user turn because the
   *  model stopped without calling `finish`. The panel inserts it into the live
   *  transcript (rendered as a subtle divider) so the resume is visible. */
  onAutoResume?: (msg: ChatMessage) => void;
  /** A "thinking" beat — fires when a turn begins, when each tool starts,
   *  and on a wall-clock interval while waiting for the first text delta.
   *  Use to keep an indicator alive so the user knows we haven't frozen. */
  onProgress?: (info: { phase: 'thinking' | 'streaming' | 'tool' | 'idle'; detail?: string }) => void;
  /** Loop ended. `reason` distinguishes a clean end_turn from the
   *  iteration cap, the spend cap, an empty final response, or other
   *  stop reasons so the UI can surface what actually happened. */
  onTurnComplete?: (info: {
    totalCostUsd: number;
    toolCalls: number;
    reason: TurnOutcomeReason;
    detail?: string;
    iterations: number;
  }) => void;
  /** User aborted the turn. Fires after the partial assistant message has
   *  been persisted. Distinct from onError — abort is intentional. */
  onAborted?: () => void;
  /** Unrecoverable error — the loop stops here. */
  onError?: (err: Error) => void;
  /** Called before executing a tool that requires explicit user permission
   *  (CONFIRM_REQUIRED_TOOLS: imports, deleteVersion). Return true to allow,
   *  false to decline. If absent, a confirm-required tool is declined when this
   *  loop runs the real executeTool; with a custom executeToolFn (the agent
   *  Worker's main-thread proxy) the confirmation is left to that layer. */
  confirmTool?: (toolName: string, input: Record<string, unknown>) => Promise<boolean>;
}

/** Resolve the base system prompt for the active provider + model, honoring
 *  any per-provider override and the slim/medium local variants. This is the
 *  "prompt" half sent to the model; the per-turn toggle suffix (toggleSuffix)
 *  rides alongside it. Extracted from runTurn so the panel can reproduce
 *  exactly what's sent (the "System prompt" disclosure in the transcript). */
export async function buildActiveSystemPrompt(toggles: ChatToggles): Promise<string> {
  const settings = loadSettings();
  const override = settings.systemPromptOverrides?.[toggles.provider] ?? null;
  if (override !== null) return override;
  if (toggles.provider === 'local' && toggles.localModel) {
    try {
      const info = resolveLocalModel(toggles.localModel);
      return info.promptTier === 'medium'
        ? buildMediumLocalSystemPrompt()
        : buildLocalSystemPrompt();
    } catch {
      return buildLocalSystemPrompt();
    }
  }
  if (toggles.provider === 'local') return buildLocalSystemPrompt();
  if (toggles.provider === 'custom') {
    // A small-window endpoint gets the local prompts (docs on demand via
    // readDoc) instead of all of ai.md — see customContext.ts.
    const tier = resolveCustomPromptTier(toggles);
    if (tier === 'medium') return buildMediumLocalSystemPrompt() + REDUCED_TOOLS_NOTE;
    if (tier === 'slim') return buildLocalSystemPrompt() + REDUCED_TOOLS_NOTE;
  }
  return buildSystemPrompt(await loadAiMd());
}

/** Run one user turn through the agent loop. Returns the final history. */
export async function runTurn(input: RunTurnInput, callbacks: RunTurnCallbacks = {}): Promise<ChatMessage[]> {
  const { apiKey, toggles, sessionId, history, userBlocks, signal } = input;
  const gatedTools = buildToolList(toggles, input.uiTools);
  // Only the tools this turn's gates allow may run. Hiding a tool is how plan
  // mode and the scope toggles gate it, but a model can still call one it saw
  // earlier in the history (a second plan after a build is the classic case).
  // Checked against the gated list, not the custom-tier trim: that trim saves
  // context, it doesn't withhold permission.
  const offeredTools = new Set(gatedTools.map(t => t.name));
  const groupsActive = toolGroupsActive(toggles);
  if (groupsActive) offeredTools.add(LOAD_TOOLS_TOOL);

  // The preamble + full ai.md is ~22K tokens — fine for hosted Claude with
  // prompt caching. Most local models have 32K context so it technically fits
  // there too, but smaller models do better with the hand-tuned
  // slim/medium prompts (which leave more room for tool docs +
  // conversation + the reply) and call readDoc to pull subdocs on demand.
  // Either path honors the per-provider user override if one is set in
  // AI settings.
  const systemPrompt = await buildActiveSystemPrompt(toggles);

  const seqStart = nextSeq(history);

  // Resume ("Keep going") calls runTurn with no userBlocks — it continues
  // the existing history rather than starting a new user turn. Skip the
  // persisted-message + history-append work in that case so an empty user
  // record doesn't accumulate in IndexedDB on every resume and doesn't
  // appear as `[user]\n` noise in later compaction summaries.
  let userMsg: ChatMessage | null = null;
  if (userBlocks.length > 0) {
    userMsg = {
      id: generateId(),
      sessionId,
      role: 'user',
      blocks: userBlocks,
      createdAt: Date.now(),
      seq: seqStart,
    };
    await putMessages([userMsg]);
    callbacks.onUserPersisted?.(userMsg);
  }

  let workingHistory: ChatMessage[] = userMsg ? [...history, userMsg] : [...history];
  let totalCostUsd = 0;
  let totalToolCalls = 0;
  let turnApiTimeMs = 0;
  const maxIter = typeof input.iterationLimit === 'number' && input.iterationLimit >= 1
    ? Math.floor(input.iterationLimit)
    : ITERATION_CAP[toggles.maxIterations];
  const maxSpend = SPEND_CAP_USD[toggles.maxSpend];
  // Auto-continue mode: the model only stops cleanly by calling `finish`; a
  // plain end_turn is auto-resumed (bounded by maxIter + maxSpend, plus the
  // no-progress ceiling below).
  const autoResume = toggles.autoResume === true;
  // Consecutive auto-resume nudges with no intervening progress (tool call or
  // human message). Reset on the tool path; trips MAX_CONSECUTIVE_AUTO_RESUMES.
  let consecutiveNudges = 0;
  // Spend cap is a session budget — count what prior turns already
  // burned so this turn stops when the running total tips over the cap,
  // not when this single turn would exceed the whole cap on its own.
  const priorSessionCost = totalCost(history);

  const model = activeModel(toggles);
  if (model === null) {
    callbacks.onError?.(new Error('No model is active. Open AI settings and choose a provider + model.'));
    callbacks.onTurnComplete?.({ totalCostUsd: 0, toolCalls: 0, reason: 'error', iterations: 0 });
    return workingHistory;
  }

  let iter = 0;
  for (; Number.isFinite(maxIter) ? iter < maxIter : true; iter++) {
    // Give the browser a frame between iterations so an agent running
    // many tool round-trips doesn't lock up the page.
    if (iter > 0) await yieldToBrowser();
    const assistantId = generateId();
    callbacks.onAssistantStart?.(assistantId);

    callbacks.onProgress?.({ phase: 'thinking', detail: 'Waiting for first token...' });
    const streamCallbacks: AnthropicStreamCallbacks & LocalStreamCallbacks & OpenaiStreamCallbacks & GeminiStreamCallbacks = {
      onText: delta => {
        // Beat on EVERY delta so the stall watchdog sees a healthy stream
        // and the elapsed-seconds counter doesn't keep climbing while text
        // is actually arriving. The progress handler short-circuits the
        // DOM rebuild when the phase is unchanged, so this is essentially
        // free past the first delta.
        callbacks.onProgress?.({ phase: 'streaming' });
        callbacks.onAssistantText?.(delta);
      },
      onThinking: delta => {
        // Beat the stall watchdog on thought deltas too. A thinking model
        // can stream pages of reasoning before its first answer token; if
        // those deltas didn't count as progress the watchdog would abort a
        // perfectly healthy turn (the "had to type resume" symptom).
        callbacks.onProgress?.({ phase: 'thinking' });
        callbacks.onAssistantThinking?.(delta);
      },
      onToolStart: (id, name) => {
        callbacks.onProgress?.({ phase: 'tool', detail: name });
        callbacks.onToolStart?.(id, name);
      },
    };

    const { tools, suffixLine } = toolsForRequest(toggles, gatedTools, workingHistory, input.preloadToolGroups);
    const baseSuffix = toggleSuffix(toggles);
    const systemSuffix = suffixLine ? `${baseSuffix}\n\n${suffixLine}` : baseSuffix;
    const requestSummary = `${workingHistory.length} msg(s), ${tools.length} tool def(s), vision=${toggles.vision.views ? 'on' : 'off'}, thinking=${toggles.thinking}`;
    // Transient provider failures (HTTP 429/5xx, dropped stream, network blip)
    // are retried in place with exponential backoff so an auto-continue run
    // survives a flaky server. These retries do NOT consume the agent's
    // per-turn iteration budget — only a *fatal* error (auth, bad request,
    // user abort) or exhausting maxTransientRetries surfaces onError and ends
    // the turn.
    const maxTransientRetries = getConfig().ai.maxTransientRetries;
    let transientAttempt = 0;
    let apiCallStart = Date.now();
    let result;
    // Trim stale render images out of the request (the persisted/displayed
    // history keeps them) so a long modeling session's image tokens don't
    // compound on every turn. Recomputed each iteration as tool results grow.
    // Providers that cache the history trim in steps (see imagesToElide) so
    // the cached prefix survives between trims; the rest keep a tight window.
    const aiCfg = getConfig().ai;
    const imageTrimmed = providerCachesHistory(toggles.provider, aiCfg.cacheConversationHistory)
      ? elideStaleToolImages(workingHistory, aiCfg.cachedImageLimit, aiCfg.cachedImageTrimTo)
      : elideStaleToolImages(workingHistory, aiCfg.keepRecentToolImages);
    // Likewise drop text payloads a later step made dead weight: superseded
    // code bodies, repeated readDoc results, old failed-call inputs.
    const sentHistory = aiCfg.pruneStaleToolPayloads ? pruneStaleToolPayloads(imageTrimmed, aiCfg) : imageTrimmed;
    for (;;) { // transient-retry loop — see maxTransientRetries below
    apiCallStart = Date.now();
    try {
      if (toggles.provider === 'anthropic') {
        if (!apiKey) throw new Error('Anthropic API key is required.');
        // Replay captured thinking blocks whenever the model will think on
        // this turn (which, on always-thinking models, includes Off) —
        // required so the tool-use loop doesn't 400 on a tool_use that isn't
        // preceded by its signed thinking block.
        const apiMessages = buildApiMessages(sentHistory, { replayThinking: anthropicThinkingActive(toggles.anthropicModel, toggles.thinking) });
        result = await streamTurn({
          apiKey,
          model: toggles.anthropicModel,
          systemPrompt,
          systemSuffix,
          apiMessages,
          tools,
          thinking: toggles.thinking,
          cacheHistory: aiCfg.cacheConversationHistory,
          cacheTtl: cacheTtlForThinking(toggles.thinking, aiCfg.extendedCacheForDeepThinking),
        }, streamCallbacks, signal);
      } else if (toggles.provider === 'openai') {
        // sendMessage passes the active provider's key as `apiKey`; fall
        // back to a direct lookup for callers that don't (e.g. retries).
        const openaiKey = apiKey ?? await getApiKey('openai');
        if (!openaiKey) throw new Error('OpenAI API key is required. Open AI Settings → OpenAI to connect one.');
        result = await streamTurnOpenai({
          apiKey: openaiKey,
          model: toggles.openaiModel,
          systemPrompt,
          systemSuffix,
          history: sentHistory,
          tools,
          thinking: toggles.thinking,
        }, streamCallbacks, signal);
      } else if (toggles.provider === 'gemini') {
        const geminiKey = apiKey ?? await getApiKey('gemini');
        if (!geminiKey) throw new Error('Google Gemini API key is required. Open AI Settings → Gemini to connect one.');
        result = await streamTurnGemini({
          apiKey: geminiKey,
          model: toggles.geminiModel,
          systemPrompt,
          systemSuffix,
          history: sentHistory,
          tools,
          thinking: toggles.thinking,
        }, streamCallbacks, signal);
      } else if (toggles.provider === 'custom') {
        // Generic OpenAI-compatible endpoint (e.g. a self-hosted llama.cpp
        // server). The base URL travels on toggles (serialized into the
        // Worker); the API key is OPTIONAL — fall back to an empty string,
        // which makes the provider omit the Authorization header.
        if (!toggles.customBaseUrl.trim()) throw new Error('Custom endpoint URL is required. Open AI Settings → Custom to set it.');
        if (!toggles.customModel.trim()) throw new Error('A model id is required for the custom endpoint. Open AI Settings → Custom to set or fetch one.');
        const customKey = apiKey ?? await resolveCustomApiKey(toggles.customBaseUrl);
        result = await streamTurnCustom({
          apiKey: customKey,
          baseUrl: toggles.customBaseUrl,
          model: toggles.customModel,
          systemPrompt,
          systemSuffix,
          history: sentHistory,
          tools,
          thinking: toggles.thinking,
          sendReasoningEffort: toggles.customReasoningEffort,
        }, streamCallbacks, signal);
      } else {
        if (!toggles.localModel) throw new Error('No local model is selected. Open AI settings → Local model.');
        // Stop interrupts the in-flight local generation via the signal (WebLLM
        // interruptGenerate), not just at the next iteration / tool boundary.
        result = await streamLocalTurn({
          modelId: toggles.localModel,
          systemPrompt,
          systemSuffix,
          history: sentHistory,
          tools,
        }, streamCallbacks, signal);
      }
      break; // streamTurn succeeded — leave the transient-retry loop
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Retryable hiccup? Back off and re-issue the same request without
      // burning an agent iteration. Keeps auto-continue alive through 5xx /
      // rate-limit / dropped-stream blips instead of tearing the loop down.
      if (!signal?.aborted && transientAttempt < maxTransientRetries && isTransientError(err)) {
        transientAttempt++;
        const waitMs = transientBackoffMs(transientAttempt);
        recordEvent({
          provider: toggles.provider,
          model: model ?? '(no model)',
          kind: 'streamTurn',
          durationMs: Date.now() - apiCallStart,
          status: 'error',
          errorMessage: `${message} — transient, retrying ${transientAttempt}/${maxTransientRetries} after ${waitMs}ms`,
          requestSummary,
        });
        callbacks.onProgress?.({ phase: 'thinking', detail: `Server error — retrying (${transientAttempt}/${maxTransientRetries})…` });
        await abortableSleep(waitMs, signal);
        continue; // re-run streamTurn
      }
      // Fatal, or retries exhausted: surface the error and end the turn. The
      // per-call diagnostics buffer records the full message (the panel's
      // onError also routes it into the app-wide errorLog with source='ai').
      recordEvent({
        provider: toggles.provider,
        model: model ?? '(no model)',
        kind: 'streamTurn',
        durationMs: Date.now() - apiCallStart,
        status: 'error',
        errorMessage: transientAttempt > 0 ? `${message} (gave up after ${transientAttempt} transient retr${transientAttempt === 1 ? 'y' : 'ies'})` : message,
        requestSummary,
      });
      callbacks.onError?.(err instanceof Error ? err : new Error(message));
      callbacks.onTurnComplete?.({ totalCostUsd, toolCalls: totalToolCalls, reason: 'error', iterations: iter + 1 });
      return workingHistory;
    }
    } // end transient-retry loop

    const durationMs = Date.now() - apiCallStart;
    turnApiTimeMs += durationMs;

    // null = the model has no known pricing (the user authorized it anyway
    // in the panel's preflight) — recorded as "cost unknown", never $0.
    const pricedCost = turnCostUsd(toggles.provider, model ?? '', result.usage);
    const turnCost = pricedCost ?? 0;
    totalCostUsd += turnCost;

    recordEvent({
      provider: toggles.provider,
      model: model ?? '(no model)',
      kind: 'streamTurn',
      durationMs,
      status: result.stopReason === 'aborted' ? 'aborted' : 'ok',
      stopReason: result.stopReason,
      ...usageEventFields(result.usage, pricedCost),
      toolCallCount: result.toolCalls.length,
      textPreview: result.text.slice(0, 200),
      requestSummary,
    });

    const aborted = result.stopReason === 'aborted' || signal?.aborted === true;

    // Thinking block (if any) renders above the answer, so it leads the
    // block list. It's a display artifact — providers' request builders
    // skip 'thinking' blocks, so it's never replayed as model text.
    const assistantBlocks: ChatBlock[] = [];
    if (result.thinking && result.thinking.trim().length > 0) {
      assistantBlocks.push({ type: 'thinking', text: result.thinking });
    }
    if (result.text.length > 0) {
      // Gemini binds a thought signature to a pure-text turn (see gemini.ts).
      // Persist it on the text block so it replays on the next request and the
      // model keeps its reasoning thread (otherwise it degrades into a tiny,
      // premature end_turn). Other providers never set it.
      const textSig = (result as { textThoughtSignature?: string }).textThoughtSignature;
      assistantBlocks.push({ type: 'text', text: result.text, ...(textSig ? { thoughtSignature: textSig } : {}) });
    }

    const assistantMsg: ChatMessage = {
      id: assistantId,
      sessionId,
      role: 'assistant',
      blocks: assistantBlocks,
      toolCalls: result.toolCalls.length > 0 ? result.toolCalls : undefined,
      // Anthropic thinking blocks (with signatures) for tool-loop replay;
      // undefined for every other provider.
      thinkingBlocks: result.thinkingBlocks && result.thinkingBlocks.length > 0 ? result.thinkingBlocks : undefined,
      usage: result.usage,
      ...(pricedCost === null ? { costUnknown: true } : { costUsd: pricedCost }),
      createdAt: Date.now(),
      seq: seqStart + 1 + iter * 2,
      durationMs,
      turnElapsedMs: turnApiTimeMs,
      ...(aborted ? { aborted: true } : {}),
    };
    await putMessages([assistantMsg]);
    workingHistory = [...workingHistory, assistantMsg];
    callbacks.onAssistantPersisted?.(assistantMsg);

    // Bill the active provider's stored key record. Local turns are free
    // at the API level so we skip them.
    if (toggles.provider !== 'local') {
      void recordUsage(toggles.provider, result.usage.inputTokens + result.usage.cacheReadInputTokens + result.usage.cacheCreationInputTokens, result.usage.outputTokens, turnCost);
    }

    // Local-provider truncation: max_tokens or unclosed tool-call. We
    // don't fire `onError` here — that would race with `onTurnComplete`
    // below and stomp the outcome. Instead we flag a synthetic stopReason
    // so the outcome formatter in the panel surfaces a useful hint.
    const localTruncated = toggles.provider === 'local' && (result as { truncated?: boolean }).truncated;
    if (localTruncated && result.stopReason !== 'tool_use') {
      result = { ...result, stopReason: 'max_tokens' };
    }

    if (aborted) {
      callbacks.onAborted?.();
      callbacks.onTurnComplete?.({ totalCostUsd, toolCalls: totalToolCalls, reason: 'aborted', iterations: iter + 1 });
      return workingHistory;
    }

    // Spend cap — stop BEFORE the next iteration if the running session
    // total (prior turns + this turn so far) has tipped over the user's
    // budget. Checked after persisting the current iteration so the
    // assistant message they paid for still lands in the transcript.
    if (Number.isFinite(maxSpend) && (priorSessionCost + totalCostUsd) > maxSpend) {
      callbacks.onTurnComplete?.({
        totalCostUsd,
        toolCalls: totalToolCalls,
        reason: 'spend_cap',
        detail: `$${maxSpend.toFixed(2)}`,
        iterations: iter + 1,
      });
      return workingHistory;
    }

    if (result.stopReason !== 'tool_use' || result.toolCalls.length === 0) {
      // Auto-continue mode: the model signals completion by calling `finish`,
      // so a plain end_turn means it stopped early — append a nudge and loop so
      // it keeps working. Bounded by maxIter (this for-loop), the spend cap
      // (checked above), and the no-progress ceiling, so it can't run away.
      // Only end_turn is auto-resumed; max_tokens / refusal keep their own
      // handling + Keep-going notice.
      // A call to a tool that isn't in this request's list (its group isn't
      // loaded) comes back as malformed_function_call on Gemini and similar
      // backends, with no call to run. Nudge the model to load the group and
      // retry, under the same no-progress ceiling.
      const groupNudge = groupsActive && result.stopReason === 'malformed_function_call';
      if (((autoResume && result.stopReason === 'end_turn') || groupNudge) && consecutiveNudges < getMaxConsecutiveAutoResumes()) {
        // Preserve user/assistant alternation: an empty assistant turn
        // (empty_final — the model said nothing) is dropped by every provider's
        // request builder, which would leave the prior tool-result user turn
        // directly before the user turn we add below — a hard 400 on Anthropic.
        // Give the empty turn a minimal marker so it survives between them.
        if (assistantBlocks.length === 0) {
          assistantMsg.blocks = [{ type: 'text', text: '(no response)' }];
          await putMessages([assistantMsg]);
        }
        // If the human queued a follow-up while the model was wrapping up,
        // deliver THAT as the next turn instead of the synthetic nudge — their
        // instruction takes priority and counts as progress.
        const queued = input.onDrainQueuedBlocks?.() ?? [];
        const useHuman = queued.length > 0;
        const nextUser: ChatMessage = {
          id: generateId(),
          sessionId,
          role: 'user',
          blocks: useHuman ? queued : [{ type: 'text', text: groupNudge ? TOOL_GROUP_NUDGE : AUTO_RESUME_PROMPT }],
          createdAt: Date.now(),
          seq: seqStart + 2 + iter * 2,
          ...(useHuman ? {} : { autoResumeNudge: true }),
        };
        await putMessages([nextUser]);
        workingHistory = [...workingHistory, nextUser];
        if (useHuman) {
          consecutiveNudges = 0;
          callbacks.onUserMessageUpdated?.(nextUser);
        } else {
          consecutiveNudges++;
          callbacks.onAutoResume?.(nextUser);
        }
        continue;
      }
      // Map stop reason to a UI-friendly outcome so the panel can show
      // "✓ done" vs "⚠ model exited without final text" vs other.
      const hasText = result.text.trim().length > 0;
      // In plan mode the tool list is limited to the pure-read subset; if the
      // model tried to call a mutating/execution tool (setCode, runCode, paint*,
      // …) it gets malformed_function_call from Anthropic because that tool
      // isn't in the turn's schema. Any text it generated before the failed
      // attempt is still valid, so treat it as end_turn rather than surfacing a
      // confusing "stopped early" banner.
      const effectiveStopReason = (result.stopReason === 'malformed_function_call' && toggles.planFirst)
        ? 'end_turn'
        : result.stopReason;
      let reason: TurnOutcomeReason = 'other';
      if (effectiveStopReason === 'end_turn') reason = hasText ? 'end_turn' : 'empty_final';
      else if (effectiveStopReason === 'max_tokens') reason = 'max_tokens';
      else if (effectiveStopReason === 'refusal') reason = 'refusal';
      // A max_tokens stop that thought but produced no text and no tool call
      // ran out of room while still thinking. That reasoning is dropped from
      // history (the API won't accept a turn that ends in thinking), so "keep
      // going" restarts the step rather than continuing it — the panel says
      // so. A Local tool call cut off mid-way also lands here with no text,
      // but that's not a thinking problem, so it keeps its own hint.
      const thought = !!result.thinking?.trim() || (result.thinkingBlocks?.length ?? 0) > 0;
      const detail = reason === 'max_tokens' && !hasText && result.toolCalls.length === 0 && thought && !localTruncated
        ? MAX_TOKENS_WHILE_THINKING
        : effectiveStopReason;
      callbacks.onTurnComplete?.({ totalCostUsd, toolCalls: totalToolCalls, reason, detail, iterations: iter + 1 });
      return workingHistory;
    }

    // The model made a tool call — that's progress, so clear the no-progress
    // auto-resume counter.
    consecutiveNudges = 0;

    // Auto-continue: did the model call the `finish` sentinel this turn? If so
    // we let any other tools in the batch run (they may be the final actions),
    // then stop cleanly below instead of looping.
    const calledFinish = autoResume && result.toolCalls.some(tc => tc.name === FINISH_TOOL);
    // askUser / proposePlan hand the next move to the user (in any mode, with
    // or without auto-continue).
    const handedToUser = result.toolCalls.find(tc => TURN_ENDING_TOOLS.has(tc.name) && offeredTools.has(tc.name));

    // Execute tools, then loop with the results posted back. Tools run
    // synchronously against window.partwright and can't be cancelled mid-
    // flight, but we check the signal between calls so a stop request
    // takes effect within ~one tool's duration.
    callbacks.onProgress?.({ phase: 'tool', detail: `running ${result.toolCalls.length} tool(s)...` });

    // Persist a placeholder tool-result message immediately after the assistant
    // message so that a page kill (tab switch, browser GC, system sleep) between
    // now and when tools finish doesn't leave orphaned tool_use blocks in
    // IndexedDB. Orphaned blocks cause a synthetic "interrupted" error on every
    // future resume of this session. Each slot is updated in-place as its tool
    // completes; the final await below writes the authoritative copy.
    const toolResultMsg: ChatMessage = {
      id: generateId(),
      sessionId,
      role: 'user',
      blocks: [],
      toolResults: result.toolCalls.map(tc => ({
        toolUseId: tc.id,
        content: '[Tool call was interrupted and did not complete]',
        isError: true,
      })),
      createdAt: Date.now(),
      seq: seqStart + 2 + iter * 2,
    };
    await putMessages([toolResultMsg]);

    const toolResults = await executeAllWithRetry(
      result.toolCalls, toggles, offeredTools, callbacks, signal,
      (eachResult, i) => {
        toolResultMsg.toolResults![i] = eachResult;
        void putMessages([toolResultMsg]);
      },
      input.executeToolFn,
    );
    totalToolCalls += result.toolCalls.length;

    // Final authoritative persist: same id, complete result set.
    toolResultMsg.toolResults = toolResults;
    await putMessages([toolResultMsg]);
    workingHistory = [...workingHistory, toolResultMsg];
    callbacks.onToolResultsPersisted?.(toolResultMsg);

    // Drain anything the human queued while we were thinking, streaming,
    // or running tools. Merging into the same user turn that carries the
    // tool_results keeps the API turn alternation clean (no two
    // consecutive user messages) and means the model sees the new
    // instruction as part of its very next response.
    const queuedBlocks = input.onDrainQueuedBlocks?.() ?? [];
    if (queuedBlocks.length > 0) {
      toolResultMsg.blocks = [...toolResultMsg.blocks, ...queuedBlocks];
      await putMessages([toolResultMsg]);
      workingHistory[workingHistory.length - 1] = toolResultMsg;
      callbacks.onUserMessageUpdated?.(toolResultMsg);
    }

    if (signal?.aborted) {
      callbacks.onAborted?.();
      callbacks.onTurnComplete?.({ totalCostUsd, toolCalls: totalToolCalls, reason: 'aborted', iterations: iter + 1 });
      return workingHistory;
    }

    // Auto-continue: the model called `finish` and its final tools have run, so
    // the task is done — stop cleanly. Two reasons NOT to stop:
    //  - a non-finish tool in the same batch errored: the model declared done
    //    but its last real action failed, so loop once more to let it react.
    //  - the human queued a follow-up mid-turn (merged above): deliver it
    //    rather than dropping it on the floor.
    const finishBatchErrored = result.toolCalls.some((tc, i) => tc.name !== FINISH_TOOL && toolResults[i]?.isError === true);
    if (calledFinish && !finishBatchErrored && queuedBlocks.length === 0) {
      callbacks.onTurnComplete?.({ totalCostUsd, toolCalls: totalToolCalls, reason: 'end_turn', detail: 'finish', iterations: iter + 1 });
      return workingHistory;
    }
    // A card was shown: wait for the user. Not when the card's own input was
    // rejected (the model gets to fix it) or the human already queued a reply
    // (delivered above, so loop on to it).
    if (handedToUser && queuedBlocks.length === 0) {
      const cardIdx = result.toolCalls.indexOf(handedToUser);
      if (toolResults[cardIdx]?.isError !== true) {
        callbacks.onTurnComplete?.({ totalCostUsd, toolCalls: totalToolCalls, reason: 'end_turn', detail: handedToUser.name, iterations: iter + 1 });
        return workingHistory;
      }
    }
  }

  // Hit iteration cap — surface to the user so they can intervene.
  // Sentinel — only reachable for finite caps. The infinite case loops above
  // and exits via end_turn / error / abort; under auto-continue the end_turn
  // exit is reached once the no-progress ceiling trips (so even infinity caps
  // can't spin forever on a model that never calls `finish`).
  callbacks.onTurnComplete?.({ totalCostUsd, toolCalls: totalToolCalls, reason: 'iteration_cap', iterations: iter });
  return workingHistory;
}

async function executeAllWithRetry(
  toolCalls: PersistedToolCall[],
  toggles: ChatToggles,
  offeredTools: ReadonlySet<string>,
  callbacks: RunTurnCallbacks,
  signal?: AbortSignal,
  onEachResult?: (result: PersistedToolResult, index: number) => void,
  executeToolFn?: RunTurnInput['executeToolFn'],
): Promise<PersistedToolResult[]> {
  const results: PersistedToolResult[] = [];
  for (let i = 0; i < toolCalls.length; i++) {
    const tc = toolCalls[i];
    // If the user hit Stop, every remaining tool call gets a synthetic
    // "aborted by user" result. The API requires every tool_use to have a
    // matching tool_result on the next turn, so we can't just drop them.
    if (signal?.aborted) {
      const aborted: PersistedToolResult = {
        toolUseId: tc.id,
        content: '[aborted by user]',
        isError: true,
      };
      results.push(aborted);
      callbacks.onToolResult?.(tc.id, tc.name, aborted);
      onEachResult?.(aborted, i);
      continue;
    }
    // A tool that wasn't offered this turn never runs (`finish` is a no-op
    // control sentinel, so it's harmless either way; a pre-rename name counts
    // as the tool it stands for).
    if (!offeredTools.has(LEGACY_TOOL_ALIASES[tc.name] ?? tc.name) && tc.name !== FINISH_TOOL) {
      const refused: PersistedToolResult = { toolUseId: tc.id, content: unofferedToolMessage(tc.name, toggles.planFirst), isError: true };
      results.push(refused);
      callbacks.onToolResult?.(tc.id, tc.name, refused);
      onEachResult?.(refused, i);
      continue;
    }
    if (CONFIRM_REQUIRED_TOOLS.has(tc.name)) {
      // Confirmation is enforced by whichever layer runs the REAL executeTool.
      // Inside the agent Worker, executeToolFn proxies to the main thread and
      // agentWorkerClient shows the prompt there, so the Worker's loop (which
      // can't hold a UI callback) delegates. Running the real executeTool here
      // with no prompt to show fails CLOSED.
      let content: string | null = null;
      // A call that would be refused anyway (e.g. a code-bearing importFromUrl)
      // returns its refusal without bothering the user with a prompt.
      const refused = preConfirmToolResult(tc.name, tc.input);
      if (refused) {
        content = refused.content;
      } else if (callbacks.confirmTool) {
        let allowed = false;
        try { allowed = await callbacks.confirmTool(tc.name, tc.input); } catch { allowed = false; }
        // Stop pressed while the prompt was up: an Allow click that raced the
        // abort must not still run the tool.
        if (signal?.aborted) content = '[aborted by user]';
        else if (!allowed) content = declinedToolMessage(tc.name);
      } else if (!executeToolFn) {
        content = CONFIRM_UNAVAILABLE_MESSAGE;
      }
      if (content !== null) {
        const declined: PersistedToolResult = { toolUseId: tc.id, content, isError: true };
        results.push(declined);
        callbacks.onToolResult?.(tc.id, tc.name, declined);
        onEachResult?.(declined, i);
        continue;
      }
    }
    // loadTools only widens the next request's tool list (toolsForRequest
    // reads the call back out of the history), so it is answered here.
    if (tc.name === LOAD_TOOLS_TOOL) {
      const loaded: PersistedToolResult = { toolUseId: tc.id, ...loadToolsResult(tc.input, offeredTools) };
      results.push(loaded);
      callbacks.onToolResult?.(tc.id, tc.name, loaded);
      onEachResult?.(loaded, i);
      continue;
    }
    let attempt = 0;
    let result = await timedExecuteTool(tc.name, tc.input, executeToolFn);
    // Only auto-retry idempotent tools. Re-running a mutation (save a version,
    // paint a region, append a note, confirm an import) that partially
    // succeeded before erroring would double-apply it; the retry budget is for
    // transient read/render/run failures, not state changes — and a
    // deterministic failure (a validation { error }, a bad id) would just fail
    // again, so only a transient-looking one is re-run.
    const retryable = RETRY_SAFE_TOOLS.has(tc.name);
    while (result.isError && retryable && isTransientToolFailure(result.content) && attempt < toggles.autoRetry && !signal?.aborted) {
      attempt++;
      result = await timedExecuteTool(tc.name, tc.input, executeToolFn);
    }
    const persisted: PersistedToolResult = {
      toolUseId: tc.id,
      content: result.content,
      isError: result.isError,
      ...(result.image ? { image: result.image } : {}),
    };
    results.push(persisted);
    callbacks.onToolResult?.(tc.id, tc.name, persisted);
    onEachResult?.(persisted, i);
    // Yield BETWEEN tool calls so the browser can flush a frame and the
    // user can interact (click Stop, scroll the transcript). A run of 5
    // paint tools without yields is enough to trigger Chrome's "page
    // unresponsive" warning on a moderately complex mesh.
    await yieldToBrowser();
  }
  return results;
}

async function timedExecuteTool(
  name: string,
  input: Record<string, unknown>,
  fn: RunTurnInput['executeToolFn'] = executeTool,
): Promise<ToolExecResult> {
  const t0 = performance.now();
  let result: ToolExecResult;
  try {
    result = await (fn ?? executeTool)(name, input);
  } catch (err) {
    // A *thrown* tool execution — most commonly the Worker-side tool-call
    // timeout (executeToolViaMessage rejects), but also a crashed main-thread
    // handler — must NOT tear the whole turn down. Before this catch the
    // rejection propagated uncaught out of runTurn, the agent Worker posted a
    // fatal `error`, and the panel's runTurn promise rejected with no cleanup —
    // leaving the chat permanently "in-flight" until a page reload. Convert it
    // into an error tool_result instead: the loop continues, the model sees the
    // failure and can react (e.g. simplify the model or retry), and a slow
    // render that blew the timeout no longer bricks the session.
    const message = err instanceof Error ? err.message : String(err);
    return { content: `Tool execution failed: ${message}`, isError: true };
  }
  const elapsed = performance.now() - t0;
  const slowMs = getSlowToolMs();
  if (elapsed > slowMs) {
    // Visible only in dev tools — meant for diagnosing the
    // "page unresponsive" case. We don't surface this in the UI to
    // avoid alarming users when the warning is benign (a Manifold
    // boolean op on a complex mesh is just genuinely slow).
    // eslint-disable-next-line no-console
    console.warn(`[AI tool] ${name} took ${Math.round(elapsed)}ms (threshold ${slowMs}ms).`);
  }
  return result;
}

function nextSeq(history: ChatMessage[]): number {
  if (history.length === 0) return 0;
  return Math.max(...history.map(m => m.seq)) + 1;
}

/** Compute estimated cached/fresh token counts for the cost estimator.
 *  Rough heuristic: assume the system prompt + tool list fits in cache after
 *  the first turn, and per-turn cost is dominated by the recent messages
 *  plus output. */
export function estimateCachedPrefixTokens(systemPromptChars: number): number {
  return Math.round(systemPromptChars / getConfig().ai.charsPerToken);
}

/** Sum the total chars in a chat message's blocks for rough token estimation. */
export function messageChars(msg: ChatMessage): number {
  let n = 0;
  for (const b of msg.blocks) if (b.type === 'text') n += b.text.length;
  if (msg.toolCalls) for (const tc of msg.toolCalls) n += JSON.stringify(tc.input).length + tc.name.length;
  if (msg.toolResults) for (const tr of msg.toolResults) n += tr.content.length;
  return n;
}

/** Rough total token estimate for the current history. Used by the
 *  context meter to color-code the bar (green/amber/red) and decide when
 *  to nudge the user toward Compact. */
export function totalTokensEstimate(history: ChatMessage[], systemPromptChars: number): number {
  let chars = systemPromptChars;
  for (const m of history) chars += messageChars(m);
  const cfg = getConfig().ai;
  const imageBlocks = history.flatMap(m => m.blocks.filter(b => b.type === 'image')).length;
  return Math.round(chars / cfg.charsPerToken) + imageBlocks * cfg.imageTokenEstimate;
}

/** Sum of all assistant-turn costs in the given history. */
export function totalCost(history: ChatMessage[]): number {
  let total = 0;
  for (const m of history) if (m.costUsd) total += m.costUsd;
  return total;
}
