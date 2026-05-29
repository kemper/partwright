// Regression tests for the AI Call Log's cross-thread plumbing.
//
// The bug: the chat loop runs inside the agent Worker for every hosted
// provider (anthropic/openai/gemini), so the `streamTurn` events it recorded
// landed in the Worker's *own* module-instance ring buffer. The AI Call Log
// modal reads the main thread's buffer, so those events never showed up —
// only the main-thread validateKey ping did. The fix routes Worker events
// through a forwarder (setEventForwarder) → postMessage → ingestEvent on the
// main thread. These tests pin that forward/store/ingest contract; the
// Worker↔main wiring itself is exercised end-to-end in the e2e suite.

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  recordEvent,
  ingestEvent,
  setEventForwarder,
  listEvents,
  clearEvents,
  onEventsChange,
  type DiagnosticEvent,
} from '../../src/ai/diagnostics';

// The ring buffer + forwarder are module-level singletons. Reset both around
// every test so one case can't leak state into the next.
beforeEach(() => {
  setEventForwarder(null);
  clearEvents();
});
afterEach(() => {
  setEventForwarder(null);
  clearEvents();
});

describe('diagnostics event forwarding', () => {
  test('with no forwarder (main thread) events store locally', () => {
    recordEvent({
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      kind: 'streamTurn',
      durationMs: 12,
      status: 'ok',
      stopReason: 'end_turn',
      outputTokens: 7,
    });

    const events = listEvents();
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('streamTurn');
    expect(events[0].id).toBeTruthy();
    expect(typeof events[0].timestamp).toBe('number');
  });

  test('with a forwarder (agent Worker) events forward INSTEAD of storing', () => {
    const forwarded: DiagnosticEvent[] = [];
    setEventForwarder((evt) => forwarded.push(evt));

    recordEvent({
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      kind: 'streamTurn',
      durationMs: 12,
      status: 'error',
      errorMessage: 'network down',
    });

    // The Worker's own buffer stays empty — it is never displayed there.
    expect(listEvents()).toHaveLength(0);
    // The sink received a fully-formed event (id + timestamp already filled)
    // ready to ship across the postMessage boundary.
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0].id).toBeTruthy();
    expect(typeof forwarded[0].timestamp).toBe('number');
    expect(forwarded[0].kind).toBe('streamTurn');
    expect(forwarded[0].errorMessage).toBe('network down');
  });

  test('ingestEvent stores a forwarded event verbatim and never re-forwards', () => {
    // A forwarder is registered, but ingestEvent must NOT route through it —
    // otherwise the main thread (which both ingests and could forward) would
    // loop. ingestEvent always stores.
    const forwarded: DiagnosticEvent[] = [];
    setEventForwarder((evt) => forwarded.push(evt));

    const evt: DiagnosticEvent = {
      id: 'diag-fromworker-1',
      timestamp: 1_700_000_000_000,
      provider: 'openai',
      model: 'gpt-5',
      kind: 'streamTurn',
      durationMs: 42,
      status: 'ok',
      stopReason: 'tool_use',
      toolCallCount: 2,
    };
    ingestEvent(evt);

    const events = listEvents();
    expect(events).toHaveLength(1);
    // id + timestamp are preserved from the origin thread (not regenerated).
    expect(events[0]).toEqual(evt);
    expect(forwarded).toHaveLength(0);
  });

  test('Worker→main round trip: forwarded events land in the main-thread buffer', () => {
    // Phase 1 — pretend we are the Worker: a forwarder captures the wire.
    const wire: DiagnosticEvent[] = [];
    setEventForwarder((evt) => wire.push(evt));
    recordEvent({ provider: 'gemini', model: 'gemini-3-pro', kind: 'streamTurn', durationMs: 5, status: 'ok', stopReason: 'tool_use', toolCallCount: 1 });
    recordEvent({ provider: 'gemini', model: 'gemini-3-pro', kind: 'streamTurn', durationMs: 9, status: 'ok', stopReason: 'end_turn', outputTokens: 30 });
    expect(listEvents()).toHaveLength(0); // nothing stored Worker-side

    // Phase 2 — pretend we are the main thread (no forwarder) receiving the
    // posted events in order.
    setEventForwarder(null);
    for (const e of wire) ingestEvent(e);

    const events = listEvents(); // newest first
    expect(events).toHaveLength(2);
    expect(events[0].stopReason).toBe('end_turn');
    expect(events[1].stopReason).toBe('tool_use');
    expect(events[1].toolCallCount).toBe(1);
  });

  test('listeners fire on ingest so an open modal live-updates', () => {
    let notifications = 0;
    const off = onEventsChange(() => { notifications += 1; });
    try {
      ingestEvent({
        id: 'diag-x', timestamp: Date.now(), provider: 'anthropic', model: 'm',
        kind: 'streamTurn', durationMs: 1, status: 'ok',
      });
      expect(notifications).toBe(1);
    } finally {
      off();
    }
  });

  test('a throwing forwarder never breaks the recording caller', () => {
    setEventForwarder(() => { throw new Error('postMessage failed'); });
    expect(() => recordEvent({
      provider: 'anthropic', model: 'm', kind: 'streamTurn', durationMs: 1, status: 'ok',
    })).not.toThrow();
  });
});
