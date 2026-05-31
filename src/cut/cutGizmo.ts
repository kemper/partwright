// Cut gizmo — interactive Three.js overlay for positioning the cut plane/shape.
// Manages a proxy Object3D (invisible, used for TransformControls), a translucent
// shape visual, edge outline, and an optional arrow showing the keep direction for
// the plane mode. Follows the same pattern as src/color/boxDrag.ts.

import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { MeshData } from '../geometry/types';
import { getScene, getCamera, getRenderer, setGizmoLock, requestRender } from '../renderer/viewport';
import { meshBounds } from '../color/slabPaint';

export type CutShape = 'plane' | 'box' | 'sphere' | 'cylinder';
export type CutMode = 'translate' | 'rotate' | 'scale';
export type KeepSide = 'outside' | 'inside';

export interface CutGizmoParams {
  /** 4x3 column-major matrix: [r00,r10,r20, r01,r11,r21, r02,r12,r22, tx,ty,tz] */
  mat4x3: number[];
  /** Cutter shape dimensions in local space. For plane: unused. For box: [sx,sy,sz].
   *  For sphere: [r,r,r]. For cylinder: [r,r,h] (Z-axis aligned). */
  scale: [number, number, number];
  shape: CutShape;
  keepSide: KeepSide;
}

let active = false;
let cutShape: CutShape = 'plane';
let cutMode: CutMode = 'translate';
let keepSide: KeepSide = 'outside';

let proxy: THREE.Object3D | null = null;
let shapeMesh: THREE.Mesh | null = null;
let shapeEdges: THREE.LineSegments | null = null;
let planeDirArrow: THREE.ArrowHelper | null = null;
let gizmo: TransformControls | null = null;
let gizmoHelper: THREE.Object3D | null = null;

const changeListeners: Array<() => void> = [];

export function onGizmoChange(fn: () => void): () => void {
  changeListeners.push(fn);
  return () => {
    const i = changeListeners.indexOf(fn);
    if (i >= 0) changeListeners.splice(i, 1);
  };
}

function notifyChange(): void {
  for (const fn of changeListeners) fn();
}

export function isGizmoActive(): boolean { return active; }
export function getCutShape(): CutShape { return cutShape; }
export function getCutMode(): CutMode { return cutMode; }
export function getKeepSide(): KeepSide { return keepSide; }

export function setCutMode(m: CutMode): void {
  // Plane doesn't scale (it's infinite); force translate/rotate
  if (cutShape === 'plane' && m === 'scale') return;
  cutMode = m;
  if (gizmo) gizmo.setMode(m);
}

export function setCutShape(s: CutShape): void {
  if (cutShape === s) return;
  cutShape = s;
  if (active) {
    rebuildShapeVisual();
    notifyChange();
  }
}

export function setKeepSide(k: KeepSide): void {
  keepSide = k;
  updateArrow();
  notifyChange();
}

/** Activate the gizmo for the current mesh. */
export function activate(mesh: MeshData): void {
  if (active) return;
  active = true;
  buildShape(mesh);
  buildGizmo();
  notifyChange();
}

export function deactivate(): void {
  if (!active) return;
  active = false;
  setGizmoLock(false);
  disposeGizmo();
  disposeShape();
}

export function onMeshChanged(mesh: MeshData): void {
  if (!active) return;
  // Re-center on new mesh
  const bb = meshBounds(mesh);
  if (proxy) {
    proxy.position.set(
      (bb.min[0] + bb.max[0]) / 2,
      (bb.min[1] + bb.max[1]) / 2,
      (bb.min[2] + bb.max[2]) / 2,
    );
    const maxDim = Math.max(
      bb.max[0] - bb.min[0],
      bb.max[1] - bb.min[1],
      bb.max[2] - bb.min[2],
    );
    proxy.scale.set(maxDim * 1.1, maxDim * 1.1, maxDim * 1.1);
  }
  rebuildShapeVisual();
  notifyChange();
}

/** Get current cut parameters (used by Apply). */
export function getParams(): CutGizmoParams {
  if (!proxy) {
    return {
      mat4x3: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
      scale: [1, 1, 1],
      shape: cutShape,
      keepSide,
    };
  }
  // Extract 4×3 column-major matrix from proxy's world matrix (without scale)
  const m = new THREE.Matrix4().compose(
    proxy.position,
    proxy.quaternion,
    new THREE.Vector3(1, 1, 1),
  );
  const e = m.elements; // THREE.js col-major 4×4
  // cols 0-2 are rotation, col 3 is translation
  const mat4x3 = [
    e[0], e[1], e[2],   // col 0
    e[4], e[5], e[6],   // col 1
    e[8], e[9], e[10],  // col 2
    e[12], e[13], e[14], // translation
  ];
  const scale: [number, number, number] = [proxy.scale.x, proxy.scale.y, proxy.scale.z];
  return { mat4x3, scale, shape: cutShape, keepSide };
}

