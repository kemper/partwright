// Main-thread client for the AI agent Worker. Exposes the same
// runTurn() signature as chatLoop.ts so callers (aiPanel.ts) swap just
// the import path — no structural change required.
//
// Responsibilities:
//  • Lazily create a single persistent Worker for the session lifetime.
//  • Translate tool_call messages → executeTool() → tool_result back.
//  • Translate callback messages → invoke the RunTurnCallbacks closures.
//  • Forward abort: listen on input.signal and send { type: 'abort' }.
//  • Expose pushQueuedBlocks() so aiPanel can relay mid-turn queued input.

import { executeTool } from './tools';
import type { RunTurnInput, RunTurnCallbacks } from './chatLoop';
import type { ChatBlock, ChatMessage, PersistedToolResult } from './types';
import type { AgentWorkerInput } from './agentWorker';

let worker: Worker | null = null;
let currentCallbacks: RunTurnCallbacks | null = null;
let resolveCurrentTurn: ((h: ChatMessage[]) => void) | null = null;
let rejectCurrentTurn: ((e: Error) => void) | null = null;

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./agentWorker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = handleMessage;
  worker.onmessageerror = (ev) => {
    // A Worker→Main message that fails structured-clone on receipt is dropped
    // silently otherwise, so the in-flight turn would never settle.
    rejectCurrentTurn?.(new Error('Agent Worker sent an undeserializable message'));
    cleanup();
    worker?.terminate();
    worker = null;
    // eslint-disable-next-line no-console
    console.error('[AgentWorker] messageerror', ev);
  };
  worker.onerror = (ev) => {
    const err = new Error(`Agent Worker crashed: ${ev.message}`);
    if (rejectCurrentTurn) {
      rejectCurrentTurn(err);
    }
    cleanup();
    // Terminate and null the dead Worker so getWorker() will create a fresh
    // one on the next turn, rather than reusing a crashed instance.
    worker?.terminate();
    worker = null;
  };
  return worker;
}

async function handleMessage(event: MessageEvent): Promise<void> {
  const msg = event.data as { type: string } & Record<string, unknown>;

  // ── tool_call: execute on main thread where window.partwright lives ───
  if (msg.type === 'tool_call') {
    const { callId, name, input } = msg as unknown as {
      callId: string;
      name: string;
      input: Record<string, unknown>;
    };
    const result = await executeTool(name, input);
    getWorker().postMessage({ type: 'tool_result', callId, result });
    return;
  }

  // ── callback: forward to the RunTurnCallbacks closures ────────────────
  if (msg.type === 'callback') {
    const cb = currentCallbacks;
    if (!cb) return;
    const { name, args } = msg as unknown as { name: string; args: unknown[] };
    switch (name) {
      case 'onUserPersisted':      cb.onUserPersisted?.(args[0] as ChatMessage); break;
      case 'onAssistantStart':     cb.onAssistantStart?.(args[0] as string); break;
      case 'onAssistantText':      cb.onAssistantText?.(args[0] as string); break;
      case 'onAssistantThinking':  cb.onAssistantThinking?.(args[0] as string); break;
      case 'onToolStart':          cb.onToolStart?.(args[0] as string, args[1] as string); break;
      case 'onToolResult':         cb.onToolResult?.(args[0] as string, args[1] as string, args[2] as PersistedToolResult); break;
      case 'onAssistantPersisted': cb.onAssistantPersisted?.(args[0] as ChatMessage); break;
      case 'onUserMessageUpdated': cb.onUserMessageUpdated?.(args[0] as ChatMessage); break;
      case 'onToolResultsPersisted': cb.onToolResultsPersisted?.(args[0] as ChatMessage); break;
      case 'onProgress':           cb.onProgress?.(args[0] as Parameters<NonNullable<RunTurnCallbacks['onProgress']>>[0]); break;
      case 'onTurnComplete':       cb.onTurnComplete?.(args[0] as Parameters<NonNullable<RunTurnCallbacks['onTurnComplete']>>[0]); break;
      case 'onAborted':            cb.onAborted?.(); break;
      case 'onError': {
        const d = args[0] as { message: string; name: string };
        cb.onError?.(Object.assign(new Error(d.message), { name: d.name }));
        break;
      }
    }
    return;
  }

  // ── turn_done ──────────────────────────────────────────────────────────
  if (msg.type === 'turn_done') {
    resolveCurrentTurn?.(msg.history as ChatMessage[]);
    cleanup();
    return;
  }

  // ── error ──────────────────────────────────────────────────────────────
  if (msg.type === 'error') {
    rejectCurrentTurn?.(new Error(msg.message as string));
    cleanup();
  }
}

function cleanup() {
  resolveCurrentTurn = null;
  rejectCurrentTurn = null;
  currentCallbacks = null;
}

/** Forward blocks queued by the user mid-turn into the Worker so the
 *  chatLoop drain hook picks them up at the next tool-round boundary.
 *  Call this whenever state.queuedBlocks is modified while a turn is
 *  in flight. */
export function pushQueuedBlocks(blocks: ChatBlock[]): void {
  // Only relay if a turn is actually in flight — if no turn is active, the
  // Worker would buffer these blocks but never drain them, silently losing them.
  if (blocks.length > 0 && worker && resolveCurrentTurn) {
    worker.postMessage({ type: 'queue_blocks', blocks });
  }
}

/** Terminate and discard the Worker (e.g. on hard reset). */
export function terminateAgentWorker(): void {
  worker?.terminate();
  worker = null;
  cleanup();
}

/** Drop-in replacement for chatLoop.runTurn — same signature, Worker-backed. */
export async function runTurn(
  input: RunTurnInput,
  callbacks: RunTurnCallbacks = {},
): Promise<ChatMessage[]> {
  const w = getWorker();
  currentCallbacks = callbacks;

  // Forward abort: when the caller aborts (Stop button), tell the Worker.
  if (input.signal) {
    input.signal.addEventListener('abort', () => w.postMessage({ type: 'abort' }), { once: true });
  }

  // Strip non-serialisable fields before sending across the thread boundary.
  const workerInput: AgentWorkerInput = {
    apiKey:      input.apiKey,
    toggles:     input.toggles,
    sessionId:   input.sessionId,
    history:     input.history,
    userBlocks:  input.userBlocks,
  };

  return new Promise<ChatMessage[]>((resolve, reject) => {
    resolveCurrentTurn = resolve;
    rejectCurrentTurn = reject;
    w.postMessage({ type: 'run_turn', input: workerInput });
  });
}
