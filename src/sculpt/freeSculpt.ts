// Free-sculpt mode — minimal "push vertex" tool used only on frozen-mesh
// versions. On click, the closest vertex of the hit triangle is shifted
// along the hit normal by a fixed step. The new mesh is validated via
// `Manifold.ofMesh()` and, if valid, the on-disk meshBlob is overwritten in
// place (no new version per click; the blob IS the source of truth).

import { pickFace } from '../color/facePicker';
import { getRenderer, setUserOrbitLock, isUserOrbitLocked } from '../renderer/viewport';
import type { MeshData } from '../geometry/types';

export const DEFAULT_PUSH_STEP = 1.0;

let active = false;
let priorOrbitLock = false;
let pushStep = DEFAULT_PUSH_STEP;
let onPush: ((newMesh: MeshData) => void | Promise<void>) | null = null;
let getMesh: (() => MeshData | null) | null = null;

// In-memory undo/redo stacks — cleared by clearFreeMeshHistory() on version
// navigation (page reload also clears them naturally).
const undoStack: MeshData[] = [];
const redoStack: MeshData[] = [];

function copyMesh(m: MeshData): MeshData {
  return {
    vertProperties: new Float32Array(m.vertProperties),
    triVerts: new Uint32Array(m.triVerts),
    numVert: m.numVert,
    numTri: m.numTri,
    numProp: m.numProp,
  };
}

export function canUndoFreePush(): boolean { return undoStack.length > 0; }
export function canRedoFreePush(): boolean { return redoStack.length > 0; }

export function clearFreeMeshHistory(): void {
  undoStack.length = 0;
  redoStack.length = 0;
}

export function isActive(): boolean { return active; }

export function setPushStep(step: number): void {
  if (Number.isFinite(step) && step > 0) pushStep = step;
}

export function getPushStep(): number { return pushStep; }

export function configure(opts: {
  getMesh: () => MeshData | null;
  onPush: (newMesh: MeshData) => void | Promise<void>;
}): void {
  getMesh = opts.getMesh;
  onPush = opts.onPush;
}

export function activate(): void {
  if (active) return;
  active = true;
  priorOrbitLock = isUserOrbitLocked();
  setUserOrbitLock(true);
  const canvas = getRenderer().domElement;
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.style.cursor = 'crosshair';
}

export function deactivate(): void {
  if (!active) return;
  active = false;
  if (!priorOrbitLock) setUserOrbitLock(false);
  const canvas = getRenderer().domElement;
  canvas.removeEventListener('mousedown', onMouseDown);
  canvas.style.cursor = '';
}

/** Apply a push at a specific triangle index along a given normal vector.
 *  Usable programmatically (AI tools) or via click (onMouseDown). */
function applyPushAtTriangle(
  mesh: MeshData,
  triangleIndex: number,
  hitPoint: [number, number, number],
  normal: [number, number, number],
  step: number,
): MeshData {
  const { triVerts, vertProperties, numProp } = mesh;
  const t = triangleIndex;
  const vIdxs = [triVerts[t * 3], triVerts[t * 3 + 1], triVerts[t * 3 + 2]];

  const [px, py, pz] = hitPoint;
  let bestIdx = vIdxs[0];
  let bestDistSq = Infinity;
  for (const vi of vIdxs) {
    const x = vertProperties[vi * numProp];
    const y = vertProperties[vi * numProp + 1];
    const z = vertProperties[vi * numProp + 2];
    const dx = x - px, dy = y - py, dz = z - pz;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestDistSq) {
      bestDistSq = d;
      bestIdx = vi;
    }
  }

  const newVerts = new Float32Array(vertProperties);
  const [nx, ny, nz] = normal;
  newVerts[bestIdx * numProp] += nx * step;
  newVerts[bestIdx * numProp + 1] += ny * step;
  newVerts[bestIdx * numProp + 2] += nz * step;

  return {
    vertProperties: newVerts,
    triVerts: new Uint32Array(triVerts),
    numVert: mesh.numVert,
    numTri: mesh.numTri,
    numProp,
  };
}

function commitPush(oldMesh: MeshData, newMesh: MeshData): void {
  if (!onPush) return;
  undoStack.push(copyMesh(oldMesh));
  redoStack.length = 0; // new push invalidates redo
  const pending = onPush(newMesh);
  if (pending && typeof (pending as Promise<unknown>).then === 'function') {
    (pending as Promise<unknown>).finally(() => {
      window.dispatchEvent(new CustomEvent('pw-sculpt-push-committed'));
    });
  } else {
    queueMicrotask(() => window.dispatchEvent(new CustomEvent('pw-sculpt-push-committed')));
  }
}

function onMouseDown(event: MouseEvent): void {
  if (event.button !== 0) return;
  if (!getMesh || !onPush) return;
  const mesh = getMesh();
  if (!mesh) return;
  const hit = pickFace(event);
  if (!hit) return;
  event.preventDefault();

  const t = hit.triangleIndex;
  if (t * 3 + 2 >= mesh.triVerts.length) return;
  const newMesh = applyPushAtTriangle(mesh, t, hit.point, hit.normal, pushStep);
  commitPush(mesh, newMesh);
}

/** Programmatic push for AI tool use — requires a previously probed triangle
 *  index, surface point, and normal (e.g. from probePixel). Returns true on
 *  success or false if there is no active mesh. */
export function programmaticPush(
  triangleIndex: number,
  hitPoint: [number, number, number],
  normal: [number, number, number],
  step?: number,
): boolean {
  if (!getMesh || !onPush) return false;
  const mesh = getMesh();
  if (!mesh) return false;
  if (triangleIndex * 3 + 2 >= mesh.triVerts.length) return false;
  const newMesh = applyPushAtTriangle(mesh, triangleIndex, hitPoint, normal, step ?? pushStep);
  commitPush(mesh, newMesh);
  return true;
}

/** Undo the most recent push. Returns the restored mesh (so callers can
 *  verify) or null if the undo stack is empty. The undone mesh goes onto the
 *  redo stack. */
export function undoFreePush(): MeshData | null {
  const prev = undoStack.pop();
  if (!prev || !getMesh || !onPush) return null;
  const current = getMesh();
  if (current) redoStack.push(copyMesh(current));
  const pending = onPush(prev);
  if (pending && typeof (pending as Promise<unknown>).then === 'function') {
    (pending as Promise<unknown>).finally(() => {
      window.dispatchEvent(new CustomEvent('pw-sculpt-push-committed'));
    });
  } else {
    queueMicrotask(() => window.dispatchEvent(new CustomEvent('pw-sculpt-push-committed')));
  }
  return prev;
}

/** Redo the most recently undone push. Returns the restored mesh or null if
 *  the redo stack is empty. */
export function redoFreePush(): MeshData | null {
  const next = redoStack.pop();
  if (!next || !getMesh || !onPush) return null;
  const current = getMesh();
  if (current) undoStack.push(copyMesh(current));
  const pending = onPush(next);
  if (pending && typeof (pending as Promise<unknown>).then === 'function') {
    (pending as Promise<unknown>).finally(() => {
      window.dispatchEvent(new CustomEvent('pw-sculpt-push-committed'));
    });
  } else {
    queueMicrotask(() => window.dispatchEvent(new CustomEvent('pw-sculpt-push-committed')));
  }
  return next;
}
