// Unit tests for the brush footprint signed-distance field (the basis of the
// in/out test and the boundary-conforming clip). Pure geometry — no browser.

import { describe, test, expect } from 'vitest';
import { strokeSignedDist, sprayCoverage, airbrushDither, strokeFootprintTriangles, buildGeodesicField, deriveSampleNormals, wrapAngleGate, buildStrokeMesh, type BrushStroke } from '../../src/color/subdivide';
import { closestPointOnTriangle } from '../../src/color/adjacency';
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

describe('buildGeodesicField', () => {
  // A shared-vertex triangulated plane grid in Z=z0: (n+1)² verts, 2·n² tris.
  // Shared vertex indices give the flood fill real edge adjacency (unlike the
  // independent-vert meshFromTris). `wrinkle` bumps interior verts in Z so the
  // surface curves — exercising the closest-point math, not just a flat plane.
  function planeGrid(n: number, z0: number, wrinkle = 0): MeshData {
    const side = n + 1;
    const verts: number[] = [];
    for (let j = 0; j < side; j++) {
      for (let i = 0; i < side; i++) {
        const z = z0 + wrinkle * Math.sin(i * 0.7) * Math.cos(j * 0.7);
        verts.push(i, j, z);
      }
    }
    const tris: number[] = [];
    const vi = (i: number, j: number) => j * side + i;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        tris.push(vi(i, j), vi(i + 1, j), vi(i + 1, j + 1));
        tris.push(vi(i, j), vi(i + 1, j + 1), vi(i, j + 1));
      }
    }
    return {
      vertProperties: new Float32Array(verts),
      triVerts: new Uint32Array(tris),
      numVert: side * side,
      numTri: tris.length / 3,
      numProp: 3,
    };
  }

  /** Independent O(mesh) reference for `reachableAt`: linear nearest-triangle for
   *  the seeds + a radius-gated flood over shared edges, then a linear nearest
   *  for the query. This is exactly what the grid-accelerated field must equal —
   *  so it pins the optimisation as behaviour-preserving. */
  function referenceField(base: MeshData, samples: [number, number, number][], radius: number) {
    const { triVerts, numTri, numVert } = base;
    const tv = (vi: number): [number, number, number] => [
      base.vertProperties[vi * 3], base.vertProperties[vi * 3 + 1], base.vertProperties[vi * 3 + 2],
    ];
    const tris = Array.from({ length: numTri }, (_, t) => [tv(triVerts[t * 3]), tv(triVerts[t * 3 + 1]), tv(triVerts[t * 3 + 2])] as const);
    const d2 = (p: number[], t: number): number => {
      const [a, b, c] = tris[t];
      const cp = closestPointOnTriangle(p[0], p[1], p[2], a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      return (cp[0] - p[0]) ** 2 + (cp[1] - p[1]) ** 2 + (cp[2] - p[2]) ** 2;
    };
    const nearest = (p: number[]): number => {
      let best = Infinity, bi = -1;
      for (let t = 0; t < numTri; t++) { const v = d2(p, t); if (v < best) { best = v; bi = t; } }
      return bi;
    };
    const r2 = radius * radius;
    const withinR = (t: number) => samples.some((s) => d2(s, t) <= r2);
    const ekey = (u: number, v: number) => (u < v ? u * numVert + v : v * numVert + u);
    const edges = new Map<number, number[]>();
    for (let t = 0; t < numTri; t++) {
      const [a, b, c] = [triVerts[t * 3], triVerts[t * 3 + 1], triVerts[t * 3 + 2]];
      for (const [u, v] of [[a, b], [b, c], [c, a]] as const) {
        const arr = edges.get(ekey(u, v)); if (arr) arr.push(t); else edges.set(ekey(u, v), [t]);
      }
    }
    const nbrs = (t: number): number[] => {
      const [a, b, c] = [triVerts[t * 3], triVerts[t * 3 + 1], triVerts[t * 3 + 2]];
      const out: number[] = [];
      for (const [u, v] of [[a, b], [b, c], [c, a]] as const) for (const o of edges.get(ekey(u, v)) ?? []) if (o !== t) out.push(o);
      return out;
    };
    const reachable = new Set<number>();
    const stack: number[] = [];
    for (const s of samples) { const t = nearest(s); if (t >= 0 && !reachable.has(t)) { reachable.add(t); stack.push(t); } }
    while (stack.length) { for (const nb of nbrs(stack.pop()!)) if (!reachable.has(nb) && withinR(nb)) { reachable.add(nb); stack.push(nb); } }
    // Tied-nearest triangles (within fp epsilon): a query sitting exactly on a
    // shared edge/vertex is equidistant to several base triangles, so its
    // reachability is inherently boundary-ambiguous.
    const nearestTies = (p: number[]): number[] => {
      let best = Infinity;
      for (let t = 0; t < numTri; t++) { const v = d2(p, t); if (v < best) best = v; }
      const out: number[] = [];
      for (let t = 0; t < numTri; t++) if (d2(p, t) <= best + 1e-9) out.push(t);
      return out;
    };
    return {
      reachableAt: (p: number[]) => { const t = nearest(p); return t >= 0 && reachable.has(t); },
      reach: (t: number) => reachable.has(t),
      nearestTies,
    };
  }

  test('grid path matches the brute-force linear scan on a dense curved surface', () => {
    // 12×12 grid → 288 triangles, well over the 64-triangle grid threshold, so
    // reachableAt runs through the spatial grid rather than the linear scan.
    const base = planeGrid(12, 0, 0.4);
    expect(base.numTri).toBeGreaterThan(64);
    const samples: [number, number, number][] = [[3, 3, 0], [8, 7, 0]];
    const radius = 3;
    const field = buildGeodesicField(base, samples, radius);
    const ref = referenceField(base, samples, radius);

    let unique = 0, tied = 0;
    for (let x = -1; x <= 13; x += 0.7) {
      for (let y = -1; y <= 13; y += 0.7) {
        for (const z of [0, 0.3, -0.3, 1.5]) {
          const got = field.reachableAt(x, y, z);
          const ties = ref.nearestTies([x, y, z]);
          if (ties.length <= 1) {
            // Unique nearest → must be byte-identical to the linear scan.
            expect(got).toBe(ref.reachableAt([x, y, z]));
            unique++;
          } else {
            // Equidistant boundary point: any tied triangle is a valid pick, so
            // the answer must equal *some* tied triangle's reachability — proving
            // the grid never returns a wrong-distance triangle.
            expect(ties.some((t) => ref.reach(t) === got)).toBe(true);
            tied++;
          }
        }
      }
    }
    expect(unique).toBeGreaterThan(500); // the vast majority resolve uniquely
    expect(tied).toBeLessThan(unique / 10); // ties are the measure-zero exception
  });

  test('never reaches across a gap to a disconnected parallel sheet', () => {
    // Two sheets a Euclidean hair apart but sharing no vertices: geodesic must
    // gate by surface connectivity, so the far sheet stays unreachable even
    // though it is well within `radius`. (Proves the grid lookup still selects
    // the correct triangle — a wrong pick would leak paint across the gap.)
    const near = planeGrid(10, 0);
    const far = planeGrid(10, 0.5); // 0.5 units above — inside radius 4
    // Merge into one mesh with disjoint vertex index ranges (no shared edges).
    const merged: MeshData = {
      vertProperties: new Float32Array([...near.vertProperties, ...far.vertProperties]),
      triVerts: new Uint32Array([...near.triVerts, ...far.triVerts].map((v, i) => i < near.triVerts.length ? v : v + near.numVert)),
      numVert: near.numVert + far.numVert,
      numTri: near.numTri + far.numTri,
      numProp: 3,
    };
    const field = buildGeodesicField(merged, [[5, 5, 0]], 4);
    expect(field.reachableAt(5, 5, 0)).toBe(true);    // seed, near sheet
    expect(field.reachableAt(6, 5, 0)).toBe(true);    // near sheet, within radius
    expect(field.reachableAt(5, 5, 0.5)).toBe(false); // directly above, far sheet — gapped
    expect(field.reachableAt(6, 5, 0.5)).toBe(false); // far sheet, within radius but disconnected
  });

  // A floor quad in z=0 (x∈[0,1]) folded 90° into a wall in the x=1 plane
  // (z∈[0,1]), sharing the crease edge. Two shared-vertex quads → real edge
  // adjacency across a sharp fold. Floor normal +z, wall normal ±x ⇒ a 90° bend.
  function foldedStrip(): MeshData {
    const verts = [
      0, 0, 0, // 0
      0, 1, 0, // 1
      1, 0, 0, // 2 crease
      1, 1, 0, // 3 crease
      1, 0, 1, // 4 wall top
      1, 1, 1, // 5 wall top
    ];
    const tris = [
      0, 2, 3, 0, 3, 1, // floor (normal +z)
      2, 4, 5, 2, 5, 3, // wall  (normal -x) sharing edge 2-3
    ];
    return {
      vertProperties: new Float32Array(verts),
      triVerts: new Uint32Array(tris),
      numVert: 6,
      numTri: 4,
      numProp: 3,
    };
  }

  test('wrap tolerance gate stops the flood fill at a sharp (90°) fold', () => {
    const base = foldedStrip();
    const samples: [number, number, number][] = [[0.4, 0.5, 0]];
    const radius = 3; // covers the wall, so only the angle gate can block it

    // No gate (cos 180° = −1): paint reaches across the fold onto the wall.
    const open = buildGeodesicField(base, samples, radius, -1);
    expect(open.reachableAt(0.4, 0.5, 0)).toBe(true);  // floor seed
    expect(open.reachableAt(1, 0.5, 0.8)).toBe(true);  // wall, across the fold

    // 45° tolerance: the 90° fold (cos 0) exceeds it, so the wall is blocked
    // while the floor the seed sits on still paints.
    const gated = buildGeodesicField(base, samples, radius, wrapAngleGate(45));
    expect(gated.reachableAt(0.4, 0.5, 0)).toBe(true);
    expect(gated.reachableAt(1, 0.5, 0.8)).toBe(false);
  });

  test('wrap tolerance still flows over a gently curved (wrinkled) surface', () => {
    // A shallow wrinkle bends adjacent faces by only a few degrees, so a 60°
    // tolerance leaves the spread unchanged — curves and bumps still flow.
    const base = planeGrid(8, 0, 0.4);
    const samples: [number, number, number][] = [[4, 4, 0]];
    const radius = 3;
    const open = buildGeodesicField(base, samples, radius, -1);
    const gated = buildGeodesicField(base, samples, radius, wrapAngleGate(60));
    for (const [x, y] of [[4, 4], [6, 4], [4, 6], [3, 5]] as const) {
      expect(gated.reachableAt(x, y, 0)).toBe(open.reachableAt(x, y, 0));
    }
  });
});

