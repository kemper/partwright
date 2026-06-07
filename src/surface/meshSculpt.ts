// Mesh Sculpt — interactive, clay-style push / pull / smooth brushing of a
// smooth triangle mesh, with in-memory undo/redo.
//
// Architectural note (mirrors Voxel Studio): a manifold-js version persists as
// CODE that re-runs deterministically on load, so free-form vertex pushing
// can't be expressed as parametric code. The honest path — the same one the
// surface modifiers (fuzzy skin, smooth) already use — is to edit a live mesh
// held in memory and, on commit, BAKE it onto `api.imports[0]` and emit
// `Manifold.ofMesh(api.imports[0])`. Until committed, the editor is locked
// (read-only) so a debounced auto-run can't clobber the in-progress sculpt.
//
// Only vertex positions move; triangle connectivity (triVerts) is never touched
// mid-session, so the mesh stays manifold and per-triangle paint survives. The
// one operation that changes connectivity — Subdivide — resets the undo history
// (old position snapshots no longer match the new vertex count).

import type { MeshData } from '../geometry/types';
import { extractPositions, subdivideToMaxEdge, maxEdgeLength, bboxOf } from './meshSubdivide';
import { applyPush, applySmooth } from './sculptBrush';
import { addPointerSuppressor, isPointerOverModel, getRenderer } from '../renderer/viewport';
import { pickFace } from '../color/facePicker';

/** The brush tools the studio offers. push/pull move vertices along the surface
 *  normal; smooth relaxes them toward their 1-ring average. */
export type SculptTool = 'push' | 'pull' | 'smooth';

export interface MeshSculptCallbacks {
  /** Called whenever the edited mesh changes (activation + each dab + undo). */
  onMeshUpdate: (mesh: MeshData) => void;
  /** Called to lock (true) / unlock (false) the editor while sculpting. */
  onLockChange?: (locked: boolean) => void;
  /** Called after any state change (tool/dab/undo) so the UI can refresh. */
  onStateChange?: () => void;
}

export interface ActivateOptions {
  /** Auto-densify on activate when the mesh is coarser than this triangle count,
   *  so the brush has vertices to move. Default 4000. */
  autoSubdivideBelow?: number;
}

const UNDO_CAP = 60;
// A coarse cube is 12 triangles — useless for clay. Auto-densify up to here.
const AUTO_SUBDIVIDE_TRIS = 4000;
// Hard ceiling so a single Subdivide press can't lock the main thread.
const MAX_TRIS = 600_000;

let active = false;
let mesh: MeshData | null = null;        // live, in-memory sculpted mesh (numProp 3)
let diag = 1;                            // bbox diagonal — scales radius/strength
let tool: SculptTool = 'push';
let radius = 0.12;                       // brush radius in world units
let intensity = 0.5;                     // 0..1 brush strength
let dabCount = 0;                        // dabs applied this session (for the label)

let undoStack: Float32Array[] = [];      // vertex-position snapshots
let redoStack: Float32Array[] = [];
// Drag-stroke state: a whole pointerdown→move→up stroke is one undo step.
let strokeActive = false;
let strokeBefore: Float32Array | null = null;
let strokeChanged = false;
let strokeLastPoint: [number, number, number] | null = null;

let cbMeshUpdate: ((m: MeshData) => void) | null = null;
let cbLockChange: ((locked: boolean) => void) | null = null;
let cbStateChange: (() => void) | null = null;
let removeSuppressor: (() => void) | null = null;
let capturedPointerId: number | null = null;

// ── public getters / setters ────────────────────────────────────────────────

export function isActive(): boolean { return active; }
export function getTool(): SculptTool { return tool; }
export function setTool(t: SculptTool): void {
  if (t === tool) return;
  if (strokeActive) endStroke();
  tool = t;
  cbStateChange?.();
}

/** Bbox diagonal of the live mesh — lets the UI scale its radius slider. */
export function getDiagonal(): number { return diag; }
export function getRadius(): number { return radius; }
export function setRadius(r: number): void {
  radius = Math.max(diag * 0.01, Math.min(diag * 0.5, r));
  cbStateChange?.();
}
/** Brush strength, 0..1. push/pull scale it by the radius; smooth uses it as a
 *  Laplacian blend weight. */
export function getIntensity(): number { return intensity; }
export function setIntensity(v: number): void {
  intensity = Math.max(0, Math.min(1, v));
  cbStateChange?.();
}

export function triangleCount(): number { return mesh?.numTri ?? 0; }
export function dabsApplied(): number { return dabCount; }
export function canUndo(): boolean { return undoStack.length > 0; }
export function canRedo(): boolean { return redoStack.length > 0; }

/** The live sculpted mesh (clone of positions so callers can't alias the
 *  in-progress buffer), or null when inactive. */
