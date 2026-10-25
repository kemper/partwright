import { describe, it, expect } from 'vitest';
import {
  pruneStaleToolPayloads,
  FAILED_INPUT_NOTE,
  REPEATED_DOC_NOTE,
  SUPERSEDED_CODE_NOTE,
  SUPERSEDED_GETCODE_NOTE,
  type ToolPayloadPruneOptions,
} from '../../src/ai/historyElision';
import { hasOrphanedToolCalls } from '../../src/ai/historyRepair';
import type { ChatMessage, PersistedToolCall, PersistedToolResult } from '../../src/ai/types';

const OPTS: ToolPayloadPruneOptions = { keepRecentCodeBodies: 1, failedCallInputTurns: 3, failedCallInputMinChars: 100 };

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
    const h = [...round('c1', 'runCode', { code: 'v1' }), ...round('c2', 'runCode', { code: 'v2' }), ...round('c3', 'runCode', { code: 'v3' })];
    const out = pruneStaleToolPayloads(h, { ...OPTS, keepRecentCodeBodies: 2 });
    expect([codeOf(out, 'c1'), codeOf(out, 'c2'), codeOf(out, 'c3')]).toEqual([SUPERSEDED_CODE_NOTE, 'v2', 'v3']);
  });

  it('counts code per target object', () => {
    const h = [...round('a1', 'runAndSave', { code: 'lid', object: 'lid' }), ...round('b1', 'runAndSave', { code: 'box' })];
    expect(pruneStaleToolPayloads(h, OPTS)).toBe(h);
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
