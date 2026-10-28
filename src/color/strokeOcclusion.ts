// Occlusion for brush strokes — "paint only what the camera can see".
//
// The smooth brush resolves its footprint analytically from the stored stroke
// (on the main thread and in the subdivision Worker, on every rebuild), so it
// can't use the screen's depth buffer the way the projection brush does. A
// stroke that stores its camera (`view`) and asks for occlusion instead casts a
// ray from each candidate triangle toward that camera against the pristine base
// mesh: a hit means something sits between the triangle and the camera, so the
// triangle is hidden and stays unpainted. Deterministic — the same stroke
// resolves the same way on every rebuild — and only touched by strokes that
// opt in.

import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { MeshData } from '../geometry/types';
import type { BrushView } from './subdivide';

const bvhCache = new WeakMap<MeshData, { bvh: MeshBVH; diag: number }>();

function bvhFor(mesh: MeshData): { bvh: MeshBVH; diag: number } {
  const hit = bvhCache.get(mesh);
  if (hit) return hit;
  const positions = new Float32Array(mesh.numVert * 3);
  for (let i = 0; i < mesh.numVert; i++) {
    positions[i * 3] = mesh.vertProperties[i * mesh.numProp];
    positions[i * 3 + 1] = mesh.vertProperties[i * mesh.numProp + 1];
    positions[i * 3 + 2] = mesh.vertProperties[i * mesh.numProp + 2];
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  // A copy of the index: the BVH must never reorder the shared base mesh's
  // triVerts (render / export / slicing all read it).
  geom.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.triVerts), 1));
  const bvh = new MeshBVH(geom, { indirect: true });
  const box = bvh.getBoundingBox(new THREE.Box3());
  const entry = { bvh, diag: box.isEmpty() ? 1 : box.min.distanceTo(box.max) || 1 };
  bvhCache.set(mesh, entry);
  return entry;
}

/** A predicate telling whether a surface point is hidden from the stroke's
 *  camera by the `occluder` mesh. Rays leave the point toward the camera
 *  position (perspective) or against the view direction (parallel), starting a
 *  hair off the surface so the point's own face doesn't count as a hit. */
export function makeOcclusionTest(occluder: MeshData, view: BrushView): (x: number, y: number, z: number) => boolean {
  const { bvh, diag } = bvhFor(occluder);
  const eps = diag * 1e-5;
  const ray = new THREE.Ray();
  const dir = new THREE.Vector3();
  const fwd = new THREE.Vector3(view.dir[0], view.dir[1], view.dir[2]).normalize();
  const origin = view.origin ? new THREE.Vector3(view.origin[0], view.origin[1], view.origin[2]) : null;
  return (x, y, z) => {
    let far = Infinity;
    if (origin) {
      dir.set(origin.x - x, origin.y - y, origin.z - z);
      far = dir.length();
      if (far === 0) return false;
      dir.divideScalar(far);
    } else {
      dir.copy(fwd).negate();
    }
    ray.origin.set(x, y, z).addScaledVector(dir, eps);
    ray.direction.copy(dir);
    return bvh.raycastFirst(ray, THREE.DoubleSide, 0, far - 2 * eps) !== null;
  };
}
