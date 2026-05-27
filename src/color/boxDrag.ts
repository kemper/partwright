// Shape drag — interactive paint-by-shape tool. Spawns a translucent shape
// (box, sphere, cylinder, or cone) in the viewport, gives the user a transform
// gizmo to position/rotate/scale it, and paints every triangle whose centroid
// is inside the shape when the user clicks "Paint inside shape".
//
// After painting the shape fades to low opacity so the user can see the result.
// It brightens again the moment the user hovers a gizmo handle or starts a drag.

import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { MeshData } from '../geometry/types';
import { getScene, getCamera, getRenderer, setGizmoLock } from '../renderer/viewport';
import { addRegion, getRegions } from './regions';
import { getColor, getCurrentMesh, shapeSmoothDescriptorFields } from './paintMode';
import { findShapeTriangles, type OrientedBox, type ShapeType } from './boxPaint';
import { meshBounds } from './slabPaint';

export type { ShapeType };
export type BoxMode = 'translate' | 'rotate' | 'scale';

let active = false;
let mode: BoxMode = 'translate';
let shapeType: ShapeType = 'box';
let boxCommitted = false; // true after a paint — dims the shape until next interaction
let shapeVisible = true;

let proxy: THREE.Object3D | null = null; // invisible — TransformControls attaches here
let shapeMesh: THREE.Mesh | null = null; // translucent shape rendered in the viewport
let shapeEdges: THREE.LineSegments | null = null;
let gizmo: TransformControls | null = null;
let gizmoHelper: THREE.Object3D | null = null;

const changeListeners: Array<(box: OrientedBox) => void> = [];
const visibilityListeners: Array<() => void> = [];

export function isBoxActive(): boolean { return active; }

export function onBoxChange(fn: (box: OrientedBox) => void): () => void {
  changeListeners.push(fn);
  return () => {
    const i = changeListeners.indexOf(fn);
    if (i >= 0) changeListeners.splice(i, 1);
  };
}

export function onShapeVisibilityChange(fn: () => void): () => void {
  visibilityListeners.push(fn);
  return () => {
    const i = visibilityListeners.indexOf(fn);
    if (i >= 0) visibilityListeners.splice(i, 1);
  };
}

function notifyChange(): void {
  const box = getBox();
  for (const fn of changeListeners) fn(box);
}

function notifyVisibility(): void {
  for (const fn of visibilityListeners) fn();
}

export function getShapeVisible(): boolean { return shapeVisible; }

export function setShapeVisible(v: boolean): void {
  if (shapeVisible === v) return;
  shapeVisible = v;
  if (proxy) proxy.visible = v;
  if (gizmoHelper) gizmoHelper.visible = v;
  notifyVisibility();
}

export function setBoxMode(m: BoxMode): void {
  mode = m;
  if (gizmo) gizmo.setMode(m);
}

export function getBoxMode(): BoxMode { return mode; }

export function getShapeType(): ShapeType { return shapeType; }

export function setShapeType(s: ShapeType): void {
  if (shapeType === s) return;
  shapeType = s;
  boxCommitted = false;
  if (active) {
    rebuildShapeVisual();
    notifyChange();
  }
}

export function getBox(): OrientedBox {
  if (!proxy) return { center: [0, 0, 0], size: [1, 1, 1], quaternion: [0, 0, 0, 1] };
  return {
    center: [proxy.position.x, proxy.position.y, proxy.position.z],
    size: [proxy.scale.x, proxy.scale.y, proxy.scale.z],
    quaternion: [proxy.quaternion.x, proxy.quaternion.y, proxy.quaternion.z, proxy.quaternion.w],
  };
}

/** Programmatically set the box transform (from numeric-input edits). */
export function setBox(box: Partial<OrientedBox>): void {
  if (!proxy || !shapeMesh || !shapeEdges) return;
  if (box.center) proxy.position.set(box.center[0], box.center[1], box.center[2]);
  if (box.size) proxy.scale.set(Math.max(0.001, box.size[0]), Math.max(0.001, box.size[1]), Math.max(0.001, box.size[2]));
  if (box.quaternion) proxy.quaternion.set(box.quaternion[0], box.quaternion[1], box.quaternion[2], box.quaternion[3]);
  syncVisuals();
  notifyChange();
}

export function activate(): void {
  if (active) return;
  active = true;
  shapeVisible = true;
  buildShape();
  buildGizmo();
  notifyChange();
  notifyVisibility();
}

export function deactivate(): void {
  if (!active) return;
  active = false;
  setGizmoLock(false);
  disposeGizmo();
  disposeShape();
  boxCommitted = false;
  shapeVisible = true;
}

