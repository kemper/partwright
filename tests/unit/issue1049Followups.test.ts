// Pure-logic coverage for the #1049 follow-ups: findFaces option validation,
// seam loops between parts, per-seed geodesic growth caps, seed landing
// checks, compare-sheet captions, the persisted paint-refine validator, and
// crack-free (conforming) smooth-paint refinement.

import { describe, expect, it } from 'vitest';
import type { MeshData } from '../../src/geometry/types';
import { findFacesKeyError } from '../../src/color/findFacesOptions';
import { partBoundaryLoops, resamplePolyline } from '../../src/color/partBoundary';
import { validPaintRefine } from '../../src/color/paintRefinePersist';
import { buildPatternContext, computePatternColors, patternRefineRegion, type ColorPatternSpec, type RGB } from '../../src/color/colorPattern';
import { buildRefinedMesh, buildStrokeMesh, type BrushStroke } from '../../src/color/subdivide';
import { computeMeshFeatures } from '../../src/segmentation/features';
import { geodesicBall, growFromSeeds } from '../../src/segmentation/growth';
import { creaseWatershedDetector, resolveSeeds } from '../../src/segmentation/detectors';
import { closestOnTriangle, seedLandings } from '../../src/segmentation/seedPreview';
import { compareCaptions, configDiffs } from '../../src/segmentation/compareCaptions';
import type { SegMesh } from '../../src/segmentation/types';

type V3 = [number, number, number];

/** Open tube (no caps) along +Z: `rings` rings of `segs` vertices. */
function tube(r: number, h: number, rings: number, segs: number): MeshData {
  const v: number[] = [];
  const t: number[] = [];
  for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) {
    const a = (2 * Math.PI * j) / segs;
    v.push(r * Math.cos(a), r * Math.sin(a), (h * i) / (rings - 1));
  }
  for (let i = 0; i < rings - 1; i++) for (let j = 0; j < segs; j++) {
    const a = i * segs + j, b = i * segs + ((j + 1) % segs), c = a + segs, d = b + segs;
    t.push(a, b, d, a, d, c);
  }
  return { vertProperties: new Float32Array(v), triVerts: new Uint32Array(t), numVert: v.length / 3, numTri: t.length / 3, numProp: 3 };
}

function centroidZ(m: MeshData, tri: number): number {
  let z = 0;
  for (let k = 0; k < 3; k++) z += m.vertProperties[m.triVerts[tri * 3 + k] * 3 + 2];
  return z / 3;
}

/** UV sphere (closed). */
function uvSphere(r: number, rings: number, segs: number): MeshData {
  const verts: number[] = [0, 0, r];
  const tris: number[] = [];
  for (let i = 1; i < rings; i++) {
    const th = (Math.PI * i) / rings;
    for (let j = 0; j < segs; j++) {
      const ph = (2 * Math.PI * j) / segs;
      verts.push(r * Math.sin(th) * Math.cos(ph), r * Math.sin(th) * Math.sin(ph), r * Math.cos(th));
    }
  }
  verts.push(0, 0, -r);
  const south = 1 + (rings - 1) * segs;
  const ring = (i: number, j: number): number => 1 + (i - 1) * segs + (j % segs);
  for (let j = 0; j < segs; j++) tris.push(0, ring(1, j), ring(1, j + 1));
  for (let i = 1; i < rings - 1; i++) for (let j = 0; j < segs; j++) {
    tris.push(ring(i, j), ring(i + 1, j), ring(i + 1, j + 1));
    tris.push(ring(i, j), ring(i + 1, j + 1), ring(i, j + 1));
  }
  for (let j = 0; j < segs; j++) tris.push(south, ring(rings - 1, j + 1), ring(rings - 1, j));
  return { vertProperties: new Float32Array(verts), triVerts: new Uint32Array(tris), numVert: verts.length / 3, numTri: tris.length / 3, numProp: 3 };
}

/** Edges used by other than exactly two triangles (a closed mesh has none;
 *  a T-junction shows up as such an edge). */
function openEdges(m: MeshData): number {
  const count = new Map<string, number>();
  for (let t = 0; t < m.numTri; t++) for (let k = 0; k < 3; k++) {
    const a = m.triVerts[t * 3 + k], b = m.triVerts[t * 3 + ((k + 1) % 3)];
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    count.set(key, (count.get(key) ?? 0) + 1);
  }
  let n = 0;
  for (const c of count.values()) if (c !== 2) n++;
  return n;
}