export function getMesh(): MeshData | null {
  if (!mesh) return null;
  return { ...mesh, vertProperties: new Float32Array(mesh.vertProperties), triVerts: mesh.triVerts };
}

// ── lifecycle ────────────────────────────────────────────────────────────────

/** Begin a sculpt session on a copy of `source`. Normalizes to a position-only
 *  mesh, optionally densifies a coarse model, attaches the pointer handler, and
 *  locks the editor. Returns null on success or an error string. */
export function activate(source: MeshData, callbacks: MeshSculptCallbacks, opts: ActivateOptions = {}): string | null {
  if (active) deactivate();
  if (!source || source.numTri === 0) return 'No mesh to sculpt — run the model first.';

  const positions = extractPositions(source);
  let work: MeshData = {
    vertProperties: positions,
    triVerts: Uint32Array.from(source.triVerts),
    numVert: source.numVert,
    numTri: source.numTri,
    numProp: 3,
    triColors: source.triColors ? Uint8Array.from(source.triColors) : undefined,
  };

  const { size } = bboxOf(positions);
  diag = Math.hypot(size[0], size[1], size[2]) || 1;

  // Densify coarse meshes so a brush dab moves more than a handful of corners.
  const floor = opts.autoSubdivideBelow ?? AUTO_SUBDIVIDE_TRIS;
  if (work.numTri < floor) {
    const target = Math.max(diag / 80, maxEdgeLength(positions, work.triVerts) / 3);
    work = subdivideToMaxEdge(work, { maxEdge: target, maxRounds: 4, maxTriangles: MAX_TRIS });
  }

  mesh = work;
  active = true;
  tool = 'push';
  radius = diag * 0.12;
  intensity = 0.5;
  dabCount = 0;
  undoStack = [];
  redoStack = [];
  strokeActive = false;
  strokeBefore = null;
  strokeChanged = false;
  strokeLastPoint = null;
  cbMeshUpdate = callbacks.onMeshUpdate;
  cbLockChange = callbacks.onLockChange ?? null;
  cbStateChange = callbacks.onStateChange ?? null;

  attachPointerHandler();
  cbLockChange?.(true);
  cbMeshUpdate(getMesh()!);
  cbStateChange?.();
  return null;
}

export function deactivate(): void {
  if (!active) return;
  active = false;
  detachPointerHandler();
  cbLockChange?.(false);
  cbLockChange = null;
  cbMeshUpdate = null;
  const notify = cbStateChange;
  cbStateChange = null;
  mesh = null;
  undoStack = [];
  redoStack = [];
  strokeActive = false;
  strokeBefore = null;
  strokeChanged = false;
  strokeLastPoint = null;
  notify?.();
}

// ── editing ──────────────────────────────────────────────────────────────────

/** One 1→4 midpoint subdivision pass over the live mesh, so the brush gets
 *  finer resolution. Resets undo history (vertex count changed). */
export function subdivide(): { ok: true; triangles: number } | { error: string } {
  if (!active || !mesh) return { error: 'Mesh Sculpt is not active.' };
  if (mesh.numTri * 4 > MAX_TRIS) {
    return { error: `Subdivide would exceed ${MAX_TRIS.toLocaleString()} triangles — sculpt at this resolution instead.` };
  }
  const positions = extractPositions(mesh);
  const target = maxEdgeLength(positions, mesh.triVerts) * 0.6;
  mesh = subdivideToMaxEdge(mesh, { maxEdge: target, maxRounds: 1, maxTriangles: MAX_TRIS });
  undoStack = [];
  redoStack = [];
  remeshAndPush();
  cbStateChange?.();
  return { ok: true, triangles: mesh.numTri };
}

/** Snapshot of the current vertex positions (for undo). */
function snapshot(): Float32Array { return new Float32Array(mesh!.vertProperties); }

/** Run a mutation with undo bookkeeping when no stroke is open. `fn` mutates
 *  positions in place and returns how many vertices moved. */
function mutate(fn: () => number): boolean {
  if (!mesh) return false;
  const before = snapshot();
  const moved = fn();
  if (moved === 0) return false;
  undoStack.push(before);
  if (undoStack.length > UNDO_CAP) undoStack.shift();
  redoStack = [];
  dabCount++;
  remeshAndPush();
  cbStateChange?.();
  return true;
}

/** Apply the active brush at a world-space point + surface normal. Honors the
 *  current stroke (so a drag collapses to one undo step) or stands alone.
 *  Optional per-call overrides let the programmatic API tune a single dab.
 *  Returns true iff any vertex moved. */
