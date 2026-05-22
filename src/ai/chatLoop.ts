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
import { streamTurn, buildApiMessages, type StreamCallbacks as AnthropicStreamCallbacks } from './anthropic';
import { streamLocalTurn, resolveLocalModel, type StreamCallbacks as LocalStreamCallbacks } from './local';
import { streamTurn as streamTurnOpenai, type StreamCallbacks as OpenaiStreamCallbacks } from './openai';
import { streamTurn as streamTurnGemini, type StreamCallbacks as GeminiStreamCallbacks } from './gemini';
import { getKey, recordUsage, putMessages } from './db';
import { recordEvent } from './diagnostics';
import { buildToolList, executeTool } from './tools';
import { buildLocalSystemPrompt, buildMediumLocalSystemPrompt, buildSystemPrompt, loadAiMd, toggleSuffix } from './systemPrompt';
import { loadSettings } from './settings';
import { turnCostUsd } from './cost';
import { activeModel, ITERATION_CAP, SPEND_CAP_USD, type ChatBlock, type ChatMessage, type ChatToggles, type PersistedToolCall, type PersistedToolResult, type Provider, type TurnOutcomeReason } from './types';

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
const SLOW_TOOL_MS = 250;

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
}

/** Run one user turn through the agent loop. Returns the final history. */
export async function runTurn(input: RunTurnInput, callbacks: RunTurnCallbacks = {}): Promise<ChatMessage[]> {
  const { apiKey, toggles, sessionId, history, userBlocks, signal } = input;
  const tools = buildToolList(toggles);

  // The full ai.md is ~12.5K tokens — fine for hosted Claude with prompt
  // caching. Most local models have 32K context so it technically fits
  // there too, but smaller models do better with the hand-tuned
  // slim/medium prompts (which leave more room for tool docs +
  // conversation + the reply) and call readDoc to pull subdocs on demand.
  // Either path honors the per-provider user override if one is set in
  // AI settings.
  const settings = loadSettings();
  const override = settings.systemPromptOverrides?.[toggles.provider] ?? null;
  let systemPrompt: string;
  if (override !== null) {
    systemPrompt = override;
  } else if (toggles.provider === 'local' && toggles.localModel) {
    try {
      const info = resolveLocalModel(toggles.localModel);
      systemPrompt = info.promptTier === 'medium'
        ? buildMediumLocalSystemPrompt()
        : buildLocalSystemPrompt();
    } catch {
      systemPrompt = buildLocalSystemPrompt();
    }
  } else if (toggles.provider === 'local') {
    systemPrompt = buildLocalSystemPrompt();
  } else {
    systemPrompt = buildSystemPrompt(await loadAiMd());
  }

  const seqStart = nextSeq(history);

  const userMsg: ChatMessage = {
    id: generateId(),
    sessionId,
    role: 'user',
    blocks: userBlocks,
    createdAt: Date.now(),
    seq: seqStart,
  };
  await putMessages([userMsg]);
  callbacks.onUserPersisted?.(userMsg);

  let workingHistory: ChatMessage[] = [...history, userMsg];
  let totalCostUsd = 0;
  let totalToolCalls = 0;
  let turnApiTimeMs = 0;
  const maxIter = ITERATION_CAP[toggles.maxIterations];
  const maxSpend = SPEND_CAP_USD[toggles.maxSpend];
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

  for (let iter = 0; Number.isFinite(maxIter) ? iter < maxIter : true; iter++) {
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

    const apiCallStart = Date.now();
    const requestSummary = `${workingHistory.length} msg(s), ${tools.length} tool def(s), vision=${toggles.vision.views ? 'on' : 'off'}, thinking=${toggles.thinking}`;
    let result;
    try {
      if (toggles.provider === 'anthropic') {
        if (!apiKey) throw new Error('Anthropic API key is required.');
        // Replay captured thinking blocks only when thinking is on for this
        // turn — required so the tool-use loop doesn't 400 on a tool_use that
        // isn't preceded by its signed thinking block.
        const apiMessages = buildApiMessages(workingHistory, { replayThinking: toggles.thinking !== 'off' });
        result = await streamTurn({
          apiKey,
          model: toggles.anthropicModel,
          systemPrompt,
          systemSuffix: toggleSuffix(toggles),
          apiMessages,
          tools,
          thinking: toggles.thinking,
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
          systemSuffix: toggleSuffix(toggles),
          history: workingHistory,
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
          systemSuffix: toggleSuffix(toggles),
          history: workingHistory,
          tools,
          thinking: toggles.thinking,
        }, streamCallbacks, signal);
      } else {
        if (!toggles.localModel) throw new Error('No local model is selected. Open AI settings → Local model.');
        // Local provider doesn't accept AbortSignal yet — the user's Stop
        // click takes effect at the next iteration / tool boundary.
        result = await streamLocalTurn({
          modelId: toggles.localModel,
          systemPrompt,
          systemSuffix: toggleSuffix(toggles),
          history: workingHistory,
          tools,
        }, streamCallbacks);
      }
    } catch (err) {
      // Surface the error to the caller; runTurn returns normally and the
      // caller's awaited post-cleanup runs the history reload. The
      // in-memory "Thinking…" placeholder gets wiped there. The per-call
      // diagnostics buffer records the full message (the panel's onError
      // also routes it into the app-wide errorLog with source='ai').
      const message = err instanceof Error ? err.message : String(err);
      recordEvent({
        provider: toggles.provider,
        model: model ?? '(no model)',
        kind: 'streamTurn',
        durationMs: Date.now() - apiCallStart,
        status: 'error',
        errorMessage: message,
        requestSummary,
      });
      callbacks.onError?.(err instanceof Error ? err : new Error(message));
      callbacks.onTurnComplete?.({ totalCostUsd, toolCalls: totalToolCalls, reason: 'error', iterations: iter + 1 });
      return workingHistory;
    }

    const durationMs = Date.now() - apiCallStart;
    turnApiTimeMs += durationMs;

    recordEvent({
      provider: toggles.provider,
      model: model ?? '(no model)',
      kind: 'streamTurn',
      durationMs,
      status: result.stopReason === 'aborted' ? 'aborted' : 'ok',
      stopReason: result.stopReason,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      cachedTokens: result.usage.cacheReadInputTokens,
      toolCallCount: result.toolCalls.length,
      textPreview: result.text.slice(0, 200),
      requestSummary,
    });

    const turnCost = turnCostUsd(toggles.provider, model ?? '', result.usage);
    totalCostUsd += turnCost;

    const aborted = result.stopReason === 'aborted' || signal?.aborted === true;

    // Thinking block (if any) renders above the answer, so it leads the
    // block list. It's a display artifact — providers' request builders
    // skip 'thinking' blocks, so it's never replayed as model text.
    const assistantBlocks: ChatBlock[] = [];
    if (result.thinking && result.thinking.trim().length > 0) {
      assistantBlocks.push({ type: 'thinking', text: result.thinking });
    }
    if (result.text.length > 0) assistantBlocks.push({ type: 'text', text: result.text });

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
      costUsd: turnCost,
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
      // Map stop reason to a UI-friendly outcome so the panel can show
      // "✓ done" vs "⚠ model exited without final text" vs other.
      const hasText = result.text.trim().length > 0;
      let reason: TurnOutcomeReason = 'other';
      if (result.stopReason === 'end_turn') reason = hasText ? 'end_turn' : 'empty_final';
      else if (result.stopReason === 'max_tokens') reason = 'max_tokens';
      else if (result.stopReason === 'refusal') reason = 'refusal';
      callbacks.onTurnComplete?.({ totalCostUsd, toolCalls: totalToolCalls, reason, detail: result.stopReason, iterations: iter + 1 });
      return workingHistory;
    }

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
      result.toolCalls, toggles, callbacks, signal,
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
  }

  // Hit iteration cap — surface to the user so they can intervene.
  // Sentinel — only reachable for finite caps. The infinite case loops
  // forever above and exits via end_turn / error / abort.
  const reached = Number.isFinite(maxIter) ? maxIter : totalToolCalls;
  callbacks.onTurnComplete?.({ totalCostUsd, toolCalls: totalToolCalls, reason: 'iteration_cap', iterations: reached });
  return workingHistory;
}

