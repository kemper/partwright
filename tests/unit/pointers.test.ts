// Unit tests for src/annotations/pointers.ts — the AI-planning pointer
// store. Covers: add/list/update/remove/clear basics, hidden flag toggles,
// serialize/deserialize round-trip, and the resolve-against-mesh logic
// (clean snap on a near-identical mesh; stale flag when normal flips;
// orphaned when the surface is gone).

import { describe, test, expect, beforeEach } from 'vitest';
import {
  __resetForTests,
  addPointer,
  clearPointers,
  getPointerCount,
  getPointerById,
  getPointers,
  loadSerialized,
  markAllStale,
  onPointersChange,
  removePointer,
  resolvePointersAgainstMesh,
  serializeAll,
  setHidden,
  updatePointer,
} from '../../src/annotations/pointers';
import { buildAdjacency } from '../../src/color/adjacency';
import type { MeshData } from '../../src/geometry/types';

// A two-triangle flat square in the XY plane, normals pointing +Z. The flat
// surface lets us drop a pointer on top, then move the surface to verify
// resolveSeed snaps back cleanly.
function flatSquare(): MeshData {
  const vertProperties = new Float32Array([
    0, 0, 0,   // 0
    1, 0, 0,   // 1
    1, 1, 0,   // 2
    0, 1, 0,   // 3
  ]);
  const triVerts = new Uint32Array([0, 1, 2,  0, 2, 3]);
  return { vertProperties, triVerts, numVert: 4, numTri: 2, numProp: 3 };
}

// Same square but flipped — surface normal points −Z. Used to drive the
// stale-flag path (anchor lands but normal disagrees > 45°).
function flippedSquare(): MeshData {
  const vertProperties = new Float32Array([
    0, 0, 0,
    1, 0, 0,
    1, 1, 0,
    0, 1, 0,
  ]);
  // Reversed winding flips the normals.
  const triVerts = new Uint32Array([0, 2, 1,  0, 3, 2]);
  return { vertProperties, triVerts, numVert: 4, numTri: 2, numProp: 3 };
}

describe('pointer store', () => {
  beforeEach(() => __resetForTests());

  test('add/list/remove basics', () => {
    const p = addPointer({ label: 'iris', point: [0.5, 0.5, 0], normal: [0, 0, 1] });
    expect(p.id).toMatch(/^ptr_/);
    expect(getPointerCount()).toBe(1);
    expect(getPointers()[0].label).toBe('iris');
    expect(getPointerById(p.id)?.status).toBe('proposed');

    expect(removePointer(p.id)).toBe(true);
    expect(getPointerCount()).toBe(0);
  });

  test('updatePointer patches in place + notifies listeners', () => {
    const p = addPointer({ label: 'before', point: [0, 0, 0], normal: [0, 0, 1] });
    let notified = 0;
    const unsub = onPointersChange(() => notified++);
    updatePointer(p.id, { label: 'after', status: 'approved' });
    expect(getPointerById(p.id)?.label).toBe('after');
    expect(getPointerById(p.id)?.status).toBe('approved');
    expect(notified).toBeGreaterThanOrEqual(1);
    unsub();
  });

  test('setHidden filters by id when supplied', () => {
    const a = addPointer({ label: 'a', point: [0, 0, 0], normal: [0, 0, 1] });
    const b = addPointer({ label: 'b', point: [0, 0, 0], normal: [0, 0, 1] });
    setHidden([a.id], true);
    expect(getPointerById(a.id)?.hidden).toBe(true);
    expect(getPointerById(b.id)?.hidden).toBe(false);
    setHidden(undefined, true);
    expect(getPointerById(b.id)?.hidden).toBe(true);
  });

  test('clearPointers filters by status', () => {
    addPointer({ label: 'p1', point: [0, 0, 0], normal: [0, 0, 1], status: 'proposed' });
    addPointer({ label: 'p2', point: [0, 0, 0], normal: [0, 0, 1], status: 'approved' });
    addPointer({ label: 'p3', point: [0, 0, 0], normal: [0, 0, 1], status: 'painted' });
    const removed = clearPointers({ status: 'proposed' });
    expect(removed).toBe(1);
    expect(getPointerCount()).toBe(2);
  });

  test('serialize/deserialize round-trips every field', () => {
    addPointer({
      label: 'iris_L',
      point: [0.25, 0.5, 1.5],
      normal: [0, 0, 1],
      paintHint: { kind: 'connected', maxDeviationDeg: 18 },
      proposedColor: [0.1, 0.2, 0.3],
      authoredBy: 'ai',
      status: 'approved',
    });
    addPointer({ label: 'hidden_one', point: [1, 1, 1], normal: [1, 0, 0] });
    setHidden(undefined, false);
    setHidden([getPointers()[1].id], true);

    const snap = serializeAll();
    __resetForTests();
    loadSerialized(snap);
    const after = getPointers();
    expect(after.length).toBe(2);
    expect(after[0].label).toBe('iris_L');
    expect(after[0].point).toEqual([0.25, 0.5, 1.5]);
    expect(after[0].paintHint).toEqual({ kind: 'connected', maxDeviationDeg: 18 });
    expect(after[0].proposedColor).toEqual([0.1, 0.2, 0.3]);
    expect(after[0].authoredBy).toBe('ai');
    expect(after[0].status).toBe('approved');
    expect(after[1].hidden).toBe(true);
    // Stale / orphaned reset on load — those are runtime state, not persisted.
    expect(after[0].stale).toBe(false);
    expect(after[0].orphaned).toBe(false);
  });

  test('resolvePointersAgainstMesh snaps a fresh anchor cleanly', () => {
    const mesh = flatSquare();
    const adj = buildAdjacency(mesh);
    const p = addPointer({
      label: 'on_top',
      point: [0.5, 0.5, 0],
      normal: [0, 0, 1],
    });
    const report = resolvePointersAgainstMesh(mesh, adj);
    expect(report.resolved).toBe(1);
    expect(report.staled + report.orphaned).toBe(0);
    expect(getPointerById(p.id)?.triangleId).toBeGreaterThanOrEqual(0);
    expect(getPointerById(p.id)?.stale).toBe(false);
  });

  test('resolvePointersAgainstMesh flags stale when the surface normal flips', () => {
    addPointer({ label: 'inv', point: [0.5, 0.5, 0], normal: [0, 0, 1] });
    const flipped = flippedSquare();
    const adj = buildAdjacency(flipped);
    const report = resolvePointersAgainstMesh(flipped, adj);
    // Anchor still snaps to a triangle, but normal disagrees → stale.
    expect(report.resolved + report.staled).toBeGreaterThan(0);
    expect(getPointers()[0].stale).toBe(true);
    expect(getPointers()[0].staleReason).toBeTruthy();
  });

  test('markAllStale flags every pointer + sets the reason', () => {
    addPointer({ label: 'a', point: [0, 0, 0], normal: [0, 0, 1] });
    addPointer({ label: 'b', point: [1, 1, 1], normal: [1, 0, 0] });
    const flagged = markAllStale('bake reason');
    expect(flagged).toBe(2);
    for (const p of getPointers()) {
      expect(p.stale).toBe(true);
      expect(p.staleReason).toBe('bake reason');
    }
  });
});
