// Web Worker for the AI agent loop. Runs runTurn() off the main thread so
// the loop never stalls when the tab is backgrounded, and tool execution
// (which must happen on the main thread where window.partwright lives)
// round-trips via postMessage without blocking the loop's task queue.
//
// Protocol — Main → Worker:
//   { type: 'run_turn',     input: AgentWorkerInput }
//   { type: 'abort' }
//   { type: 'tool_result',  callId: string, result: ToolExecResult }
//   { type: 'queue_blocks', blocks: ChatBlock[] }
//
// Protocol — Worker → Main:
//   { type: 'tool_call',  callId, name, input }
//   { type: 'callback',   name: string, args: unknown[] }
//   { type: 'turn_done',  history: ChatMessage[] }
//   { type: 'error',      message: string }

import { runTurn, type RunTurnInput, type RunTurnCallbacks } from './chatLoop';
import type { ChatBlock } from './types';
import type { ToolExecResult } from './tools';

/** Serialisable subset of RunTurnInput sent from the main thread.
 *  signal, onDrainQueuedBlocks and executeToolFn are managed by the Worker
 *  itself rather than transferred (functions and signals can't cross threads). */
export type AgentWorkerInput = Omit<RunTurnInput, 'signal' | 'onDrainQueuedBlocks' | 'executeToolFn'>;

// Pending tool-call promises keyed by callId.
const pendingToolCalls = new Map<string, (result: ToolExecResult) => void>();

// Blocks queued by the human mid-turn; pushed from main thread via queue_blocks.
const workerQueuedBlocks: ChatBlock[] = [];

let abortController: AbortController | null = null;
let callIdCounter = 0;

/** Proxy that the Worker uses instead of the real executeTool.
 *  Sends a tool_call message, then awaits the matching tool_result. */
async function executeToolViaMessage(
  name: string,
  input: Record<string, unknown>,
): Promise<ToolExecResult> {
  const callId = `tc-${++callIdCounter}`;
  self.postMessage({ type: 'tool_call', callId, name, input });
  return new Promise<ToolExecResult>(resolve => pendingToolCalls.set(callId, resolve));
}

self.onmessage = async (event: MessageEvent) => {
  const msg = event.data as { type: string } & Record<string, unknown>;

  // ── tool_result ────────────────────────────────────────────────────────
  if (msg.type === 'tool_result') {
    const resolve = pendingToolCalls.get(msg.callId as string);
    if (resolve) {
      pendingToolCalls.delete(msg.callId as string);
      resolve(msg.result as ToolExecResult);
    }
    return;
  }

  // ── abort ──────────────────────────────────────────────────────────────
  if (msg.type === 'abort') {
    abortController?.abort();
    return;
  }

  // ── queue_blocks ───────────────────────────────────────────────────────
  if (msg.type === 'queue_blocks') {
    workerQueuedBlocks.push(...(msg.blocks as ChatBlock[]));
    return;
  }

  // ── run_turn ───────────────────────────────────────────────────────────
  if (msg.type === 'run_turn') {
    const input = msg.input as AgentWorkerInput;
    abortController = new AbortController();

    // Map every RunTurnCallbacks slot to a postMessage so the main thread
    // can forward them to the aiPanel DOM callbacks.
    const post = (name: string, ...args: unknown[]) =>
      self.postMessage({ type: 'callback', name, args });

    const callbacks: RunTurnCallbacks = {
      onUserPersisted:      (m) => post('onUserPersisted', m),
      onAssistantStart:     (id) => post('onAssistantStart', id),
      onAssistantText:      (d) => post('onAssistantText', d),
      onToolStart:          (id, n) => post('onToolStart', id, n),
      onToolResult:         (id, n, r) => post('onToolResult', id, n, r),
      onAssistantPersisted: (m) => post('onAssistantPersisted', m),
      onUserMessageUpdated: (m) => post('onUserMessageUpdated', m),
      onProgress:           (i) => post('onProgress', i),
      onTurnComplete:       (i) => post('onTurnComplete', i),
      onAborted:            () => post('onAborted'),
      onError:              (e) => post('onError', { message: e.message, name: e.name }),
    };

    try {
      const history = await runTurn({
        ...input,
        signal: abortController.signal,
        executeToolFn: executeToolViaMessage,
        onDrainQueuedBlocks: () => {
          const drained = workerQueuedBlocks.splice(0);
          return drained;
        },
      }, callbacks);
      self.postMessage({ type: 'turn_done', history });
    } catch (err) {
      self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      abortController = null;
    }
  }
};
