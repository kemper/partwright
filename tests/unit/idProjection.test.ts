import { describe, it, expect } from 'vitest';
import {
  fillFromNearestPainted,
  encodeTriangleIdColor,
  decodeTriangleIdPixel,
  buildPaletteSnapper,
  tallyProjectionVotes,
  buildScopeEdgeAdjacency,
  fillUnvotedFromNeighbors,
  triangleFacing,
  getProjectionConfidence,
  projectionRegionRegistry,
  BACKGROUND_VOTE,
  OFF_IMAGE,
  WINNER_UNPAINTED,
  WINNER_NO_PIXELS,
} from '../../src/color/idProjection';
import type { MeshData } from '../../src/geometry/types';

function makeMesh(verts: number[][], tris: number[][]): MeshData {
  const vertProperties = new Float32Array(verts.flat());
  const triVerts = new Uint32Array(tris.flat());
  return {
    vertProperties,
    triVerts,
    numVert: verts.length,
    numTri: tris.length,
    numProp: 3,
  };
}

describe('triangle ID encode/decode', () => {
  it('round-trips indices across byte boundaries', () => {
    for (const i of [0, 1, 254, 255, 256, 65534, 65535, 65536, 1_000_000]) {
      const [r, g, b] = encodeTriangleIdColor(i);
      expect(decodeTriangleIdPixel(r, g, b, i + 1)).toBe(i);
    }
  });

  it('decodes pure black (background) to -1', () => {
    expect(decodeTriangleIdPixel(0, 0, 0, 100)).toBe(-1);
  });

  it('rejects out-of-range ids', () => {
    const [r, g, b] = encodeTriangleIdColor(50);
    expect(decodeTriangleIdPixel(r, g, b, 50)).toBe(-1); // count 50 → max index 49
  });
});

describe('buildPaletteSnapper', () => {
  const red: [number, number, number] = [0.85, 0.1, 0.1];
  const white: [number, number, number] = [1, 1, 1];
  const black: [number, number, number] = [0.05, 0.05, 0.05];
  const blue: [number, number, number] = [0.1, 0.2, 0.8];

  it('snaps a shaded (dark) red to red, not black — hue dominates for saturated colors', () => {
    const snap = buildPaletteSnapper([red, white, black, blue]);
    expect(snap(0.45, 0.05, 0.05)).toBe(0);
  });

  it('snaps shaded white (light gray) to white by lightness', () => {
    const snap = buildPaletteSnapper([red, white, black]);
    expect(snap(0.82, 0.82, 0.84)).toBe(1);
  });

  it('snaps near-black to black, not to a saturated dark color', () => {
    const snap = buildPaletteSnapper([red, white, black]);
    expect(snap(0.12, 0.1, 0.11)).toBe(2);
  });
});

