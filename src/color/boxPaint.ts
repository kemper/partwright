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
