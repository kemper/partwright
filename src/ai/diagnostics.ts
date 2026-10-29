// Ring buffer of recent AI provider events. The diagnostics modal reads
// this; providers and the chat loop record into it whenever an API call
// completes (success, error, or abort).
//
// Mirrored to this tab's sessionStorage so a reload keeps the log — the
// moment a costly or stuck turn makes you reload is exactly when you want
// it. sessionStorage is per tab and cleared when the tab closes, so nothing
// leaks into other windows (see "Cross-Tab Isolation" in CLAUDE.md) and the
// records, which can hold request fragments, never sit in IndexedDB.

import type { Provider, TurnUsage } from './types';
import { getConfig } from '../config/appConfig';

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
  /** Prompt tokens served from the provider's cache (billed ~0.1× input). */
  cachedTokens?: number;
  /** Prompt tokens written to the cache this call (Anthropic: 1.25× input,
   *  or 2× for the 1-hour cache). A large number on a mid-conversation call
   *  means the cache had expired and the whole history was re-written. */
  cacheWriteTokens?: number;
  /** The part of `cacheWriteTokens` written to the 1-hour cache. */
  cacheWrite1hTokens?: number;
  /** USD cost of this call, when the model is priced. */
  costUsd?: number;
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

/** The token + cost fields of an event, from a provider's usage and the
 *  priced cost (`null` = unpriced model, left out rather than shown as $0). */
export function usageEventFields(usage: TurnUsage, costUsd: number | null): Pick<DiagnosticEvent, 'inputTokens' | 'outputTokens' | 'cachedTokens' | 'cacheWriteTokens' | 'cacheWrite1hTokens' | 'costUsd'> {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedTokens: usage.cacheReadInputTokens,
    ...(usage.cacheCreationInputTokens > 0 ? { cacheWriteTokens: usage.cacheCreationInputTokens } : {}),
    ...(usage.cacheCreation1hInputTokens ? { cacheWrite1hTokens: usage.cacheCreation1hInputTokens } : {}),
    ...(costUsd !== null ? { costUsd } : {}),
  };
}

const STORAGE_KEY = 'partwright.aiCallLog';

function getMaxEvents(): number { return getConfig().ai.diagnosticsRingSize; }
const events: DiagnosticEvent[] = loadStoredEvents();

/** This tab's saved log, newest first, or [] (no sessionStorage — the agent
 *  Worker, a blocked storage — or nothing usable saved). */
function loadStoredEvents(): DiagnosticEvent[] {
  try {
    if (typeof sessionStorage === 'undefined') return [];
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e): e is DiagnosticEvent => !!e && typeof e === 'object'
        && typeof (e as DiagnosticEvent).id === 'string'
        && typeof (e as DiagnosticEvent).timestamp === 'number')
      .slice(0, getMaxEvents());
  } catch {
    return [];
  }
}

function saveEvents(): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    if (events.length === 0) sessionStorage.removeItem(STORAGE_KEY);
    else sessionStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch { /* quota or blocked storage: the in-memory log still works */ }
}
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
  if (events.length > getMaxEvents()) events.length = getMaxEvents();
  saveEvents();
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
  saveEvents();
  for (const fn of listeners) {
    try { fn(); } catch { /* ignore */ }
  }
}

export function onEventsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
