// Unit tests for the brush footprint signed-distance field (the basis of the
// in/out test and the boundary-conforming clip). Pure geometry — no browser.

import { describe, test, expect } from 'vitest';
import { strokeSignedDist, sprayCoverage, airbrushDither, strokeFootprintTriangles, type BrushStroke } from '../../src/color/subdivide';
import type { MeshData } from '../../src/geometry/types';

/** Build a MeshData (3 props/vertex, no shared verts) from a list of triangles. */
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

const at = (s: BrushStroke, p: [number, number, number]) => strokeSignedDist(p[0], p[1], p[2], s);

describe('strokeSignedDist', () => {
  test('legacy circle: signed distance to a sphere of radius r', () => {
    const s: BrushStroke = { samples: [[0, 0, 0]], radius: 2, shape: 'circle', maxEdge: 0.1 };
    expect(at(s, [0, 0, 0])).toBeCloseTo(-2);   // centre, r inside
    expect(at(s, [2, 0, 0])).toBeCloseTo(0);     // on the boundary
    expect(at(s, [3, 0, 0])).toBeCloseTo(1);     // outside
  });

  test('legacy square: Chebyshev box, corners are inside (not clipped to a sphere)', () => {
    const s: BrushStroke = { samples: [[0, 0, 0]], radius: 2, shape: 'square', maxEdge: 0.1 };
    expect(at(s, [1.9, 1.9, 0])).toBeLessThan(0);   // near a corner — inside the box
    expect(at(s, [2.1, 0, 0])).toBeGreaterThan(0);  // just past a face — outside
  });

  test('legacy diamond: L1 ball', () => {
    const s: BrushStroke = { samples: [[0, 0, 0]], radius: 2, shape: 'diamond', maxEdge: 0.1 };
    expect(at(s, [1, 0.9, 0])).toBeLessThan(0);     // |1|+|0.9| = 1.9 < 2 → inside
    expect(at(s, [1.2, 1.2, 0])).toBeGreaterThan(0); // 2.4 > 2 → outside
  });

  test('slab circle: cylinder — gated by depth along the normal', () => {
    const s: BrushStroke = {
      samples: [[0, 0, 0]], radius: 2, shape: 'circle', maxEdge: 0.1,
      surface: 'slab', depth: 1, sampleNormals: [[0, 0, 1]],
    };
    expect(at(s, [1, 0, 0])).toBeLessThan(0);    // on the surface, within radius
    expect(at(s, [0, 0, 0.5])).toBeLessThan(0);  // within depth through the wall
    expect(at(s, [0, 0, 1.5])).toBeGreaterThan(0); // beyond depth → outside the slab
    expect(at(s, [2.5, 0, 0])).toBeGreaterThan(0); // beyond radius → outside laterally
  });

  test('union over samples takes the nearest footprint', () => {
    const s: BrushStroke = { samples: [[0, 0, 0], [10, 0, 0]], radius: 2, shape: 'circle', maxEdge: 0.1 };
    expect(at(s, [10, 0, 0])).toBeCloseTo(-2);   // inside the second sample
    expect(at(s, [5, 0, 0])).toBeGreaterThan(0); // between, outside both
  });
});

