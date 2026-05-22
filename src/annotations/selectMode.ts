// Select sub-mode — click an annotation to select it (highlight); drag to
// translate it on its own plane (the plane captured at its creation);
// Delete/Backspace removes it; Esc deselects.
//
// Like pen/text, select locks the user orbit so a click-drag on an
// annotation doesn't compete with OrbitControls. The lock-toggle button
// in the toolbar reflects the change via onUserOrbitLockChange.

import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import {
  getAnnotationById,
  removeAnnotationById,
  updateStrokePoints,
  updateTextAnchor,
  type Annotation,
} from './annotations';
import {
  getOverlayGroup,
  setLine2Points,
} from './annotationOverlay';
import {
  endSession,
  hidePlaneOutline,
  screenToPlane,
  sessionToPlane,
  restoreCameraView,
} from './sessionPlane';
import {
  getCamera,
  getRenderer,
  setUserOrbitLock,
  isUserOrbitLocked,
} from '../renderer/viewport';
import { forceDeactivate as forceDeactivatePaint } from '../color/paintUI';
import { forceDeactivate as closeSimplifyMenu } from '../ui/simplifyUI';
import { forceDeactivate as forceDeactivatePen } from './annotateMode';
import { forceDeactivate as forceDeactivateText } from './textMode';

let active = false;
let selectedId: string | null = null;
let priorOrbitLock = false;

// Drag state
let dragging = false;
let dragInitialIntersection: THREE.Vector3 | null = null;
let dragInitialStrokePoints: THREE.Vector3[] | null = null;
let dragInitialTextAnchor: THREE.Vector3 | null = null;
// Live object being dragged — mutated directly on each pointermove for
// instant visual feedback. The store is only updated once on pointer-up.
let dragLiveObject: Line2 | THREE.Sprite | null = null;

const raycaster = new THREE.Raycaster();
raycaster.params.Line = { threshold: 0.2 };

const listeners: Array<(active: boolean) => void> = [];
const selectionListeners: Array<(id: string | null) => void> = [];

export function isActive(): boolean {
  return active;
}

export function getSelectedId(): string | null {
  return selectedId;
}

export function onActiveChange(fn: (active: boolean) => void): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

export function onSelectionChange(fn: (id: string | null) => void): () => void {
  selectionListeners.push(fn);
  return () => {
    const i = selectionListeners.indexOf(fn);
    if (i >= 0) selectionListeners.splice(i, 1);
  };
}

function notifyActiveChange(): void {
  for (const fn of listeners) fn(active);
}

function notifySelectionChange(): void {
  for (const fn of selectionListeners) fn(selectedId);
}

export function activate(): void {
  if (active) return;
  forceDeactivatePaint();
  closeSimplifyMenu();
  forceDeactivatePen({ keepSession: false });
  forceDeactivateText({ keepSession: false });
  // Select doesn't have a session plane — each annotation has its own.
  hidePlaneOutline();
  endSession();

  active = true;
  // Lock orbit so a click-drag on an annotation doesn't fight OrbitControls.
  // The lock-toggle button reflects this via onUserOrbitLockChange.
  priorOrbitLock = isUserOrbitLocked();
  setUserOrbitLock(true);

  const canvas = getRenderer().domElement;
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  document.addEventListener('keydown', onKeyDown);
  canvas.style.cursor = 'default';

  notifyActiveChange();
}

export function deactivate(): void {
  if (!active) return;
  active = false;
  dragging = false;
  dragLiveObject = null;
  selectedId = null;
  notifySelectionChange();
  if (!priorOrbitLock) setUserOrbitLock(false);

  const canvas = getRenderer().domElement;
  canvas.removeEventListener('pointerdown', onPointerDown);
  canvas.removeEventListener('pointermove', onPointerMove);
  canvas.removeEventListener('pointerup', onPointerUp);
  canvas.removeEventListener('pointercancel', onPointerUp);
  document.removeEventListener('keydown', onKeyDown);
  canvas.style.cursor = '';

  notifyActiveChange();
}

export function forceDeactivate(): void {
  if (active) deactivate();
}

/** Restore the viewport camera to the angle from which the given annotation
 *  was originally drawn. Returns true if the annotation exists. */
export function restoreView(id: string): boolean {
  const a = getAnnotationById(id);
  if (!a) return false;
  restoreCameraView(a.camera);
  return true;
}

function setSelection(id: string | null): void {
  if (selectedId === id) return;
  selectedId = id;
  notifySelectionChange();
}

