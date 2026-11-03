import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { checkEngineWorkerMessage, checkMeshData, checkPaintDescriptor, isPlainData } from '../../src/geometry/workerMessageValidation';
import { API_PAINT_DESCRIPTOR_KINDS } from '../../src/geometry/apiPaintSpec';
import { parseSelector } from '../../src/geometry/selector';

/** One valid descriptor per api.paint.* kind — exactly what the recorder emits. */
const VALID_DESCRIPTORS: Record<string, Record<string, unknown>> = {
  box: { kind: 'box', center: [0, 0, 0], size: [1, 1, 1], quaternion: [0, 0, 0, 1], shape: 'box' },
  slab: { kind: 'slab', normal: [0, 0, 1], offset: 2, thickness: 1, withinPart: 'body' },
  cylinder: { kind: 'cylinder', center: [0, 0], rMin: 0, rMax: 2, zMin: 0, zMax: 5 },
  byLabel: { kind: 'byLabel', label: 'body' },
  pattern: {
    kind: 'pattern', pattern: 'spots', colors: [[1, 1, 1], [0, 0, 0]],
    scope: { label: 'body', above: { axis: 'z', at: 1 }, box: { min: [0, 0, 0], max: [1, 1, 1] }, sphere: { center: [0, 0, 0], radius: 2 } },
    scale: 3, axis: 'y', warp: 0.2, coverage: 0.5, seed: 7, anchors: [[0, 0, 1]],
  },
};
const execWithPaint = (descriptor: unknown) => ({
  type: 'execute_result', callId: 'exec-p', mesh: null, error: null,
  paintOps: [{ name: 'p', color: [1, 0, 0], descriptor }],
});

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
      paintOps: [
        { name: 'p', color: [0, 1, 0], descriptor: { kind: 'box', center: [0, 0, 0], size: [1, 1, 1], quaternion: [0, 0, 0, 1] } },
        { name: 'coat', color: [0.5, 0.4, 0.3], descriptor: { kind: 'pattern', pattern: 'spots', colors: [[1, 1, 1], [0, 0, 0]] } },
      ],
      surfaceOps: [{ id: 'fuzzy', params: { amplitude: 0.2 } }], materialSpec: { preset: 'brass' },
      lostLabels: null, paramsSchema: [{ key: 'w', type: 'number', default: 1, label: 'W' }],
      renderOnly: false, workerMs: 12, engineHeapBytes: 1024,
      manifoldFacts: { bbox: { min: [0, 0, 0], max: [1, 1, 1] }, volume: 1, surfaceArea: 6, genus: 0, isManifold: true, manifoldStatus: null, componentCount: 1, containedComponents: 0, componentsInterpenetrate: false, edges: { min: 0.5, mean: 1 }, pieces: { count: 1, pieceOfTri: new Int32Array(1) } },
    }).ok).toBe(true);
    expect(checkEngineWorkerMessage({ type: 'execute_result', callId: 'exec-2', mesh: null, error: 'x', diagnostics: [{ message: 'x', severity: 'error' }], labelMapEntries: null, lostLabels: null, paramsSchema: null, workerMs: 1 }).ok).toBe(true);
    expect(checkEngineWorkerMessage({ type: 'validate_result', callId: 'v', result: { valid: true } }).ok).toBe(true);
    expect(checkEngineWorkerMessage({ type: 'detect_includes_result', callId: 'd', result: ['a.scad'] }).ok).toBe(true);
    expect(checkEngineWorkerMessage({ type: 'exportSTEP_result', callId: 's', blob: new Blob(['x']), error: null }).ok).toBe(true);
    expect(checkEngineWorkerMessage({ type: 'simplify_progress', callId: 's', fraction: 0.5 }).ok).toBe(true);
    expect(checkEngineWorkerMessage({ type: 'enhance_result', callId: 'e', mesh: null, triangleCount: 9, cancelled: false, exceeded: true, error: null }).ok).toBe(true);
    expect(checkEngineWorkerMessage({ type: 'simplify_result', callId: 's', mesh: mesh(), triangleCount: 1, tolerance: 0.1, cancelled: false, error: null,
      manifoldFacts: { bbox: null, volume: 1, surfaceArea: 1, genus: 0, isManifold: true, manifoldStatus: null, componentCount: 1, containedComponents: 0, componentsInterpenetrate: false, pieces: { count: 1, pieceOfTri: new Int32Array(1) } } }).ok).toBe(true);
    expect(checkEngineWorkerMessage({ type: 'enhance_result', callId: 'e', mesh: mesh(), triangleCount: 1, cancelled: false, error: null, manifoldError: 'Not manifold' }).ok).toBe(true);
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
      { type: 'execute_result', callId: 'exec-3', mesh: null, paintOps: [{ name: 'p', color: [0, 0, 0], descriptor: { entries: [] } }] },
      { type: 'execute_result', callId: 'exec-3', mesh: null, materialSpec: JSON.parse('{"__proto__": {"x": 1}}') },
      { type: 'execute_result', callId: 'exec-3', mesh: null, paramsSchema: [{ key: 1 }] },
      { type: 'execute_result', callId: 'exec-3', mesh: null, sdfLabelCounts: { a: 'NaN' } },
      { type: 'execute_result', callId: 'exec-3', mesh: null, manifoldFacts: { bbox: null, volume: 'big', surfaceArea: 0, genus: null, isManifold: true, manifoldStatus: null, componentCount: 1, containedComponents: 0, componentsInterpenetrate: false } },
      { type: 'execute_result', callId: 'exec-3', mesh: null, manifoldFacts: { bbox: null, volume: 1, surfaceArea: 0, genus: null, isManifold: true, manifoldStatus: null, componentCount: 1, containedComponents: 0, componentsInterpenetrate: false, extra: 1 } },
      { type: 'execute_result', callId: 'exec-3', mesh: mesh(), manifoldFacts: { bbox: null, volume: 1, surfaceArea: 0, genus: null, isManifold: true, manifoldStatus: null, componentCount: 1, containedComponents: 0, componentsInterpenetrate: false, pieces: { count: 1, pieceOfTri: new Int32Array([3]) } } },
      { type: 'execute_result', callId: 'exec-3', mesh: mesh(), manifoldFacts: { bbox: null, volume: 1, surfaceArea: 0, genus: null, isManifold: true, manifoldStatus: null, componentCount: 1, containedComponents: 0, componentsInterpenetrate: false, pieces: { count: 1, pieceOfTri: new Int32Array(2) } } },
      { type: 'execute_result', callId: 7, mesh: null },
      { type: 'validate_result', callId: 'exec-3', result: { valid: 'yes' } },
      { type: 'exportSTEP_result', callId: 'exec-3', blob: 'not a blob' },
      { type: 'simplify_progress', callId: 'exec-3', fraction: 7 },
      { type: 'simplify_result', callId: 'exec-3', mesh: mesh(), manifoldFacts: { volume: 'x' } },
      { type: 'enhance_result', callId: 'exec-3', mesh: null, manifoldError: 42 },
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