describe('strokeFootprintTriangles spatial grid', () => {
  // The footprint contract is "triangles whose centroid falls within the stroke
  // footprint". The grid is just an accelerator, so its result must equal a
  // brute-force centroid test over every triangle — no misses, no extras.
  const centroid = (tri: [number, number, number][]): [number, number, number] => [
    (tri[0][0] + tri[1][0] + tri[2][0]) / 3,
    (tri[0][1] + tri[1][1] + tri[2][1]) / 3,
    (tri[0][2] + tri[1][2] + tri[2][2]) / 3,
  ];

  test('matches brute-force centroid test on a mesh of mixed triangle sizes', () => {
    const tris: [number, number, number][][] = [];
    // A dense field of small triangles across the XY plane.
    for (let x = -6; x <= 6; x++) {
      for (let y = -6; y <= 6; y++) {
        tris.push([[x, y, 0], [x + 0.3, y, 0], [x, y + 0.3, 0]]);
      }
    }
    // A couple of oversize triangles (extent ≫ cell) — exercise the always-return
    // path. One centroid lands inside the footprint, one outside.
    tris.push([[-0.2, -0.2, 0], [5, 0, 0], [0, 5, 0]]);   // centroid ≈ (1.6,1.6) — outside r=3
    tris.push([[0, 0, 0], [-3, 0, 0], [0, -3, 0]]);       // centroid ≈ (-1,-1) — inside r=3
    const mesh = meshFromTris(tris);

    const stroke: BrushStroke = { samples: [[0, 0, 0]], radius: 3, shape: 'circle', maxEdge: 0.1 };
    const got = strokeFootprintTriangles(mesh, stroke);

    const expected = new Set<number>();
    for (let t = 0; t < tris.length; t++) {
      const c = centroid(tris[t]);
      if (Math.hypot(c[0], c[1], c[2]) <= 3) expected.add(t);
    }

    expect([...got].sort((a, b) => a - b)).toEqual([...expected].sort((a, b) => a - b));
    expect(got.size).toBeGreaterThan(0);
  });

  test('multi-sample stroke covers triangles near every sample', () => {
    const tris: [number, number, number][][] = [];
    for (let x = -2; x <= 12; x++) {
      tris.push([[x, 0, 0], [x + 0.2, 0, 0], [x, 0.2, 0]]);
    }
    const mesh = meshFromTris(tris);
    const stroke: BrushStroke = { samples: [[0, 0, 0], [10, 0, 0]], radius: 1.5, shape: 'circle', maxEdge: 0.1 };
    const got = strokeFootprintTriangles(mesh, stroke);

    const expected = new Set<number>();
    for (let t = 0; t < tris.length; t++) {
      const c = centroid(tris[t]);
      const near = Math.min(Math.hypot(c[0], c[1], c[2]), Math.hypot(c[0] - 10, c[1], c[2]));
      if (near <= 1.5) expected.add(t);
    }
    expect([...got].sort((a, b) => a - b)).toEqual([...expected].sort((a, b) => a - b));
  });
});

describe('airbrush spray coverage', () => {
  // sd = signed distance to the footprint edge (≤0 inside). For a radius-10
  // circle, sd = d - 10 where d is the distance from the centre.
  const stroke = (spray: Partial<{ strength: number; softness: number }> = {}): BrushStroke =>
    ({ samples: [[0, 0, 0]], radius: 10, shape: 'circle', maxEdge: 0.5, spray: { strength: 1, softness: 0.5, seed: 1, ...spray } });

  test('coverage: full in the core, fades across the feather, zero at/past the edge', () => {
    const s = stroke(); // featherWidth = 5 (softness 0.5)
    expect(sprayCoverage(-10, s)).toBeCloseTo(1);  // centre (depth 10)
    expect(sprayCoverage(-5, s)).toBeCloseTo(1);   // core boundary (depth = featherWidth)
    expect(sprayCoverage(-2.5, s)).toBeCloseTo(0.5); // mid-feather
    expect(sprayCoverage(0, s)).toBe(0);           // edge
    expect(sprayCoverage(1, s)).toBe(0);           // outside
  });

  test('strength scales coverage; lower softness widens the solid core', () => {
    expect(sprayCoverage(-10, stroke({ strength: 0.4 }))).toBeCloseTo(0.4);
    // depth 2 inside: softness 0.1 → featherWidth 1 (solid); softness 0.9 → featherWidth 9 (deep feather)
    expect(sprayCoverage(-2, stroke({ softness: 0.1 }))).toBeCloseTo(1);
    expect(sprayCoverage(-2, stroke({ softness: 0.9 }))).toBeLessThan(0.5);
  });

  test('dither is deterministic and ~uniform in [0,1)', () => {
    expect(airbrushDither(1.23, 4.56, 7.89, 1)).toBe(airbrushDither(1.23, 4.56, 7.89, 1)); // stable
    expect(airbrushDither(1.23, 4.56, 7.89, 1)).not.toBe(airbrushDither(1.23, 4.56, 7.89, 2)); // seed matters
    let sum = 0; const N = 4000;
    for (let i = 0; i < N; i++) { const v = airbrushDither(i * 0.013, i * 0.029, 0, 7); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); sum += v; }
    expect(sum / N).toBeGreaterThan(0.45); // mean ≈ 0.5 (well-distributed)
    expect(sum / N).toBeLessThan(0.55);
  });

  test('coverage is monotonic in strength (the dither superset → non-flaky tests)', () => {
    const lo = stroke({ strength: 0.5 }), hi = stroke({ strength: 0.9 });
    for (const sd of [-10, -6, -3, -1]) expect(sprayCoverage(sd, hi)).toBeGreaterThanOrEqual(sprayCoverage(sd, lo));
  });
});