describe('tallyProjectionVotes', () => {
  /** Build a 4-wide, 1-tall ID buffer where each pixel names the given local
   *  triangle (or -1 for background). */
  function idBuffer(pixelTris: number[]): Uint8Array {
    const data = new Uint8Array(pixelTris.length * 4);
    pixelTris.forEach((t, i) => {
      if (t < 0) return;
      const [r, g, b] = encodeTriangleIdColor(t);
      data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255;
    });
    return data;
  }

  it('plurality of pixel votes wins per triangle', () => {
    // Triangle 0 gets pixels voting palette 1, 1, 0 → winner 1.
    const data = idBuffer([0, 0, 0, -1]);
    const samples = [1, 1, 0];
    let call = 0;
    const tally = tallyProjectionVotes({
      idData: data, idWidth: 4, idHeight: 1, triangleCount: 1, paletteCount: 2,
      sample: () => samples[call++],
    });
    expect(tally.winner[0]).toBe(1);
    expect(tally.pixelCounts[0]).toBe(3);
    expect(tally.sampledPixels).toBe(3);
  });

  it('background outvoting all palette colors leaves the triangle unpainted', () => {
    const data = idBuffer([0, 0, 0]);
    const samples = [BACKGROUND_VOTE, BACKGROUND_VOTE, 0];
    let call = 0;
    const tally = tallyProjectionVotes({
      idData: data, idWidth: 3, idHeight: 1, triangleCount: 1, paletteCount: 2,
      sample: () => samples[call++],
    });
    expect(tally.winner[0]).toBe(WINNER_UNPAINTED);
    expect(tally.backgroundPixels).toBe(2);
  });

  it('a triangle with no pixels reports WINNER_NO_PIXELS', () => {
    const data = idBuffer([0, -1]);
    const tally = tallyProjectionVotes({
      idData: data, idWidth: 2, idHeight: 1, triangleCount: 2, paletteCount: 2,
      sample: () => 0,
    });
    expect(tally.winner[0]).toBe(0);
    expect(tally.winner[1]).toBe(WINNER_NO_PIXELS);
  });

  it('off-image samples do not count toward the triangle', () => {
    const data = idBuffer([0, 0]);
    const samples = [OFF_IMAGE, 1];
    let call = 0;
    const tally = tallyProjectionVotes({
      idData: data, idWidth: 2, idHeight: 1, triangleCount: 1, paletteCount: 2,
      sample: () => samples[call++],
    });
    expect(tally.winner[0]).toBe(1);
    expect(tally.pixelCounts[0]).toBe(1);
    expect(tally.offImagePixels).toBe(1);
  });
});

describe('buildScopeEdgeAdjacency', () => {
  it('links triangles sharing an edge, in local indices', () => {
    // Quad split into two triangles sharing edge 1-2.
    const mesh = makeMesh(
      [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]],
      [[0, 1, 2], [1, 3, 2]],
    );
    const adj = buildScopeEdgeAdjacency(mesh, [0, 1]);
    expect(Array.from(adj.subarray(0, 3))).toContain(1);
    expect(Array.from(adj.subarray(3, 6))).toContain(0);
  });

  it('leaves boundary edge slots at -1 and respects the scope subset', () => {
    const mesh = makeMesh(
      [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [2, 0, 0]],
      [[0, 1, 2], [1, 3, 2], [1, 4, 3]],
    );
    // Scope excludes triangle 2 — triangle local 1 must NOT see it.
    const adj = buildScopeEdgeAdjacency(mesh, [0, 1]);
    const t1 = Array.from(adj.subarray(3, 6)).filter(n => n >= 0);
    expect(t1).toEqual([0]);
  });
});

describe('fillUnvotedFromNeighbors', () => {
  it('fills an unvoted triangle when two neighbors agree, cascading across rounds', () => {
    // Strip: t0 - t1 - t2 - t3; t0/t3 painted color 2, t1/t2 unvoted.
    // t1 sees painted t0 + (after round 1) t2 — needs the cascade.
    // Manual adjacency: each triangle linked to its strip neighbors.
    const adjacency = new Int32Array([
      1, -1, -1,
      0, 2, -1,
      1, 3, -1,
      2, -1, -1,
    ]);
    const winner = new Int32Array([2, WINNER_NO_PIXELS, WINNER_NO_PIXELS, 2]);
    const facing = new Float32Array([1, 1, 1, 1]);
    // Round 1: t1 has neighbors {t0: 2, t2: unvoted} → only 1 agreeing, no fill.
    // Nothing ever reaches 2 agreeing neighbors on this strip except…
    const filled = fillUnvotedFromNeighbors({ winner, adjacency, facing, minFacing: 0.1 });
    // t1: neighbors t0(2), t2(unvoted) → agree=1 → no. t2 symmetric. No fills.
    expect(filled).toEqual([]);

    // Now make t1 flanked by two painted: t0 and t2 painted.
    const winner2 = new Int32Array([2, WINNER_NO_PIXELS, 2, 2]);
    const filled2 = fillUnvotedFromNeighbors({ winner: winner2, adjacency, facing, minFacing: 0.1 });
    expect(filled2).toEqual([1]);
    expect(winner2[1]).toBe(2);
  });

  it('does not fill when neighbors disagree or facing is below the gate', () => {
    const adjacency = new Int32Array([
      1, -1, -1,
      0, 2, -1,
      1, -1, -1,
    ]);
    // t1 flanked by colors 0 and 1 → conflict, no fill.
    const winner = new Int32Array([0, WINNER_NO_PIXELS, 1]);
    const facing = new Float32Array([1, 1, 1]);
    expect(fillUnvotedFromNeighbors({ winner, adjacency, facing, minFacing: 0.1 })).toEqual([]);
    expect(winner[1]).toBe(WINNER_NO_PIXELS);

    // Agreeing neighbors but back-facing candidate → no fill.
    const winner2 = new Int32Array([0, WINNER_NO_PIXELS, 0]);
    const facing2 = new Float32Array([1, -0.5, 1]);
    expect(fillUnvotedFromNeighbors({ winner: winner2, adjacency, facing: facing2, minFacing: 0.1 })).toEqual([]);
  });

  it('never fills triangles the image explicitly left unpainted', () => {
    const adjacency = new Int32Array([
      1, -1, -1,
      0, 2, -1,
      1, -1, -1,
    ]);
    const winner = new Int32Array([0, WINNER_UNPAINTED, 0]);
    const facing = new Float32Array([1, 1, 1]);
    expect(fillUnvotedFromNeighbors({ winner, adjacency, facing, minFacing: 0.1 })).toEqual([]);
    expect(winner[1]).toBe(WINNER_UNPAINTED);
  });
});

