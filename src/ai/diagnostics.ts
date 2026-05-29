// In-memory ring buffer of recent AI provider events. The diagnostics
// modal reads this; providers and the chat loop record into it whenever
// an API call completes (success, error, or abort).
//
// Lives in memory only — there's no value persisting yesterday's HTTP
// errors across page loads, and the records can contain sensitive
// request fragments we don't want sitting in IndexedDB long-term.

import type { Provider } from './types';

export type DiagnosticKind = 'streamTurn' | 'summarize' | 'validateKey' | 'review';
export type DiagnosticStatus = 'ok' | 'error' | 'aborted';

export interface DiagnosticEvent {
  id: string;
  /** When the event was recorded. */
  timestamp: number;
  provider: Provider;
  /** Model id sent to the API. */
  model: string;
  /** Which provider entry point was called. */
  kind: DiagnosticKind;
  /** Wall-clock ms from request start to event recording. */
  durationMs: number;
  status: DiagnosticStatus;
  // === Populated on success ===
  /** Provider-canonical stop reason (end_turn / tool_use / max_tokens /
   *  refusal / aborted / unknown). */
  stopReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  toolCallCount?: number;
  textPreview?: string;
  // === Populated on error ===
  /** Full error message as thrown by the provider. We do NOT truncate
   *  here — the diagnostics view is where you go specifically to read
   *  this in full. */
  errorMessage?: string;
  /** HTTP status code when the failure was an API error. */
  httpStatus?: number;
  // === Always populated when available ===
  /** Short caller-supplied summary of what was being sent: msg count,
   *  tool count, vision on/off. Helps correlate failures with payload
   *  shape without leaking the full conversation. */
  requestSummary?: string;
  /** Optional additional notes (e.g. "promptFeedback: SAFETY"). */
  notes?: string;
}

const MAX_EVENTS = 50;
const events: DiagnosticEvent[] = [];
const listeners = new Set<() => void>();
let counter = 0;
let forwarder: ((evt: DiagnosticEvent) => void) | null = null;

function nextId(): string {
  counter += 1;
  return `diag-${Date.now().toString(36)}-${counter.toString(36)}`;
}

/** Register a sink that receives each event INSTEAD of storing it in this
 *  context's ring buffer (pass `null` to clear).
 *
 *  The AI chat loop runs inside the agent Worker for every hosted provider
 *  (anthropic/openai/gemini — see aiPanel's runTurn router), so the
 *  `streamTurn` events it records would otherwise land in the Worker's own
 *  module-instance buffer — which the AI Call Log modal, living on the main
 *  thread, never reads. The Worker sets a forwarder that ships each event to
 *  the main thread via postMessage; the main thread (no forwarder) stores them
 *  as usual. Without this, only main-thread calls (validateKey, review,
 *  compaction) ever showed up in the log. */
export function setEventForwarder(fn: ((evt: DiagnosticEvent) => void) | null): void {
  forwarder = fn;
}

/** Push an event. Caller fills everything except `id` and `timestamp`. */
export function recordEvent(evt: Omit<DiagnosticEvent, 'id' | 'timestamp'>): void {
  const full: DiagnosticEvent = {
    id: nextId(),
    timestamp: Date.now(),
    ...evt,
  };
  if (forwarder) {
    // Forward-only context (the agent Worker): hand the fully-formed event to
    // the sink and skip local storage. This buffer is never displayed here,
    // and the main thread stores + console-mirrors the event on receipt —
    // doing both would double-log it in devtools.
    try { forwarder(full); }
    catch { /* a broken forwarder must never break the caller's turn */ }
    return;
  }
  ingestEvent(full);
}

/** Insert a fully-formed event (id + timestamp already assigned) into this
 *  context's ring buffer, mirror it to the console, and notify listeners.
 *
 *  Called by recordEvent on the storing context, and directly by the main
 *  thread when it receives an event forwarded from the agent Worker — the
 *  origin thread's id/timestamp are preserved so the modal shows the call's
 *  real time, not when the main thread happened to receive it. */
export function ingestEvent(full: DiagnosticEvent): void {
  events.unshift(full);
  if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
  // Mirror to devtools so a user who reports "diagnostics shows nothing"
  // can verify in the browser console that recording is alive. The
  // single-line format is greppable: `[partwright-ai]`.
  //
  // We deliberately use console.info / console.debug — NOT warn/error —
  // because the app-wide errorLog (src/diagnostics/errorLog.ts)
  // intercepts console.warn/error. Hard provider errors already reach
  // that log via chatLoop's onError → errorLog.capture(source:'ai');
  // mirroring here through warn would double-list them.
  if (typeof console !== 'undefined') {
    const head = `[partwright-ai] ${full.provider}/${full.model} ${full.kind} ${full.status} ${full.durationMs}ms`;
    if (full.status === 'error') {
      console.debug(head, full.errorMessage ?? '');
    } else {
      console.info(head, full.stopReason ?? '', full.outputTokens != null ? `${full.outputTokens}t out` : '');
    }
  }
  for (const fn of listeners) {
    try { fn(); } catch { /* listener errors must not break recording */ }
  }
}

/** Snapshot of current events, newest first. Returns a copy so callers
 *  can't mutate the ring buffer. */
export function listEvents(): DiagnosticEvent[] {
  return events.slice();
}

export function clearEvents(): void {
  events.length = 0;
  for (const fn of listeners) {
    try { fn(); } catch { /* ignore */ }
  }
}

export function onEventsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** True when there's at least one error event since the last clear. The
 *  panel status bar uses this to decide whether to surface a "View
 *  diagnostics" affordance after an error. */
export function hasRecentError(): boolean {
  return events.some(e => e.status === 'error');
}
