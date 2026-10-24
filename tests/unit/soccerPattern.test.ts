// Soccer-ball colour pattern (`pattern: 'soccer'`) + smooth pattern clipping.
//
// Pure-logic: the field, the sphere fit, and the refine/clip pipeline all run
// headlessly (no browser / WASM), the same code the subdivision Worker runs.

import { describe, it, expect } from 'vitest';
import type { MeshData } from '../../src/geometry/types';
import {
  buildPatternContext,
  computePatternColors,
  fitSphere,
  patternField,
  patternRefineRegion,
  soccerField,
  soccerGeometry,
  type ColorPatternSpec,
  type RGB,
} from '../../src/color/colorPattern';
import { buildRefinedMesh } from '../../src/color/subdivide';
import { collectRefineRegions, descriptorRefines } from '../../src/color/refinePipeline';
import type { RegionDescriptor } from '../../src/color/regions';

type V3 = [number, number, number];
const WHITE: RGB = [1, 1, 1];
const BLACK: RGB = [0.07, 0.07, 0.07];
const PHI = (1 + Math.sqrt(5)) / 2;

const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** UV sphere (lat/long) — deliberately NOT icosahedral, so panel seams cut
 *  across the tessellation the way they do on a real scanned ball. */
function uvSphere(center: V3, r: number, rings = 24, segs = 48, zMin = -Infinity): MeshData {
  const verts: number[] = [];
  const tris: number[] = [];
  verts.push(center[0], center[1], center[2] + r); // north pole
  for (let i = 1; i < rings; i++) {
    const th = (Math.PI * i) / rings;
    for (let j = 0; j < segs; j++) {
      const ph = (2 * Math.PI * j) / segs;
      verts.push(center[0] + r * Math.sin(th) * Math.cos(ph), center[1] + r * Math.sin(th) * Math.sin(ph), center[2] + r * Math.cos(th));
    }
  }
  verts.push(center[0], center[1], center[2] - r); // south pole
  const south = 1 + (rings - 1) * segs;
  const ring = (i: number, j: number): number => 1 + (i - 1) * segs + (j % segs);
  for (let j = 0; j < segs; j++) tris.push(0, ring(1, j), ring(1, j + 1));
  for (let i = 1; i < rings - 1; i++) {
    for (let j = 0; j < segs; j++) {
      tris.push(ring(i, j), ring(i + 1, j), ring(i + 1, j + 1));
      tris.push(ring(i, j), ring(i + 1, j + 1), ring(i, j + 1));
    }
  }
  for (let j = 0; j < segs; j++) tris.push(south, ring(rings - 1, j + 1), ring(rings - 1, j));
  // Optionally drop triangles below zMin (a ball cut flat where it sits).
  const kept: number[] = [];
  for (let t = 0; t < tris.length / 3; t++) {
    const zc = (verts[tris[t * 3] * 3 + 2] + verts[tris[t * 3 + 1] * 3 + 2] + verts[tris[t * 3 + 2] * 3 + 2]) / 3;
    if (zc >= zMin) kept.push(tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2]);
  }
  return {
    vertProperties: new Float32Array(verts),
    triVerts: new Uint32Array(kept),
    numVert: verts.length / 3,
    numTri: kept.length / 3,
    numProp: 3,
  };
}

const allTris = (m: MeshData): number[] => Array.from({ length: m.numTri }, (_, i) => i);

function triArea(m: MeshData, t: number): number {
  const P = m.numProp, vp = m.vertProperties;
  const a = m.triVerts[t * 3] * P, b = m.triVerts[t * 3 + 1] * P, c = m.triVerts[t * 3 + 2] * P;
  const e1: V3 = [vp[b] - vp[a], vp[b + 1] - vp[a + 1], vp[b + 2] - vp[a + 2]];
  const e2: V3 = [vp[c] - vp[a], vp[c + 1] - vp[a + 1], vp[c + 2] - vp[a + 2]];
  const n = cross(e1, e2);
  return 0.5 * Math.hypot(n[0], n[1], n[2]);
}

/** Black area fraction of a standard truncated-icosahedron ball, derived
 *  independently of the implementation: 12 regular spherical pentagons whose
 *  corners are the icosahedron edges cut at 1/3, area = Σ angles − 3π. */
