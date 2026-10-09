// A single, transient tint over a set of the displayed mesh's triangles — used
// when the user clicks a part or piece in the object list (or an agent calls
// `partwright.highlightObjectPart`). Lives in the mesh group so it shares the
// model's transform, and is ignored by ray-casts so paint/measure picks still
// hit the real mesh. `updateMesh` clears the mesh group on every run, which
// disposes the overlay with it — so a stale highlight can never outlive the
// geometry it was built for (see `isTriangleHighlightActive`).

import * as THREE from 'three';
import { getMeshGroup, requestRender } from './viewport';
import type { MeshData } from '../geometry/types';

const HIGHLIGHT_NAME = 'object-part-highlight';
let overlay: THREE.Mesh | null = null;

/** Tint `triangles` of `mesh` (the mesh currently shown in the viewport). */
export function showTriangleHighlight(mesh: MeshData, triangles: Iterable<number>, color: [number, number, number] = [1, 230 / 255, 0]): number {
  clearTriangleHighlight();
  const tris = Array.from(triangles).filter(t => t >= 0 && t < mesh.numTri);
  if (tris.length === 0) return 0;

  const { triVerts, vertProperties, numProp } = mesh;
  const positions = new Float32Array(tris.length * 9);
  let i = 0;
  for (const t of tris) {
    for (let k = 0; k < 3; k++) {
      const v = triVerts[t * 3 + k];
      positions[i++] = vertProperties[v * numProp];
      positions[i++] = vertProperties[v * numProp + 1];
      positions[i++] = vertProperties[v * numProp + 2];
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color[0], color[1], color[2]),
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  // Inherit the model's clipping planes so the tint respects an active
  // cross-section (setClipping also updates every mesh-group child later).
  const solid = getMeshGroup().children[0];
  if (solid instanceof THREE.Mesh && !Array.isArray(solid.material)) {
    mat.clippingPlanes = solid.material.clippingPlanes ?? [];
  }
  overlay = new THREE.Mesh(geo, mat);
  overlay.name = HIGHLIGHT_NAME;
  overlay.renderOrder = 998;
  overlay.raycast = () => {}; // never intercept picks meant for the model
  getMeshGroup().add(overlay);
  requestRender();
  return tris.length;
}

/** Remove the highlight (no-op when none is shown). */
export function clearTriangleHighlight(): void {
  if (!overlay) return;
  const group = getMeshGroup();
  if (overlay.parent === group) {
    group.remove(overlay);
    overlay.geometry.dispose();
    (overlay.material as THREE.Material).dispose();
    requestRender();
  }
  overlay = null;
}

/** True while a highlight is on screen — false once a mesh update swept it. */
export function isTriangleHighlightActive(): boolean {
  if (overlay && overlay.parent !== getMeshGroup()) overlay = null;
  return overlay !== null;
}