export function onMeshChanged(): void {
  if (!active) return;
  disposeShape();
  buildShape();
  if (gizmo && proxy) {
    gizmo.attach(proxy);
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
  const size = new THREE.Vector3(
    Math.max(0.1, (bb.max[0] - bb.min[0]) * 1.1),
    Math.max(0.1, (bb.max[1] - bb.min[1]) * 1.1),
    Math.max(0.1, (bb.max[2] - bb.min[2]) * 1.1),
  );
  return { center, size };
}

function makeShapeGeometry(shape: ShapeType): THREE.BufferGeometry {
  switch (shape) {
    case 'sphere':   return new THREE.SphereGeometry(0.5, 16, 10);
    case 'cylinder': return new THREE.CylinderGeometry(0.5, 0.5, 1, 24);
    case 'cone':     return new THREE.ConeGeometry(0.5, 1, 24);
    default:         return new THREE.BoxGeometry(1, 1, 1);
  }
}

function buildShape(): void {
  const mesh = getCurrentMesh();
  if (!mesh) return;

  const { center, size } = defaultBoxFor(mesh);

  proxy = new THREE.Object3D();
  proxy.position.copy(center);
  proxy.scale.copy(size);
  // Attach to the scene (not meshGroup) so updateMesh() clearing meshGroup
  // children doesn't wipe the proxy when a paint region is committed.
  getScene().add(proxy);

  const geo = makeShapeGeometry(shapeType);
  const hex = colorToHex(getColor());
  const mat = new THREE.MeshBasicMaterial({
    color: hex,
    transparent: true,
    opacity: 0.18,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  shapeMesh = new THREE.Mesh(geo, mat);
  shapeMesh.name = 'paint-shape';
  shapeMesh.renderOrder = 998;
  proxy.add(shapeMesh);

  const edgeGeo = new THREE.EdgesGeometry(geo);
  const edgeMat = new THREE.LineBasicMaterial({ color: hex, transparent: true, opacity: 0.8, depthTest: false });
  shapeEdges = new THREE.LineSegments(edgeGeo, edgeMat);
  shapeEdges.name = 'paint-shape-edges';
  shapeEdges.renderOrder = 999;
  proxy.add(shapeEdges);
}

/** Swap out the visual geometry for the new shape type while preserving position/scale/rotation. */
function rebuildShapeVisual(): void {
  if (!proxy || !shapeMesh || !shapeEdges) return;
  const oldGeo = shapeMesh.geometry;
  const oldEdgeGeo = shapeEdges.geometry;

  const newGeo = makeShapeGeometry(shapeType);
  shapeMesh.geometry = newGeo;

  const newEdgeGeo = new THREE.EdgesGeometry(newGeo);
  shapeEdges.geometry = newEdgeGeo;

  oldGeo.dispose();
  oldEdgeGeo.dispose();
}

function disposeShape(): void {
  if (shapeMesh) {
    shapeMesh.geometry.dispose();
    (shapeMesh.material as THREE.Material).dispose();
    shapeMesh.parent?.remove(shapeMesh);
    shapeMesh = null;
  }
  if (shapeEdges) {
    shapeEdges.geometry.dispose();
    (shapeEdges.material as THREE.Material).dispose();
    shapeEdges.parent?.remove(shapeEdges);
    shapeEdges = null;
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
  gizmoHelper = gizmo.getHelper();
  getScene().add(gizmoHelper);

  gizmo.addEventListener('change', () => {
    syncVisuals();
    notifyChange();
  });
  gizmo.addEventListener('axis-changed', (e) => {
    if (e.value !== null) restoreFromCommitted();
    setGizmoLock(e.value !== null || gizmo!.dragging);
  });
  gizmo.addEventListener('dragging-changed', (e) => {
    if (e.value === true) restoreFromCommitted();
    setGizmoLock(e.value === true || gizmo!.axis !== null);
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

function restoreFromCommitted(): void {
  if (!boxCommitted) return;
  boxCommitted = false;
  applyOpacity(0.18, 0.8);
}

function applyOpacity(meshOpacity: number, edgeOpacity: number): void {
  if (shapeMesh) (shapeMesh.material as THREE.MeshBasicMaterial).opacity = meshOpacity;
  if (shapeEdges) (shapeEdges.material as THREE.LineBasicMaterial).opacity = edgeOpacity;
}

function syncVisuals(): void {
  if (!shapeMesh || !shapeEdges) return;
  const hex = colorToHex(getColor());
  (shapeMesh.material as THREE.MeshBasicMaterial).color.setHex(hex);
  (shapeEdges.material as THREE.LineBasicMaterial).color.setHex(hex);
}

export function refreshColor(): void {
  if (active) syncVisuals();
}

/** Commit the shape's current footprint as a paint region. Returns the painted
 *  triangle count, or 0 if the shape was empty or no mesh was loaded. */
export function commitBox(): number {
  const mesh = getCurrentMesh();
  if (!mesh || !proxy) return 0;

  const box = getBox();
  const triangles = findShapeTriangles(mesh, shapeType, box);
  if (triangles.size === 0) return 0;

  const existingCount = getRegions().length;
  const { smooth, maxEdge } = shapeSmoothDescriptorFields(mesh);
  addRegion(
    `${shapeLabel(shapeType)} ${existingCount + 1}`,
    [...getColor()] as [number, number, number],
    'slab',
    { kind: 'box', center: box.center, size: box.size, quaternion: box.quaternion, shape: shapeType, smooth, maxEdge },
    triangles,
  );

  // Dim the shape so the user can see the painted result underneath.
  // Stays faint until the user hovers a gizmo handle or drags again.
  boxCommitted = true;
  applyOpacity(0.08, 0.4);

  return triangles.size;
}

function shapeLabel(s: ShapeType): string {
  if (s === 'sphere')   return 'Sphere';
  if (s === 'cylinder') return 'Cylinder';
  if (s === 'cone')     return 'Cone';
  return 'Box';
}

function colorToHex(color: [number, number, number]): number {
  const r = Math.round(Math.max(0, Math.min(1, color[0])) * 255);
  const g = Math.round(Math.max(0, Math.min(1, color[1])) * 255);
  const b = Math.round(Math.max(0, Math.min(1, color[2])) * 255);
  return (r << 16) | (g << 8) | b;
}
