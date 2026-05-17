// Box drag — interactive oriented-box paint tool. Spawns a translucent box
// in the viewport sized to the model's bounding box, gives the user a
// transform gizmo (translate / rotate / scale) to position it, and commits
// every triangle whose centroid is inside the box when the user clicks
// "Paint inside box".

import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { MeshData } from '../geometry/types';
import { getScene, getCamera, getRenderer, getMeshGroup, setUserOrbitLock, isUserOrbitLocked } from '../renderer/viewport';
import { addRegion, getRegions } from './regions';
import { getColor, getCurrentMesh } from './paintMode';
import { findBoxTriangles, type OrientedBox } from './boxPaint';
import { meshBounds } from './slabPaint';

export type BoxMode = 'translate' | 'rotate' | 'scale';

let active = false;
let mode: BoxMode = 'translate';
let proxy: THREE.Object3D | null = null; // invisible — TransformControls attaches here
let boxMesh: THREE.Mesh | null = null;   // translucent box rendered in the viewport
let boxEdges: THREE.LineSegments | null = null;
let gizmo: TransformControls | null = null;
let gizmoHelper: THREE.Object3D | null = null;
let priorOrbitLock = false;

const changeListeners: Array<(box: OrientedBox) => void> = [];

export function isBoxActive(): boolean { return active; }

export function onBoxChange(fn: (box: OrientedBox) => void): () => void {
  changeListeners.push(fn);
  return () => {
    const i = changeListeners.indexOf(fn);
    if (i >= 0) changeListeners.splice(i, 1);
  };
}

function notifyChange(): void {
  const box = getBox();
  for (const fn of changeListeners) fn(box);
}

export function setBoxMode(m: BoxMode): void {
  mode = m;
  if (gizmo) gizmo.setMode(m);
}

export function getBoxMode(): BoxMode { return mode; }

export function getBox(): OrientedBox {
  if (!proxy) return { center: [0, 0, 0], size: [1, 1, 1], quaternion: [0, 0, 0, 1] };
  return {
    center: [proxy.position.x, proxy.position.y, proxy.position.z],
    size: [proxy.scale.x, proxy.scale.y, proxy.scale.z],
    quaternion: [proxy.quaternion.x, proxy.quaternion.y, proxy.quaternion.z, proxy.quaternion.w],
  };
}

/** Programmatically set the box transform. Use for numeric-input edits. */
export function setBox(box: Partial<OrientedBox>): void {
  if (!proxy || !boxMesh || !boxEdges) return;
  if (box.center) proxy.position.set(box.center[0], box.center[1], box.center[2]);
  if (box.size) proxy.scale.set(Math.max(0.001, box.size[0]), Math.max(0.001, box.size[1]), Math.max(0.001, box.size[2]));
  if (box.quaternion) proxy.quaternion.set(box.quaternion[0], box.quaternion[1], box.quaternion[2], box.quaternion[3]);
  syncVisuals();
  notifyChange();
}

export function activate(): void {
  if (active) return;
  active = true;

  // Reuse the global orbit lock the way other paint tools do. The gizmo also
  // listens for its own dragging-changed event below to lock during a drag,
  // but locking up-front matches the paint mode's "stop orbiting" contract.
  priorOrbitLock = isUserOrbitLocked();
  setUserOrbitLock(true);

  buildBox();
  buildGizmo();
  notifyChange(); // populate the panel's numeric readouts with initial values
}

export function deactivate(): void {
  if (!active) return;
  active = false;
  if (!priorOrbitLock) setUserOrbitLock(false);
  disposeGizmo();
  disposeBox();
}

export function onMeshChanged(): void {
  if (!active) return;
  // Reset the box to fit the new mesh, but preserve the user's chosen mode.
  disposeBox();
  buildBox();
  if (gizmo && proxy) {
    gizmo.attach(proxy);
    // Re-add the gizmo helper in case the mesh swap reset the scene.
    if (gizmoHelper && !gizmoHelper.parent) getScene().add(gizmoHelper);
  }
  syncVisuals();
  notifyChange();
}

function defaultBoxFor(mesh: MeshData): { center: THREE.Vector3; size: THREE.Vector3 } {
  const bb = meshBounds(mesh);
  const center = new THREE.Vector3(
    (bb.min[0] + bb.max[0]) / 2,
    (bb.min[1] + bb.max[1]) / 2,
    (bb.min[2] + bb.max[2]) / 2,
  );
  // Default size = 110% of the model bbox so the box fully contains the
  // model on activation. A "Paint" with default settings paints everything;
  // the user shrinks/rotates/moves the box from there.
  const size = new THREE.Vector3(
    Math.max(0.1, (bb.max[0] - bb.min[0]) * 1.1),
    Math.max(0.1, (bb.max[1] - bb.min[1]) * 1.1),
    Math.max(0.1, (bb.max[2] - bb.min[2]) * 1.1),
  );
  return { center, size };
}