describe('findFaces option validation', () => {
  it('accepts omitted filters and real values', () => {
    expect(findFacesKeyError({})).toBeNull();
    expect(findFacesKeyError({ region: 3, maxResults: 10 })).toBeNull();
  });
  it('rejects an explicitly undefined or null filter instead of matching everything', () => {
    expect(findFacesKeyError({ region: undefined })).toMatch(/"region" was passed as undefined/);
    expect(findFacesKeyError({ box: null })).toMatch(/"box" was passed as null/);
  });
  it('rejects unknown keys', () => {
    expect(findFacesKeyError({ regoin: 2 })).toMatch(/unknown option "regoin"/);
  });
});

describe('partBoundaryLoops', () => {
  const m = tube(1, 4, 9, 24);
  const lower = new Set<number>(), upper = new Set<number>();
  for (let t = 0; t < m.numTri; t++) (centroidZ(m, t) < 2 ? lower : upper).add(t);

  it('finds one closed loop round a tube split at mid-height', () => {
    const loops = partBoundaryLoops(m, lower, upper);
    expect(loops).toHaveLength(1);
    expect(loops[0].closed).toBe(true);
    expect(loops[0].points).toHaveLength(24);
    for (const p of loops[0].points) expect(p[2]).toBeCloseTo(2, 5);
    // Circumference of the 24-gon inscribed in a unit circle.
    expect(loops[0].length).toBeCloseTo(24 * 2 * Math.sin(Math.PI / 24), 4);
  });

  it('orders the points along the seam (consecutive points are neighbours)', () => {
    const [loop] = partBoundaryLoops(m, lower, upper);
    const step = 2 * Math.sin(Math.PI / 24);
    for (let i = 0; i < loop.points.length; i++) {
      const a = loop.points[i], b = loop.points[(i + 1) % loop.points.length];
      expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeCloseTo(step, 4);
    }
  });

  it('returns an open chain when a third part interrupts the seam', () => {
    const third = new Set<number>();
    const lo = new Set<number>(), up = new Set<number>();
    for (let t = 0; t < m.numTri; t++) {
      const c = [0, 1, 2].map((k) => m.vertProperties[m.triVerts[t * 3 + k] * 3]);
      if (Math.min(...c) > 0.7) third.add(t);
      else (centroidZ(m, t) < 2 ? lo : up).add(t);
    }
    const loops = partBoundaryLoops(m, lo, up);
    expect(loops.length).toBeGreaterThanOrEqual(1);
    expect(loops[0].closed).toBe(false);
  });

  it('is empty when the parts do not touch', () => {
    const bottom = new Set([...lower].filter((t) => centroidZ(m, t) < 1));
    expect(partBoundaryLoops(m, bottom, upper)).toEqual([]);
  });

  it('matches vertices by position (split vertex soups still chain)', () => {
    // Un-index the tube: every triangle gets its own three vertices.
    const vp: number[] = [];
    for (let t = 0; t < m.numTri; t++) for (let k = 0; k < 3; k++) {
      const v = m.triVerts[t * 3 + k];
      vp.push(m.vertProperties[v * 3], m.vertProperties[v * 3 + 1], m.vertProperties[v * 3 + 2]);
    }
    const soup: MeshData = { vertProperties: new Float32Array(vp), triVerts: Uint32Array.from({ length: m.numTri * 3 }, (_, i) => i), numVert: m.numTri * 3, numTri: m.numTri, numProp: 3 };
    const loops = partBoundaryLoops(soup, lower, upper);
    expect(loops).toHaveLength(1);
    expect(loops[0].closed).toBe(true);
  });
});

describe('resamplePolyline', () => {
  it('spaces points evenly and closes a closed loop', () => {
    const sq: V3[] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]];
    const out = resamplePolyline(sq, true, 0.25);
    expect(out[0]).toEqual([0, 0, 0]);
    expect(out[out.length - 1]).toEqual([0, 0, 0]);
    expect(out).toHaveLength(17);
    for (let i = 1; i < out.length; i++) {
      const a = out[i - 1], b = out[i];
      expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeCloseTo(0.25, 6);
    }
  });
  it('keeps both ends of an open chain', () => {
    const out = resamplePolyline([[0, 0, 0], [1, 0, 0]], false, 0.3);
    expect(out[0]).toEqual([0, 0, 0]);
    expect(out[out.length - 1]).toEqual([1, 0, 0]);
  });
});

/** Flat strip [0, 4] × [0, 1] (no grooves anywhere). */
function strip(): SegMesh {
  const NX = 41, NY = 11;
  const positions = new Float32Array(NX * NY * 3);
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) positions.set([(4 * i) / (NX - 1), j / (NY - 1), 0], (j * NX + i) * 3);
  const tris: number[] = [];
  for (let j = 0; j < NY - 1; j++) for (let i = 0; i < NX - 1; i++) {
    const a = j * NX + i, b = a + 1, c = a + NX, d = c + 1;
    tris.push(a, b, d, a, d, c);
  }
  return { positions, triVerts: Uint32Array.from(tris) };
}