describe('api.paint.* recorder parity', () => {
  // Drift guard for #1109: every descriptor kind the manifold-js recorder can
  // emit must survive Worker→main validation (a kind allow-list here once
  // rejected `pattern`, breaking api.paint.pattern in-app).
  it('the recorder emits exactly the shared API_PAINT_DESCRIPTOR_KINDS, and each validates', () => {
    const src = readFileSync(new URL('../../src/geometry/engines/manifoldJs.ts', import.meta.url), 'utf8');
    // (Minus the part-edit recorder, api.movePart & co., whose ops also carry a `kind`.)
    const recorder = src.slice(src.indexOf('const paintOps')).split('\n').filter(l => !l.includes('partOps.push(')).join('\n');
    const kinds = new Set([...recorder.matchAll(/kind:\s*'([A-Za-z]+)'/g)].map(m => m[1]));
    expect([...kinds].sort()).toEqual([...API_PAINT_DESCRIPTOR_KINDS].sort());
    expect(Object.keys(VALID_DESCRIPTORS).sort()).toEqual([...API_PAINT_DESCRIPTOR_KINDS].sort());
    for (const kind of API_PAINT_DESCRIPTOR_KINDS) {
      const r = checkEngineWorkerMessage(execWithPaint(VALID_DESCRIPTORS[kind]));
      expect(r.ok, `${kind}: ${r.ok ? '' : r.reason}`).toBe(true);
    }
  });

  it('refuses kinds the recorder never emits and forged / incomplete descriptors', () => {
    const bad: unknown[] = [
      { kind: 'imagePaint', entries: [0, 255, 0, 0], avgColor: [1, 0, 0] },
      { kind: 'brushStroke', samples: [[0, 0, 0]], radius: 1, shape: 'round', maxEdge: 1 },
      { kind: 'colorFlood', seedPoint: [0, 0, 0], seedNormal: [0, 0, 1], seedColor: [1, 1, 1], colorTolerance: 0.1 },
      { kind: 'triangles', ids: [0] },
      { kind: 'box' },
      { ...VALID_DESCRIPTORS.box, center: [0, 0] },
      { ...VALID_DESCRIPTORS.box, center: ['0', 0, 0] },
      { ...VALID_DESCRIPTORS.box, extra: 1 },
      { ...VALID_DESCRIPTORS.slab, thickness: Infinity },
      { ...VALID_DESCRIPTORS.cylinder, axis: 'w' },
      { kind: 'byLabel', label: '' },
      { ...VALID_DESCRIPTORS.pattern, pattern: 'plaid' },
      { ...VALID_DESCRIPTORS.pattern, colors: [] },
      { ...VALID_DESCRIPTORS.pattern, smooth: true, maxEdge: 0.1 },
      { ...VALID_DESCRIPTORS.pattern, scope: { sphere: { center: [0, 0, 0] } } },
      { ...VALID_DESCRIPTORS.pattern, anchors: Array.from({ length: 2000 }, () => [0, 0, 0]) },
    ];
    for (const d of bad) {
      expect(() => checkPaintDescriptor(d), JSON.stringify(d).slice(0, 80)).toThrow();
      expect(checkEngineWorkerMessage(execWithPaint(d)).ok).toBe(false);
    }
  });
});

