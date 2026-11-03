// Brush alignment (surface / area / view), front-faces-only and the sphere
// volume: how a brushStroke descriptor's options shape its painted footprint.

import { describe, expect, test } from 'vitest';
import { buildBrushStrokeFromDescriptor } from '../../src/color/refinePipeline';
import { brushRefineRegion, buildRefinedMesh, deriveAreaNormals, deriveSampleNormals, strokeFootprintTriangles, viewDirsForSamples } from '../../src/color/subdivide';
import type { MeshData } from '../../src/geometry/types';
import type { RegionDescriptor } from '../../src/color/regions';

type Stroke = Extract<RegionDescriptor, { kind: 'brushStroke' }>;
type V3 = [number, number, number];

/** Closed box [-h, h]² × [z0, z1], every face gridded into `step`-sized quads,
 *  wound outward. `bump(x, y)` lifts top-face vertices. */
function plateBox(h: number, z0: number, z1: number, step: number, bump: (x: number, y: number) => number = () => 0): MeshData {
  const verts: number[] = [];
  const tris: number[] = [];
  const index = new Map<string, number>();
  const vid = (x: number, y: number, z: number): number => {
    const k = `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`;
    let i = index.get(k);
    if (i === undefined) { i = verts.length / 3; index.set(k, i); verts.push(x, y, z); }
    return i;
  };
  const P = (i: number): V3 => [verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]];
  const quad = (a: number, b: number, c: number, d: number, n: V3): void => {
    const pa = P(a), pb = P(b), pc = P(c);
    const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], v = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    const cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    if (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] < 0) tris.push(a, c, b, a, d, c); else tris.push(a, b, c, a, c, d);
  };
  const n = Math.round((2 * h) / step);
  const c = (i: number): number => -h + i * step;
  const top = (x: number, y: number): number => vid(x, y, z1 + (Math.abs(x) < h && Math.abs(y) < h ? bump(x, y) : 0));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    quad(top(c(i), c(j)), top(c(i + 1), c(j)), top(c(i + 1), c(j + 1)), top(c(i), c(j + 1)), [0, 0, 1]);
    quad(vid(c(i), c(j), z0), vid(c(i + 1), c(j), z0), vid(c(i + 1), c(j + 1), z0), vid(c(i), c(j + 1), z0), [0, 0, -1]);
  }
  for (let i = 0; i < n; i++) {
    quad(vid(c(i), -h, z0), vid(c(i + 1), -h, z0), top(c(i + 1), -h), top(c(i), -h), [0, -1, 0]);
    quad(vid(c(i), h, z0), vid(c(i + 1), h, z0), top(c(i + 1), h), top(c(i), h), [0, 1, 0]);
    quad(vid(-h, c(i), z0), vid(-h, c(i + 1), z0), top(-h, c(i + 1)), top(-h, c(i)), [-1, 0, 0]);
    quad(vid(h, c(i), z0), vid(h, c(i + 1), z0), top(h, c(i + 1)), top(h, c(i)), [1, 0, 0]);
  }
  return { vertProperties: new Float32Array(verts), triVerts: new Uint32Array(tris), numVert: verts.length / 3, numTri: tris.length / 3, numProp: 3 };
}

function centroid(m: MeshData, t: number): V3 {
  const out: V3 = [0, 0, 0];
  for (let k = 0; k < 3; k++) for (let a = 0; a < 3; a++) out[a] += m.vertProperties[m.triVerts[t * 3 + k] * m.numProp + a] / 3;
  return out;
}

const stroke = (extra: Partial<Stroke>): Stroke => ({
  kind: 'brushStroke', samples: [[0, 0, 0.5]], radius: 2, shape: 'circle', maxEdge: 0.1, ...extra,
});

function paint(m: MeshData, d: Stroke): V3[] {
  return [...strokeFootprintTriangles(m, buildBrushStrokeFromDescriptor(d, m))].map(t => centroid(m, t));
}

