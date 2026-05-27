// Slab painting — select all triangles whose centroid falls inside a planar slab
// defined by a normal vector, an offset along that normal, and a thickness.
//
// A slab is the set of points P satisfying:   offset <= P · n <= offset + thickness
// where n is a unit-length normal. With n = (0,0,1) this is a Z-range slab; with
// arbitrary n it's an oblique/tilted slab.

import type { MeshData } from '../geometry/types';
import { getTriangleCentroid } from './adjacency';
import type { RefineRegion, TriClass, Aabb } from './subdivide';

export interface AxisAlignedNormal {
  axis: 'x' | 'y' | 'z';
  normal: [number, number, number];
}

export const AXIS_NORMALS: Record<'x' | 'y' | 'z', [number, number, number]> = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
};

/** Bounding box of a mesh (axis-aligned, world coords). */
export function meshBounds(mesh: MeshData): { min: [number, number, number]; max: [number, number, number] } {
  const { vertProperties, numVert, numProp } = mesh;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (let i = 0; i < numVert; i++) {
    const x = vertProperties[i * numProp];
    const y = vertProperties[i * numProp + 1];
    const z = vertProperties[i * numProp + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

/** Project all vertices onto a normal direction and return [min, max] dot products.
 *  Used to size the offset slider for an arbitrary normal. */
export function projectionRange(mesh: MeshData, normal: [number, number, number]): { min: number; max: number } {
  const { vertProperties, numVert, numProp } = mesh;
  const [nx, ny, nz] = normalize(normal);

  let min = Infinity;
  let max = -Infinity;

  for (let i = 0; i < numVert; i++) {
    const x = vertProperties[i * numProp];
    const y = vertProperties[i * numProp + 1];
    const z = vertProperties[i * numProp + 2];
    const d = x * nx + y * ny + z * nz;
    if (d < min) min = d;
    if (d > max) max = d;
  }

  return { min, max };
}

export type SlabCoverageMode = 'centroid' | 'fully_inside' | 'any_vertex_inside';

/** Find all triangles inside the slab. Coverage mode controls which
 *  point on the triangle has to satisfy the slab containment test:
 *
 *  - `centroid` (default): the triangle's centroid lies in the slab.
 *    Cheapest, matches historical behavior, but lets long radial fan
 *    triangles "bleed" outside the slab when their centroid happens
 *    to fall in range while their vertices extend further.
 *  - `fully_inside`: all 3 vertices lie in the slab.
 *  - `any_vertex_inside`: at least one vertex lies in the slab.
 */
export function findSlabTriangles(
  mesh: MeshData,
  normal: [number, number, number],
  offset: number,
  thickness: number,
  coverage: SlabCoverageMode = 'centroid',
): Set<number> {
  const result = new Set<number>();
  if (thickness <= 0) return result;

  const [nx, ny, nz] = normalize(normal);
  const lo = offset;
  const hi = offset + thickness;
  const { triVerts, vertProperties, numProp, numTri } = mesh;

  for (let t = 0; t < numTri; t++) {
    if (coverage === 'centroid') {
      const c = getTriangleCentroid(t, mesh);
      const d = c[0] * nx + c[1] * ny + c[2] * nz;
      if (d >= lo && d <= hi) result.add(t);
      continue;
    }
    const v0 = triVerts[t * 3], v1 = triVerts[t * 3 + 1], v2 = triVerts[t * 3 + 2];
    const dA = vertProperties[v0 * numProp] * nx + vertProperties[v0 * numProp + 1] * ny + vertProperties[v0 * numProp + 2] * nz;
    const dB = vertProperties[v1 * numProp] * nx + vertProperties[v1 * numProp + 1] * ny + vertProperties[v1 * numProp + 2] * nz;
    const dC = vertProperties[v2 * numProp] * nx + vertProperties[v2 * numProp + 1] * ny + vertProperties[v2 * numProp + 2] * nz;
    const inA = dA >= lo && dA <= hi;
    const inB = dB >= lo && dB <= hi;
    const inC = dC >= lo && dC <= hi;
    if (coverage === 'fully_inside' ? (inA && inB && inC) : (inA || inB || inC)) result.add(t);
  }

  return result;
}

function normalize(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len === 0) return [0, 0, 1];
  return [v[0] / len, v[1] / len, v[2] / len];
}

/** Absolute target edge length for smoothing a slab/shape boundary on `mesh` at
 *  the given resolution: the model's bounding-box diagonal divided by resolution
 *  (a scale-relative target, so one resolution gives similar smoothness on
 *  models of any size). Returns 0 for a non-positive resolution. */
export function smoothEdgeForResolution(mesh: MeshData, resolution: number): number {
  if (!(resolution > 0)) return 0;
  const b = meshBounds(mesh);
  const diag = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
  return diag / resolution;
}

/** Build a refine region for a slab so its two boundary planes can be smoothed.
 *  A triangle straddles when its vertices' projections onto the normal span the
 *  slab's `[offset, offset+thickness]` range without lying entirely inside it.
 *  Because the projection is affine over a planar triangle, the per-vertex
 *  min/max test is exact — it never misses a thin slab crossing a coarse face. */
export function slabRefineRegion(
  normal: [number, number, number],
  offset: number,
  thickness: number,
  maxEdge: number,
): RefineRegion {
  const [nx, ny, nz] = normalize(normal);
  const lo = offset;
  const hi = offset + thickness;
  const classify = (a: number[], b: number[], c: number[]): TriClass => {
    const dA = a[0] * nx + a[1] * ny + a[2] * nz;
    const dB = b[0] * nx + b[1] * ny + b[2] * nz;
    const dC = c[0] * nx + c[1] * ny + c[2] * nz;
    const minD = Math.min(dA, dB, dC);
    const maxD = Math.max(dA, dB, dC);
    if (maxD < lo || minD > hi) return 'outside';
    if (minD >= lo && maxD <= hi) return 'inside';
    return 'straddle';
  };
  return { aabb: axisAlignedSlabAabb(nx, ny, nz, lo, hi), maxEdge, classify };
}

/** Cheap spatial-reject box for an axis-aligned slab (the UI's X/Y/Z slabs and
 *  most API calls): the band only bounds the normal's own axis — the two in-plane
 *  axes stay unbounded (±Infinity) so only triangles fully clear of the band are
 *  rejected before the classify. Oblique slabs return null (no tight AABB without
 *  the mesh bounds; the classify is just three dot products with a maxEdge
 *  early-out, so a full scan stays cheap for a one-shot paint). */
function axisAlignedSlabAabb(nx: number, ny: number, nz: number, lo: number, hi: number): Aabb | null {
  const eps = 1e-9;
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  const min: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const max: [number, number, number] = [Infinity, Infinity, Infinity];
  // For an axis k with n_k = ±1, P·n = ±P_k, so the slab lo ≤ ±P_k ≤ hi maps to
  // P_k ∈ [lo, hi] (positive normal) or [-hi, -lo] (negative normal).
  const bound = (k: number, sign: number): void => {
    if (sign > 0) { min[k] = lo; max[k] = hi; } else { min[k] = -hi; max[k] = -lo; }
  };
  if (ax > 1 - eps && ay < eps && az < eps) bound(0, Math.sign(nx));
  else if (ay > 1 - eps && ax < eps && az < eps) bound(1, Math.sign(ny));
  else if (az > 1 - eps && ax < eps && ay < eps) bound(2, Math.sign(nz));
  else return null;
  return { min, max };
}
