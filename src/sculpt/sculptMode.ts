// Sculpt mode — pointer wiring for brush strokes. Mirrors
// `color/paintMode.ts` in event shape (mousedown / mousemove / mouseup
// / mouseleave), orbit-lock behavior, and active/inactive lifecycle.
//
// Strokes are recorded as a sequence of world-space sample points. On
// each new sample we apply the brush kernel to the live working mesh
// and push the result to the viewport so the user sees clay-style
// feedback while dragging. On mouseup the completed stroke is pushed
// to the in-memory pendingStrokes[] queue (see strokes.ts).

import { pickFace } from '../color/facePicker';
import { getRenderer, setUserOrbitLock, isUserOrbitLocked, updateMesh } from '../renderer/viewport';
import type { MeshData } from '../geometry/types';
import type { BrushKind, StrokePoint } from './types';
import { applyPush, applySmooth, cloneMesh } from './brushes';
import { addStroke, getStrokes, getSubdivisionLevel, setSubdivisionLevel } from './strokes';
import { subdivide } from './subdivide';
import { replayStrokes } from './replay';

let active = false;

/** Brush settings. Adjusted by the sculpt UI. */
let currentBrush: BrushKind = 'push';
let currentRadius = 3;
let currentStrength = 0.5;

/** Base mesh (the original from runCode) — captured the moment sculpt
 *  mode activates, so cancel/discard can return to it. */
let baseMesh: MeshData | null = null;
/** The live "working" mesh — base plus subdivision plus every applied
 *  brush sample so far. Pushed to the viewport on each sample so the
 *  user sees the deformation in real time. */
let workingMesh: MeshData | null = null;

/** In-progress stroke samples while the mouse is held down. */
let dragging = false;
let dragBrush: BrushKind = 'push';
let dragRadius = 0;
let dragStrength = 0;
let dragPoints: StrokePoint[] = [];
let lastSample: [number, number, number] | null = null;

/** Throttle threshold — don't add a new sample if it's closer than this
 *  to the last sample. Keeps the recording reasonably compact and the
 *  per-sample brush apply cheap. */
const SAMPLE_MIN_DISTANCE = 0.1;

let priorOrbitLock = false;

let onMeshChange: ((mesh: MeshData) => void) | null = null;

export function isActive(): boolean { return active; }

export function setBrush(b: BrushKind): void { currentBrush = b; }
export function getBrush(): BrushKind { return currentBrush; }

export function setRadius(r: number): void { currentRadius = Math.max(0.01, r); }
export function getRadius(): number { return currentRadius; }

export function setStrength(s: number): void { currentStrength = Math.max(0, Math.min(1, s)); }
export function getStrength(): number { return currentStrength; }

/** Notify other systems (e.g. main.ts) when the working mesh changes
 *  so they can refresh multiview/elevations alongside the live viewport. */
export function setOnMeshChange(fn: ((mesh: MeshData) => void) | null): void {
  onMeshChange = fn;
}

/** Called by main.ts whenever a fresh mesh comes out of runCode. */
export function updateSculptBaseMesh(mesh: MeshData): void {
  baseMesh = mesh;
  // If we're not actively sculpting, drop any working state — it's
  // tied to a now-stale base.
  if (!active) {
    workingMesh = null;
  } else {
    rebuildWorkingFromBase();
  }
}

export function getBaseMesh(): MeshData | null {
  return baseMesh;
}

export function getWorkingMesh(): MeshData | null {
  return workingMesh;
}

/** Apply one extra midpoint-subdivision pass to the working mesh and
 *  bump the pending subdivision level by one. Pure UI shortcut. */
export function subdivideOnce(): MeshData | null {
  if (!baseMesh) return null;
  const newLevel = getSubdivisionLevel() + 1;
  setSubdivisionLevel(newLevel);
  rebuildWorkingFromBase();
  return workingMesh;
}

function rebuildWorkingFromBase(): void {
  if (!baseMesh) { workingMesh = null; return; }
  const level = getSubdivisionLevel();
  workingMesh = level > 0 ? subdivide(baseMesh, level) : cloneMesh(baseMesh);
  pushMeshToViewport();
}

