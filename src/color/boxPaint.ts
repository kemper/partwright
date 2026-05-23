// Box/shape painting — select all triangles whose centroid falls inside the
// chosen shape (box, sphere, cylinder, or cone). Each shape is defined by the
// same OrientedBox descriptor (center, size, quaternion) but interprets those
// fields differently:
//
//   box      — OBB: |local.x| ≤ sx/2, |local.y| ≤ sy/2, |local.z| ≤ sz/2
//   sphere   — sphere of radius size[0]/2 around center (ignores quaternion)
//   cylinder — radius size[0]/2 around local Y axis, height size[1]
//   cone     — apex at +Y (local), base radius size[0]/2 at -Y, height size[1]

import * as THREE from 'three';
import type { MeshData } from '../geometry/types';
import { closestPointOnTriangle } from './adjacency';
import type { RefineRegion, TriClass, Aabb } from './subdivide';

export type ShapeType = 'box' | 'sphere' | 'cylinder' | 'cone';

export interface OrientedBox {
  center: [number, number, number];
  size: [number, number, number];
  quaternion: [number, number, number, number]; // [x, y, z, w]
}

const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

/** Dispatch to the correct containment test for the given shape type. */
export function findShapeTriangles(mesh: MeshData, shape: ShapeType, box: OrientedBox): Set<number> {
  if (shape === 'sphere')   return findSphereTriangles(mesh, box);
  if (shape === 'cylinder') return findCylinderTriangles(mesh, box);
  if (shape === 'cone')     return findConeTriangles(mesh, box);
  return findBoxTriangles(mesh, box);
}

/** Return the set of triangle indices whose centroid lies inside the OBB. */
export function findBoxTriangles(mesh: MeshData, box: OrientedBox): Set<number> {
  const { triVerts, vertProperties, numProp, numTri } = mesh;
  const result = new Set<number>();

  const halfX = box.size[0] / 2;
  const halfY = box.size[1] / 2;
  const halfZ = box.size[2] / 2;
  if (halfX <= 0 || halfY <= 0 || halfZ <= 0) return result;

  const cx = box.center[0], cy = box.center[1], cz = box.center[2];
  tmpQ.set(-box.quaternion[0], -box.quaternion[1], -box.quaternion[2], box.quaternion[3]);

  for (let t = 0; t < numTri; t++) {
    const v0 = triVerts[t * 3];
    const v1 = triVerts[t * 3 + 1];
    const v2 = triVerts[t * 3 + 2];

    const ax = (vertProperties[v0 * numProp]     + vertProperties[v1 * numProp]     + vertProperties[v2 * numProp])     / 3 - cx;
    const ay = (vertProperties[v0 * numProp + 1] + vertProperties[v1 * numProp + 1] + vertProperties[v2 * numProp + 1]) / 3 - cy;
    const az = (vertProperties[v0 * numProp + 2] + vertProperties[v1 * numProp + 2] + vertProperties[v2 * numProp + 2]) / 3 - cz;

    tmpV.set(ax, ay, az).applyQuaternion(tmpQ);
    if (Math.abs(tmpV.x) <= halfX && Math.abs(tmpV.y) <= halfY && Math.abs(tmpV.z) <= halfZ) {
      result.add(t);
    }
  }

  return result;
}

function findSphereTriangles(mesh: MeshData, box: OrientedBox): Set<number> {
  const { triVerts, vertProperties, numProp, numTri } = mesh;
  const result = new Set<number>();
  const radius = box.size[0] / 2;
  if (radius <= 0) return result;
  const r2 = radius * radius;
  const cx = box.center[0], cy = box.center[1], cz = box.center[2];

  for (let t = 0; t < numTri; t++) {
    const v0 = triVerts[t * 3], v1 = triVerts[t * 3 + 1], v2 = triVerts[t * 3 + 2];
    const dx = (vertProperties[v0 * numProp]     + vertProperties[v1 * numProp]     + vertProperties[v2 * numProp])     / 3 - cx;
    const dy = (vertProperties[v0 * numProp + 1] + vertProperties[v1 * numProp + 1] + vertProperties[v2 * numProp + 1]) / 3 - cy;
    const dz = (vertProperties[v0 * numProp + 2] + vertProperties[v1 * numProp + 2] + vertProperties[v2 * numProp + 2]) / 3 - cz;
    if (dx * dx + dy * dy + dz * dz <= r2) result.add(t);
  }
  return result;
}

