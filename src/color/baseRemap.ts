// Map a refined-mesh triangle back to the pristine base mesh it was subdivided
// from. Projection paint collects triangle ids in the *current* working mesh's
// index space; a `{ kind: 'triangles' }` descriptor must store *base* ids so
// every later rebuild remaps them base→child correctly (the alternative —
// storing refined-space ids — smears the colour once the mesh is rebuilt).
//
// A refined child triangle lies on its parent's surface, so the base triangle
// closest to the child's centroid is its parent. We answer that with a BVH
// closest-point query on the base mesh — built lazily and cached, and only ever
// touched when the mesh is actually refined (the common, unrefined case maps
// identically and never builds anything).

import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { MeshData } from '../geometry/types';

let cacheMesh: MeshData | null = null;
let cacheBvh: MeshBVH | null = null;
let cacheGeom: THREE.BufferGeometry | null = null;

function bvhFor(base: MeshData): MeshBVH {
  if (cacheMesh === base && cacheBvh) return cacheBvh;
  cacheGeom?.dispose();
  const positions = new Float32Array(base.numVert * 3);
  for (let i = 0; i < base.numVert; i++) {
    positions[i * 3] = base.vertProperties[i * base.numProp];
    positions[i * 3 + 1] = base.vertProperties[i * base.numProp + 1];
    positions[i * 3 + 2] = base.vertProperties[i * base.numProp + 2];
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setIndex(new THREE.BufferAttribute(base.triVerts, 1));
  cacheMesh = base;
  cacheGeom = geom;
  cacheBvh = new MeshBVH(geom);
  return cacheBvh;
}

const _centroid = new THREE.Vector3();
const _hit: { point: THREE.Vector3; distance: number; faceIndex: number } = {
  point: new THREE.Vector3(), distance: 0, faceIndex: -1,
};

/** Base-mesh triangle index a current-mesh triangle was refined from. Returns
 *  `t` unchanged when the meshes are identical (unrefined) or the lookup fails. */
export function baseTriangleOf(current: MeshData, base: MeshData, t: number): number {
  if (current === base) return t;
  const { triVerts, vertProperties, numProp } = current;
  const v0 = triVerts[t * 3], v1 = triVerts[t * 3 + 1], v2 = triVerts[t * 3 + 2];
  _centroid.set(
    (vertProperties[v0 * numProp] + vertProperties[v1 * numProp] + vertProperties[v2 * numProp]) / 3,
    (vertProperties[v0 * numProp + 1] + vertProperties[v1 * numProp + 1] + vertProperties[v2 * numProp + 1]) / 3,
    (vertProperties[v0 * numProp + 2] + vertProperties[v1 * numProp + 2] + vertProperties[v2 * numProp + 2]) / 3,
  );
  const res = bvhFor(base).closestPointToPoint(_centroid, _hit);
  return res && res.faceIndex >= 0 ? res.faceIndex : t;
}
