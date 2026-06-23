import { describe, it, expect } from 'vitest';
import { findCylinderTriangles } from '../../src/color/cylinderPaint';
import type { MeshData } from '../../src/geometry/types';

// Build a MeshData from a flat list of triangle centroids. Each triangle gets
// three vertices clustered tightly around its centroid (the 'centroid' coverage
// mode only reads the centroid, so the exact spread is irrelevant).
function meshFromCentroids(centroids: [number, number, number][]): MeshData {
  const vertProperties: number[] = [];
  const triVerts: number[] = [];
  centroids.forEach(([x, y, z], t) => {
    // Three verts whose average is exactly (x, y, z).
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

describe('findCylinderTriangles — axis', () => {
  // T0 sits 10 units out in XY at z=5  → in a z-axis shell, out of an x-axis one.
  // T1 sits 10 units out in YZ at x=5  → in an x-axis shell, out of a z-axis one.
  const mesh = meshFromCentroids([
    [10, 0, 5],
    [5, 0, 10],
  ]);

  it("defaults to the z axis (radius in XY, band along Z)", () => {
    const sel = findCylinderTriangles(mesh, [0, 0], 8, 12, 0, 10);
    expect([...sel]).toEqual([0]);
  });

  it("axis 'x' measures radius in YZ with the band along X", () => {
    const sel = findCylinderTriangles(mesh, [0, 0], 8, 12, 0, 10, undefined, 'centroid', undefined, 'x');
    expect([...sel]).toEqual([1]);
  });

  it("axis 'z' explicitly matches the default", () => {
    const zDefault = findCylinderTriangles(mesh, [0, 0], 8, 12, 0, 10);
    const zExplicit = findCylinderTriangles(mesh, [0, 0], 8, 12, 0, 10, undefined, 'centroid', undefined, 'z');
    expect([...zExplicit]).toEqual([...zDefault]);
  });
});
