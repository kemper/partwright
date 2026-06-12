// Unit tests for the pure printability math. Run in Node (no browser); the
// module is kept dependency-free (only a type import) precisely so it can be
// tested directly.

import { test, expect, describe } from 'vitest';
import { analyzePrintability, computeCenterOfMass } from '../../src/geometry/printability';
import type { MeshData } from '../../src/geometry/types';

/** A correctly-wound (outward normals) axis-aligned cube of `size`, centred in
 *  XY and resting on z=0 (z spans 0..size). */
function makeCube(size: number): MeshData {
  const h = size / 2;
  const verts = [
    -h, -h, 0,  h, -h, 0,  h, h, 0,  -h, h, 0,
    -h, -h, size,  h, -h, size,  h, h, size,  -h, h, size,
  ];
  const tris = [
    0, 3, 2, 0, 2, 1,   // bottom (−Z)
    4, 5, 6, 4, 6, 7,   // top (+Z)
    0, 1, 5, 0, 5, 4,   // front (−Y)
    3, 7, 6, 3, 6, 2,   // back (+Y)
    1, 2, 6, 1, 6, 5,   // right (+X)
    0, 4, 7, 0, 7, 3,   // left (−X)
  ];
  return {
    vertProperties: new Float32Array(verts),
    triVerts: new Uint32Array(tris),
    numVert: 8,
    numTri: 12,
    numProp: 3,
  };
}

const BED: [number, number, number] = [256, 256, 256];

describe('computeCenterOfMass', () => {
  test('a cube has its centre of mass at the geometric centre', () => {
    const mp = computeCenterOfMass(makeCube(10));
    expect(mp).not.toBeNull();
    if (mp) {
      expect(mp.volume).toBeCloseTo(1000, 2);
      expect(mp.com[0]).toBeCloseTo(0, 4);
      expect(mp.com[1]).toBeCloseTo(0, 4);
      expect(mp.com[2]).toBeCloseTo(5, 4);
    }
  });
});

describe('analyzePrintability', () => {
  test('a small cube on the bed passes the key checks', () => {
    const r = analyzePrintability(makeCube(20), { bed: BED, nozzleWidth: 0.4, overhangAngleDeg: 45, isManifold: true });
    expect(r.ok).toBe(true);
    expect(r.bedFit.fits).toBe(true);
    expect(r.overhangs.triangleCount).toBe(0);
    expect(r.isManifold).toBe(true);
    expect(r.stability.supported).toBe(true);
    expect(r.checks.find(c => c.id === 'manifold')?.level).toBe('pass');
  });

  test('a cube larger than the bed fails the bed-fit check', () => {
    const r = analyzePrintability(makeCube(300), { bed: BED, nozzleWidth: 0.4, overhangAngleDeg: 45, isManifold: true });
    expect(r.bedFit.fits).toBe(false);
    expect(r.ok).toBe(false);
    expect(r.checks.find(c => c.id === 'bed')?.level).toBe('fail');
  });

  test('non-manifold geometry is flagged as a blocker', () => {
    const r = analyzePrintability(makeCube(20), { bed: BED, nozzleWidth: 0.4, overhangAngleDeg: 45, isManifold: false });
    expect(r.ok).toBe(false);
    expect(r.checks.find(c => c.id === 'manifold')?.level).toBe('fail');
  });
});
