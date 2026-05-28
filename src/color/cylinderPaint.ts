// Cylinder painting — refine + classify for a cylindrical shell selector.
//
// The shell is the set of points satisfying:
//   rMin ≤ √((x - cx)² + (y - cy)²) ≤ rMax   AND   zMin ≤ z ≤ zMax
//
// `cylinderRefineRegion` returns a `RefineRegion` so the shared mesh-refinement
// pipeline (see `subdivide.ts`) subdivides boundary triangles around the
// cylindrical / annular wall until they fall below `maxEdge`. The result is
// crisp painted edges that follow the analytic cylinder boundary instead of
// the coarse base tessellation — same idea as `slabRefineRegion`, just with
// curved walls instead of planar ones.

import type { MeshData } from '../geometry/types';
import { buildAdjacency } from './adjacency';
import type { RefineRegion, TriClass, Aabb } from './subdivide';

export type CylinderCoverage = 'centroid' | 'fully_inside' | 'any_vertex_inside';

/** Collect triangle ids whose centroids (or every vertex, depending on
 *  `coverage`) fall inside a cylindrical shell. Mirrors `findSlabTriangles`
 *  / `findBoxTriangles` in shape — top-level so the post-refine descriptor
 *  resolver can call it without going through `main.ts`'s closure scope. */
export function findCylinderTriangles(
  mesh: MeshData,
  center: [number, number],
  rMin: number,
  rMax: number,
  zMin: number,
  zMax: number,
  cone?: { axis: [number, number, number]; angleDeg: number },
  coverage: CylinderCoverage = 'centroid',
  maxArea?: number,
): Set<number> {
  const adjacency = cone ? buildAdjacency(mesh) : null;
  let coneAxis: [number, number, number] | null = null;
  let coneCos = -1;
  if (cone) {
    const len = Math.hypot(cone.axis[0], cone.axis[1], cone.axis[2]);
    coneAxis = [cone.axis[0] / len, cone.axis[1] / len, cone.axis[2] / len];
    coneCos = Math.cos(cone.angleDeg * Math.PI / 180);
  }
  const rMin2 = rMin * rMin, rMax2 = rMax * rMax;
  const [cx, cy] = center;
  const result = new Set<number>();
  const { triVerts, vertProperties, numProp, numTri } = mesh;

  const inShell = (x: number, y: number, z: number): boolean => {
    const dx = x - cx, dy = y - cy;
    const r2 = dx * dx + dy * dy;
    return r2 >= rMin2 && r2 <= rMax2 && z >= zMin && z <= zMax;
  };

  for (let t = 0; t < numTri; t++) {
    const v0 = triVerts[t * 3], v1 = triVerts[t * 3 + 1], v2 = triVerts[t * 3 + 2];
    const ax = vertProperties[v0 * numProp], ay = vertProperties[v0 * numProp + 1], az = vertProperties[v0 * numProp + 2];
    const bx = vertProperties[v1 * numProp], by = vertProperties[v1 * numProp + 1], bz = vertProperties[v1 * numProp + 2];
    const cx2 = vertProperties[v2 * numProp], cy2 = vertProperties[v2 * numProp + 1], cz2 = vertProperties[v2 * numProp + 2];

    if (coverage === 'fully_inside') {
      if (!inShell(ax, ay, az) || !inShell(bx, by, bz) || !inShell(cx2, cy2, cz2)) continue;
    } else if (coverage === 'any_vertex_inside') {
      if (!inShell(ax, ay, az) && !inShell(bx, by, bz) && !inShell(cx2, cy2, cz2)) continue;
    } else {
      const ccx = (ax + bx + cx2) / 3, ccy = (ay + by + cy2) / 3, ccz = (az + bz + cz2) / 3;
      if (!inShell(ccx, ccy, ccz)) continue;
    }

    if (coneAxis && adjacency) {
      const nx = adjacency.normals[t * 3], ny = adjacency.normals[t * 3 + 1], nz = adjacency.normals[t * 3 + 2];
      if (coneAxis[0] * nx + coneAxis[1] * ny + coneAxis[2] * nz < coneCos) continue;
    }
    if (maxArea !== undefined) {
      // Inline 2× triangle area via the cross product magnitude so we don't
      // need a buildAdjacency() call when the cone branch didn't already
      // build one. The factor of 2 is consistent on both sides of the test.
      const ex1 = bx - ax, ey1 = by - ay, ez1 = bz - az;
      const ex2 = cx2 - ax, ey2 = cy2 - ay, ez2 = cz2 - az;
      const nx = ey1 * ez2 - ez1 * ey2;
      const ny = ez1 * ex2 - ex1 * ez2;
      const nz = ex1 * ey2 - ey1 * ex2;
      const area = 0.5 * Math.hypot(nx, ny, nz);
      if (area > maxArea) continue;
    }
    result.add(t);
  }
  return result;
}