function analyticPentagonFraction(): number {
  const ico: V3[] = [];
  for (const s1 of [1, -1]) for (const s2 of [1, -1]) {
    ico.push(norm([0, s1, s2 * PHI]), norm([s1, s2 * PHI, 0]), norm([s2 * PHI, 0, s1]));
  }
  const v = ico[0];
  const nbrs = ico.filter((u) => u !== v && Math.abs(dot(u, v) - 1 / Math.sqrt(5)) < 1e-9);
  const tu = norm(cross(cross(v, nbrs[0]), v));
  const tw = cross(v, tu);
  nbrs.sort((p, q) => Math.atan2(dot(p, tw), dot(p, tu)) - Math.atan2(dot(q, tw), dot(q, tu)));
  const q = nbrs.map((u) => norm([v[0] + (u[0] - v[0]) / 3, v[1] + (u[1] - v[1]) / 3, v[2] + (u[2] - v[2]) / 3]));
  // Interior angle at a corner = angle between the tangents of its two arcs.
  let angles = 0;
  for (let j = 0; j < 5; j++) {
    const p = q[j], prev = q[(j + 4) % 5], next = q[(j + 1) % 5];
    const t1 = norm(cross(cross(p, prev), p));
    const t2 = norm(cross(cross(p, next), p));
    angles += Math.acos(Math.max(-1, Math.min(1, dot(t1, t2))));
  }
  const area = angles - 3 * Math.PI;
  return (12 * area) / (4 * Math.PI);
}

/** Fibonacci-lattice estimate of the fraction of the unit sphere where `f ≤ 0`. */
function sampledFraction(f: (x: number, y: number, z: number) => number, n = 200_000): number {
  let inside = 0;
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const z = 1 - (2 * i + 1) / n;
    const r = Math.sqrt(1 - z * z);
    if (f(r * Math.cos(i * ga), r * Math.sin(i * ga), z) <= 0) inside++;
  }
  return inside / n;
}

describe('soccer field', () => {
  const g = soccerGeometry({ center: [0, 0, 0], radius: 1 });
  const f = soccerField(g);

  it('has 12 pentagon centres, mutually at icosahedron angles', () => {
    expect(g.centers).toHaveLength(12);
    for (let i = 0; i < 12; i++) {
      expect(Math.hypot(...g.centers[i])).toBeCloseTo(1, 9);
      let neighbours = 0;
      for (let j = 0; j < 12; j++) {
        if (i === j) continue;
        const c = dot(g.centers[i], g.centers[j]);
        if (Math.abs(c - 1 / Math.sqrt(5)) < 1e-9) neighbours++;
        expect(c).toBeLessThan(1 / Math.sqrt(5) + 1e-9); // no two closer than an icosahedron edge
      }
      expect(neighbours).toBe(5);
    }
  });

  it('is negative (black) at every pentagon centre and positive (white) at every hexagon centre', () => {
    for (const c of g.centers) expect(f(...c)).toBeLessThan(-0.2);
    // Hexagon centres = icosahedron FACE centres: the normalized sum of each
    // triple of mutually-adjacent pentagon centres. There must be exactly 20.
    const hex: V3[] = [];
    const adj = (a: V3, b: V3): boolean => Math.abs(dot(a, b) - 1 / Math.sqrt(5)) < 1e-9;
    for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) for (let k = j + 1; k < 12; k++) {
      const [a, b, c] = [g.centers[i], g.centers[j], g.centers[k]];
      if (adj(a, b) && adj(b, c) && adj(a, c)) hex.push(norm([a[0] + b[0] + c[0], a[1] + b[1] + c[1], a[2] + b[2] + c[2]]));
    }
    expect(hex).toHaveLength(20);
    for (const h of hex) expect(f(...h)).toBeGreaterThan(0.2);
  });

  it('covers the standard truncated-icosahedron black fraction (~28.3%)', () => {
    const expected = analyticPentagonFraction();
    expect(expected).toBeGreaterThan(0.27);
    expect(expected).toBeLessThan(0.29);
    expect(sampledFraction(f)).toBeCloseTo(expected, 2);
  });

  it('yields exactly 12 separate black panels', () => {
    // Every black sample is closest to one pentagon centre, and every centre
    // gets black samples — 12 panels, none merged, none missing.
    const hits = new Array(12).fill(0);
    const ga = Math.PI * (3 - Math.sqrt(5));
    const n = 20_000;
    for (let i = 0; i < n; i++) {
      const z = 1 - (2 * i + 1) / n, r = Math.sqrt(1 - z * z);
      const p: V3 = [r * Math.cos(i * ga), r * Math.sin(i * ga), z];
      if (f(...p) > 0) continue;
      let best = 0;
      for (let k = 1; k < 12; k++) if (dot(p, g.centers[k]) > dot(p, g.centers[best])) best = k;
      // inside ⇒ well within that pentagon's cone (closer to its centre than an edge)
      expect(dot(p, g.centers[best])).toBeGreaterThan(Math.cos(0.4));
      hits[best]++;
    }
    for (const h of hits) expect(h).toBeGreaterThan(0);
  });

  it('defaults a pentagon to face +X; anchors[0] re-aims it', () => {
    expect(f(1, 0, 0)).toBeLessThan(-0.2);
    const aimed = soccerField(soccerGeometry({ center: [5, 5, 5], radius: 2 }, [[5, 5, 9]]));
    expect(aimed(5, 5, 7)).toBeLessThan(-0.2); // pentagon centred at +Z of the ball
  });

  it('coverage scales the panels', () => {
    const small = sampledFraction(soccerField(soccerGeometry({ center: [0, 0, 0], radius: 1 }, undefined, 0.6)), 50_000);
    expect(small).toBeLessThan(analyticPentagonFraction() * 0.5);
  });
});