export function applyAt(
  point: [number, number, number],
  normal: [number, number, number],
  overrides?: { tool?: SculptTool; radius?: number; intensity?: number },
): boolean {
  if (!active || !mesh) return false;
  const t = overrides?.tool ?? tool;
  const r = overrides?.radius ?? radius;
  const it = overrides?.intensity ?? intensity;
  const run = (): number => {
    if (t === 'smooth') return applySmooth(mesh!, point, r, Math.min(1, it));
    const disp = it * r * 0.6 * (t === 'pull' ? -1 : 1);
    return applyPush(mesh!, point, normal, r, disp);
  };
  if (strokeActive) {
    const moved = run();
    if (moved > 0) { strokeChanged = true; dabCount++; remeshAndPush(); cbStateChange?.(); }
    return moved > 0;
  }
  return mutate(run);
}

function beginStroke(): void {
  if (!active || !mesh || strokeActive) return;
  strokeActive = true;
  strokeBefore = snapshot();
  strokeChanged = false;
  strokeLastPoint = null;
}

function endStroke(): void {
  if (!strokeActive) return;
  strokeActive = false;
  strokeLastPoint = null;
  if (strokeChanged && strokeBefore) {
    undoStack.push(strokeBefore);
    if (undoStack.length > UNDO_CAP) undoStack.shift();
    redoStack = [];
  }
  strokeBefore = null;
  strokeChanged = false;
  cbStateChange?.();
}

export function undo(): boolean {
  if (!mesh || undoStack.length === 0) return false;
  redoStack.push(snapshot());
  mesh = { ...mesh, vertProperties: undoStack.pop()! };
  remeshAndPush();
  cbStateChange?.();
  return true;
}

export function redo(): boolean {
  if (!mesh || redoStack.length === 0) return false;
  undoStack.push(snapshot());
  mesh = { ...mesh, vertProperties: redoStack.pop()! };
  remeshAndPush();
  cbStateChange?.();
  return true;
}

// ── internal ─────────────────────────────────────────────────────────────────

function remeshAndPush(): void {
  if (!mesh) return;
  cbMeshUpdate?.(getMesh()!);
}

function onPointerDown(event: PointerEvent): void {
  if (!active || event.button !== 0) return;
  const hit = pickFace(event);
  if (!hit) return;
  const canvas = getRenderer().domElement;
  try { canvas.setPointerCapture(event.pointerId); capturedPointerId = event.pointerId; } catch { /* not capturable */ }
  beginStroke();
  strokeLastPoint = hit.point;
  applyAt(hit.point, hit.normal);
}

function onPointerMove(event: PointerEvent): void {
  if (!active || !strokeActive || (event.buttons & 1) === 0) return;
  const hit = pickFace(event);
  if (!hit) return;
  // Throttle: only re-stamp after the cursor has travelled a quarter-radius,
  // so a slow drag doesn't pile up redundant dabs (and remeshes) in one spot.
  if (strokeLastPoint) {
    const dx = hit.point[0] - strokeLastPoint[0];
    const dy = hit.point[1] - strokeLastPoint[1];
    const dz = hit.point[2] - strokeLastPoint[2];
    if (dx * dx + dy * dy + dz * dz < (radius * 0.25) ** 2) return;
  }
  strokeLastPoint = hit.point;
  applyAt(hit.point, hit.normal);
}

function onPointerUp(): void {
  if (capturedPointerId !== null) {
    try { getRenderer().domElement.releasePointerCapture(capturedPointerId); } catch { /* already released */ }
    capturedPointerId = null;
  }
  if (strokeActive) endStroke();
}

function attachPointerHandler(): void {
  const canvas = getRenderer().domElement;
  const container = canvas.parentElement ?? canvas;
  // Capture phase so we run before the viewport's OrbitControls suppressor —
  // same rationale as voxelPaint.ts / paintMode.ts.
  container.addEventListener('pointerdown', onPointerDown, { capture: true });
  container.addEventListener('pointermove', onPointerMove, { capture: true });
  window.addEventListener('pointerup', onPointerUp, { capture: true });
  canvas.style.cursor = 'crosshair';
  canvas.style.touchAction = 'none';
  removeSuppressor = addPointerSuppressor((event) => {
    if (event.button !== 0) return false;
    return isPointerOverModel(event);
  });
}

function detachPointerHandler(): void {
  const canvas = getRenderer().domElement;
  const container = canvas.parentElement ?? canvas;
  container.removeEventListener('pointerdown', onPointerDown, { capture: true } as EventListenerOptions);
  container.removeEventListener('pointermove', onPointerMove, { capture: true } as EventListenerOptions);
  window.removeEventListener('pointerup', onPointerUp, { capture: true } as EventListenerOptions);
  canvas.style.cursor = '';
  canvas.style.touchAction = '';
  if (capturedPointerId !== null) {
    try { canvas.releasePointerCapture(capturedPointerId); } catch { /* already released */ }
    capturedPointerId = null;
  }
  if (removeSuppressor) { removeSuppressor(); removeSuppressor = null; }
}
