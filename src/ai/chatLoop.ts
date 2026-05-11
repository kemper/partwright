// Main agent loop: assembles the request, streams the response, executes
// tools, persists everything, and loops until the model hits end_turn.
//
// Dispatch by provider:
//   anthropic → src/ai/anthropic.ts   (hosted Claude over HTTPS)
//   local     → src/ai/local.ts       (WebLLM, in-browser WebGPU)
// Both providers return the same `StreamResult` shape; chatLoop is otherwise
// agnostic to which one is in play.

import { generateId } from '../storage/db';
import { streamTurn, buildApiMessages, type StreamCallbacks as AnthropicStreamCallbacks } from './anthropic';
import { streamLocalTurn, type StreamCallbacks as LocalStreamCallbacks } from './local';
import { recordUsage, putMessages } from './db';
import { buildToolList, executeTool } from './tools';
import { buildLocalSystemPrompt, buildSystemPrompt, loadAiMd, toggleSuffix } from './systemPrompt';
import { loadSettings } from './settings';
import { turnCostUsd } from './cost';
import { activeModel, type ChatBlock, type ChatMessage, type ChatToggles, type PersistedToolCall, type PersistedToolResult, type TurnUsage } from './types';

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
  /** A tool call has begun streaming — render a "calling X..." chip. */
  onToolStart?: (toolUseId: string, toolName: string) => void;
  /** A tool has finished executing. Render the result bubble. */
  onToolResult?: (toolUseId: string, toolName: string, result: PersistedToolResult) => void;
  /** Persisted assistant message at the end of one round (post-tools). */
  onAssistantPersisted?: (msg: ChatMessage) => void;
  /** Loop ended (either end_turn or unrecoverable error). */
  onTurnComplete?: (info: { totalCostUsd: number; toolCalls: number }) => void;
  /** Unrecoverable error — the loop stops here. */
  onError?: (err: Error) => void;
}

const MAX_AGENT_ITERATIONS = 8;

