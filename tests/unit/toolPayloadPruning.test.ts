import { describe, it, expect } from 'vitest';
import {
  pruneStaleToolPayloads,
  FAILED_INPUT_NOTE,
  REPEATED_DOC_NOTE,
  SUPERSEDED_CODE_NOTE,
  SUPERSEDED_GETCODE_NOTE,
  SUPERSEDED_RUN_NOTE,
  type ToolPayloadPruneOptions,
} from '../../src/ai/historyElision';
import { hasOrphanedToolCalls } from '../../src/ai/historyRepair';
import type { ChatMessage, PersistedToolCall, PersistedToolResult } from '../../src/ai/types';

const OPTS: ToolPayloadPruneOptions = { keepRecentCodeBodies: 1, codeBodyTrimBatch: 0, failedCallInputTurns: 3, failedCallInputMinChars: 100, failedCallValueMinChars: 200 };

let seq = 0;
function assistant(calls: PersistedToolCall[]): ChatMessage {
  seq++;
  return { id: `a${seq}`, sessionId: 's', role: 'assistant', blocks: [{ type: 'text', text: 'ok' }], toolCalls: calls, seq, createdAt: seq };
}
function results(rs: PersistedToolResult[]): ChatMessage {
  seq++;
  return { id: `u${seq}`, sessionId: 's', role: 'user', blocks: [], toolResults: rs, seq, createdAt: seq };
}
/** One tool round: the assistant's call plus its result message. */
function round(id: string, name: string, input: Record<string, unknown>, content = '{"ok":true}', isError = false, extra: Partial<PersistedToolCall> = {}): ChatMessage[] {
  return [assistant([{ id, name, input, ...extra }]), results([{ toolUseId: id, content, ...(isError ? { isError: true } : {}) }])];
}
const codeOf = (h: ChatMessage[], id: string) => h.flatMap(m => m.toolCalls ?? []).find(c => c.id === id)?.input.code;
const resultOf = (h: ChatMessage[], id: string) => h.flatMap(m => m.toolResults ?? []).find(r => r.toolUseId === id)?.content;