function findCylinderTriangles(mesh: MeshData, box: OrientedBox): Set<number> {
  // Cylinder axis = local Y. size[0] = diameter (X/Z), size[1] = height.
  const { triVerts, vertProperties, numProp, numTri } = mesh;
  const result = new Set<number>();
  const halfR = box.size[0] / 2;
  const halfH = box.size[1] / 2;
  if (halfR <= 0 || halfH <= 0) return result;
  const r2 = halfR * halfR;
  const cx = box.center[0], cy = box.center[1], cz = box.center[2];
  tmpQ.set(-box.quaternion[0], -box.quaternion[1], -box.quaternion[2], box.quaternion[3]);

  for (let t = 0; t < numTri; t++) {
    const v0 = triVerts[t * 3], v1 = triVerts[t * 3 + 1], v2 = triVerts[t * 3 + 2];
    const ax = (vertProperties[v0 * numProp]     + vertProperties[v1 * numProp]     + vertProperties[v2 * numProp])     / 3 - cx;
    const ay = (vertProperties[v0 * numProp + 1] + vertProperties[v1 * numProp + 1] + vertProperties[v2 * numProp + 1]) / 3 - cy;
    const az = (vertProperties[v0 * numProp + 2] + vertProperties[v1 * numProp + 2] + vertProperties[v2 * numProp + 2]) / 3 - cz;
    tmpV.set(ax, ay, az).applyQuaternion(tmpQ);
    if (Math.abs(tmpV.y) <= halfH && tmpV.x * tmpV.x + tmpV.z * tmpV.z <= r2) result.add(t);
  }
  return result;
}

function findConeTriangles(mesh: MeshData, box: OrientedBox): Set<number> {
  // Cone: apex at local +Y (top), base at local -Y (bottom).
  // size[0] = base diameter, size[1] = height.
  // At depth d from apex (d in [0, height]): allowed radius = (size[0]/2) * d / height.
  const { triVerts, vertProperties, numProp, numTri } = mesh;
  const result = new Set<number>();
  const halfR = box.size[0] / 2;
  const halfH = box.size[1] / 2;
  if (halfR <= 0 || halfH <= 0) return result;
  const fullH = halfH * 2;
  const cx = box.center[0], cy = box.center[1], cz = box.center[2];
  tmpQ.set(-box.quaternion[0], -box.quaternion[1], -box.quaternion[2], box.quaternion[3]);

  for (let t = 0; t < numTri; t++) {
    const v0 = triVerts[t * 3], v1 = triVerts[t * 3 + 1], v2 = triVerts[t * 3 + 2];
    const ax = (vertProperties[v0 * numProp]     + vertProperties[v1 * numProp]     + vertProperties[v2 * numProp])     / 3 - cx;
    const ay = (vertProperties[v0 * numProp + 1] + vertProperties[v1 * numProp + 1] + vertProperties[v2 * numProp + 1]) / 3 - cy;
    const az = (vertProperties[v0 * numProp + 2] + vertProperties[v1 * numProp + 2] + vertProperties[v2 * numProp + 2]) / 3 - cz;
    tmpV.set(ax, ay, az).applyQuaternion(tmpQ);
    if (tmpV.y < -halfH || tmpV.y > halfH) continue;
    const depth = halfH - tmpV.y; // 0 at apex, fullH at base
    const allowedR = halfR * depth / fullH;
    if (tmpV.x * tmpV.x + tmpV.z * tmpV.z <= allowedR * allowedR) result.add(t);
  }
  return result;
}

const tmpL = new THREE.Vector3();

/** Bounding radius of a shape about its center — used to size the spatial-reject
 *  AABB for refinement. A loose sphere bound is plenty for rejection. */
function shapeBoundingRadius(shape: ShapeType, box: OrientedBox): number {
  const [sx, sy, sz] = box.size;
  if (shape === 'sphere') return sx / 2;
  if (shape === 'cylinder' || shape === 'cone') return Math.hypot(sx / 2, sy / 2);
  return 0.5 * Math.hypot(sx, sy, sz); // box (OBB half-diagonal)
}

function shapeAabb(shape: ShapeType, box: OrientedBox): Aabb {
  const r = shapeBoundingRadius(shape, box);
  const [cx, cy, cz] = box.center;
  return { min: [cx - r, cy - r, cz - r], max: [cx + r, cy + r, cz + r] };
}

/** Make a function that maps a world point to the shape's local frame (centered,
 *  un-rotated). The shape predicates below all work in that frame. */
function localizer(box: OrientedBox): (p: number[]) => THREE.Vector3 {
  const [cx, cy, cz] = box.center;
  const inv = new THREE.Quaternion(-box.quaternion[0], -box.quaternion[1], -box.quaternion[2], box.quaternion[3]);
  return (p) => tmpL.set(p[0] - cx, p[1] - cy, p[2] - cz).applyQuaternion(inv);
}

/** Squared distance from the origin to the triangle projected onto the local XZ
 *  plane (used for the radial separation test of cylinders/cones). */
function xzDist2ToOrigin(la: THREE.Vector3, lb: THREE.Vector3, lc: THREE.Vector3): number {
  const cp = closestPointOnTriangle(0, 0, 0, la.x, 0, la.z, lb.x, 0, lb.z, lc.x, 0, lc.z);
  return cp[0] * cp[0] + cp[2] * cp[2];
}