function pushMeshToViewport(): void {
  if (!workingMesh) return;
  updateMesh(workingMesh, { skipAutoFrame: true });
  if (onMeshChange) onMeshChange(workingMesh);
}

export function activate(): void {
  if (active) return;
  active = true;

  if (baseMesh) rebuildWorkingFromBase();

  priorOrbitLock = isUserOrbitLocked();
  setUserOrbitLock(true);

  const canvas = getRenderer().domElement;
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('mouseleave', onMouseLeave);
  canvas.style.cursor = 'crosshair';
}

export function deactivate(): void {
  if (!active) return;
  active = false;
  dragging = false;
  dragPoints = [];
  lastSample = null;

  if (!priorOrbitLock) setUserOrbitLock(false);

  const canvas = getRenderer().domElement;
  canvas.removeEventListener('mousedown', onMouseDown);
  canvas.removeEventListener('mousemove', onMouseMove);
  canvas.removeEventListener('mouseup', onMouseUp);
  canvas.removeEventListener('mouseleave', onMouseLeave);
  canvas.style.cursor = '';
}

function onMouseDown(event: MouseEvent): void {
  if (event.button !== 0) return;
  if (!workingMesh) return;
  const hit = pickFace(event);
  if (!hit) return;

  dragging = true;
  dragBrush = currentBrush;
  dragRadius = currentRadius;
  dragStrength = currentStrength;
  dragPoints = [];
  lastSample = null;

  recordSample(hit.point, hit.normal);
  event.preventDefault();
}

function onMouseMove(event: MouseEvent): void {
  if (!dragging || !workingMesh) return;
  const hit = pickFace(event);
  if (!hit) return;

  if (lastSample) {
    const dx = hit.point[0] - lastSample[0];
    const dy = hit.point[1] - lastSample[1];
    const dz = hit.point[2] - lastSample[2];
    if (dx * dx + dy * dy + dz * dz < SAMPLE_MIN_DISTANCE * SAMPLE_MIN_DISTANCE) {
      return;
    }
  }

  recordSample(hit.point, hit.normal);
}

function onMouseUp(event: MouseEvent): void {
  if (event.button !== 0) return;
  finishStroke();
}

function onMouseLeave(): void {
  finishStroke();
}

function recordSample(
  point: [number, number, number],
  normal: [number, number, number],
): void {
  if (!workingMesh) return;
  const sample: StrokePoint = {
    x: point[0], y: point[1], z: point[2],
    nx: normal[0], ny: normal[1], nz: normal[2],
  };
  dragPoints.push(sample);
  lastSample = point;

  // Apply this single sample to the live mesh so the user sees it.
  if (dragBrush === 'push') {
    applyPush(workingMesh, point, normal, dragRadius, dragStrength);
  } else if (dragBrush === 'smooth') {
    applySmooth(workingMesh, point, dragRadius, dragStrength);
  }
  pushMeshToViewport();
}

function finishStroke(): void {
  if (!dragging) return;
  dragging = false;
  if (dragPoints.length === 0) {
    lastSample = null;
    return;
  }
  // Commit the stroke to the in-memory pending list.
  addStroke(dragBrush, dragPoints, dragRadius, dragStrength);
  dragPoints = [];
  lastSample = null;
}

/** Cancel all in-progress sculpt state and restore the base mesh.
 *  Used by the UI "Cancel/Discard" button. The pendingStrokes queue
 *  (in strokes.ts) is cleared by the caller. */
export function discardPending(): void {
  if (!baseMesh) return;
  // Clear any current drag.
  dragging = false;
  dragPoints = [];
  lastSample = null;
  // The strokes module is cleared externally so the order between the
  // store and our local working mesh is unambiguous.
  if (active) {
    rebuildWorkingFromBase();
  } else {
    workingMesh = null;
    updateMesh(baseMesh, { skipAutoFrame: true });
    if (onMeshChange) onMeshChange(baseMesh);
  }
}

/** Rebuild the working mesh by replaying every remaining stroke over
 *  the base. Used after Undo (one stroke popped from the store) so the
 *  preview catches up to the truncated stroke list. */
export function rebuildFromStrokes(): void {
  if (!baseMesh) return;
  const replayed = replayStrokes(baseMesh, getStrokes());
  workingMesh = replayed;
  pushMeshToViewport();
}
