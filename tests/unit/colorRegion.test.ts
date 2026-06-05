// Unit tests for the color-based bucket flood fill (findColorRegion).
//
// The bucket tool's sensitivity is color-distance based: starting from a seed
// triangle, the flood fill expands to edge-adjacent triangles whose RGB color
// is within `colorTolerance` (normalised Euclidean distance) of the seed.

import { describe, it, expect } from 'vitest';
import { buildAdjacency, findColorRegion, gateRegionByBend } from '../../src/color/adjacency';
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

  it('bridges a T-junction (corner adjacency) the brush leaves behind', () => {
    // Triangle A spans edge P0–P1. On the far side that edge is split at its
    // midpoint M into B1 and B2 — a T-junction: A shares NO full edge with B1/B2
    // (so pure edge-pair adjacency would strand A alone), but it still shares the
    // corners P0 and P1. Corner adjacency must keep all three connected so the
    // bucket walks across the subdivision boundary instead of grabbing one face.
    const vertProperties = new Float32Array([
      0, 0, 0, // 0 P0
      2, 0, 0, // 1 P1
      1, 1, 0, // 2 P2
      1, 0, 0, // 3 M (midpoint of P0–P1)
      1, -1, 0, // 4 X
    ]);
    const triVerts = new Uint32Array([
      0, 1, 2, // A
      0, 3, 4, // B1
      3, 1, 4, // B2
    ]);
    const mesh: MeshData = { vertProperties, triVerts, numVert: 5, numTri: 3, numProp: 3 };
    const adjacency = buildAdjacency(mesh);
    // All one color → a tight tolerance still fills all three across the T-junction.
    const sameColor = new Uint8Array([10, 20, 30, 10, 20, 30, 10, 20, 30]);
    const region = findColorRegion(0, adjacency, sameColor, 0);
    expect([...region].sort((a, b) => a - b)).toEqual([0, 1, 2]);
  });

  it('anchors on the seed-color override instead of the seed triangle color', () => {
    const { adjacency } = buildStrip();
    // Seed the red quad but tell the flood to match BLUE: the seed is always
    // included, and the walk then collects only the blue-matching neighbours.
    const region = findColorRegion(0, adjacency, RED_BLUE, 0, [0, 0, 255]);
    expect(region.has(0)).toBe(true); // seed always kept
    expect(region.has(2)).toBe(true); // blue
    expect(region.has(3)).toBe(true); // blue
    expect(region.has(1)).toBe(false); // red, not the matched color
  });
});

describe('gateRegionByBend', () => {
  // A floor quad in z=0 folded 90° into a wall in the x=1 plane, sharing the
  // crease verts (2,3). Floor (T0,T1) normal +z; wall (T2,T3) normal -x.
  function buildFold(): ReturnType<typeof buildAdjacency> {
    const vertProperties = new Float32Array([
      0, 0, 0, // 0
      0, 1, 0, // 1
      1, 0, 0, // 2 crease
      1, 1, 0, // 3 crease
      1, 0, 1, // 4 wall top
      1, 1, 1, // 5 wall top
    ]);
    const triVerts = new Uint32Array([
      0, 2, 3, // T0 floor
      0, 3, 1, // T1 floor
      2, 4, 5, // T2 wall
      2, 5, 3, // T3 wall
    ]);
    return buildAdjacency({ vertProperties, triVerts, numVert: 6, numTri: 4, numProp: 3 });
  }

  it('drops candidates across a 90° fold but keeps the coplanar floor', () => {
    const adjacency = buildFold();
    const all = new Set([0, 1, 2, 3]);
    // cos(45°) ≈ 0.707: the floor↔wall 90° fold (dot 0) is too sharp to cross,
    // so only the two coplanar floor triangles remain.
    const gated = gateRegionByBend(all, 0, adjacency, Math.cos(Math.PI / 4));
    expect([...gated].sort((a, b) => a - b)).toEqual([0, 1]);
  });

  it('keeps the whole set when the tolerance admits the fold', () => {
    const adjacency = buildFold();
    const all = new Set([0, 1, 2, 3]);
    // cos(120°) = -0.5: a 90° fold (dot 0) is now gentle enough to cross.
    const gated = gateRegionByBend(all, 0, adjacency, -0.5);
    expect(gated.size).toBe(4);
  });

  it('is a no-op at cos(180°) = -1 (wrap freely) and never grows the set', () => {
    const adjacency = buildFold();
    const all = new Set([0, 1, 2, 3]);
    expect(gateRegionByBend(all, 0, adjacency, -1)).toBe(all); // same reference, untouched
    // The walk only steps into candidates, so a partial set stays a subset.
    const partial = new Set([0, 1]);
    const gated = gateRegionByBend(partial, 0, adjacency, Math.cos(Math.PI / 4));
    expect([...gated].sort((a, b) => a - b)).toEqual([0, 1]);
  });

  it('returns the candidates untouched when the seed is not among them', () => {
    const adjacency = buildFold();
    const candidates = new Set([2, 3]);
    expect(gateRegionByBend(candidates, 0, adjacency, Math.cos(Math.PI / 4))).toBe(candidates);
  });
});
