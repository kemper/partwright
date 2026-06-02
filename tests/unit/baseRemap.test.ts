// Unit tests for current→base triangle remapping (src/color/baseRemap.ts).
//
// The remapper builds a BVH over the pristine base mesh to find which base
// triangle a refined child came from. Two invariants matter:
//   1. It must NOT mutate the base mesh — the BVH wraps the live `triVerts`
//      array, so an in-place index reorder (which some BVH build configs do)
//      would silently scramble the shared pristine mesh that render/export/
//      reload all use. The remapper builds with `indirect: true` to guarantee
//      this; the snapshot test below is the defensive guard for that invariant.
//   2. It must return the correct parent triangle for a refined child.

import { describe, test, expect } from 'vitest';
import { baseTriangleOf } from '../../src/color/baseRemap';
import type { MeshData } from '../../src/geometry/types';

function meshFromTris(tris: [number, number, number][][]): MeshData {
  const vertProperties = new Float32Array(tris.length * 9);
  const triVerts = new Uint32Array(tris.length * 3);
  for (let t = 0; t < tris.length; t++) {
    for (let v = 0; v < 3; v++) {
      const p = tris[t][v];
      vertProperties[t * 9 + v * 3] = p[0];
      vertProperties[t * 9 + v * 3 + 1] = p[1];
      vertProperties[t * 9 + v * 3 + 2] = p[2];
      triVerts[t * 3 + v] = t * 3 + v;
    }
  }
  return { vertProperties, triVerts, numVert: tris.length * 3, numTri: tris.length, numProp: 3 };
}

/** A strip of `n` spatially-separated small triangles along +x (triangle i sits
 *  near x=i). Big enough (n ≫ BVH leaf size) that a non-indirect build must
 *  partition and reorder the index. */
function stripBase(n: number): MeshData {
  const tris: [number, number, number][][] = [];
  for (let i = 0; i < n; i++) {
    tris.push([[i, 0, 0], [i + 0.6, 0, 0], [i, 0.6, 0]]);
  }
  return meshFromTris(tris);
}

/** Centroid of strip triangle i (matches `stripBase`). */
const stripCentroid = (i: number): [number, number, number] => [i + 0.2, 0.2, 0];

describe('baseTriangleOf', () => {
  test('maps a refined child to the base triangle containing its centroid', () => {
    const base = stripBase(120);
    // "current" only needs centroids that land inside known base triangles.
    const current = meshFromTris([
      [stripCentroid(0), [0.05, 0.1, 0], [0.3, 0.05, 0]],
      [stripCentroid(50), [50.05, 0.1, 0], [50.3, 0.05, 0]],
      [stripCentroid(119), [119.05, 0.1, 0], [119.3, 0.05, 0]],
    ]);
    expect(baseTriangleOf(current, base, 0)).toBe(0);
    expect(baseTriangleOf(current, base, 1)).toBe(50);
    expect(baseTriangleOf(current, base, 2)).toBe(119);
  });

  test('does not mutate the base mesh triVerts (no in-place index reorder)', () => {
    // Fresh base so the BVH is built (and, if buggy, reorders) during this test.
    const base = stripBase(120);
    const snapshot = Uint32Array.from(base.triVerts);
    const current = meshFromTris([[stripCentroid(37), [37.05, 0.1, 0], [37.3, 0.05, 0]]]);
    for (let i = 0; i < 10; i++) baseTriangleOf(current, base, 0);
    expect(Array.from(base.triVerts)).toEqual(Array.from(snapshot));
  });

  test('returns the identity when current and base are the same mesh', () => {
    const base = stripBase(8);
    expect(baseTriangleOf(base, base, 3)).toBe(3);
  });
});
