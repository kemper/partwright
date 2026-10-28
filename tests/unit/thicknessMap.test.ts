// Wall-thickness map (src/geometry/thicknessMap.ts) against real manifold-3d
// meshes: the per-triangle field must equal the wall thickness, thin spots
// must cluster where the walls are thin, and the colours must flag them.

import { describe, it, expect, beforeAll } from 'vitest';
import { thicknessField, summarizeThickness, thicknessColors } from '../../src/geometry/thicknessMap';
import type { MeshData } from '../../src/geometry/types';

let Manifold: any;

beforeAll(async () => {
  const Module = (await import('manifold-3d')).default;
  const mod = await Module();
  mod.setup();
  Manifold = mod.Manifold;
});

const meshOf = (m: any): MeshData => {
  const g = m.getMesh();
  return { vertProperties: g.vertProperties, triVerts: g.triVerts, numVert: g.numVert, numTri: g.numTri, numProp: g.numProp } as MeshData;
};

describe('thicknessField', () => {
  it('measures a hollow box wall everywhere', () => {
    const box = Manifold.cube([20, 20, 20], true).subtract(Manifold.cube([18, 18, 18], true));
    const field = thicknessField(meshOf(box));
    for (const d of field) expect(d).toBeCloseTo(1, 3);
  });

  it('measures a solid as its through-thickness', () => {
    const field = thicknessField(meshOf(Manifold.cube([10, 4, 6])));
    const values = [...new Set([...field].map(d => Math.round(d * 1000) / 1000))].sort((a, b) => a - b);
    expect(values).toEqual([4, 6, 10]);
  });
});

describe('summarizeThickness', () => {
  it('finds the thin patch of a plate and reports it first', () => {
    // A 40×40×3 plate with a 10×10 pocket milled to leave 0.6 of floor.
    const plate = Manifold.cube([40, 40, 3]).subtract(Manifold.cube([10, 10, 3]).translate([25, 5, 0.6]));
    const mesh = meshOf(plate);
    const s = summarizeThickness(mesh, thicknessField(mesh), 1, 10);
    expect(s.minThickness).toBeCloseTo(0.6, 3);
    expect(s.spotCount).toBe(1);
    const spot = s.spots[0];
    expect(spot.thickness).toBeCloseTo(0.6, 3);
    // The pocket floor is thin. (Its underside belongs to the plate's few big
    // bottom triangles, each measured at its centroid — 3 thick.)
    expect(spot.area).toBeCloseTo(100, 0);
    expect(spot.center[0]).toBeCloseTo(30, 0);
    expect(spot.center[1]).toBeCloseTo(10, 0);
    expect(s.thinFraction).toBeGreaterThan(0);
    expect(s.unmeasured).toBe(0);
  });

  it('reports nothing thin on a thick part', () => {
    const mesh = meshOf(Manifold.cube([10, 10, 10]));
    const s = summarizeThickness(mesh, thicknessField(mesh), 1, 10);
    expect(s.spots).toEqual([]);
    expect(s.thinArea).toBe(0);
    expect(s.medianThickness).toBeCloseTo(10, 3);
  });
});

describe('thicknessColors', () => {
  it('reds what is thin, greys what is thick, darkens what is unmeasured', () => {
    const c = thicknessColors(new Float32Array([0.1, 1, 5, NaN]), 1);
    expect([...c.slice(0, 3)]).toEqual([220, 38, 38]);
    expect([...c.slice(3, 6)]).toEqual([250, 204, 21]);
    expect([...c.slice(6, 9)]).toEqual([170, 172, 178]);
    expect([...c.slice(9, 12)]).toEqual([90, 90, 96]);
  });
});
