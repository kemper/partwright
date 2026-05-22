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

function nextId(): string {
  counter += 1;
  return `diag-${Date.now().toString(36)}-${counter.toString(36)}`;
}

/** Push an event. Caller fills everything except `id` and `timestamp`. */
export function recordEvent(evt: Omit<DiagnosticEvent, 'id' | 'timestamp'>): void {
  const full: DiagnosticEvent = {
    id: nextId(),
    timestamp: Date.now(),
    ...evt,
  };
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
