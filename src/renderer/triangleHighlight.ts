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
import { getConfig } from '../config/appConfig';

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

// === Isolate: ghost everything except one part ===
// The selected part is redrawn opaque (with its drawn colours) while the rest
// of the model fades to a translucent ghost. A fused part can't be hidden —
// it shares a solid with its neighbours — so ghosting is the honest view.
// Like the tint, `updateMesh` sweeps it (it rebuilds the solid's material and
// clears the group); the host re-applies it after each mesh update.

const ISOLATE_NAME = 'object-part-isolate';
let isolateOverlay: THREE.Mesh | null = null;
let ghosted: { material: THREE.Material; transparent: boolean; opacity: number; depthWrite: boolean } | null = null;

/** Ghost the displayed model except `triangles` of `mesh` (the mesh currently
 *  shown — its `triColors`, when present, colour the isolated part). */
export function showIsolation(mesh: MeshData, triangles: Iterable<number>): number {
  clearIsolation();
  const solid = getMeshGroup().children[0];
  if (!(solid instanceof THREE.Mesh) || Array.isArray(solid.material)) return 0;
  const tris = Array.from(triangles).filter(t => t >= 0 && t < mesh.numTri);
  if (tris.length === 0) return 0;

  const { triVerts, vertProperties, numProp, triColors } = mesh;
  const positions = new Float32Array(tris.length * 9);
  const colors = triColors ? new Float32Array(tris.length * 9) : null;
  const painted = (triColors as (Uint8Array & { _painted?: Uint8Array }) | undefined)?._painted;
  let i = 0;
  for (const t of tris) {
    let r = 0x4a / 255, g = 0x9e / 255, b = 0xff / 255;
    if (triColors && (painted ? painted[t] === 1 : (triColors[t * 3] | triColors[t * 3 + 1] | triColors[t * 3 + 2]) !== 0)) {
      r = triColors[t * 3] / 255; g = triColors[t * 3 + 1] / 255; b = triColors[t * 3 + 2] / 255;
    }
    for (let k = 0; k < 3; k++) {
      const v = triVerts[t * 3 + k];
      if (colors) { colors[i] = r; colors[i + 1] = g; colors[i + 2] = b; }
      positions[i++] = vertProperties[v * numProp];
      positions[i++] = vertProperties[v * numProp + 1];
      positions[i++] = vertProperties[v * numProp + 2];
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (colors) geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  // Same shading as the model (a clone of its material, clipping included).
  const mat = solid.material.clone();
  if (colors) (mat as THREE.MeshStandardMaterial).vertexColors = true;
  isolateOverlay = new THREE.Mesh(geo, mat);
  isolateOverlay.name = ISOLATE_NAME;
  isolateOverlay.renderOrder = 997;
  isolateOverlay.raycast = () => {};

  const m = solid.material;
  ghosted = { material: m, transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite };
  m.transparent = true;
  m.opacity = getConfig().renderer.isolateGhostOpacity;
  m.depthWrite = false;
  m.needsUpdate = true;

  getMeshGroup().add(isolateOverlay);
  requestRender();
  return tris.length;
}

/** Restore the model and drop the isolation overlay (no-op when not isolating). */
export function clearIsolation(): void {
  if (ghosted) {
    const { material: m } = ghosted;
    m.transparent = ghosted.transparent;
    m.opacity = ghosted.opacity;
    m.depthWrite = ghosted.depthWrite;
    m.needsUpdate = true;
    ghosted = null;
  }
  if (isolateOverlay) {
    isolateOverlay.parent?.remove(isolateOverlay);
    isolateOverlay.geometry.dispose();
    (isolateOverlay.material as THREE.Material).dispose();
    isolateOverlay = null;
  }
  requestRender();
}

/** True while an isolation is on screen — false once a mesh update swept it. */
export function isIsolationActive(): boolean {
  if (isolateOverlay && isolateOverlay.parent !== getMeshGroup()) {
    // Swept by updateMesh: its geometry/material were disposed with the group,
    // and the ghosted material belonged to the old solid.
    isolateOverlay = null;
    ghosted = null;
  }
  return isolateOverlay !== null;
}

/** Temporarily un-ghost the model (for a scene-graph export such as GLB, which
 *  would otherwise bake the ghost's transparency). Returns a restore function. */
export function suspendIsolation(): () => void {
  if (!isIsolationActive() || !ghosted) return () => {};
  const g = ghosted;
  const m = g.material;
  const saved = { transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite };
  m.transparent = g.transparent; m.opacity = g.opacity; m.depthWrite = g.depthWrite;
  return () => {
    m.transparent = saved.transparent; m.opacity = saved.opacity; m.depthWrite = saved.depthWrite;
  };
}