describe('brush alignment', () => {
  // Thin plate: top at z = 0.5, bottom at z = -0.5, 0.25-unit grid.
  const plate = plateBox(6, -0.5, 0.5, 0.25);

  test('descriptors without align resolve exactly as before (surface normals, half-radius depth)', () => {
    const d = stroke({ surface: 'slab' });
    const s = buildBrushStrokeFromDescriptor(d, plate);
    expect(s.depth).toBe(1);
    expect(s.sampleNormals).toEqual(deriveSampleNormals(d.samples, plate));
    expect(s.frontFacing).toBeUndefined();
  });

  test('view alignment points the prism down the camera ray and widens the footprint on a tilted view', () => {
    // Looking down at 45° along +x: a camera-facing circle of radius 2 covers an
    // ellipse on the top face reaching 2/cos45 ≈ 2.83 along x.
    const dir: V3 = [Math.SQRT1_2, 0, -Math.SQRT1_2];
    const view = stroke({ surface: 'slab', align: 'view', view: { dir }, frontFaceMaxDeg: 90 });
    const s = buildBrushStrokeFromDescriptor(view, plate);
    expect(s.sampleNormals![0][0]).toBeCloseTo(dir[0]);
    expect(s.sampleNormals![0][2]).toBeCloseTo(dir[2]);
    // Auto depth along the ray = r·tan(70°): the whole circle up to a 70° tilt.
    expect(s.depth).toBeCloseTo(2 * Math.tan((70 * Math.PI) / 180));
    const reachX = (pts: V3[]) => Math.max(...pts.filter(p => p[2] > 0.4).map(p => Math.abs(p[0])));
    const reachY = (pts: V3[]) => Math.max(...pts.filter(p => p[2] > 0.4).map(p => Math.abs(p[1])));
    const v = paint(plate, view);
    const surf = paint(plate, stroke({ surface: 'slab', align: 'surface' }));
    expect(reachX(v)).toBeGreaterThan(2.4);
    expect(reachY(v)).toBeLessThan(2.1);
    expect(reachX(surf)).toBeLessThan(2.1);
  });

  test('perspective views fan the ray out from the camera position', () => {
    const dirs = viewDirsForSamples([[0, 0, 0], [10, 0, 0]], { dir: [0, 0, -1], origin: [0, 0, 10] });
    expect(dirs[0]).toEqual([0, 0, -1]);
    expect(dirs[1][0]).toBeCloseTo(Math.SQRT1_2);
    expect(dirs[1][2]).toBeCloseTo(-Math.SQRT1_2);
  });

  test('area alignment averages out a bump the per-triangle normal follows', () => {
    // A sharp 0.6-high bump at the origin on an otherwise flat top.
    const bumpy = plateBox(6, -0.5, 0.5, 0.25, (x, y) => (Math.abs(x) < 0.01 && Math.abs(y) < 0.01 ? 0.6 : 0));
    const sample: [number, number, number][] = [[0.1, 0.05, 0.95]];
    const nearest = deriveSampleNormals(sample, bumpy)[0];
    const area = deriveAreaNormals(sample, bumpy, 2)[0];
    expect(Math.abs(nearest[2])).toBeLessThan(0.5); // the bump facet is steep
    expect(area[2]).toBeGreaterThan(0.95);           // the brush-wide average is nearly up
  });
});