describe('pruneStaleToolPayloads', () => {
  it('returns the same array when nothing is stale', () => {
    const h = [...round('c1', 'runAndSave', { code: 'return a;' }), ...round('d1', 'readDoc', { name: 'colors' }, 'doc')];
    expect(pruneStaleToolPayloads(h, OPTS)).toBe(h);
  });

  it('keeps only the newest code body; earlier code args and getCode results become notes', () => {
    const h = [
      ...round('c1', 'runAndSave', { code: 'v1', label: 'first' }),
      ...round('g1', 'getCode', {}, '"v1"'),
      ...round('c2', 'setCode', { code: 'v2' }),
      ...round('c3', 'runAndSave', { code: 'v3' }),
    ];
    const out = pruneStaleToolPayloads(h, OPTS);
    expect(codeOf(out, 'c1')).toBe(SUPERSEDED_CODE_NOTE);
    expect(out.flatMap(m => m.toolCalls ?? []).find(c => c.id === 'c1')?.input.label).toBe('first');
    expect(resultOf(out, 'g1')).toBe(SUPERSEDED_GETCODE_NOTE);
    expect(codeOf(out, 'c2')).toBe(SUPERSEDED_CODE_NOTE);
    expect(codeOf(out, 'c3')).toBe('v3');
    // The stored history is never mutated.
    expect(codeOf(h, 'c1')).toBe('v1');
  });

  it('a getCode after the last edit is the newest body and survives', () => {
    const h = [...round('c1', 'runAndSave', { code: 'v1' }), ...round('g1', 'getCode', {}, '"v1"')];
    const out = pruneStaleToolPayloads(h, OPTS);
    expect(codeOf(out, 'c1')).toBe(SUPERSEDED_CODE_NOTE);
    expect(resultOf(out, 'g1')).toBe('"v1"');
  });

  it('honours keepRecentCodeBodies', () => {
    const h = [...round('c1', 'setCode', { code: 'v1' }), ...round('c2', 'setCode', { code: 'v2' }), ...round('c3', 'setCode', { code: 'v3' })];
    const out = pruneStaleToolPayloads(h, { ...OPTS, keepRecentCodeBodies: 2 });
    expect([codeOf(out, 'c1'), codeOf(out, 'c2'), codeOf(out, 'c3')]).toEqual([SUPERSEDED_CODE_NOTE, 'v2', 'v3']);
  });

  it('counts code per target object', () => {
    const h = [...round('a1', 'runAndSave', { code: 'lid', object: 'lid' }), ...round('b1', 'runAndSave', { code: 'box' })];
    expect(pruneStaleToolPayloads(h, OPTS)).toBe(h);
  });

  it('trims in batches so the cached prefix survives between trims', () => {
    const steps = (n: number) => Array.from({ length: n }, (_, k) => round(`c${k}`, 'runAndSave', { code: `v${k}` })).flat();
    const opts = { ...OPTS, codeBodyTrimBatch: 2 };
    // keep 1 + batch 2: up to 3 bodies stay verbatim…
    const three = steps(3);
    expect(pruneStaleToolPayloads(three, opts)).toBe(three);
    expect([0, 1, 2].map(k => codeOf(pruneStaleToolPayloads(steps(3), opts), `c${k}`))).toEqual(['v0', 'v1', 'v2']);
    // …the 4th triggers one cut back to 1…
    expect([0, 1, 2, 3].map(k => codeOf(pruneStaleToolPayloads(steps(4), opts), `c${k}`)))
      .toEqual([SUPERSEDED_CODE_NOTE, SUPERSEDED_CODE_NOTE, SUPERSEDED_CODE_NOTE, 'v3']);
    // …and the 5th edits nothing older than the 4th (same prefix as before).
    expect([0, 1, 2, 3, 4].map(k => codeOf(pruneStaleToolPayloads(steps(5), opts), `c${k}`)))
      .toEqual([SUPERSEDED_CODE_NOTE, SUPERSEDED_CODE_NOTE, SUPERSEDED_CODE_NOTE, 'v3', 'v4']);
  });

  it('a scratch run never evicts the real program; runs supersede only runs', () => {
    const h = [
      ...round('s1', 'runAndSave', { code: 'FULL PROGRAM' }),
      ...round('r1', 'runIsolated', { code: 'snippet 1' }),
      ...round('r2', 'runAndAssert', { code: 'snippet 2' }),
    ];
    const out = pruneStaleToolPayloads(h, OPTS);
    expect(codeOf(out, 's1')).toBe('FULL PROGRAM');
    expect(codeOf(out, 'r1')).toBe(SUPERSEDED_RUN_NOTE);
    expect(codeOf(out, 'r2')).toBe('snippet 2');
  });

  it('an object switch starts a new code lineage', () => {
    const h = [
      ...round('a1', 'runAndSave', { code: 'box' }),
      ...round('x1', 'changeObject', { id: 'lid' }),
      ...round('b1', 'runAndSave', { code: 'lid' }),
    ];
    expect(pruneStaleToolPayloads(h, OPTS)).toBe(h);
  });

  it('pairs results with calls by position — repeated ids (Gemini, WebLLM) never cross-match', () => {
    const bigCode = 'x'.repeat(500);
    const h = [
      ...round('gemini_call_0', 'runAndSave', { code: bigCode }, 'Error: boom', true),
      ...Array.from({ length: 3 }, () => round('gemini_call_0', 'getGeometryData', {}, '{"stats":1}')).flat(),
      ...round('gemini_call_0', 'runAndSave', { code: 'CURRENT' }, '{"saved":2}', false, { thoughtSignature: 'sig' }),
      ...round('gemini_call_0', 'readDoc', { name: 'colors' }, 'COLORS'),
    ];
    const out = pruneStaleToolPayloads(h, OPTS);
    const calls = out.flatMap(m => m.toolCalls ?? []);
    const results = out.flatMap(m => m.toolResults ?? []).map(r => r.content);
    // The old failed run loses its big code; the newest (signed) run keeps its program.
    expect(calls[0].input.code).toBe(FAILED_INPUT_NOTE);
    expect(calls[4].input.code).toBe('CURRENT');
    // No result is mistaken for a readDoc / getCode result.
    expect(results).toEqual(['Error: boom', '{"stats":1}', '{"stats":1}', '{"stats":1}', '{"saved":2}', 'COLORS']);
  });

  it('never rewrites a Gemini-signed call', () => {
    const h = [...round('c1', 'runAndSave', { code: 'v1' }, '{}', false, { thoughtSignature: 'sig' }), ...round('c2', 'runAndSave', { code: 'v2' })];
    expect(codeOf(pruneStaleToolPayloads(h, OPTS), 'c1')).toBe('v1');
  });

  it('drops a repeated readDoc result but keeps the newest read and other docs', () => {
    const h = [
      ...round('d1', 'readDoc', { name: 'figure' }, 'FIGURE DOC'),
      ...round('d2', 'readDoc', { name: 'colors' }, 'COLORS DOC'),
      ...round('d3', 'readDoc', { name: 'figure' }, 'FIGURE DOC'),
    ];
    const out = pruneStaleToolPayloads(h, OPTS);
    expect([resultOf(out, 'd1'), resultOf(out, 'd2'), resultOf(out, 'd3')]).toEqual([REPEATED_DOC_NOTE, 'COLORS DOC', 'FIGURE DOC']);
  });

  it('drops large inputs of a failed call after N newer assistant turns, keeping its error', () => {
    const bigPoints = Array.from({ length: 50 }, (_, i) => [i, i, i]);
    const failed = round('p1', 'paintStroke', { points: bigPoints, color: '#f00' }, 'Error: points off-surface', true);
    const later = (n: number) => Array.from({ length: n }, (_, i) => round(`q${i}`, 'getGeometryData', {})).flat();

    const tooSoon = [...failed, ...later(2)];
    expect(pruneStaleToolPayloads(tooSoon, OPTS)).toBe(tooSoon);

    const out = pruneStaleToolPayloads([...failed, ...later(3)], OPTS);
    const call = out.flatMap(m => m.toolCalls ?? []).find(c => c.id === 'p1')!;
    expect(call.input).toEqual({ points: FAILED_INPUT_NOTE, color: '#f00' });
    expect(resultOf(out, 'p1')).toBe('Error: points off-surface');
  });

  it('leaves small failed inputs alone', () => {
    const h = [...round('p1', 'paintByLabel', { label: 'x' }, 'Error', true), ...Array.from({ length: 4 }, (_, i) => round(`q${i}`, 'listLabels', {})).flat()];
    expect(pruneStaleToolPayloads(h, OPTS)).toBe(h);
  });

  it('keeps tool_use / tool_result pairing intact', () => {
    const h = [...round('c1', 'runAndSave', { code: 'v1' }), ...round('c2', 'runAndSave', { code: 'v2' })];
    const out = pruneStaleToolPayloads(h, OPTS);
    expect(out).toHaveLength(h.length);
    expect(hasOrphanedToolCalls(out)).toBe(false);
  });
});