function makeShapeGeometry(shape: CutShape): THREE.BufferGeometry {
  switch (shape) {
    case 'plane':
      // Large plane aligned with XY (normal = +Z)
      return new THREE.PlaneGeometry(1, 1);
    case 'sphere':
      return new THREE.SphereGeometry(0.5, 16, 10);
    case 'cylinder': {
      // THREE.CylinderGeometry is Y-aligned; rotate by 90° around X to make it Z-aligned
      const geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 24);
      geo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
      return geo;
    }
    default:
      return new THREE.BoxGeometry(1, 1, 1);
  }
}

const CUT_COLOR = 0x22aaff;

function buildShape(mesh: MeshData): void {
  const bb = meshBounds(mesh);
  const center = new THREE.Vector3(
    (bb.min[0] + bb.max[0]) / 2,
    (bb.min[1] + bb.max[1]) / 2,
    (bb.min[2] + bb.max[2]) / 2,
  );
  const maxDim = Math.max(
    bb.max[0] - bb.min[0],
    bb.max[1] - bb.min[1],
    bb.max[2] - bb.min[2],
  );
  const size = Math.max(0.1, maxDim * 1.1);

  proxy = new THREE.Object3D();
  proxy.position.copy(center);
  proxy.scale.set(size, size, size);
  // Attach to scene (not meshGroup) so mesh updates don't wipe the proxy
  getScene().add(proxy);

  buildShapeVisual();
}

function buildShapeVisual(): void {
  if (!proxy) return;

  const geo = makeShapeGeometry(cutShape);
  const mat = new THREE.MeshBasicMaterial({
    color: CUT_COLOR,
    transparent: true,
    opacity: 0.18,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  shapeMesh = new THREE.Mesh(geo, mat);
  shapeMesh.name = 'cut-shape';
  shapeMesh.renderOrder = 998;
  proxy.add(shapeMesh);

  // Edge outline
  const edgeGeo = new THREE.EdgesGeometry(geo);
  const edgeMat = new THREE.LineBasicMaterial({
    color: CUT_COLOR,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
  });
  shapeEdges = new THREE.LineSegments(edgeGeo, edgeMat);
  shapeEdges.name = 'cut-shape-edges';
  shapeEdges.renderOrder = 999;
  proxy.add(shapeEdges);

  // Arrow showing keep direction (only for plane)
  if (cutShape === 'plane') {
    buildArrow();
  }

  requestRender();
}

function buildArrow(): void {
  if (!proxy) return;
  const dir = keepSide === 'outside'
    ? new THREE.Vector3(0, 0, 1)
    : new THREE.Vector3(0, 0, -1);
  planeDirArrow = new THREE.ArrowHelper(
    dir,
    new THREE.Vector3(0, 0, 0),
    0.6,
    keepSide === 'outside' ? 0x44ff44 : 0xff4444,
  );
  planeDirArrow.name = 'cut-dir-arrow';
  proxy.add(planeDirArrow);
}

function updateArrow(): void {
  if (!planeDirArrow) return;
  const dir = keepSide === 'outside'
    ? new THREE.Vector3(0, 0, 1)
    : new THREE.Vector3(0, 0, -1);
  planeDirArrow.setDirection(dir);
  planeDirArrow.setColor(keepSide === 'outside' ? 0x44ff44 : 0xff4444);
  requestRender();
}

function rebuildShapeVisual(): void {
  disposeShapeVisual();
  buildShapeVisual();
  if (gizmo && proxy) {
    gizmo.attach(proxy);
    if (gizmoHelper && !gizmoHelper.parent) getScene().add(gizmoHelper);
  }
  requestRender();
}

function disposeShapeVisual(): void {
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
  if (planeDirArrow) {
    planeDirArrow.traverse(child => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    });
    planeDirArrow.parent?.remove(planeDirArrow);
    planeDirArrow = null;
  }
}

function disposeShape(): void {
  disposeShapeVisual();
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
  gizmo.setMode(cutShape === 'plane' ? 'translate' : cutMode);
  gizmo.setSize(0.8);
  gizmo.attach(proxy);
  gizmoHelper = gizmo.getHelper();
  getScene().add(gizmoHelper);

  gizmo.addEventListener('change', () => {
    notifyChange();
    requestRender();
  });
  gizmo.addEventListener('dragging-changed', (e) => {
    setGizmoLock((e as { value: boolean }).value === true);
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