function buildBox(): void {
  const mesh = getCurrentMesh();
  if (!mesh) return;

  const { center, size } = defaultBoxFor(mesh);

  proxy = new THREE.Object3D();
  proxy.position.copy(center);
  proxy.scale.copy(size);
  getMeshGroup().add(proxy);

  // Box mesh is a unit cube; we scale it via the proxy. The proxy ALSO scales
  // the gizmo handles unfortunately — so we make the renderable box a child
  // of the proxy and apply our own visual scale to keep things clean.
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const hex = colorToHex(getColor());
  const mat = new THREE.MeshBasicMaterial({
    color: hex,
    transparent: true,
    opacity: 0.18,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  boxMesh = new THREE.Mesh(geo, mat);
  boxMesh.name = 'paint-box';
  boxMesh.renderOrder = 998;
  proxy.add(boxMesh);

  const edgeGeo = new THREE.EdgesGeometry(geo);
  const edgeMat = new THREE.LineBasicMaterial({ color: hex, transparent: true, opacity: 0.8, depthTest: false });
  boxEdges = new THREE.LineSegments(edgeGeo, edgeMat);
  boxEdges.name = 'paint-box-edges';
  boxEdges.renderOrder = 999;
  proxy.add(boxEdges);
}

function disposeBox(): void {
  if (boxMesh) {
    boxMesh.geometry.dispose();
    (boxMesh.material as THREE.Material).dispose();
    boxMesh.parent?.remove(boxMesh);
    boxMesh = null;
  }
  if (boxEdges) {
    boxEdges.geometry.dispose();
    (boxEdges.material as THREE.Material).dispose();
    boxEdges.parent?.remove(boxEdges);
    boxEdges = null;
  }
  if (proxy) {
    proxy.parent?.remove(proxy);
    proxy = null;
  }
}

function buildGizmo(): void {
  if (!proxy) return;
  const camera = getCamera();
  const canvas = getRenderer().domElement;
  gizmo = new TransformControls(camera, canvas);
  gizmo.setMode(mode);
  gizmo.setSize(0.8);
  gizmo.attach(proxy);
  // The visual helper is a separate Object3D returned by getHelper(); the
  // TransformControls itself is event-only in the modern three.js API.
  gizmoHelper = gizmo.getHelper();
  getScene().add(gizmoHelper);

  gizmo.addEventListener('change', () => {
    syncVisuals();
    notifyChange();
  });
  gizmo.addEventListener('dragging-changed', (e) => {
    if (e.value === true) setUserOrbitLock(true);
  });
}

function disposeGizmo(): void {
  if (gizmo) {
    gizmo.detach();
    gizmo.dispose();
    gizmo = null;
  }
  if (gizmoHelper) {
    gizmoHelper.parent?.remove(gizmoHelper);
    gizmoHelper = null;
  }
}

/** Sync any visual props that depend on current state (e.g. paint color). */
function syncVisuals(): void {
  if (!boxMesh || !boxEdges) return;
  const hex = colorToHex(getColor());
  (boxMesh.material as THREE.MeshBasicMaterial).color.setHex(hex);
  (boxEdges.material as THREE.LineBasicMaterial).color.setHex(hex);
}

/** Refresh visuals after the active paint color changed. */
export function refreshColor(): void {
  if (active) syncVisuals();
}

/** Commit the box's current footprint as a paint region. Returns the painted
 *  triangle count, or 0 if the box was empty or no mesh was loaded. */
export function commitBox(): number {
  const mesh = getCurrentMesh();
  if (!mesh || !proxy) return 0;

  const box = getBox();
  const triangles = findBoxTriangles(mesh, box);
  if (triangles.size === 0) return 0;

  const existingCount = getRegions().length;
  addRegion(
    `Box ${existingCount + 1}`,
    [...getColor()] as [number, number, number],
    'slab', // reuse the 'slab' source bucket — region badges treat it the same
    { kind: 'box', center: box.center, size: box.size, quaternion: box.quaternion },
    triangles,
  );
  return triangles.size;
}

function colorToHex(color: [number, number, number]): number {
  const r = Math.round(Math.max(0, Math.min(1, color[0])) * 255);
  const g = Math.round(Math.max(0, Math.min(1, color[1])) * 255);
  const b = Math.round(Math.max(0, Math.min(1, color[2])) * 255);
  return (r << 16) | (g << 8) | b;
}