/** Build a refine region that subdivides triangles straddling a cylindrical
 *  shell. The classifier is conservative — a triangle is treated as
 *  `straddle` whenever its vertices land on different sides of any one of
 *  the four bounding surfaces (rMin sphere, rMax sphere, zMin plane, zMax
 *  plane). False positives just trigger extra subdivision, which is harmless
 *  next to a painted boundary; the alternative (missing a crossing) leaves a
 *  jagged edge. */
export function cylinderRefineRegion(
  center: [number, number],
  rMin: number,
  rMax: number,
  zMin: number,
  zMax: number,
  maxEdge: number,
): RefineRegion {
  const [cx, cy] = center;
  const rMin2 = rMin * rMin;
  const rMax2 = rMax * rMax;
  const classify = (a: number[], b: number[], c: number[]): TriClass => {
    const ra2 = (a[0] - cx) * (a[0] - cx) + (a[1] - cy) * (a[1] - cy);
    const rb2 = (b[0] - cx) * (b[0] - cx) + (b[1] - cy) * (b[1] - cy);
    const rc2 = (c[0] - cx) * (c[0] - cx) + (c[1] - cy) * (c[1] - cy);
    const az = a[2], bz = b[2], cz = c[2];

    // Outside on any single side — all three vertices fail the same test.
    // This is conservative: a thin triangle that happens to lie tangent to
    // rMax while straddling zMax would still be straddle (not outside)
    // because the z test catches it.
    if (ra2 > rMax2 && rb2 > rMax2 && rc2 > rMax2) return 'outside';
    if (rMin > 0 && ra2 < rMin2 && rb2 < rMin2 && rc2 < rMin2) return 'outside';
    if (az < zMin && bz < zMin && cz < zMin) return 'outside';
    if (az > zMax && bz > zMax && cz > zMax) return 'outside';

    // Inside — all three vertices fully inside the shell. This also requires
    // a positive rMin only if rMin > 0 (a solid cylinder has rMin = 0).
    const aIn = ra2 <= rMax2 && (rMin === 0 || ra2 >= rMin2) && az >= zMin && az <= zMax;
    const bIn = rb2 <= rMax2 && (rMin === 0 || rb2 >= rMin2) && bz >= zMin && bz <= zMax;
    const cIn = rc2 <= rMax2 && (rMin === 0 || rc2 >= rMin2) && cz >= zMin && cz <= zMax;
    if (aIn && bIn && cIn) return 'inside';
    return 'straddle';
  };
  // Cheap outer-AABB reject: anything fully outside the [cx±rMax, cy±rMax,
  // zMin..zMax] box can't be in the shell at all. The inner hole (rMin) is
  // unbounded by a single AABB so we live with the false positives — the
  // classify catches them.
  const aabb: Aabb = {
    min: [cx - rMax, cy - rMax, zMin],
    max: [cx + rMax, cy + rMax, zMax],
  };
  return { aabb, maxEdge, classify };
}