function centroidX(m: SegMesh, t: number): number {
  return (m.positions[m.triVerts[t * 3] * 3] + m.positions[m.triVerts[t * 3 + 1] * 3] + m.positions[m.triVerts[t * 3 + 2] * 3]) / 3;
}

describe('per-seed geodesic radius cap', () => {
  const m = strip();
  const f = computeMeshFeatures(m);

  it('geodesicBall covers exactly the triangles within reach', () => {
    const start = resolveSeeds(f, [{ label: 'a', point: [0.05, 0.5, 0] }]).seedTris[0];
    const ball = geodesicBall(f, start, 1);
    // Centroid-to-centroid paths zig-zag over the triangulation, so allow
    // ~40% detour: everything within 0.6 is in, nothing beyond 1.05 is.
    const sx = f.triCentroid[start * 3], sy = f.triCentroid[start * 3 + 1];
    for (let t = 0; t < f.triCount; t++) {
      const d = Math.hypot(f.triCentroid[t * 3] - sx, f.triCentroid[t * 3 + 1] - sy);
      if (d < 0.6) expect(ball[t]).toBe(1);
      if (d > 1.05) expect(ball[t]).toBe(0);
    }
  });

  it('an uncapped seed floods the ungrooved strip; a capped one stops at its radius', () => {
    const seeds = [{ label: 'collar', point: [0.05, 0.5, 0] as V3 }, { label: 'shirt', point: [3.95, 0.5, 0] as V3 }];
    const free = creaseWatershedDetector.run(m, f, { params: { growth: 'summed', creaseQuantumDeg: 5, creaseWeight: 1 }, seeds });
    let freeCollar = 0;
    for (let t = 0; t < f.triCount; t++) if (free.triPart[t] === 0) freeCollar++;
    expect(freeCollar / f.triCount).toBeGreaterThan(0.4); // half the strip: nothing stops it

    const capped = creaseWatershedDetector.run(m, f, { params: { growth: 'summed', creaseQuantumDeg: 5, creaseWeight: 1 }, seeds: [{ ...seeds[0], maxRadius: 0.5 }, seeds[1]] });
    for (let t = 0; t < f.triCount; t++) {
      if (capped.triPart[t] === 0) expect(centroidX(m, t)).toBeLessThan(0.6);
    }
    // What the capped seed could not reach went to the other seed.
    let shirt = 0;
    for (let t = 0; t < f.triCount; t++) if (capped.triPart[t] === 1) shirt++;
    expect(shirt / f.triCount).toBeGreaterThan(0.8);
  });

  it('growFromSeeds honours seedMaxRadius per seed index', () => {
    const { seedTris, seedLabels } = resolveSeeds(f, [{ label: 'a', point: [2, 0.5, 0] }]);
    const g = growFromSeeds(f, seedTris, seedLabels, { growth: 'summed', creaseQuantumDeg: 5, creaseWeight: 1, seedMaxRadius: [0.3] });
    let claimed = 0;
    for (let t = 0; t < f.triCount; t++) if (g.triLabel[t] === 0) { claimed++; expect(Math.abs(centroidX(m, t) - 2)).toBeLessThan(0.4); }
    expect(claimed).toBeGreaterThan(0);
    expect(claimed).toBeLessThan(f.triCount / 4);
  });
});

describe('seed landings (previewSeeds)', () => {
  it('closestOnTriangle clamps to the triangle', () => {
    const q = closestOnTriangle([0.2, 0.2, 5], [0, 0, 0], [1, 0, 0], [0, 1, 0]);
    expect(q[0]).toBeCloseTo(0.2); expect(q[1]).toBeCloseTo(0.2); expect(q[2]).toBeCloseTo(0);
    expect(closestOnTriangle([-1, -1, 0], [0, 0, 0], [1, 0, 0], [0, 1, 0])).toEqual([0, 0, 0]);
    const e = closestOnTriangle([1, 1, 0], [0, 0, 0], [1, 0, 0], [0, 1, 0]);
    expect(e[0]).toBeCloseTo(0.5); expect(e[1]).toBeCloseTo(0.5);
  });
  it('reports the landing triangle, surface point and distance', () => {
    const m = strip();
    const [on, off] = seedLandings(m.positions, m.triVerts, [[1.01, 0.52, 0], [1, 0.5, 0.8]]);
    expect(on.distance).toBeLessThan(1e-6);
    expect(on.triangle).toBeGreaterThanOrEqual(0);
    expect(off.distance).toBeCloseTo(0.8, 5);
    expect(off.point[2]).toBeCloseTo(0, 6);
    expect(Math.abs(off.normal[2])).toBeCloseTo(1, 6);
  });
});