describe('wrapAngleGate', () => {
  test('maps degrees to the cosine bend threshold', () => {
    expect(wrapAngleGate(180)).toBeCloseTo(-1, 10); // wrap freely
    expect(wrapAngleGate(90)).toBeCloseTo(0, 10);   // stop at right angles
    expect(wrapAngleGate(0)).toBeCloseTo(1, 10);    // coplanar only
  });
  test('clamps out-of-range angles', () => {
    expect(wrapAngleGate(-30)).toBeCloseTo(1, 10);
    expect(wrapAngleGate(360)).toBeCloseTo(-1, 10);
  });
});

describe('deriveSampleNormals', () => {
  // Shared-vertex wrinkled plane grid: (n+1)² verts, 2·n² tris, each with a
  // distinct orientation (the wrinkle tilts every triangle), so a wrong nearest
  // pick would surface as a wrong normal.
  function wrinkledGrid(n: number, wrinkle: number): MeshData {
    const side = n + 1;
    const verts: number[] = [];
    for (let j = 0; j < side; j++) {
      for (let i = 0; i < side; i++) {
        verts.push(i, j, wrinkle * Math.sin(i * 0.6) * Math.cos(j * 0.6));
      }
    }
    const tris: number[] = [];
    const vi = (i: number, j: number) => j * side + i;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        tris.push(vi(i, j), vi(i + 1, j), vi(i + 1, j + 1));
        tris.push(vi(i, j), vi(i + 1, j + 1), vi(i, j + 1));
      }
    }
    return {
      vertProperties: new Float32Array(verts),
      triVerts: new Uint32Array(tris),
      numVert: side * side, numTri: tris.length / 3, numProp: 3,
    };
  }

  /** The old brute-force algorithm: nearest triangle over the whole mesh
   *  (lowest index wins ties), then its geometric normal. */
  function brute(samples: [number, number, number][], base: MeshData): [number, number, number][] {
    const { triVerts, numTri } = base;
    const tv = (vi: number): [number, number, number] => [
      base.vertProperties[vi * 3], base.vertProperties[vi * 3 + 1], base.vertProperties[vi * 3 + 2],
    ];
    return samples.map((s) => {
      let best = Infinity; let bn: [number, number, number] = [0, 0, 1];
      for (let t = 0; t < numTri; t++) {
        const a = tv(triVerts[t * 3]), b = tv(triVerts[t * 3 + 1]), c = tv(triVerts[t * 3 + 2]);
        const cp = closestPointOnTriangle(s[0], s[1], s[2], a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
        const d2 = (cp[0] - s[0]) ** 2 + (cp[1] - s[1]) ** 2 + (cp[2] - s[2]) ** 2;
        if (d2 < best) {
          best = d2;
          const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
          const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
          const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
          const len = Math.hypot(nx, ny, nz) || 1;
          bn = [nx / len, ny / len, nz / len];
        }
      }
      return bn;
    });
  }

  test('grid result matches the brute-force scan for on-surface samples', () => {
    const base = wrinkledGrid(12, 0.5); // 288 tris
    const { triVerts } = base;
    const tv = (vi: number): [number, number, number] => [
      base.vertProperties[vi * 3], base.vertProperties[vi * 3 + 1], base.vertProperties[vi * 3 + 2],
    ];
    // Sample at every triangle centroid (unambiguously on that triangle).
    const samples: [number, number, number][] = [];
    for (let t = 0; t < base.numTri; t++) {
      const a = tv(triVerts[t * 3]), b = tv(triVerts[t * 3 + 1]), c = tv(triVerts[t * 3 + 2]);
      samples.push([(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3]);
    }
    const got = deriveSampleNormals(samples, base);
    const ref = brute(samples, base);
    expect(got.length).toBe(samples.length);
    for (let i = 0; i < samples.length; i++) {
      expect(got[i][0]).toBeCloseTo(ref[i][0], 6);
      expect(got[i][1]).toBeCloseTo(ref[i][1], 6);
      expect(got[i][2]).toBeCloseTo(ref[i][2], 6);
    }
  });

  test('matches brute force for slightly off-surface samples and falls back when far', () => {
    const base = wrinkledGrid(10, 0.4);
    // A near-surface point (nudged off a centroid) and a far one (well outside
    // the grid, exercising the full-scan fallback).
    const samples: [number, number, number][] = [
      [3.4, 4.7, 0.05], [7.1, 2.2, -0.1], [5.5, 5.5, 0.2], [100, 100, 100],
    ];
    const got = deriveSampleNormals(samples, base);
    const ref = brute(samples, base);
    for (let i = 0; i < samples.length; i++) {
      expect(got[i][0]).toBeCloseTo(ref[i][0], 6);
      expect(got[i][1]).toBeCloseTo(ref[i][1], 6);
      expect(got[i][2]).toBeCloseTo(ref[i][2], 6);
    }
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

/** Build a flat NxN coarse quad grid in the XY plane (big triangles), centered
 *  at the origin with cell size `S`. */
function flatGrid(N: number, S: number): MeshData {
  const verts: number[] = [], tris: number[] = [];
  const idx = (i: number, j: number) => i * (N + 1) + j;
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) verts.push(j * S - (N * S) / 2, i * S - (N * S) / 2, 0);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const a = idx(i, j), b = idx(i, j + 1), c = idx(i + 1, j), d = idx(i + 1, j + 1);
    tris.push(a, b, d, a, d, c);
  }
  return { vertProperties: new Float32Array(verts), triVerts: new Uint32Array(tris), numVert: verts.length / 3, numTri: tris.length / 3, numProp: 3 };
}

/** Longest edge and minimum altitude (sliver width) of a triangle. */
function triShape(m: MeshData, t: number): { longest: number; width: number } {
  const p = (v: number) => [m.vertProperties[v * 3], m.vertProperties[v * 3 + 1], m.vertProperties[v * 3 + 2]] as const;
  const A = p(m.triVerts[t * 3]), B = p(m.triVerts[t * 3 + 1]), C = p(m.triVerts[t * 3 + 2]);
  const sub = (u: readonly number[], v: readonly number[]) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
  const len = (u: number[]) => Math.hypot(u[0], u[1], u[2]);
  const cr = (u: number[], v: number[]) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const area = 0.5 * len(cr(sub(B, A), sub(C, A)));
  const longest = Math.max(len(sub(B, A)), len(sub(C, B)), len(sub(A, C)));
  return { longest, width: longest > 0 ? (2 * area) / longest : 0 };
}

describe('clipByField — no streak slivers when the boundary grazes a corner', () => {
  // Regression for the "downward streak" paint artifact: a straight painted edge
  // running nearly parallel to a chain of coarse mesh edges used to emit a long,
  // razor-thin sliver spanning each grazed triangle. The snap-to-vertex clip must
  // not produce any triangle that is both long (a meaningful fraction of a coarse
  // cell) and razor-thin.
  test('a square edge grazing a grid column produces no long thin slivers', () => {
    const mesh = flatGrid(20, 2.0);
    // Right edge of the square footprint lands at x ≈ 8.001, grazing the grid
    // column at x = 8 (cells span x ∈ {…, 8, 10, …}).
    const stroke: BrushStroke = { samples: [[-0.999, 0.0007, 0]], radius: 9.0, shape: 'square', maxEdge: 9.0 / 64 };
    const { mesh: out } = buildStrokeMesh(mesh, [stroke]);

    let longThinSlivers = 0;
    for (let t = 0; t < out.numTri; t++) {
      const { longest, width } = triShape(out, t);
      // A streak: spans a sizeable fraction of the 2-unit cell yet is hair-thin.
      if (longest > 0.5 && width < 0.02) longThinSlivers++;
    }
    expect(longThinSlivers).toBe(0);
  });

  test('the painted region is preserved (the clip still covers the footprint)', () => {
    const mesh = flatGrid(20, 2.0);
    const stroke: BrushStroke = { samples: [[-0.999, 0.0007, 0]], radius: 9.0, shape: 'square', maxEdge: 9.0 / 64 };
    const { mesh: out } = buildStrokeMesh(mesh, [stroke]);
    // Centroids well inside the footprint must still resolve as painted.
    const painted = strokeFootprintTriangles(out, stroke);
    expect(painted.size).toBeGreaterThan(0);
  });
});
