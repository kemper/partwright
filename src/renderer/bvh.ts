// Bounding-volume-hierarchy acceleration for mesh raycasting.
//
// Stock three.js raycasting tests the ray against every triangle — O(n) per
// pick. On the dense meshes Partwright routinely paints (hundreds of thousands
// of triangles) that makes hover/pick noticeably heavy. three-mesh-bvh adds a
// precomputed spatial tree so a ray only descends the boxes it actually pierces
// — O(log n) per pick — at the cost of a one-time build per geometry version.
//
// The prototype patch is global (it swaps in the accelerated raycast for all
// meshes), but it's the library's documented integration and is inert until a
// geometry actually has a `boundsTree`. `firstHitOnly` is opted in per-raycaster
// by the caller, not here.

import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

let patched = false;

/** Install the accelerated raycast + boundsTree helpers on the three.js
 *  prototypes. Idempotent — safe to call from every module that wants the BVH. */
function ensurePatched(): void {
  if (patched) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (THREE.BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
  THREE.Mesh.prototype.raycast = acceleratedRaycast;
  patched = true;
}

/** Build the BVH for `geometry` if it doesn't already have one. The tree lives
 *  on the geometry object, so it's rebuilt automatically whenever the viewport
 *  swaps in a fresh BufferGeometry (a new geometry has no `boundsTree`) and is
 *  garbage-collected with the geometry it hangs off — no manual disposal needed
 *  beyond the geometry's own `dispose()`.
 *
 *  `indirect: true` matters here: the viewport's index buffer *is* the live
 *  mesh's `triVerts` array (shared with the app's MeshData), so the BVH must
 *  never reorder it in place — some three-mesh-bvh build configs partition the
 *  index for cache locality, which would corrupt the mesh and break the
 *  assumption that a raycast `faceIndex` equals the mesh triangle index paint
 *  relies on. Indirect mode keeps an internal indirection buffer instead, so the
 *  shared index is left untouched and queries still return original triangle
 *  indices. */
export function ensureBoundsTree(geometry: THREE.BufferGeometry): void {
  ensurePatched();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = geometry as any;
  if (g.boundsTree) return;
  g.computeBoundsTree({ indirect: true });
}
