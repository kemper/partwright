import { describe, it, expect } from 'vitest';
import { resolvePaintDescriptor, resolvePaintOps } from '../../src/color/paintOpsResolve';
import type { RegionDescriptor } from '../../src/color/regions';
import type { MeshData } from '../../src/geometry/types';

// Build a MeshData from triangle centroids (same idiom as cylinderPaint.test.ts):
// each triangle gets three vertices clustered around its centroid, which is all
// the 'centroid' coverage modes read.
function meshFromCentroids(centroids: [number, number, number][]): MeshData {
  const vertProperties: number[] = [];
  const triVerts: number[] = [];
  centroids.forEach(([x, y, z], t) => {
    vertProperties.push(x + 1, y, z, x - 0.5, y + 0.5, z, x - 0.5, y - 0.5, z);
    triVerts.push(t * 3, t * 3 + 1, t * 3 + 2);
  });
  return {
    vertProperties: new Float32Array(vertProperties),
    triVerts: new Uint32Array(triVerts),
    numProp: 3,
    numVert: centroids.length * 3,
    numTri: centroids.length,
  } as MeshData;
}

// T0 low (z=1), T1 high (z=9), T2 far out in X.
const mesh = meshFromCentroids([
  [0, 0, 1],
  [0, 0, 9],
  [50, 0, 5],
]);

describe('resolvePaintDescriptor — the api.paint.* descriptor subset', () => {
  it('slab selects by signed distance band along the normal', () => {
    const d: RegionDescriptor = { kind: 'slab', normal: [0, 0, 1], offset: 1, thickness: 2 };
    expect([...resolvePaintDescriptor(d, mesh)!]).toEqual([0]);
  });

  it('box selects centroids inside the oriented box', () => {
    const d: RegionDescriptor = { kind: 'box', center: [0, 0, 9], size: [4, 4, 4], quaternion: [0, 0, 0, 1] };
    expect([...resolvePaintDescriptor(d, mesh)!]).toEqual([1]);
  });

  it('cylinder selects the radial band along z', () => {
    const d: RegionDescriptor = { kind: 'cylinder', center: [50, 0], rMin: 0, rMax: 5, zMin: 0, zMax: 10 };
    expect([...resolvePaintDescriptor(d, mesh)!]).toEqual([2]);
  });

  it('byLabel reads the engine labelMap, and a missing label resolves empty (not null)', () => {
    const labelMap = new Map([['body', new Set([0, 1])]]);
    const hit = resolvePaintDescriptor({ kind: 'byLabel', label: 'body' }, mesh, labelMap)!;
    expect([...hit].sort()).toEqual([0, 1]);
    const miss = resolvePaintDescriptor({ kind: 'byLabel', label: 'ghost' }, mesh, labelMap)!;
    expect(miss.size).toBe(0);
  });

  it('returns null for non-api.paint.* kinds', () => {
    const d = { kind: 'triangles', ids: [0] } as RegionDescriptor;
    expect(resolvePaintDescriptor(d, mesh)).toBeNull();
  });
});

describe('resolvePaintOps — ordered batch resolution', () => {
  it('keeps declaration order and reports per-op triangle sets (zero counts included)', () => {
    const ops = [
      { name: 'base', color: [1, 0, 0] as [number, number, number], descriptor: { kind: 'slab', normal: [0, 0, 1], offset: 1, thickness: 2 } },
      { name: 'nowhere', color: [0, 1, 0] as [number, number, number], descriptor: { kind: 'slab', normal: [0, 0, 1], offset: 100, thickness: 2 } },
    ];
    const resolved = resolvePaintOps(ops, mesh);
    expect(resolved.map((r) => r.name)).toEqual(['base', 'nowhere']);
    expect(resolved[0].triangles.size).toBe(1);
    expect(resolved[1].triangles.size).toBe(0); // the silent-paint trap, made visible
    expect(resolved[1].kind).toBe('slab');
  });
});
