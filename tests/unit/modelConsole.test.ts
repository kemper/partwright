// Console capture for model code (src/geometry/modelConsole.ts) and its wiring
// through an engine run: what model code prints must come back on the result
// as `logs`, success and error alike, capped per run.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { compileModel, createModelLog, formatValue, withLogs } from '../../src/geometry/modelConsole';
import { voxelEngine } from '../../src/geometry/engines/voxel';

// The capturing console mirrors to the real one; keep test output quiet.
beforeAll(() => {
  for (const k of ['log', 'info', 'debug', 'warn', 'error'] as const) vi.spyOn(console, k).mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());

describe('createModelLog', () => {
  it('captures every level, prefixing warn/error/assert', () => {
    const log = createModelLog({ maxLines: 50, maxChars: 10_000 });
    const c = log.console;
    c.log('a', 1, true);
    c.info('b');
    c.debug('c');
    c.warn('careful');
    c.error('bad');
    c.assert(1 > 2, 'math');
    c.assert(true, 'not logged');
    expect(log.lines()).toEqual(['a 1 true', 'b', 'c', 'warn: careful', 'error: bad', 'assert: math']);
  });

  it('returns undefined when nothing was printed', () => {
    expect(createModelLog({ maxLines: 5, maxChars: 100 }).lines()).toBeUndefined();
  });

  it('caps lines and characters, and says how many were dropped', () => {
    const log = createModelLog({ maxLines: 3, maxChars: 10_000 });
    for (let i = 0; i < 10; i++) log.console.log(i);
    const lines = log.lines()!;
    expect(lines.slice(0, 3)).toEqual(['0', '1', '2']);
    expect(lines[3]).toMatch(/7 more log lines dropped/);

    const chars = createModelLog({ maxLines: 100, maxChars: 12 });
    chars.console.log('0123456789');
    chars.console.log('abcdefghij');
    chars.console.log('never');
    const out = chars.lines()!;
    expect(out[0]).toBe('0123456789');
    expect(out[1]).toBe('ab…');
    expect(out[2]).toMatch(/1 more log line dropped/);
  });

  it('passes other console methods through to the real console', () => {
    const log = createModelLog({ maxLines: 5, maxChars: 100 });
    expect(typeof log.console.time).toBe('function');
    expect(typeof log.console.group).toBe('function');
  });

  it('withLogs only adds the field when something was printed', () => {
    const quiet = createModelLog({ maxLines: 5, maxChars: 100 });
    expect('logs' in withLogs({ ok: 1 }, quiet)).toBe(false);
    const loud = createModelLog({ maxLines: 5, maxChars: 100 });
    loud.console.log('hi');
    expect(withLogs({ ok: 1 }, loud)).toEqual({ ok: 1, logs: ['hi'] });
  });
});

describe('formatValue', () => {
  it('prints objects as compact JSON, safely', () => {
    expect(formatValue({ a: [1, 2], b: 'x' })).toBe('{"a":[1,2],"b":"x"}');
    const cyclic: Record<string, unknown> = { name: 'loop' };
    cyclic.self = cyclic;
    expect(formatValue(cyclic)).toBe('{"name":"loop","self":"[Circular]"}');
    expect(formatValue(new Float32Array([1, 2, 3]))).toBe('Float32Array(3) [1, 2, 3]');
    expect(formatValue({ big: 10n })).toBe('{"big":"10"}');
    expect(formatValue(new RangeError('nope'))).toBe('RangeError: nope');
    expect(formatValue(function named() {})).toBe('[Function named]');
  });

  it('marks only true cycles circular, and prints nested errors', () => {
    const shared = { x: 1 };
    expect(formatValue({ a: shared, b: shared })).toBe('{"a":{"x":1},"b":{"x":1}}');
    expect(formatValue([shared, [shared]])).toBe('[{"x":1},[{"x":1}]]');
    expect(formatValue({ err: new TypeError('bad') })).toBe('{"err":"TypeError: bad"}');
    expect(formatValue({ n: NaN, u: undefined })).toBe('{"n":"NaN"}');
    let deep: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 10; i++) deep = { d: deep };
    expect(formatValue(deep)).toContain('"[Object]"');
  });

  it('never walks into a BREP shape or a WASM module', () => {
    const oc = { HEAP8: new Int8Array(4), SomeClass: function SomeClass() {} };
    const brep = { _shape: { oc }, fillet: () => {} };
    expect(formatValue(brep)).toBe('BrepShape');
    expect(formatValue({ part: brep })).toBe('{"part":"BrepShape"}');
    expect(formatValue({ mod: oc })).toBe('{"mod":"[WASM module]"}');
  });

  it('summarises a Manifold-like value instead of dumping it', () => {
    const fake = {
      getMesh: () => ({}),
      numTri: () => 12,
      boundingBox: () => ({ min: [-1, -2.00004, 0], max: [1, 2, 3.12345] }),
    };
    expect(formatValue(fake)).toBe('Manifold{tris: 12, bbox: [[-1, -2, 0], [1, 2, 3.123]]}');
    expect(formatValue({ part: fake })).toBe('{"part":"Manifold{tris: 12, bbox: [[-1, -2, 0], [1, 2, 3.123]]}"}');
  });
});

describe('compileModel', () => {
  it('hands model code the per-run console without touching the global one', () => {
    const log = createModelLog({ maxLines: 5, maxChars: 100 });
    const fn = compileModel('console.log("from model", api.n); return api.n * 2;');
    expect(fn({ n: 21 }, log.console)).toBe(42);
    expect(log.lines()).toEqual(['from model 21']);
  });

  it('explains a model that declares its own top-level console', () => {
    expect(() => compileModel('const console = 1; return 0;')).toThrow(/`console` is provided to model code/);
    expect(() => compileModel('return (')).toThrow(SyntaxError);
  });
});

describe('engine runs return logs', () => {
  it('on success', () => {
    const r = voxelEngine.run('const v = api.voxels(); console.log("size", 3); v.fillBox([0,0,0],[2,2,2], "#ff0000"); return v;');
    expect(r.error).toBeNull();
    expect(r.logs).toEqual(['size 3']);
  });

  it('on error — output printed before the throw is kept', () => {
    const r = voxelEngine.run('console.log("got here", { step: 1 }); throw new Error("boom");');
    expect(r.error).toMatch(/boom/);
    expect(r.logs).toEqual(['got here {"step":1}']);
  });

  it('absent when the code printed nothing', () => {
    const r = voxelEngine.run('const v = api.voxels(); v.set(0,0,0,"#fff"); return v;');
    expect(r.logs).toBeUndefined();
  });
});