describe('triangleFacing', () => {
  it('scores +1 for a triangle facing the camera and -1 turned away', () => {
    // CCW triangle in the XY plane → normal +Z.
    const mesh = makeMesh(
      [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      [[0, 1, 2], [0, 2, 1]],
    );
    const facing = triangleFacing(mesh, [0, 1], [0, 0, 1]);
    expect(facing[0]).toBeCloseTo(1, 5);
    expect(facing[1]).toBeCloseTo(-1, 5);
  });
});

describe('fillFromNearestPainted', () => {
  it('propagates the nearest painted color across an unpainted strip and leaves unreachable components alone', () => {
    // Strip t0..t4 (colors 7, -1, -1, -1, 9) plus isolated t5 (-1).
    const adjacency = new Int32Array([
      1, -1, -1,
      0, 2, -1,
      1, 3, -1,
      2, 4, -1,
      3, -1, -1,
      -1, -1, -1,
    ]);
    const colorIndex = new Int32Array([7, -1, -1, -1, 9, -1]);
    const filled = fillFromNearestPainted({ colorIndex, adjacency });
    expect(filled.sort()).toEqual([1, 2, 3]);
    expect(colorIndex[1]).toBe(7); // nearest to t0
    expect(colorIndex[3]).toBe(9); // nearest to t4
    expect([7, 9]).toContain(colorIndex[2]); // equidistant — either is fine
    expect(colorIndex[5]).toBe(-1); // unreachable stays unpainted
  });
});

describe('projection compositing state', () => {
  it('confidence store is per-mesh-identity and sized to the mesh', () => {
    const meshA = makeMesh([[0, 0, 0], [1, 0, 0], [0, 1, 0]], [[0, 1, 2]]);
    const meshB = makeMesh([[0, 0, 0], [1, 0, 0], [0, 1, 0]], [[0, 1, 2]]);
    const confA = getProjectionConfidence(meshA);
    confA[0] = 0.7;
    expect(getProjectionConfidence(meshA)[0]).toBeCloseTo(0.7);
    expect(getProjectionConfidence(meshB)[0]).toBe(0);
    expect(confA.length).toBe(1);
  });

  it('region registry is per-mesh-identity', () => {
    const meshA = makeMesh([[0, 0, 0], [1, 0, 0], [0, 1, 0]], [[0, 1, 2]]);
    const meshB = makeMesh([[0, 0, 0], [1, 0, 0], [0, 1, 0]], [[0, 1, 2]]);
    projectionRegionRegistry(meshA).add(5);
    expect(projectionRegionRegistry(meshA).has(5)).toBe(true);
    expect(projectionRegionRegistry(meshB).has(5)).toBe(false);
  });
});
