import { describe, it, expect } from 'vitest';
import { checkEngineWorkerMessage, checkMeshData, isPlainData } from '../../src/geometry/workerMessageValidation';

function mesh(numVert = 3, numTri = 1) {
  return {
    vertProperties: new Float32Array(numVert * 3),
    triVerts: Uint32Array.from({ length: numTri * 3 }, (_, i) => i % numVert),
    numVert, numTri, numProp: 3,
  };
}

describe('checkMeshData', () => {
  it('accepts a well-formed mesh', () => {
    expect(checkMeshData(mesh())).toBeNull();
    expect(checkMeshData({ ...mesh(), runIndex: new Uint32Array([0, 3]), runOriginalID: new Uint32Array([1]), triColors: new Uint8Array(3) })).toBeNull();
  });
  it('rejects wrong classes, sizes and out-of-range indices', () => {
    expect(checkMeshData({ ...mesh(), vertProperties: new Float64Array(9) })).toMatch(/Float32Array/);
    expect(checkMeshData({ ...mesh(), triVerts: [0, 1, 2] })).toMatch(/Uint32Array/);
    expect(checkMeshData({ ...mesh(), numVert: 4 })).toMatch(/length/);
    expect(checkMeshData({ ...mesh(), numTri: 1.5 })).toMatch(/integers/);
    expect(checkMeshData({ ...mesh(), triVerts: new Uint32Array([0, 1, 7]) })).toMatch(/out of range/);
    expect(checkMeshData({ ...mesh(), triColors: new Uint8Array(2) })).toMatch(/triColors/);
    expect(checkMeshData({ ...mesh(), mergeFromVert: new Uint32Array(1) })).toMatch(/merge/);
    expect(checkMeshData(null)).not.toBeNull();
  });
});

describe('isPlainData', () => {
  it('accepts JSON-ish data and typed arrays', () => {
    expect(isPlainData({ a: [1, 'x', true, null, { b: new Uint8Array(2) }] })).toBe(true);
  });
  it('rejects prototype-polluting keys, exotic objects and runaway depth', () => {
    const polluted = JSON.parse('{"__proto__": {"admin": true}}');
    expect(isPlainData(polluted)).toBe(false);
    expect(isPlainData({ constructor: { prototype: {} } })).toBe(false);
    expect(isPlainData(new Map())).toBe(false);
    expect(isPlainData(new Date())).toBe(false);
    let deep: unknown = 1;
    for (let i = 0; i < 100; i++) deep = [deep];
    expect(isPlainData(deep)).toBe(false);
  });
});

describe('checkEngineWorkerMessage', () => {
  it('accepts the messages the Worker really sends', () => {
    expect(checkEngineWorkerMessage({ type: 'ready' }).ok).toBe(true);
    expect(checkEngineWorkerMessage({ type: 'error', callId: null, message: 'boom' }).ok).toBe(true);
    expect(checkEngineWorkerMessage({
      type: 'execute_result', callId: 'exec-1', mesh: mesh(), error: null, diagnostics: [],
      labelMapEntries: [['body', [0]]], labelColorEntries: [['body', [1, 0, 0]]],
      paintOps: [{ name: 'p', color: [0, 1, 0], descriptor: { kind: 'box', center: [0, 0, 0], size: [1, 1, 1], quaternion: [0, 0, 0, 1] } }],
      surfaceOps: [{ id: 'fuzzy', params: { amplitude: 0.2 } }], materialSpec: { preset: 'brass' },
      lostLabels: null, paramsSchema: [{ key: 'w', type: 'number', default: 1, label: 'W' }],
      renderOnly: false, workerMs: 12, engineHeapBytes: 1024,
    }).ok).toBe(true);
    expect(checkEngineWorkerMessage({ type: 'execute_result', callId: 'exec-2', mesh: null, error: 'x', diagnostics: [{ message: 'x', severity: 'error' }], labelMapEntries: null, lostLabels: null, paramsSchema: null, workerMs: 1 }).ok).toBe(true);
    expect(checkEngineWorkerMessage({ type: 'validate_result', callId: 'v', result: { valid: true } }).ok).toBe(true);
    expect(checkEngineWorkerMessage({ type: 'detect_includes_result', callId: 'd', result: ['a.scad'] }).ok).toBe(true);
    expect(checkEngineWorkerMessage({ type: 'exportSTEP_result', callId: 's', blob: new Blob(['x']), error: null }).ok).toBe(true);
    expect(checkEngineWorkerMessage({ type: 'simplify_progress', callId: 's', fraction: 0.5 }).ok).toBe(true);
    expect(checkEngineWorkerMessage({ type: 'enhance_result', callId: 'e', mesh: null, triangleCount: 9, cancelled: false, exceeded: true, error: null }).ok).toBe(true);
  });

  it('rejects unknown types and non-objects', () => {
    expect(checkEngineWorkerMessage('ready').ok).toBe(false);
    expect(checkEngineWorkerMessage(null).ok).toBe(false);
    const r = checkEngineWorkerMessage({ type: 'navigate', url: 'https://evil.example' });
    expect(r.ok).toBe(false);
  });

  it('rejects crafted payloads and reports the callId so the request can fail', () => {
    const bad = [
      { type: 'execute_result', callId: 'exec-3', mesh: { ...mesh(), triVerts: new Uint32Array([0, 1, 99]) } },
      { type: 'execute_result', callId: 'exec-3', mesh: null, error: { html: '<img>' } },
      { type: 'execute_result', callId: 'exec-3', mesh: mesh(), labelMapEntries: [['x', [5]]] },
      { type: 'execute_result', callId: 'exec-3', mesh: null, paintOps: [{ name: 'p', color: [0, 0, 0], descriptor: { kind: 'imagePaint', entries: [] } }] },
      { type: 'execute_result', callId: 'exec-3', mesh: null, materialSpec: JSON.parse('{"__proto__": {"x": 1}}') },
      { type: 'execute_result', callId: 'exec-3', mesh: null, paramsSchema: [{ key: 1 }] },
      { type: 'execute_result', callId: 'exec-3', mesh: null, sdfLabelCounts: { a: 'NaN' } },
      { type: 'execute_result', callId: 7, mesh: null },
      { type: 'validate_result', callId: 'exec-3', result: { valid: 'yes' } },
      { type: 'exportSTEP_result', callId: 'exec-3', blob: 'not a blob' },
      { type: 'simplify_progress', callId: 'exec-3', fraction: 7 },
    ];
    for (const m of bad) {
      const r = checkEngineWorkerMessage(m);
      expect(r.ok, JSON.stringify(Object.keys(m))).toBe(false);
      if (!r.ok && typeof m.callId === 'string') expect(r.callId).toBe('exec-3');
    }
    const missing = checkEngineWorkerMessage({ type: 'execute_result', mesh: null });
    expect(missing.ok).toBe(false);
  });
});