describe('front faces only and the sphere volume', () => {
  const plate = plateBox(6, -0.5, 0.5, 0.25);
  const down = { dir: [0, 0, -1] as V3 };

  test('a sphere reaches the far side of a thin plate; front faces only stops it', () => {
    const ball = paint(plate, stroke({ surface: 'sphere' }));
    expect(ball.some(p => p[2] < -0.4)).toBe(true);
    const front = paint(plate, stroke({ surface: 'sphere', view: down, frontFaceMaxDeg: 90 }));
    expect(front.some(p => p[2] < -0.4)).toBe(false);
    expect(front.some(p => p[2] > 0.4)).toBe(true);
  });

  test('front faces only also skips refining the back faces', () => {
    const count = (d: Stroke): number => {
      const { mesh } = buildRefinedMesh(plate, [brushRefineRegion(buildBrushStrokeFromDescriptor(d, plate))]);
      let bottom = 0;
      for (let t = 0; t < mesh.numTri; t++) if (centroid(mesh, t)[2] < -0.4) bottom++;
      return bottom;
    };
    const baseBottom = (() => { let b = 0; for (let t = 0; t < plate.numTri; t++) if (centroid(plate, t)[2] < -0.4) b++; return b; })();
    const all = count(stroke({ surface: 'sphere', maxEdge: 0.1 }));
    const front = count(stroke({ surface: 'sphere', maxEdge: 0.1, view: down, frontFaceMaxDeg: 90 }));
    expect(all - baseBottom).toBeGreaterThan(10 * (front - baseBottom));
  });

  test('a malformed stored view degrades to surface alignment without a facing filter', () => {
    const s = buildBrushStrokeFromDescriptor(stroke({ surface: 'slab', align: 'view', view: {} as never, frontFaceMaxDeg: 90 }), plate);
    expect(s.frontFacing).toBeUndefined();
    expect(s.sampleNormals).toEqual(deriveSampleNormals([[0, 0, 0.5]], plate));
  });

  test('a sphere ignores the wrap gate and builds no prism', () => {
    const s = buildBrushStrokeFromDescriptor(stroke({ surface: 'sphere', wrapAngleDeg: 90 }), plate);
    expect(s.sampleNormals).toBeUndefined();
    expect(s.geoField).toBeUndefined();
  });

  test("align 'view' without a stored view falls back to surface alignment", () => {
    const s = buildBrushStrokeFromDescriptor(stroke({ surface: 'slab', align: 'view' }), plate);
    expect(s.depth).toBe(1);
    expect(s.sampleNormals).toEqual(deriveSampleNormals([[0, 0, 0.5]], plate));
  });
});

describe('occlusion (visible faces only)', () => {
  /** Concatenate meshes (independent shells). */
  function merge(...ms: MeshData[]): MeshData {
    const verts: number[] = [];
    const tris: number[] = [];
    for (const m of ms) {
      const off = verts.length / 3;
      for (let i = 0; i < m.numVert * 3; i++) verts.push(m.vertProperties[i]);
      for (let i = 0; i < m.numTri * 3; i++) tris.push(m.triVerts[i] + off);
    }
    return { vertProperties: new Float32Array(verts), triVerts: new Uint32Array(tris), numVert: verts.length / 3, numTri: tris.length / 3, numProp: 3 };
  }
  // A plate (top at z = 0.5) with a 2×2 roof floating over its middle at z 3–4.
  const scene = merge(plateBox(6, -0.5, 0.5, 0.25), plateBox(1, 3, 4, 0.25));
  const fromAbove = { dir: [0, 0, -1] as V3, origin: [0, 0, 50] as V3 };
  const base = stroke({ samples: [[1.5, 0, 0.5]], radius: 2.5, surface: 'slab', align: 'view', view: fromAbove, frontFaceMaxDeg: 90 });
  const underRoof = (p: V3) => p[2] > 0.4 && p[2] < 0.6 && Math.abs(p[0]) < 0.85 && Math.abs(p[1]) < 0.85;
  const plateTop = (p: V3) => p[2] > 0.4 && p[2] < 0.6;

  test('without occlusion the plate under the roof is painted', () => {
    expect(paint(scene, base).some(underRoof)).toBe(true);
  });

  test('with occlusion the plate under the roof stays unpainted; the visible plate and roof top are painted', () => {
    const pts = paint(scene, { ...base, occlude: true });
    expect(pts.some(underRoof)).toBe(false);
    expect(pts.some(p => plateTop(p) && p[0] > 1.2)).toBe(true);
    expect(pts.some(p => p[2] > 3.9)).toBe(true); // the roof's top face
  });

  test('parallel rays (no camera position) occlude too', () => {
    const pts = paint(scene, { ...base, view: { dir: [0, 0, -1] }, occlude: true });
    expect(pts.some(underRoof)).toBe(false);
    expect(pts.some(p => plateTop(p) && p[0] > 1.2)).toBe(true);
  });

  test('occlude without a stored view is ignored', () => {
    const s = buildBrushStrokeFromDescriptor(stroke({ occlude: true }), scene);
    expect(s.occluded).toBeUndefined();
  });
});