/** Per-shape boundary classifier for refinement. Each is conservative — it never
 *  reports `outside` for a triangle the shape actually crosses (so no boundary
 *  band is left coarse), at the cost of occasionally subdividing a triangle just
 *  outside a corner. Shapes are convex, so "all 3 vertices inside" ⇒ inside. */
function shapeClassifier(shape: ShapeType, box: OrientedBox): (a: number[], b: number[], c: number[]) => TriClass {
  const [sx, sy] = box.size;

  if (shape === 'sphere') {
    const r2 = (sx / 2) * (sx / 2);
    const [cx, cy, cz] = box.center;
    const d2 = (p: number[]): number => {
      const dx = p[0] - cx, dy = p[1] - cy, dz = p[2] - cz;
      return dx * dx + dy * dy + dz * dz;
    };
    return (a, b, c) => {
      if (d2(a) <= r2 && d2(b) <= r2 && d2(c) <= r2) return 'inside';
      // Exact: the sphere intersects the triangle iff its closest point is within r.
      const cp = closestPointOnTriangle(cx, cy, cz, a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      const ex = cp[0] - cx, ey = cp[1] - cy, ez = cp[2] - cz;
      return (ex * ex + ey * ey + ez * ez <= r2) ? 'straddle' : 'outside';
    };
  }

  const toLocal = localizer(box);

  if (shape === 'cylinder') {
    const r2 = (sx / 2) * (sx / 2);
    const hH = sy / 2;
    const inCyl = (p: THREE.Vector3): boolean => Math.abs(p.y) <= hH && (p.x * p.x + p.z * p.z) <= r2;
    return (a, b, c) => {
      const la = toLocal(a).clone(), lb = toLocal(b).clone(), lc = toLocal(c).clone();
      if (inCyl(la) && inCyl(lb) && inCyl(lc)) return 'inside';
      if ((la.y > hH && lb.y > hH && lc.y > hH) || (la.y < -hH && lb.y < -hH && lc.y < -hH)) return 'outside';
      if (xzDist2ToOrigin(la, lb, lc) > r2) return 'outside';
      return 'straddle';
    };
  }

  if (shape === 'cone') {
    const halfR = sx / 2;
    const hH = sy / 2;
    const fullH = hH * 2;
    const inCone = (p: THREE.Vector3): boolean => {
      if (p.y < -hH || p.y > hH) return false;
      const allowedR = halfR * (hH - p.y) / fullH;
      return (p.x * p.x + p.z * p.z) <= allowedR * allowedR;
    };
    return (a, b, c) => {
      const la = toLocal(a).clone(), lb = toLocal(b).clone(), lc = toLocal(c).clone();
      if (inCone(la) && inCone(lb) && inCone(lc)) return 'inside';
      if ((la.y > hH && lb.y > hH && lc.y > hH) || (la.y < -hH && lb.y < -hH && lc.y < -hH)) return 'outside';
      // Cone ⊂ bounding cylinder of radius halfR → outside that cylinder ⇒ outside cone.
      if (xzDist2ToOrigin(la, lb, lc) > halfR * halfR) return 'outside';
      return 'straddle';
    };
  }

  // box (OBB)
  const hx = sx / 2, hy = box.size[1] / 2, hz = box.size[2] / 2;
  return (a, b, c) => {
    const la = toLocal(a).clone(), lb = toLocal(b).clone(), lc = toLocal(c).clone();
    const inA = Math.abs(la.x) <= hx && Math.abs(la.y) <= hy && Math.abs(la.z) <= hz;
    const inB = Math.abs(lb.x) <= hx && Math.abs(lb.y) <= hy && Math.abs(lb.z) <= hz;
    const inC = Math.abs(lc.x) <= hx && Math.abs(lc.y) <= hy && Math.abs(lc.z) <= hz;
    if (inA && inB && inC) return 'inside';
    if ((la.x > hx && lb.x > hx && lc.x > hx) || (la.x < -hx && lb.x < -hx && lc.x < -hx)) return 'outside';
    if ((la.y > hy && lb.y > hy && lc.y > hy) || (la.y < -hy && lb.y < -hy && lc.y < -hy)) return 'outside';
    if ((la.z > hz && lb.z > hz && lc.z > hz) || (la.z < -hz && lb.z < -hz && lc.z < -hz)) return 'outside';
    return 'straddle';
  };
}

/** Build a refine region for an oriented shape so its boundary can be smoothed.
 *  The mesh is subdivided near the shape surface until boundary triangles fall
 *  below `maxEdge`; the centroid selector (`findShapeTriangles`) then paints a
 *  smooth edge on the refined mesh. */
export function shapeRefineRegion(shape: ShapeType, box: OrientedBox, maxEdge: number): RefineRegion {
  return { aabb: shapeAabb(shape, box), maxEdge, classify: shapeClassifier(shape, box) };
}