function pickAnnotationAt(event: PointerEvent): Annotation | null {
  const overlay = getOverlayGroup();
  if (!overlay) return null;
  const canvas = getRenderer().domElement;
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  if (x < 0 || x > rect.width || y < 0 || y > rect.height) return null;
  const ndc = new THREE.Vector2(
    (x / rect.width) * 2 - 1,
    -(y / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(ndc, getCamera());

  const hits = raycaster.intersectObjects(overlay.children, false);
  for (const hit of hits) {
    const id = (hit.object.userData as { annotationId?: string })?.annotationId;
    if (!id) continue;
    const ann = getAnnotationById(id);
    if (ann) return ann;
  }
  return null;
}

function findLiveObject(id: string): Line2 | THREE.Sprite | null {
  const overlay = getOverlayGroup();
  if (!overlay) return null;
  for (const c of overlay.children) {
    if ((c.userData as { annotationId?: string })?.annotationId === id) {
      if (c instanceof Line2 || c instanceof THREE.Sprite) return c;
    }
  }
  return null;
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return;
  const ann = pickAnnotationAt(event);
  if (!ann) {
    setSelection(null);
    return;
  }
  setSelection(ann.id);

  // Begin drag against the annotation's stored plane.
  const plane = sessionToPlane(ann.plane);
  const start = screenToPlane(event, plane);
  if (!start) return;

  dragging = true;
  dragInitialIntersection = start;
  // Cache the live three.js object so we can mutate it in-place during the
  // drag — much smoother than going through the store rebuild path each
  // pointermove. We commit to the store once on pointerup.
  dragLiveObject = findLiveObject(ann.id);
  if (ann.type === 'stroke') {
    dragInitialStrokePoints = ann.points.map(p => p.clone());
    dragInitialTextAnchor = null;
  } else {
    dragInitialTextAnchor = ann.anchor.clone();
    dragInitialStrokePoints = null;
  }

  try { (event.target as Element).setPointerCapture?.(event.pointerId); } catch { /* */ }
  event.preventDefault();
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging || !selectedId || !dragInitialIntersection) return;
  const ann = getAnnotationById(selectedId);
  if (!ann) return;

  const plane = sessionToPlane(ann.plane);
  const cur = screenToPlane(event, plane);
  if (!cur) return;

  const delta = cur.clone().sub(dragInitialIntersection);
  if (ann.type === 'stroke' && dragInitialStrokePoints) {
    const moved = dragInitialStrokePoints.map(p => p.clone().add(delta));
    if (dragLiveObject instanceof Line2) {
      setLine2Points(dragLiveObject, moved);
    } else {
      // No live object cached — fall back to store path.
      updateStrokePoints(ann.id, moved);
    }
  } else if (ann.type === 'text' && dragInitialTextAnchor) {
    const moved = dragInitialTextAnchor.clone().add(delta);
    if (dragLiveObject instanceof THREE.Sprite) {
      dragLiveObject.position.copy(moved);
    } else {
      updateTextAnchor(ann.id, moved);
    }
  }
}

function onPointerUp(event: PointerEvent): void {
  if (!dragging) return;
  dragging = false;
  // Commit final position to the store. This triggers a rebuild — same
  // visual result as the live mutation, but now persisted.
  if (selectedId && dragInitialIntersection) {
    const ann = getAnnotationById(selectedId);
    if (ann) {
      const plane = sessionToPlane(ann.plane);
      const cur = screenToPlane(event, plane);
      if (cur) {
        const delta = cur.clone().sub(dragInitialIntersection);
        if (ann.type === 'stroke' && dragInitialStrokePoints) {
          updateStrokePoints(ann.id, dragInitialStrokePoints.map(p => p.clone().add(delta)));
        } else if (ann.type === 'text' && dragInitialTextAnchor) {
          updateTextAnchor(ann.id, dragInitialTextAnchor.clone().add(delta));
        }
      }
    }
  }
  dragInitialIntersection = null;
  dragInitialStrokePoints = null;
  dragInitialTextAnchor = null;
  dragLiveObject = null;
  try { (event.target as Element).releasePointerCapture?.(event.pointerId); } catch { /* */ }
}

function onKeyDown(e: KeyboardEvent): void {
  if (!active || !selectedId) return;
  // Ignore if user is typing in an input field elsewhere
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    removeAnnotationById(selectedId);
    setSelection(null);
  } else if (e.key === 'Escape') {
    setSelection(null);
  }
}
