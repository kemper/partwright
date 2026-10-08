// Voxel symmetric-difference + localized findings coverage.

import { describe, it, expect } from 'vitest';
// @ts-expect-error — .mjs script
import { voxelizeMesh, makeSharedGrid, voxelDiff } from '../../scripts/inverse-cad/voxelDiff.mjs';

// An axis-aligned box from `min` to `max`, as 12 triangles (2 per face).
function box(min: [number, number, number], max: [number, number, number]): Float32Array {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const v = (i: 0 | 1, j: 0 | 1, k: 0 | 1) => [i ? x1 : x0, j ? y1 : y0, k ? z1 : z0] as const;
  const faces: readonly (readonly (readonly [number, number, number])[])[] = [
    [v(0, 0, 0), v(1, 0, 0), v(1, 1, 0), v(0, 1, 0)], // -Z
    [v(0, 0, 1), v(0, 1, 1), v(1, 1, 1), v(1, 0, 1)], // +Z
    [v(0, 0, 0), v(0, 1, 0), v(0, 1, 1), v(0, 0, 1)], // -X
    [v(1, 0, 0), v(1, 0, 1), v(1, 1, 1), v(1, 1, 0)], // +X
    [v(0, 0, 0), v(0, 0, 1), v(1, 0, 1), v(1, 0, 0)], // -Y
    [v(0, 1, 0), v(1, 1, 0), v(1, 1, 1), v(0, 1, 1)], // +Y
  ];
  const tris: number[] = [];
  for (const quad of faces) {
    const [a, b, c, d] = quad;
    tris.push(...a, ...b, ...c);
    tris.push(...a, ...c, ...d);
  }
  return Float32Array.from(tris);
}

function concatMesh(...arrs: Float32Array[]): Float32Array {
  const total = arrs.reduce((s, a) => s + a.length, 0);
  const out = new Float32Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

function occCount(occ: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < occ.length; i++) n += occ[i];
  return n;
}

describe('inverse-cad/voxelDiff.voxelizeMesh', () => {
  it('voxelizes a 10mm cube within 2% of the true 1000mm3 volume', () => {
    const mesh = { triangles: box([0, 0, 0], [10, 10, 10]) };
    // Grid covers -1..11 on each axis at res 0.5 (24 voxels/axis).
    const grid = { min: [-1, -1, -1] as [number, number, number], size: [24, 24, 24], res: 0.5 };
    const occ = voxelizeMesh(mesh, grid);
    const vol = occCount(occ) * 0.5 ** 3;
    expect(vol).toBeGreaterThan(1000 * 0.98);
    expect(vol).toBeLessThan(1000 * 1.02);
  });
});

describe('inverse-cad/voxelDiff.makeSharedGrid', () => {
  it('covers the union bbox padded by 2 voxels', () => {
    const a = { triangles: box([0, 0, 0], [10, 10, 10]) };
    const b = { triangles: box([1, 0, 0], [11, 10, 10]) };
    const grid = makeSharedGrid(a, b, {});
    // Union bbox is [0,0,0]..[11,10,10]; padded min should sit 2 voxels
    // outside that on every axis.
    expect(grid.min[0]).toBeCloseTo(0 - 2 * grid.res, 6);
    expect(grid.min[1]).toBeCloseTo(0 - 2 * grid.res, 6);
    expect(grid.min[2]).toBeCloseTo(0 - 2 * grid.res, 6);
  });
});

describe('inverse-cad/voxelDiff.voxelDiff', () => {
  it('reports IoU > 0.99 and no findings for identical cubes', () => {
    const mesh = { triangles: box([0, 0, 0], [10, 10, 10]) };
    const result = voxelDiff({ triangles: mesh.triangles }, { triangles: mesh.triangles });
    expect(result.volumeIoU).toBeGreaterThan(0.99);
    expect(result.findings.length).toBe(0);
    expect(result.totalFindings).toBe(0);
  });

  it('reports a compact excess finding for a flush non-overlapping bump', () => {
    const target = { triangles: box([0, 0, 0], [10, 10, 10]) };
    const bump = box([4, 4, 10], [6, 6, 12]); // flush on the +Z face, no overlap
    const candidate = { triangles: concatMesh(box([0, 0, 0], [10, 10, 10]), bump) };
    const result = voxelDiff(target, candidate);

    expect(result.findings.length).toBe(1);
    const f = result.findings[0];
    expect(f.sign).toBe('excess');
    expect(f.volume_mm3).toBeGreaterThan(5);
    expect(f.volume_mm3).toBeLessThan(11);
    expect(f.centroid[0]).toBeCloseTo(5, 0);
    expect(f.centroid[1]).toBeCloseTo(5, 0);
    expect(f.centroid[2]).toBeGreaterThan(10);
    expect(f.centroid[2]).toBeLessThan(12);
    expect(f.classification).toBe('compact-feature');
    expect(f.hint).toMatch(/protrusion too large or missing cut/);
  });

  it('reports a thin-skin missing finding for a cube shrunk on one axis', () => {
    const target = { triangles: box([0, 0, 0], [10, 10, 10]) };
    const candidate = { triangles: box([0, 0, 0], [10, 10, 9.6]) };
    const result = voxelDiff(target, candidate);

    const missing = result.findings.filter((f: any) => f.sign === 'missing');
    expect(missing.length).toBeGreaterThan(0);
    for (const f of missing) {
      expect(f.classification).toBe('thin-skin');
      expect(f.hint).toMatch(/missing feature or cut too deep/);
    }
    const totalMissingVol = missing.reduce((s: number, f: any) => s + f.volume_mm3, 0);
    expect(totalMissingVol).toBeGreaterThan(30);
    expect(totalMissingVol).toBeLessThan(50);
  });

  it('reports both excess and missing slabs for a translated cube, IoU in a sensible band', () => {
    const target = { triangles: box([0, 0, 0], [10, 10, 10]) };
    const candidate = { triangles: box([1, 0, 0], [11, 10, 10]) };
    const result = voxelDiff(target, candidate);

    expect(result.volumeIoU).toBeGreaterThan(0.7);
    expect(result.volumeIoU).toBeLessThan(0.95);
    expect(result.findings.some((f: any) => f.sign === 'excess')).toBe(true);
    expect(result.findings.some((f: any) => f.sign === 'missing')).toBe(true);
  });
});
