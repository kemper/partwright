// Unit tests for the color-based bucket flood fill (findColorRegion).
//
// The bucket tool's sensitivity is color-distance based: starting from a seed
// triangle, the flood fill expands to edge-adjacent triangles whose RGB color
// is within `colorTolerance` (normalised Euclidean distance) of the seed.

import { describe, it, expect } from 'vitest';
import { buildAdjacency, findColorRegion } from '../../src/color/adjacency';
import type { MeshData } from '../../src/geometry/types';

// A flat 2-quad strip in the z=0 plane → 4 triangles, all one connected
// component. Quad 0 (T0,T1) sits at x 0..1, quad 1 (T2,T3) at x 1..2; the two
// quads share edge (1,4) via T0↔T3, so the whole strip is edge-connected.
function buildStrip(): { mesh: MeshData; adjacency: ReturnType<typeof buildAdjacency> } {
  // Verts: bottom A,B,C (y=0) then top D,E,F (y=1).
  const vertProperties = new Float32Array([
    0, 0, 0, // 0 A
    1, 0, 0, // 1 B
    2, 0, 0, // 2 C
    0, 1, 0, // 3 D
    1, 1, 0, // 4 E
    2, 1, 0, // 5 F
  ]);
  const triVerts = new Uint32Array([
    0, 1, 4, // T0 (quad 0)
    0, 4, 3, // T1 (quad 0)
    1, 2, 5, // T2 (quad 1)
    1, 5, 4, // T3 (quad 1)
  ]);
  const mesh: MeshData = { vertProperties, triVerts, numVert: 6, numTri: 4, numProp: 3 };
  return { mesh, adjacency: buildAdjacency(mesh) };
}

// RGB (0..255) per triangle: quad 0 red, quad 1 blue.
const RED_BLUE = new Uint8Array([
  255, 0, 0,
  255, 0, 0,
  0, 0, 255,
  0, 0, 255,
]);

describe('findColorRegion', () => {
  it('stops at a color boundary with a tight tolerance', () => {
    const { adjacency } = buildStrip();
    // Seed T0 (red). Tolerance 0 = exact match only → only the two red tris.
    const region = findColorRegion(0, adjacency, RED_BLUE, 0);
    expect([...region].sort((a, b) => a - b)).toEqual([0, 1]);
  });

  it('fills the whole connected component when tolerance is 1', () => {
    const { adjacency } = buildStrip();
    const region = findColorRegion(0, adjacency, RED_BLUE, 1);
    expect(region.size).toBe(4);
  });

  it('fills the whole connected component when triColors is null', () => {
    const { adjacency } = buildStrip();
    // No color data → every triangle looks identical, so the whole strip fills.
    const region = findColorRegion(0, adjacency, null, 0);
    expect(region.size).toBe(4);
  });

  it('crosses a boundary once the tolerance exceeds the color distance', () => {
    const { adjacency } = buildStrip();
    // Distance red→blue is sqrt(1²+0+1²)/√3 ≈ 0.816 of max. A 0.9 tolerance
    // clears it, so the bucket bleeds into the blue quad too.
    const region = findColorRegion(0, adjacency, RED_BLUE, 0.9);
    expect(region.size).toBe(4);
    // …but a tolerance just under that distance does not.
    const tight = findColorRegion(0, adjacency, RED_BLUE, 0.5);
    expect([...tight].sort((a, b) => a - b)).toEqual([0, 1]);
  });

  it('always includes the seed triangle', () => {
    const { adjacency } = buildStrip();
    const region = findColorRegion(2, adjacency, RED_BLUE, 0);
    expect(region.has(2)).toBe(true);
    // Seed is blue → exact-match tolerance keeps only the blue quad.
    expect([...region].sort((a, b) => a - b)).toEqual([2, 3]);
  });
});
