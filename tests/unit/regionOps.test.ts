import { describe, it, expect } from 'vitest';
import { buildAdjacency } from '../../src/color/adjacency';
import type { MeshData } from '../../src/geometry/types';
import {
  growTriangles,
  shrinkTriangles,
  connectedComponents,
  despeckleTriangles,
  combineTriangles,
} from '../../src/color/regionOps';
import { addRegion, clearRegions, getRegions, replaceRegion, removeLastRegion, redoLastRegion, serialize } from '../../src/color/regions';

/** Flat n×n grid of unit quads, two triangles each. Triangle index for cell
 *  (i, j) is 2·(j·n + i) (+1 for the upper triangle). */
function grid(n: number): MeshData {
  const verts: number[] = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) verts.push(i, j, 0);
  const tris: number[] = [];
  const v = (i: number, j: number) => j * (n + 1) + i;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      tris.push(v(i, j), v(i + 1, j), v(i + 1, j + 1));
      tris.push(v(i, j), v(i + 1, j + 1), v(i, j + 1));
    }
  }
  return {
    vertProperties: new Float32Array(verts),
    triVerts: new Uint32Array(tris),
    numVert: (n + 1) * (n + 1),
    numTri: tris.length / 3,
    numProp: 3,
  };
}

/** Both triangles of every cell in the [i0..i1]×[j0..j1] block. */
function cells(n: number, i0: number, i1: number, j0: number, j1: number): Set<number> {
  const s = new Set<number>();
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { s.add(2 * (j * n + i)); s.add(2 * (j * n + i) + 1); }
  return s;
}

const N = 12;
const mesh = grid(N);
const { neighbors } = buildAdjacency(mesh);

describe('regionOps', () => {
  it('grow adds rings and respects the allow filter', () => {
    const seed = cells(N, 5, 6, 5, 6);
    const g1 = growTriangles(seed, neighbors, 1);
    expect(g1.size).toBeGreaterThan(seed.size);
    for (const t of seed) expect(g1.has(t)).toBe(true);
    const g2 = growTriangles(seed, neighbors, 2);
    expect(g2.size).toBeGreaterThan(g1.size);
    // Clamp: never add triangles in column ≥ 7.
    const allow = (t: number) => Math.floor(t / 2) % N < 7;
    const gc = growTriangles(seed, neighbors, 5, allow);
    for (const t of gc) expect(Math.floor(t / 2) % N).toBeLessThan(7);
  });

  it('shrink is the inverse-ish of grow and keeps the open mesh border', () => {
    const block = cells(N, 3, 8, 3, 8);
    const s1 = shrinkTriangles(block, neighbors, 1);
    expect(s1.size).toBeLessThan(block.size);
    for (const t of s1) expect(block.has(t)).toBe(true);
    // Growing the shrunk block back by one ring covers the original interior.
    const back = growTriangles(s1, neighbors, 1);
    for (const t of cells(N, 4, 7, 4, 7)) expect(back.has(t)).toBe(true);
    // The whole mesh has no outside neighbours, so nothing erodes.
    const all = new Set<number>(Array.from({ length: mesh.numTri }, (_, i) => i));
    expect(shrinkTriangles(all, neighbors, 3).size).toBe(mesh.numTri);
  });

  it('connectedComponents splits disjoint blocks', () => {
    const two = new Set([...cells(N, 0, 1, 0, 1), ...cells(N, 8, 9, 8, 9)]);
    expect(connectedComponents(two, neighbors).length).toBe(2);
  });

  it('despeckle drops small islands and fills small enclosed holes', () => {
    const body = cells(N, 2, 9, 2, 9);
    // Punch a 1-cell hole (2 tris) in the middle; add a 1-triangle speck far away.
    const hole = cells(N, 5, 5, 5, 5);
    for (const t of hole) body.delete(t);
    const speck = 2 * (0 * N + 11);
    body.add(speck);

    const r = despeckleTriangles(body, neighbors, mesh.numTri, { minIslandTriangles: 4, maxHoleTriangles: 4 });
    expect(r.islandsRemoved).toBe(1);
    expect(r.triangles.has(speck)).toBe(false);
    expect(r.holesFilled).toBe(1);
    for (const t of hole) expect(r.triangles.has(t)).toBe(true);
    // The big unpainted surround is "outside", not a hole.
    expect(r.triangles.has(0)).toBe(false);
  });

  it('despeckle never erases the largest component, and 0 thresholds are no-ops', () => {
    const tiny = cells(N, 4, 4, 4, 4);
    const r = despeckleTriangles(tiny, neighbors, mesh.numTri, { minIslandTriangles: 100, maxHoleTriangles: 0 });
    expect(r.triangles.size).toBe(tiny.size);
    const noop = despeckleTriangles(tiny, neighbors, mesh.numTri, { minIslandTriangles: 0, maxHoleTriangles: 0 });
    expect(noop.islandsRemoved + noop.holesFilled).toBe(0);
  });

  it('combine implements union / subtract / intersect', () => {
    const a = new Set([1, 2, 3, 4]);
    const b = new Set([3, 4, 5]);
    const c = new Set([4, 9]);
    expect([...combineTriangles(a, [b], 'union')].sort()).toEqual([1, 2, 3, 4, 5]);
    expect([...combineTriangles(a, [b, c], 'subtract')].sort()).toEqual([1, 2]);
    expect([...combineTriangles(a, [b, c], 'intersect')]).toEqual([4]);
  });
});


describe('replaceRegion (region edit undo)', () => {
  it('keeps the slot + order, undoes to the original, redoes back, and never serializes the link', () => {
    clearRegions();
    const a = addRegion('A', [1, 0, 0], 'face-pick', { kind: 'triangles', ids: [0, 1] }, new Set([0, 1]));
    const b = addRegion('B', [0, 1, 0], 'face-pick', { kind: 'triangles', ids: [5] }, new Set([5]));
    const edited = replaceRegion(a.id, new Set([0, 1, 2]), { kind: 'triangles', ids: [0, 1, 2] });
    expect(edited).not.toBeNull();
    // Same id/slot/order; B is still on top.
    expect(getRegions().map(r => r.name)).toEqual(['A', 'B']);
    expect(getRegions()[0].id).toBe(a.id);
    expect(getRegions()[0].order).toBe(a.order);
    expect(getRegions()[0].triangles.size).toBe(3);
    expect(JSON.stringify(serialize())).not.toContain('replaces');

    // Undo reverses the EDIT (most recent op), not B (last in the list).
    removeLastRegion();
    expect(getRegions().map(r => r.name)).toEqual(['A', 'B']);
    expect(getRegions()[0].triangles.size).toBe(2);
    redoLastRegion();
    expect(getRegions()[0].triangles.size).toBe(3);

    // Next undo after the edit's undo+redo: edit again, then B.
    removeLastRegion();
    removeLastRegion();
    expect(getRegions().map(r => r.name)).toEqual(['A']);
    expect(getRegions()[0].triangles.size).toBe(2);
    expect(b.id).toBeGreaterThan(a.id);
  });
});