describe('surfaceOps / paramsSchema / materialSpec re-validation', () => {
  const exec = (extra: Record<string, unknown>) => checkEngineWorkerMessage({ type: 'execute_result', callId: 'e', mesh: null, error: null, ...extra });
  it('accepts what the recorders emit', () => {
    expect(exec({ surfaceOps: [{ id: 'knurl', params: { amplitude: 0.3, profile: 'pyramid' }, scope: { kind: 'label', label: 'grip' } }] }).ok).toBe(true);
    expect(exec({ surfaceOps: [{ id: 'fuzzy', params: {}, scope: { kind: 'point', point: [0, 0, 0], radius: 4 } }] }).ok).toBe(true);
    // #1111's shared-selector scope, as the Worker recorder emits it (already parsed).
    const select = parseSelector({ label: 'grip', where: { facing: 'up' } }, 'test');
    expect(exec({ surfaceOps: [{ id: 'knurl', params: { amplitude: 0.7 }, scope: { kind: 'select', select } }] }).ok).toBe(true);
    expect(exec({ surfaceOps: [{ id: 'knurl', params: {}, scope: { kind: 'select', select: [] } }] }).ok).toBe(false);
    expect(exec({ surfaceOps: [{ id: 'knurl', params: {}, scope: { kind: 'select', select, extra: 1 } }] }).ok).toBe(false);
    expect(exec({ surfaceOps: [{ id: 'knurl', params: { select }, scope: undefined }] }).ok).toBe(false);
    // #1093: a normalized selector (what parseSurfaceOpts records) round-trips.
    expect(exec({ surfaceOps: [{ id: 'knurl', params: {}, scope: { kind: 'select', select: [{ label: ['grip'], where: { facing: [0, 0, 1] } }] } }] }).ok).toBe(true);
    expect(exec({ paramsSchema: [
      { key: 'w', type: 'number', default: 5, label: 'Width', min: 1, max: 10, step: 0.5, unit: 'mm' },
      { key: 'mode', type: 'select', default: 'a', label: 'Mode', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
      { key: 'on', type: 'boolean', default: true, label: 'On' },
      { key: 'tag', type: 'text', default: 'hi', label: 'Tag', maxLength: 8 },
      { key: 'c', type: 'color', default: '#3b82f6', label: 'C' },
    ] }).ok).toBe(true);
    expect(exec({ materialSpec: { preset: 'brass', roughness: 0.4, color: [0.9, 0.7, 0.3] } }).ok).toBe(true);
  });
  it('refuses forged values', () => {
    for (const extra of [
      { surfaceOps: [{ id: 'teleport', params: {} }] },
      { surfaceOps: [{ id: 'fuzzy', params: { bogus: 1 } }] },
      { surfaceOps: [{ id: 'fuzzy', params: { amplitude: { x: 1 } } }] },
      { surfaceOps: [{ id: 'fuzzy', params: {}, scope: { kind: 'point', point: [0, 0], radius: 4 } }] },
      { surfaceOps: [{ id: 'fuzzy', params: { label: 'x' } }] },
      { surfaceOps: [{ id: 'fuzzy', params: { select: { label: 'x' } } }] },
      { surfaceOps: [{ id: 'fuzzy', params: {}, scope: { kind: 'select', select: [{ teleport: true }] } }] },
      { surfaceOps: [{ id: 'fuzzy', params: {}, scope: { kind: 'select', select: [{ label: ['x'] }], extra: 1 } }] },
      { paramsSchema: [{ key: 'w', type: 'number', default: 5, label: 'W', min: 10, max: 1 }] },
      { paramsSchema: [{ key: 'w', type: 'select', default: 'z', label: 'W', options: [{ value: 'a', label: 'A' }] }] },
      { paramsSchema: [{ key: 'w', type: 'number', default: 1, label: 'W' }, { key: 'w', type: 'number', default: 2, label: 'W' }] },
      { paramsSchema: [{ key: 'w', type: 'number', default: 1, label: 'W', onclick: 'x' }] },
      { materialSpec: { preset: 'unobtainium' } },
      { materialSpec: { roughness: 7 } },
      { materialSpec: { color: [2, 0, 0] } },
      { materialSpec: { shader: 'x' } },
    ]) {
      expect(exec(extra).ok, JSON.stringify(extra).slice(0, 90)).toBe(false);
    }
  });
});

describe('cycles and the normalized Customizer schema', () => {
  it('refuses a cyclic extra key inside diagnostics', () => {
    const d: Record<string, unknown> = { message: 'x', severity: 'error' };
    d.self = d;
    const r = checkEngineWorkerMessage({ type: 'execute_result', callId: 'c1', mesh: null, error: 'x', diagnostics: [d] });
    expect(r.ok).toBe(false);
  });

  it('refuses a cyclic paramsSchema option', () => {
    const opt: Record<string, unknown> = { value: 'a', label: 'A' };
    opt.loop = [opt];
    const r = checkEngineWorkerMessage({ type: 'execute_result', callId: 'c2', mesh: null, error: null,
      paramsSchema: [{ key: 'm', type: 'select', default: 'a', label: 'M', options: [opt] }] });
    expect(r.ok).toBe(false);
  });

  it('accepts shared-but-acyclic references and returns the normalized schema', () => {
    const option = { value: 'a', label: 'A' };
    const r = checkEngineWorkerMessage({ type: 'execute_result', callId: 'c3', mesh: null, error: null,
      paramsSchema: [
        { key: 'm', type: 'select', default: 'a', label: 'M', options: [option, { value: 'b', label: 'B' }] },
        { key: 'n', type: 'select', default: 'a', label: 'N', options: [option] },
        { key: 'w', type: 'int', default: 3.6, label: 'W', min: 1, max: 10 },
      ] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // normalizeParamSchema's output, not the raw array (int default rounded).
    expect(r.paramsSchema?.map(p => p.key)).toEqual(['m', 'n', 'w']);
    expect(r.paramsSchema?.[2].default).toBe(4);
    expect(r.paramsSchema).not.toBe(r.msg.paramsSchema);
  });
});

describe('DoS and shared-memory guards', () => {
  it('isPlainData walks a shared-reference DAG once and caps total nodes', () => {
    let x: unknown = [1];
    for (let i = 0; i < 31; i++) x = [x, x];
    const t0 = performance.now();
    expect(isPlainData(x)).toBe(true);
    expect(performance.now() - t0).toBeLessThan(500);
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);
    expect(isPlainData(cyclic)).toBe(false); // structured clone can carry cycles — refused
    const shared = { a: 1 };
    expect(isPlainData({ x: shared, y: [shared, shared], z: { w: shared } })).toBe(true); // shared but acyclic
    expect(isPlainData(Array.from({ length: 300_000 }, (_, i) => i))).toBe(false);
  });

  it('refuses typed arrays backed by a SharedArrayBuffer', () => {
    const shared = new Float32Array(new SharedArrayBuffer(9 * 4));
    expect(checkMeshData({ vertProperties: shared, triVerts: new Uint32Array([0, 1, 2]), numVert: 3, numTri: 1, numProp: 3 })).toMatch(/own buffer/);
    const sharedTris = new Uint32Array(new SharedArrayBuffer(3 * 4));
    expect(checkMeshData({ vertProperties: new Float32Array(9), triVerts: sharedTris, numVert: 3, numTri: 1, numProp: 3 })).toMatch(/own buffer/);
    expect(isPlainData({ a: new Uint8Array(new SharedArrayBuffer(4)) })).toBe(false);
    const grid = { keys: new Float64Array(new SharedArrayBuffer(8)), colors: new Uint32Array(1), surfacing: { mode: 'blocks', iterations: 2, detail: 1 } };
    expect(checkEngineWorkerMessage({ type: 'voxel_grid_result', callId: 'g', grid, error: null }).ok).toBe(false);
  });
});
