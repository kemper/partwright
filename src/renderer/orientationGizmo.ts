// Orientation gizmo — XYZ axes indicator in the viewport corner
// Uses Three.js ViewHelper for the visual, with custom click-to-snap for Z-up

import * as THREE from 'three';
import { ViewHelper } from 'three/addons/helpers/ViewHelper.js';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { getConfig } from '../config/appConfig';

let viewHelper: ViewHelper | null = null;
let mainCamera: THREE.PerspectiveCamera | null = null;
let mainControls: OrbitControls | null = null;
let canvasEl: HTMLElement | null = null;

// Snap-to-view animation state
let snapAnimating = false;
const snapStartPos = new THREE.Vector3();
const snapTargetPos = new THREE.Vector3();
const snapStartUp = new THREE.Vector3();
const snapTargetUp = new THREE.Vector3();
let snapProgress = 0;

// Z-up view orientations: camera direction from target, camera up vector.
// Top/bottom use a tiny Y offset to avoid degenerate lookAt when view dir is parallel to camera.up.
const VIEW_TARGETS: Record<string, { dir: [number, number, number]; up: [number, number, number] }> = {
  posX: { dir: [1, 0, 0], up: [0, 0, 1] },
  negX: { dir: [-1, 0, 0], up: [0, 0, 1] },
  posY: { dir: [0, 1, 0], up: [0, 0, 1] },
  negY: { dir: [0, -1, 0], up: [0, 0, 1] },
  posZ: { dir: [0, -0.001, 1], up: [0, 0, 1] },
  negZ: { dir: [0, 0.001, -1], up: [0, 0, 1] },
};

// Axis endpoint base positions (unit vectors in gizmo space)
const AXIS_ENDPOINTS: [string, number, number, number][] = [
  ['posX', 1, 0, 0], ['posY', 0, 1, 0], ['posZ', 0, 0, 1],
  ['negX', -1, 0, 0], ['negY', 0, -1, 0], ['negZ', 0, 0, -1],
];

let gizmoCursorActive = false;

export function initOrientationGizmo(
  camera: THREE.PerspectiveCamera,
  canvas: HTMLElement,
  controls: OrbitControls,
): void {
  mainCamera = camera;
  mainControls = controls;
  canvasEl = canvas;

  viewHelper = new ViewHelper(camera, canvas);
  viewHelper.setLabels('X', 'Y', 'Z');
  viewHelper.setLabelStyle('18px system-ui', '#ffffff', 14);
  viewHelper.location = { top: getConfig().renderer.gizmoMarginPx, right: getConfig().renderer.gizmoMarginPx, bottom: 0, left: null };

  // Fix negative axis sprites: default black is invisible on the dark viewport background
  viewHelper.children.forEach(child => {
    if (child instanceof THREE.Sprite && child.userData.type?.startsWith('neg')) {
      child.material.dispose();
      if (child.material.map) child.material.map.dispose();
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 64;
      const ctx = c.getContext('2d')!;
      ctx.beginPath();
      ctx.arc(32, 32, 14, 0, Math.PI * 2);
      ctx.fillStyle = '#666666';
      ctx.fill();
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      child.material = new THREE.SpriteMaterial({ map: tex, toneMapped: false, opacity: 0.4 });
    }
  });

  canvas.addEventListener('click', onGizmoClick);
  canvas.addEventListener('pointermove', onGizmoPointerMove);
}

/** Hit-test gizmo axis endpoints. Returns axis type or null. */
function hitTestGizmo(clientX: number, clientY: number): string | null {
  if (!canvasEl || !mainCamera) return null;

  const rect = canvasEl.getBoundingClientRect();
  const cfg = getConfig().renderer;
  const gizmoLeft = rect.right - cfg.gizmoSizePx - cfg.gizmoMarginPx;
  const gizmoTop = rect.top + cfg.gizmoMarginPx;

  const localX = clientX - gizmoLeft;
  const localY = clientY - gizmoTop;
  if (localX < 0 || localX > cfg.gizmoSizePx || localY < 0 || localY > cfg.gizmoSizePx) return null;

  // Convert to gizmo's orthographic space (-2 to 2)
  const orthoX = (localX / cfg.gizmoSizePx) * 4 - 2;
  const orthoY = -((localY / cfg.gizmoSizePx) * 4 - 2);

  const q = mainCamera.quaternion.clone().invert();
  let best: string | null = null;
  let bestZ = -Infinity;

  for (const [type, x, y, z] of AXIS_ENDPOINTS) {
    const pos = new THREE.Vector3(x, y, z).applyQuaternion(q);
    const dx = orthoX - pos.x;
    const dy = orthoY - pos.y;
    if (Math.sqrt(dx * dx + dy * dy) < getConfig().renderer.gizmoHitRadius && pos.z > bestZ) {
      best = type;
      bestZ = pos.z;
    }
  }

  return best;
}

function onGizmoClick(event: MouseEvent): void {
  if (!mainCamera || !mainControls || snapAnimating) return;

  const axis = hitTestGizmo(event.clientX, event.clientY);
  if (!axis) return;

  const target = VIEW_TARGETS[axis];
  if (!target) return;

  const distance = mainCamera.position.distanceTo(mainControls.target);
  const dir = new THREE.Vector3(...target.dir).normalize();

  snapStartPos.copy(mainCamera.position);
  snapTargetPos.copy(dir).multiplyScalar(distance).add(mainControls.target);
  snapStartUp.copy(mainCamera.up);
  snapTargetUp.set(...target.up);
  snapProgress = 0;
  snapAnimating = true;
}

function onGizmoPointerMove(event: PointerEvent): void {
  if (!canvasEl) return;
  const overAxis = !snapAnimating && hitTestGizmo(event.clientX, event.clientY) !== null;
  if (overAxis && !gizmoCursorActive) {
    canvasEl.style.cursor = 'pointer';
    gizmoCursorActive = true;
  } else if (!overAxis && gizmoCursorActive) {
    canvasEl.style.cursor = '';
    gizmoCursorActive = false;
  }
}

export function renderGizmo(renderer: THREE.WebGLRenderer): void {
  if (!viewHelper) return;
  // Disable autoClear so ViewHelper's internal renderer.render() doesn't
  // wipe the main scene that was already drawn this frame.
  const saved = renderer.autoClear;
  renderer.autoClear = false;
  viewHelper.render(renderer);
  renderer.autoClear = saved;
}

export function updateGizmo(delta: number): void {
  if (!snapAnimating || !mainCamera || !mainControls) return;

  snapProgress = Math.min(1, snapProgress + delta / getConfig().renderer.gizmoSnapDurationSec);
  const t = snapProgress * snapProgress * (3 - 2 * snapProgress); // smoothstep

  mainCamera.position.lerpVectors(snapStartPos, snapTargetPos, t);
  mainCamera.up.lerpVectors(snapStartUp, snapTargetUp, t).normalize();
  mainCamera.lookAt(mainControls.target);

  if (snapProgress >= 1) {
    snapAnimating = false;
  }
}

export function isGizmoAnimating(): boolean {
  return snapAnimating;
}

export function disposeGizmo(): void {
  if (canvasEl) {
    canvasEl.removeEventListener('click', onGizmoClick);
    canvasEl.removeEventListener('pointermove', onGizmoPointerMove);
    if (gizmoCursorActive) {
      canvasEl.style.cursor = '';
      gizmoCursorActive = false;
    }
  }
  viewHelper?.dispose();
  viewHelper = null;
  mainCamera = null;
  mainControls = null;
  canvasEl = null;
}
