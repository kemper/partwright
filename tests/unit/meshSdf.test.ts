import { describe, it, expect } from 'vitest';
import {
  chooseGridForRadius,
  rasterizeOccupancy,
  signedFieldFromOccupancy,
  edt3dSquared,
  thresholdField,
  openField,
  closeField,
  smin,
  blurField,
  makeTrilinearSampler,
  isoCrossings,
  nearestPointDistances,
  markTriangleSamples,
  selectionWeightField,
  type GridSpec,
  type MeshLike,
} from '../../src/geometry/meshSdf';

/** Axis-aligned box mesh [min, max] as a 12-triangle MeshLike (CCW outward). */
function boxMesh(min: [number, number, number], max: [number, number, number]): MeshLike {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const v = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const quads: [number, number, number, number][] = [
    [0, 3, 2, 1], // bottom (z0), outward -Z
    [4, 5, 6, 7], // top (z1), outward +Z
    [0, 1, 5, 4], // front (y0), outward -Y
    [2, 3, 7, 6], // back (y1), outward +Y
    [0, 4, 7, 3], // left (x0), outward -X
    [1, 2, 6, 5], // right (x1), outward +X
  ];
  const tris: number[] = [];
  for (const [a, b, c, d] of quads) tris.push(a, b, c, a, c, d);
  return {
    vertProperties: new Float32Array(v.flat()),
    triVerts: new Uint32Array(tris),
    numProp: 3,
    numTri: 12,
  };
}

describe('chooseGridForRadius', () => {
  it('sizes the voxel to resolve the radius', () => {
    const spec = chooseGridForRadius([0, 0, 0], [10, 10, 10], 1, 2, 192);
    expect(spec).not.toBeNull();
    expect(spec!.voxel).toBeLessThanOrEqual(1 / 2.5 + 1e-9);
    expect(spec!.nx).toBeGreaterThan(10 / spec!.voxel);
  });

  it('returns null when the radius is unresolvable at the resolution cap', () => {
    expect(chooseGridForRadius([0, 0, 0], [1000, 10, 10], 0.5, 1, 64)).toBeNull();
  });
});

describe('rasterizeOccupancy', () => {
  const spec: GridSpec = { nx: 20, ny: 20, nz: 20, origin: [-5, -5, -5], voxel: 1 };
  const occ = rasterizeOccupancy(boxMesh([-3, -3, -3], [3, 3, 3]), spec);

  it('marks interior samples inside and exterior samples outside', () => {
    const at = (i: number, j: number, k: number) => occ[i + j * 20 + k * 400];
    expect(at(5, 5, 5)).toBe(1);   // origin+(5,5,5)=(0,0,0) — box center
    expect(at(3, 5, 5)).toBe(1);   // (-2,0,0) — inside
    expect(at(0, 0, 0)).toBe(0);   // (-5,-5,-5) — outside
    expect(at(19, 5, 5)).toBe(0);  // (14,0,0) — outside
  });

  it('fills approximately the right volume', () => {
    let count = 0;
    for (let i = 0; i < occ.length; i++) count += occ[i];
    // 6×6×6 box on a unit lattice ≈ 6³..7³ samples inside.
    expect(count).toBeGreaterThan(5 * 5 * 5);
    expect(count).toBeLessThan(8 * 8 * 8);
  });
});

describe('edt3dSquared', () => {
  it('computes exact squared distances to a single seed', () => {
    const nx = 8, ny = 8, nz = 8;
    const seed = 3 + 4 * nx + 5 * nx * ny;
    const d = edt3dSquared(i => i === seed, nx, ny, nz);
    expect(d[seed]).toBe(0);
    const q = 6 + 4 * nx + 5 * nx * ny; // 3 along x
    expect(d[q]).toBe(9);
    const r = 4 + 6 * nx + 6 * nx * ny; // (1, 2, 1) away
    expect(d[r]).toBe(1 + 4 + 1);
  });
});