async function executeAllWithRetry(
  toolCalls: PersistedToolCall[],
  toggles: ChatToggles,
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
    let attempt = 0;
    let result = await timedExecuteTool(tc.name, tc.input, executeToolFn);
    while (result.isError && attempt < toggles.autoRetry && !signal?.aborted) {
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
) {
  const t0 = performance.now();
  const result = await (fn ?? executeTool)(name, input);
  const elapsed = performance.now() - t0;
  if (elapsed > SLOW_TOOL_MS) {
    // Visible only in dev tools — meant for diagnosing the
    // "page unresponsive" case. We don't surface this in the UI to
    // avoid alarming users when the warning is benign (a Manifold
    // boolean op on a complex mesh is just genuinely slow).
    // eslint-disable-next-line no-console
    console.warn(`[AI tool] ${name} took ${Math.round(elapsed)}ms (threshold ${SLOW_TOOL_MS}ms).`);
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
  // ~4 chars per token average
  return Math.round(systemPromptChars / 4);
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
  // Image blocks: ~1500 tokens each at standard res for a mid-size image.
  const imageBlocks = history.flatMap(m => m.blocks.filter(b => b.type === 'image')).length;
  return Math.round(chars / 4) + imageBlocks * 1500;
}

/** Sum of all assistant-turn costs in the given history. */
export function totalCost(history: ChatMessage[]): number {
  let total = 0;
  for (const m of history) if (m.costUsd) total += m.costUsd;
  return total;
}