/** Run one user turn through the agent loop. Returns the final history. */
export async function runTurn(input: RunTurnInput, callbacks: RunTurnCallbacks = {}): Promise<ChatMessage[]> {
  const { apiKey, toggles, sessionId, history, userBlocks } = input;
  const tools = buildToolList(toggles);
  // The full ai.md is ~15K tokens — fine for hosted Claude with prompt
  // caching, but ruinous for a local 1-8B model with a 4K window. Use a
  // hand-tuned slim prompt on the local path. Either path honors the
  // per-provider user override if one is set in AI settings.
  const settings = loadSettings();
  const override = settings.systemPromptOverrides?.[toggles.provider] ?? null;
  let systemPrompt: string;
  if (override !== null) {
    systemPrompt = override;
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

  const model = activeModel(toggles);
  if (model === null) {
    callbacks.onError?.(new Error('No model is active. Open AI settings and choose a provider + model.'));
    callbacks.onTurnComplete?.({ totalCostUsd: 0, toolCalls: 0 });
    return workingHistory;
  }

  for (let iter = 0; iter < MAX_AGENT_ITERATIONS; iter++) {
    const assistantId = generateId();
    callbacks.onAssistantStart?.(assistantId);

    const streamCallbacks: AnthropicStreamCallbacks & LocalStreamCallbacks = {
      onText: callbacks.onAssistantText,
      onToolStart: callbacks.onToolStart,
    };

    let result;
    try {
      if (toggles.provider === 'anthropic') {
        if (!apiKey) throw new Error('Anthropic API key is required.');
        const apiMessages = buildApiMessages(workingHistory);
        result = await streamTurn({
          apiKey,
          model: toggles.anthropicModel,
          systemPrompt,
          systemSuffix: toggleSuffix(toggles),
          apiMessages,
          tools,
        }, streamCallbacks);
      } else {
        if (!toggles.localModel) throw new Error('No local model is selected. Open AI settings → Local model.');
        result = await streamLocalTurn({
          modelId: toggles.localModel,
          systemPrompt,
          systemSuffix: toggleSuffix(toggles),
          history: workingHistory,
          tools,
        }, streamCallbacks);
        // streamLocalTurn returns the same StreamResult shape but without
        // raw assistant blocks; chatLoop never reads that field.
      }
    } catch (err) {
      callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
      return workingHistory;
    }

    const turnCost = turnCostUsd(model, result.usage);
    totalCostUsd += turnCost;

    const assistantMsg: ChatMessage = {
      id: assistantId,
      sessionId,
      role: 'assistant',
      blocks: result.text.length > 0 ? [{ type: 'text', text: result.text }] : [],
      toolCalls: result.toolCalls.length > 0 ? result.toolCalls : undefined,
      usage: result.usage,
      costUsd: turnCost,
      createdAt: Date.now(),
      seq: seqStart + 1 + iter * 2,
    };
    await putMessages([assistantMsg]);
    workingHistory = [...workingHistory, assistantMsg];
    callbacks.onAssistantPersisted?.(assistantMsg);

    if (toggles.provider === 'anthropic') {
      void recordUsage('anthropic', result.usage.inputTokens + result.usage.cacheReadInputTokens + result.usage.cacheCreationInputTokens, result.usage.outputTokens, turnCost);
    }

    if (toggles.provider === 'local' && (result as { truncated?: boolean }).truncated) {
      // Local models are prone to running out of `max_tokens` mid-response
      // — especially small ones that ramble. Surface a clear, actionable
      // notice rather than the cryptic max_tokens stop reason.
      callbacks.onError?.(new Error(
        'The local model\'s response was cut off before it finished. ' +
        'Try a shorter prompt, switch to the Large (Hermes 3) model, or compact the chat to free up context.'
      ));
    }

    if (result.stopReason !== 'tool_use' || result.toolCalls.length === 0) {
      callbacks.onTurnComplete?.({ totalCostUsd, toolCalls: totalToolCalls });
      return workingHistory;
    }

    // Execute tools, then loop with the results posted back.
    const toolResults = await executeAllWithRetry(result.toolCalls, toggles, callbacks);
    totalToolCalls += result.toolCalls.length;

    const toolResultMsg: ChatMessage = {
      id: generateId(),
      sessionId,
      role: 'user',
      blocks: [],
      toolResults,
      createdAt: Date.now(),
      seq: seqStart + 2 + iter * 2,
    };
    await putMessages([toolResultMsg]);
    workingHistory = [...workingHistory, toolResultMsg];
  }

  // Hit iteration cap — surface to the user so they can intervene.
  callbacks.onError?.(new Error(`Agent loop exceeded ${MAX_AGENT_ITERATIONS} iterations without completing. Try a more focused prompt or compact the conversation.`));
  callbacks.onTurnComplete?.({ totalCostUsd, toolCalls: totalToolCalls });
  return workingHistory;
}

async function executeAllWithRetry(
  toolCalls: PersistedToolCall[],
  toggles: ChatToggles,
  callbacks: RunTurnCallbacks,
): Promise<PersistedToolResult[]> {
  const results: PersistedToolResult[] = [];
  for (const tc of toolCalls) {
    let attempt = 0;
    let result = await executeTool(tc.name, tc.input);
    while (result.isError && attempt < toggles.autoRetry) {
      attempt++;
      result = await executeTool(tc.name, tc.input);
    }
    const persisted: PersistedToolResult = {
      toolUseId: tc.id,
      content: result.content,
      isError: result.isError,
    };
    results.push(persisted);
    callbacks.onToolResult?.(tc.id, tc.name, persisted);
  }
  return results;
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

/** Token usage summed across the assistant turns. */
export function totalUsage(history: ChatMessage[]): TurnUsage {
  const out: TurnUsage = { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
  for (const m of history) {
    if (!m.usage) continue;
    out.inputTokens += m.usage.inputTokens;
    out.outputTokens += m.usage.outputTokens;
    out.cacheCreationInputTokens += m.usage.cacheCreationInputTokens;
    out.cacheReadInputTokens += m.usage.cacheReadInputTokens;
  }
  return out;
}
