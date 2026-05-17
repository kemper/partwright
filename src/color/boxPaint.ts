// Box painting — select all triangles whose centroid falls inside an
// oriented bounding box (OBB). The box is defined by a world-space center,
// a size (full lengths along its local X / Y / Z axes), and a quaternion
// that rotates from box-local to world space.
//
// For a centroid C and box (center O, quaternion q, size s), the test is:
//   local = q^-1 * (C - O)
//   inside <=> |local.x| <= s.x/2 AND |local.y| <= s.y/2 AND |local.z| <= s.z/2

import * as THREE from 'three';
import type { MeshData } from '../geometry/types';

export interface OrientedBox {
  center: [number, number, number];
  size: [number, number, number];
  quaternion: [number, number, number, number]; // [x, y, z, w]
}

const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

/** Return the set of triangle indices whose centroid lies inside the OBB. */
export function findBoxTriangles(mesh: MeshData, box: OrientedBox): Set<number> {
  const { triVerts, vertProperties, numProp, numTri } = mesh;
  const result = new Set<number>();

  const halfX = box.size[0] / 2;
  const halfY = box.size[1] / 2;
  const halfZ = box.size[2] / 2;
  if (halfX <= 0 || halfY <= 0 || halfZ <= 0) return result;

  const cx = box.center[0], cy = box.center[1], cz = box.center[2];
  // Inverse rotation = conjugate for unit quaternions: (-x, -y, -z, w).
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