describe('fitSphere', () => {
  it('recovers a full sphere', () => {
    const s = fitSphere(uvSphere([146.8, 119.9, 42.3], 10.3), allTris(uvSphere([146.8, 119.9, 42.3], 10.3)))!;
    expect(s.center[0]).toBeCloseTo(146.8, 1);
    expect(s.center[1]).toBeCloseTo(119.9, 1);
    expect(s.center[2]).toBeCloseTo(42.3, 1);
    expect(s.radius).toBeGreaterThan(10.1);
    expect(s.radius).toBeLessThan(10.4);
  });

  it('recovers a PARTIAL sphere (cut flat at the bottom) where a centroid fit would drift', () => {
    const m = uvSphere([0, 0, 0], 5, 24, 48, -1);
    const s = fitSphere(m, allTris(m))!;
    expect(Math.hypot(...s.center)).toBeLessThan(0.15);
    expect(s.radius).toBeCloseTo(5, 0);
  });
});

describe('soccer colours (whole-triangle)', () => {
  it('assigns base/mark per triangle with ~28% of the area black', () => {
    const m = uvSphere([0, 0, 0], 10, 48, 96);
    const colors = computePatternColors(m, allTris(m), { pattern: 'soccer', colors: [WHITE, BLACK] });
    let black = 0, total = 0;
    for (const [t, c] of colors) {
      const a = triArea(m, t);
      total += a;
      if (c === BLACK) black += a;
    }
    expect(black / total).toBeGreaterThan(0.25);
    expect(black / total).toBeLessThan(0.31);
  });
});

