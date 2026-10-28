import { describe, it, expect } from 'vitest';
import { absorbSubPixelSlivers } from '../../src/color/thinTriangles';
import { buildAdjacency } from '../../src/color/adjacency';
import type { MeshData } from '../../src/geometry/types';

/** A flat seam: a chain of 0.01-wide sliver quads up x = 0..0.01, with a
 *  normal-shaped triangle fan on each side.
 *  Triangles 0–3: left fan; 4–11: slivers (2 per segment, bottom to top);
 *  12–15: right fan. */
function seamMesh(): MeshData {
  const ys = [0, 2.5, 5, 7.5, 10];
  const verts: number[] = [];
  const v = (x: number, y: number): number => { verts.push(x, y, 0); return verts.length / 3 - 1; };
  const left = ys.map(y => v(0, y));
  const right = ys.map(y => v(0.01, y));
  const leftApex = v(-5, 5), rightApex = v(5, 5);
  const tris: number[] = [];
  for (let i = 0; i < 4; i++) tris.push(leftApex, left[i + 1], left[i]);
  for (let i = 0; i < 4; i++) tris.push(left[i], right[i], right[i + 1], left[i], right[i + 1], left[i + 1]);
  for (let i = 0; i < 4; i++) tris.push(rightApex, right[i], right[i + 1]);
  return {
    vertProperties: new Float32Array(verts),
    triVerts: new Uint32Array(tris),
    numVert: verts.length / 3,
    numTri: tris.length / 3,
    numProp: 3,
  } as MeshData;
}

describe('absorbSubPixelSlivers', () => {
  it('follows a chain of slivers inside the brush, skipping normal triangles', () => {
    const mesh = seamMesh();
    const footprint = new Set([0]);
    const added = absorbSubPixelSlivers(footprint, mesh, buildAdjacency(mesh), 0.05, (_x, y) => y < 6);
    // Segments 0–2 touch y < 6 (segment 2 starts at y = 5); segment 3 doesn't.
    expect(added).toBe(6);
    expect([...footprint].sort((a, b) => a - b)).toEqual([0, 4, 5, 6, 7, 8, 9]);
  });

  it('never pulls in a normal-shaped triangle, even when it is inside the brush', () => {
    const mesh = seamMesh();
    const footprint = new Set([0]);
    absorbSubPixelSlivers(footprint, mesh, buildAdjacency(mesh), 0.05, () => true);
    for (let t = 12; t < 16; t++) expect(footprint.has(t)).toBe(false);
    for (let t = 4; t < 12; t++) expect(footprint.has(t)).toBe(true);
  });

  it('adds nothing when the slivers are wider than the threshold, or it is off', () => {
    const mesh = seamMesh();
    const adj = buildAdjacency(mesh);
    expect(absorbSubPixelSlivers(new Set([0]), mesh, adj, 0.001, () => true)).toBe(0);
    expect(absorbSubPixelSlivers(new Set([0]), mesh, adj, 0, () => true)).toBe(0);
  });
});
