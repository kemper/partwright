// Face picking — raycast from mouse position to find triangle index on the viewport mesh

import * as THREE from 'three';
import { getMeshGroup, getCamera, getRenderer } from '../renderer/viewport';
import { ensureBoundsTree } from '../renderer/bvh';

export interface FacePickResult {
  triangleIndex: number;
  point: [number, number, number];
  normal: [number, number, number];
}

const raycaster = new THREE.Raycaster();
// We only ever care about the nearest triangle under the cursor, so let the BVH
// stop at the first hit instead of gathering + sorting every intersection.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(raycaster as any).firstHitOnly = true;
const mouse = new THREE.Vector2();

/** Pick a face from a mouse event on the viewport canvas.
 *  Returns null if no face was hit. */
export function pickFace(event: MouseEvent): FacePickResult | null {
  const canvas = getRenderer().domElement;
  const rect = canvas.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  const camera = getCamera();
  raycaster.setFromCamera(mouse, camera);

  const meshGroup = getMeshGroup();
  // Only intersect the solid mesh (first child), not wireframe or cap
  const solidMesh = meshGroup.children[0];
  if (!(solidMesh instanceof THREE.Mesh)) return null;

  // Build (or reuse) the BVH for the current geometry so the raycast below is
  // O(log n) instead of scanning every triangle. A fresh geometry from
  // updateMesh has no tree yet, so this rebuilds it on the first pick after a
  // mesh change and reuses it for every pick until the geometry is replaced.
  ensureBoundsTree(solidMesh.geometry);

  const intersections = raycaster.intersectObject(solidMesh);
  if (intersections.length === 0) return null;

  const hit = intersections[0];
  if (hit.faceIndex === undefined || hit.faceIndex === null) return null;
  if (!hit.face) return null;

  return {
    triangleIndex: hit.faceIndex,
    point: [hit.point.x, hit.point.y, hit.point.z],
    normal: [hit.face.normal.x, hit.face.normal.y, hit.face.normal.z],
  };
}