describe('smooth pattern clipping', () => {
  const spec: ColorPatternSpec = { pattern: 'soccer', colors: [WHITE, BLACK] };

  it('splits boundary triangles and matches the analytic panel area within a few %', () => {
    const m = uvSphere([0, 0, 0], 10, 16, 32); // coarse: seams cut through big triangles
    const ctx = buildPatternContext(m, allTris(m), spec, true);
    const region = patternRefineRegion(spec, ctx, ctx.sphere!.radius / 100)!;
    expect(region).not.toBeNull();
    const { mesh, childToParent } = buildRefinedMesh(m, [region]);
    expect(mesh.numTri).toBeGreaterThan(m.numTri);
    expect(childToParent.length).toBe(mesh.numTri);

    const colors = computePatternColors(mesh, allTris(mesh), spec, ctx);
    let black = 0, total = 0;
    for (const [t, c] of colors) {
      const a = triArea(mesh, t);
      total += a;
      if (c === BLACK) black += a;
    }
    const expected = analyticPentagonFraction();
    // Polyhedral sphere: allow 1% for the faceting — a staircase edge would not get close.
    expect(Math.abs(black / total - expected) / expected).toBeLessThan(0.01);

    // Crispness: no output triangle straddles the seam (all corners on one side,
    // up to the clip's snap tolerance).
    const f = patternField(spec, ctx)!;
    const P = mesh.numProp, vp = mesh.vertProperties;
    let straddles = 0;
    for (let t = 0; t < mesh.numTri; t++) {
      let neg = 0, pos = 0;
      for (let k = 0; k < 3; k++) {
        const v = mesh.triVerts[t * 3 + k] * P;
        const fv = f(vp[v], vp[v + 1], vp[v + 2]);
        if (fv < -0.05) neg++; else if (fv > 0.05) pos++;
      }
      if (neg > 0 && pos > 0) straddles++;
    }
    expect(straddles).toBe(0);

    // Every triangle's colour agrees with its corners' side of the seam —
    // except sub-maxEdge slivers right at a panel corner (the documented
    // resolution limit), never a full-size triangle.
    const maxEdge = ctx.sphere!.radius / 100;
    for (let t = 0; t < mesh.numTri; t++) {
      const fs: number[] = [];
      const pts: V3[] = [];
      for (let k = 0; k < 3; k++) {
        const v = mesh.triVerts[t * 3 + k] * P;
        pts.push([vp[v], vp[v + 1], vp[v + 2]]);
        fs.push(f(vp[v], vp[v + 1], vp[v + 2]));
      }
      const isBlack = colors.get(t) === BLACK;
      const wrong = (isBlack && Math.min(...fs) > 1e-4) || (!isBlack && Math.max(...fs) < -1e-4);
      if (!wrong) continue;
      const e = Math.max(...[0, 1, 2].map((k) => Math.hypot(...([0, 1, 2].map((ax) => pts[k][ax] - pts[(k + 1) % 3][ax])) as V3)));
      expect(e).toBeLessThanOrEqual(maxEdge * 1.01);
    }
  });

  it('the allow mask confines refinement to the scope', () => {
    // Two balls side by side; only the first is in scope.
    const a = uvSphere([0, 0, 0], 10, 16, 32);
    const b = uvSphere([15, 0, 0], 10, 16, 32); // overlaps a's pentagon cones
    const merged: MeshData = {
      vertProperties: new Float32Array([...a.vertProperties, ...b.vertProperties]),
      triVerts: new Uint32Array([...a.triVerts, ...Array.from(b.triVerts, (v) => v + a.numVert)]),
      numVert: a.numVert + b.numVert,
      numTri: a.numTri + b.numTri,
      numProp: 3,
    };
    const scope = allTris(a); // ids 0..a.numTri-1
    const ctx = buildPatternContext(merged, scope, spec, true);
    expect(ctx.sphere!.radius).toBeCloseTo(10, 0);
    const { mesh, childToParent } = buildRefinedMesh(merged, [patternRefineRegion(spec, ctx, 0.1)!]);
    expect(mesh.numTri).toBeGreaterThan(merged.numTri);
    // Every triangle of ball b survives untouched: exactly one child each.
    const childCount = new Map<number, number>();
    for (const p of childToParent) childCount.set(p, (childCount.get(p) ?? 0) + 1);
    for (let t = a.numTri; t < merged.numTri; t++) expect(childCount.get(t)).toBe(1);
  });

  it('stripes and checker clip too; spots does not refine', () => {
    const m = uvSphere([0, 0, 0], 10, 16, 32);
    for (const pattern of ['stripes', 'checker'] as const) {
      const s: ColorPatternSpec = { pattern, colors: [WHITE, BLACK], scale: 4, warp: 0 };
      const ctx = buildPatternContext(m, allTris(m), s, true);
      const region = patternRefineRegion(s, ctx, 0.5)!;
      expect(region).not.toBeNull();
      expect(buildRefinedMesh(m, [region]).mesh.numTri).toBeGreaterThan(m.numTri);
    }
    const ctx = buildPatternContext(m, allTris(m), { pattern: 'spots', colors: [WHITE, BLACK] }, true);
    expect(patternRefineRegion({ pattern: 'spots', colors: [WHITE, BLACK] }, ctx, 0.5)).toBeNull();
  });
});

describe('refine pipeline wiring', () => {
  const base: RegionDescriptor = { kind: 'pattern', pattern: 'soccer', colors: [WHITE, BLACK] };

  it('descriptorRefines: only smooth + maxEdge + a smooth-capable kind', () => {
    expect(descriptorRefines(base)).toBe(false);
    expect(descriptorRefines({ ...base, smooth: true })).toBe(false);
    expect(descriptorRefines({ ...base, smooth: true, maxEdge: 0.1 })).toBe(true);
    expect(descriptorRefines({ ...base, pattern: 'spots', smooth: true, maxEdge: 0.1 })).toBe(false);
  });

  it('collectRefineRegions builds a pattern region only with a context provider', () => {
    const m = uvSphere([0, 0, 0], 10, 16, 32);
    const d: RegionDescriptor = { ...base, smooth: true, maxEdge: 0.1 };
    expect(collectRefineRegions([d], m)).toHaveLength(0);
    const ctx = buildPatternContext(m, allTris(m), d as ColorPatternSpec, true);
    const regions = collectRefineRegions([d], m, undefined, () => ctx);
    expect(regions).toHaveLength(1);
    expect(regions[0].field).toBeTypeOf('function');
  });

  it('cylinder refine regions honour the descriptor axis (shared with main.ts)', () => {
    const m = uvSphere([0, 0, 0], 10, 16, 32);
    const mk = (axis: 'x' | 'z'): RegionDescriptor => ({ kind: 'cylinder', center: [0, 0], rMin: 0, rMax: 4, zMin: -20, zMax: 20, axis, smooth: true, maxEdge: 0.5 });
    const rx = buildRefinedMesh(m, collectRefineRegions([mk('x')], m)).mesh;
    const rz = buildRefinedMesh(m, collectRefineRegions([mk('z')], m)).mesh;
    // An x-axis tube and a z-axis tube cut the UV sphere along different rims.
    expect(rx.numTri).not.toBe(rz.numTri);
  });
});