describe('signed field + morphology + sampling', () => {
  const spec: GridSpec = { nx: 24, ny: 24, nz: 24, origin: [-6, -6, -6], voxel: 0.5 };
  const occ = rasterizeOccupancy(boxMesh([-3, -3, -3], [3, 3, 3]), spec);
  const field = signedFieldFromOccupancy(occ, spec);
  const idx = (i: number, j: number, k: number) => i + j * 24 + k * 576;

  it('is negative inside, positive outside, ~zero near the surface', () => {
    expect(field[idx(12, 12, 12)]).toBeLessThan(0);           // center
    expect(field[idx(1, 1, 1)]).toBeGreaterThan(0);           // corner of lattice
    // Sample adjacent to the +X face (x=3 → lattice i=18).
    expect(Math.abs(field[idx(18, 12, 12)])).toBeLessThanOrEqual(1.0);
  });

  it('opening removes a feature thinner than 2r entirely', () => {
    // Thin slab: 1 unit thick — opening with r=1 (2 voxels) erases it.
    const slabOcc = rasterizeOccupancy(boxMesh([-4, -4, -0.5], [4, 4, 0.5]), spec);
    const slabField = signedFieldFromOccupancy(slabOcc, spec);
    const opened = openField(slabField, spec, 1.0);
    const inside = thresholdField(opened, 0);
    let count = 0;
    for (let i = 0; i < inside.length; i++) count += inside[i];
    expect(count).toBe(0);
  });

  it('closing fills a thin internal gap', () => {
    // Two slabs 0.5 apart — closing with r=1 bridges the gap at the middle.
    const a = rasterizeOccupancy(boxMesh([-3, -3, -3], [3, 3, -0.25]), spec);
    const b = rasterizeOccupancy(boxMesh([-3, -3, 0.25], [3, 3, 3]), spec);
    const merged = new Uint8Array(a.length);
    for (let i = 0; i < a.length; i++) merged[i] = a[i] | b[i];
    const f = signedFieldFromOccupancy(merged, spec);
    expect(f[idx(12, 12, 12)]).toBeGreaterThanOrEqual(0); // gap sample starts outside/at boundary
    const closed = closeField(f, spec, 1.0);
    expect(closed[idx(12, 12, 12)]).toBeLessThan(0);      // …and ends up solid
  });

  it('trilinear sampler interpolates and clamps outside to positive', () => {
    const sample = makeTrilinearSampler(field, spec);
    expect(sample(0, 0, 0)).toBeLessThan(0);
    expect(sample(100, 0, 0)).toBeGreaterThan(1000); // OUTSIDE sentinel
    // Continuity: two nearby samples differ by less than a voxel's worth.
    const d = Math.abs(sample(0.2, 0.1, 0) - sample(0.21, 0.1, 0));
    expect(d).toBeLessThan(spec.voxel);
  });

  it('blurField preserves deep-inside and far-outside signs', () => {
    const copy = new Float32Array(field);
    blurField(copy, spec);
    expect(copy[idx(12, 12, 12)]).toBeLessThan(0);
    expect(copy[idx(1, 1, 1)]).toBeGreaterThan(0);
  });
});

describe('smin', () => {
  it('equals min when far apart, dips below min when close', () => {
    expect(smin(0, 10, 2)).toBeCloseTo(0, 6);
    expect(smin(10, 0, 2)).toBeCloseTo(0, 6);
    expect(smin(1, 1, 2)).toBeLessThan(1); // blend bulge
    expect(smin(3, 5, 0)).toBe(3);         // k=0 degenerates to min
  });
});

describe('scoped-op helpers (#1093)', () => {
  it('nearestPointDistances matches brute force', () => {
    let seed = 3;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const cloud = Float64Array.from({ length: 900 }, () => rnd() * 20);
    const queries = Float64Array.from({ length: 600 }, () => rnd() * 30 - 5);
    const d = nearestPointDistances(cloud, queries);
    for (let q = 0; q < 200; q++) {
      let best = Infinity;
      for (let i = 0; i < 300; i++) {
        best = Math.min(best, Math.hypot(cloud[i * 3] - queries[q * 3], cloud[i * 3 + 1] - queries[q * 3 + 1], cloud[i * 3 + 2] - queries[q * 3 + 2]));
      }
      expect(d[q]).toBeCloseTo(best, 9);
    }
    expect(nearestPointDistances(new Float64Array(0), queries)[0]).toBe(Infinity);
  });

  it('isoCrossings lands on the iso-surface of a linear field', () => {
    const spec: GridSpec = { nx: 6, ny: 4, nz: 4, origin: [0, 0, 0], voxel: 1 };
    const field = new Float32Array(6 * 4 * 4);
    for (let i = 0; i < field.length; i++) field[i] = (i % 6) - 2.3; // zero at x = 2.3
    const all = Int32Array.from({ length: field.length }, (_, i) => i);
    const pts = isoCrossings(field, spec, 0, all);
    expect(pts.length).toBe(16 * 3); // one crossing per x-row
    for (let i = 0; i < pts.length; i += 3) expect(pts[i]).toBeCloseTo(2.3, 5);
  });

  it('selection weights: 1 near the selected faces, fading to 0 past reach + blend', () => {
    const spec = chooseGridForRadius([0, 0, 0], [10, 10, 10], 2, 2, 64)!;
    const box = boxMesh([0, 0, 0], [10, 10, 10]);
    // Select only the two +Z (top) triangles.
    const mask = new Uint8Array(12);
    const tv = box.triVerts, vp = box.vertProperties;
    for (let t = 0; t < 12; t++) if ([0, 1, 2].every(c => vp[tv[t * 3 + c] * 3 + 2] === 10)) mask[t] = 1;
    const mark = new Uint8Array(spec.nx * spec.ny * spec.nz);
    markTriangleSamples(box, mask, spec, mark);
    const w = selectionWeightField(mark, spec, 2, 2);
    const at = (x: number, y: number, z: number) => {
      const i = Math.round((x - spec.origin[0]) / spec.voxel), j = Math.round((y - spec.origin[1]) / spec.voxel), k = Math.round((z - spec.origin[2]) / spec.voxel);
      return w[i + j * spec.nx + k * spec.nx * spec.ny];
    };
    expect(at(5, 5, 9)).toBe(1);   // just under the top face
    expect(at(5, 5, 7)).toBeGreaterThan(0); // in the fade
    expect(at(5, 5, 7)).toBeLessThan(1);
    expect(at(5, 5, 2)).toBe(0);   // near the bottom: untouched
  });
});
