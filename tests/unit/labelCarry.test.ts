import { describe, it, expect } from 'vitest';
import { carryRunsByNearest, type RunMesh } from '../../src/geometry/labelCarry';
import { nearestSurfaceTriangleMap } from '../../src/surface/colorTransfer';

// One long thin triangle (a "cap" sliver whose centroid sits far from its
// right end) plus a tiny triangle just past that end.
const SLIVER: RunMesh = {
  vertProperties: new Float32Array([0, 0, 0, 30, 0, 0, 0, 1, 0, /* tiny */ 32, 0, 0, 33, 0, 0, 32, 1, 0]),
  triVerts: new Uint32Array([0, 1, 2, 3, 4, 5]),
  numProp: 3,
  numTri: 2,
  runIndex: new Uint32Array([0, 3, 6]),
  runOriginalID: new Uint32Array([7, 9]),
};

describe('label carry through remeshing (#1093)', () => {
  it('nearest-SURFACE matching beats centroid matching for long thin triangles', () => {
    // A point at x=29 sits on the sliver (centroid x=10) but is 3 units from the
    // tiny triangle's centroid (x≈32.3): by surface it belongs to the sliver.
    const map = nearestSurfaceTriangleMap(
      { vertProperties: SLIVER.vertProperties, triVerts: SLIVER.triVerts, numProp: 3, numTri: 2, numVert: 6 },
      new Float64Array([29, 0.01, 0, 32.4, 0.2, 0]),
    );
    expect([...map]).toEqual([0, 1]);
  });

  it('re-sorts output triangles into runs of the nearest source originalID', () => {
    // Output: three small triangles — two over the sliver, one over the tiny one.
    const out: RunMesh = {
      vertProperties: new Float32Array([
        1, 0, 0, 2, 0, 0, 1, 0.5, 0,
        32.2, 0, 0, 32.8, 0, 0, 32.2, 0.5, 0,
        20, 0, 0, 21, 0, 0, 20, 0.2, 0,
      ]),
      triVerts: new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]),
      numProp: 3,
      numTri: 3,
    };
    const r = carryRunsByNearest([SLIVER], out, 99)!;
    expect([...r.runOriginalID]).toEqual([7, 9]);
    expect([...r.runIndex]).toEqual([0, 6, 9]);
    // Run 7 holds output triangles 0 and 2 (in order); run 9 holds triangle 1.
    expect([...r.triVerts]).toEqual([0, 1, 2, 6, 7, 8, 3, 4, 5]);
  });

  it('returns null when no source carries provenance', () => {
    const plain: RunMesh = { ...SLIVER, runIndex: undefined, runOriginalID: undefined };
    expect(carryRunsByNearest([plain], SLIVER, 1)).toBeNull();
  });
});