describe('comparePartDetectors captions', () => {
  const defaults = (id: string) => (id === 'crease-watershed' ? { growth: 'hybrid', creaseQuantumDeg: 5, creaseWeight: 1 } : {});
  it('lists the params that differ between variants of one detector', () => {
    const caps = compareCaptions([
      { detectorId: 'crease-watershed', params: { growth: 'hybrid', creaseQuantumDeg: 5, creaseWeight: 1 } },
      { detectorId: 'crease-watershed', params: { growth: 'summed', creaseQuantumDeg: 5, creaseWeight: 4 } },
      { detectorId: 'pieces', params: {} },
    ], defaults);
    expect(caps[0]).toBe('1. crease-watershed · creaseWeight=1 growth=hybrid');
    expect(caps[1]).toBe('2. crease-watershed · creaseWeight=4 growth=summed');
    expect(caps[2]).toBe('3. pieces');
  });
  it('a lone detector lists what it changed from its defaults, incl. feature options', () => {
    const d = configDiffs([{ detectorId: 'crease-watershed', params: { growth: 'hybrid', creaseQuantumDeg: 12, creaseWeight: 1 }, featureOptions: { normalSmoothEdgeLengths: 3 } }], defaults);
    expect(d[0]).toBe('creaseQuantumDeg=12 normalSmoothEdgeLengths=3');
  });
});

describe('persisted paint refine validation', () => {
  const ok = {
    key: 'r1-x',
    mesh: { vertProperties: new Float32Array(9), triVerts: Uint32Array.from([0, 1, 2]), numVert: 3, numTri: 1, numProp: 3 },
    toRoot: Int32Array.from([0]),
  };
  it('accepts a well-formed refine over a base with enough triangles', () => {
    expect(validPaintRefine(ok, 1)).toBe(true);
  });
  it('rejects mismatched sizes, out-of-range roots and bad indices', () => {
    expect(validPaintRefine({ ...ok, toRoot: Int32Array.from([0, 0]) }, 1)).toBe(false);
    expect(validPaintRefine({ ...ok, toRoot: Int32Array.from([5]) }, 1)).toBe(false);
    expect(validPaintRefine({ ...ok, mesh: { ...ok.mesh, triVerts: Uint32Array.from([0, 1, 7]) } }, 1)).toBe(false);
    expect(validPaintRefine({ key: 1 }, 1)).toBe(false);
    expect(validPaintRefine(null, 1)).toBe(false);
  });
});

describe('smooth-paint refinement is crack-free (no T-junctions)', () => {
  const WHITE: RGB = [1, 1, 1];
  const BLACK: RGB = [0.07, 0.07, 0.07];

  it('a smooth soccer pattern on a closed sphere stays closed (every edge shared by exactly two triangles)', () => {
    const m = uvSphere(10, 32, 64);
    expect(openEdges(m)).toBe(0);
    const spec: ColorPatternSpec = { pattern: 'soccer', colors: [WHITE, BLACK] };
    const all = Array.from({ length: m.numTri }, (_, i) => i);
    const ctx = buildPatternContext(m, all, spec, true);
    const { mesh } = buildRefinedMesh(m, [patternRefineRegion(spec, ctx, ctx.sphere!.radius / 100)!]);
    expect(mesh.numTri).toBeGreaterThan(m.numTri);
    // Before the fix: thousands of open edges (T-junctions where the fine
    // band met coarse triangles, and crossings dropped with collapsed
    // slivers) — they rasterized as 1–2 px specks around the panel corners.
    expect(openEdges(mesh)).toBe(0);
    // Colours still follow the seam exactly.
    const colors = computePatternColors(mesh, Array.from({ length: mesh.numTri }, (_, i) => i), spec, ctx);
    expect(colors.size).toBe(mesh.numTri);
  });

  it('a smooth brush stroke on a closed sphere stays closed', () => {
    const m = uvSphere(10, 24, 48);
    const stroke: BrushStroke = { samples: [[10, 0, 0], [7.07, 7.07, 0]], radius: 2, shape: 'circle', maxEdge: 2 / 16 };
    const { mesh } = buildStrokeMesh(m, [stroke]);
    expect(mesh.numTri).toBeGreaterThan(m.numTri);
    expect(openEdges(mesh)).toBe(0);
  });
});
