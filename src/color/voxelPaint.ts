// Voxel Studio — multi-tool, click-to-edit voxel editing (paint, add, remove,
// bucket flood-fill, and box add/subtract) with undo/redo.
//
// Architectural note: voxel sessions persist as CODE — the user's `voxels()`
// calls re-run deterministically on load. Editing mutates *state*, so it
// can't be expressed in arbitrary procedural code. The honest path: the studio
// edits a live grid held in memory; "bake" replaces the editor's code with
// `voxels.decode(<encoded>)` and saves it as a new version. Until baked, the
// editor is locked (read-only) so a runaway auto-run can't clobber the
// in-progress grid. This is also exactly what lets the studio modify an
// imported image-voxel: the import's `voxels.decode(...)` code re-runs to a
// live grid here, the tools add/subtract/recolor it, and bake re-encodes it.
//
// The voxel engine is pure JS and idempotent, so the studio runs the user's
// code once on activate to get the grid + per-triangle voxel/normal
// provenance, and all subsequent clicks are local — no Worker round-trip.

import type { MeshData } from '../geometry/types';
import { normalizeColor, type VoxelGrid } from '../geometry/voxel/grid';
import { gridToMeshWithProvenance } from '../geometry/voxel/mesher';
import { runVoxelForPaint, type VoxelPaintRun } from '../geometry/engines/voxel';
import { bucketRecolor, clearBox, fillBoxRecolor, addTarget, brushApply, levelRecolor, type BrushShape } from '../geometry/voxel/edits';
import { generateVoxelImportCode } from '../import/imageToVoxel';
import { addPointerSuppressor, isPointerOverModel, getRenderer } from '../renderer/viewport';
import { pickFace } from './facePicker';

export type { BrushShape } from '../geometry/voxel/edits';

/** The edit tools the studio offers. `paint`/`add`/`remove` are brush tools
 *  (size + shape, drag to stroke); `bucket` flood-fills a same-color region;
 *  `level` recolors a whole axis layer; `boxAdd`/`boxRemove` are two-click
 *  region ops (click one corner, then the opposite corner). */
export type VoxelTool = 'paint' | 'add' | 'remove' | 'bucket' | 'level' | 'boxAdd' | 'boxRemove';

/** Tools that paint a brush footprint and support click-drag strokes. */
function isBrushTool(t: VoxelTool): boolean { return t === 'paint' || t === 'add' || t === 'remove'; }

export interface VoxelPaintCallbacks {
  /** Called whenever the edited mesh changes (activation + each edit + undo). */
  onMeshUpdate: (mesh: MeshData) => void;
  /** Called to lock (true) / unlock (false) the editor while the studio is live. */
  onLockChange?: (locked: boolean) => void;
  /** Called after any state change (tool/edit/undo) so the UI can refresh
   *  voxel count, undo/redo enablement, and the box-tool prompt. */
  onStateChange?: () => void;
}

const UNDO_CAP = 100;

let active = false;
let run: VoxelPaintRun | null = null;
let color: [number, number, number] = [255, 0, 0];
let eraser = false;            // legacy single-voxel paint/erase modifier
let tool: VoxelTool = 'paint';
let boxCorner: [number, number, number] | null = null;
// Brush settings (shared by the paint/add/remove tools).
let brushRadius = 0;            // 0 = single voxel (preserves click-to-paint)
let brushShape: BrushShape = 'sphere';
let spray = false;             // scatter a random subset of the footprint
let sprayDensity = 0.5;        // 0..1, fraction kept when spraying
let levelAxis: 0 | 1 | 2 = 2;  // axis for the "level" tool (x/y/z)
let undoStack: VoxelGrid[] = [];
let redoStack: VoxelGrid[] = [];
// Drag-stroke state: a whole pointerdown→move→up stroke is one undo step.
let strokeActive = false;
let strokeBefore: VoxelGrid | null = null;
let strokeChanged = false;
let strokeLastVoxel: [number, number, number] | null = null;
let cbMeshUpdate: ((mesh: MeshData) => void) | null = null;
let cbLockChange: ((locked: boolean) => void) | null = null;
let cbStateChange: (() => void) | null = null;
let removeSuppressor: (() => void) | null = null;

export function isActive(): boolean { return active; }
export function setColor(c: [number, number, number] | string | number): void {
  const rgb = normalizeColor(c, 'setColor(color)');
  color = [(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff];
}
export function isEraser(): boolean { return eraser; }
export function setEraser(on: boolean): void { eraser = !!on; }

/** The active studio tool. */
export function getTool(): VoxelTool { return tool; }
/** Switch the active tool. Switching tools cancels any half-finished box
 *  selection; re-selecting the *same* tool is a no-op (so a caller that
 *  re-passes the tool on every `voxelStudioApply` doesn't keep re-banking the
 *  first box corner and never completing the box). */
export function setTool(t: VoxelTool): void {
  if (t === tool) return;
  // Finish any open stroke before switching so it commits cleanly (and a later
  // endStroke can't push a stale snapshot taken under the previous tool).
  if (strokeActive) endStroke();
  tool = t;
  boxCorner = null;
  cbStateChange?.();
}

// ── Brush / level settings ───────────────────────────────────────────────
const MAX_BRUSH_RADIUS = 16;
export function getBrushRadius(): number { return brushRadius; }
export function setBrushRadius(r: number): void {
  brushRadius = Math.max(0, Math.min(MAX_BRUSH_RADIUS, Math.round(r) || 0));
  cbStateChange?.();
}
export function getBrushShape(): BrushShape { return brushShape; }
export function setBrushShape(s: BrushShape): void { brushShape = s; cbStateChange?.(); }
export function isSpray(): boolean { return spray; }
export function setSpray(on: boolean): void { spray = !!on; cbStateChange?.(); }
export function getSprayDensity(): number { return sprayDensity; }
export function setSprayDensity(d: number): void {
  sprayDensity = Math.max(0.05, Math.min(1, d));
  cbStateChange?.();
}
export function getLevelAxis(): 0 | 1 | 2 { return levelAxis; }
export function setLevelAxis(a: 0 | 1 | 2): void { levelAxis = a; cbStateChange?.(); }

/** Voxel count in the live grid, or 0 when the studio isn't active. */
export function voxelCount(): number { return run?.grid.size ?? 0; }
export function canUndo(): boolean { return undoStack.length > 0; }
export function canRedo(): boolean { return redoStack.length > 0; }
/** The first corner of an in-progress box selection (null when none pending). */
export function pendingBoxCorner(): [number, number, number] | null {
  return boxCorner ? [...boxCorner] : null;
}

/** The live edited grid, or null when the studio isn't active. Lets callers
 *  (e.g. `.vox` export) capture unbaked edits without re-running the code. */
export function getGrid(): VoxelGrid | null { return run?.grid ?? null; }

// ── Stroke transactions ────────────────────────────────────────────────────
// A click-drag stroke (or a programmatic begin/apply…/end) collapses into a
// single undo step: snapshot once at begin, mutate in place per sample, push
// the one snapshot at end.
export function beginStroke(): void {
  // Strokes only make sense for the brush tools (paint/add/remove); other tools
  // are single-shot, so opening a stroke for them would just leave a stale,
  // never-committed snapshot.
  if (!active || !run || strokeActive || !isBrushTool(tool)) return;
  strokeActive = true;
  strokeBefore = run.grid.clone();
  strokeChanged = false;
  strokeLastVoxel = null;
}
export function endStroke(): void {
  if (!strokeActive) return;
  strokeActive = false;
  strokeLastVoxel = null;
  if (strokeChanged && strokeBefore) {
    undoStack.push(strokeBefore);
    if (undoStack.length > UNDO_CAP) undoStack.shift();
    redoStack = [];
  }
  strokeBefore = null;
  strokeChanged = false;
  cbStateChange?.();
}

/** Activate the studio on the given code. Runs the code locally to obtain the
 *  grid + provenance, attaches a click handler, and pushes the meshed grid
 *  through `onMeshUpdate`. Returns null on success or an error string. */
export function activate(code: string, callbacks: VoxelPaintCallbacks, paramOverrides?: Record<string, unknown>): string | null {
  if (active) deactivate();
  const r = runVoxelForPaint(code, paramOverrides);
  if (!r.ok) return r.error;
  // Smooth surfacing moves vertices off the voxel grid, so a clicked
  // triangle's coords no longer map cleanly to a single source voxel. Refuse
  // here with a clear, actionable message rather than silently dropping the
  // user's `.smooth()` and showing them a blocky model.
  if (r.data.grid.surfacing().mode === 'smooth') {
    return 'Voxel Studio cannot edit a smooth-surfaced grid (per-voxel picking only works on hard cube faces). Call `.blocky()` before returning, edit, then re-apply `.smooth()` afterward.';
  }
  // Soft cap: edits re-mesh on every click on the main thread, so very large
  // grids tank interactivity. The blocky-art / image-import range is far below
  // this; refuse at the door with a useful number.
  const MAX_PAINT_VOXELS = 200_000;
  if (r.data.grid.size > MAX_PAINT_VOXELS) {
    return `Voxel Studio is capped at ${MAX_PAINT_VOXELS.toLocaleString()} voxels for responsiveness; this model has ${r.data.grid.size.toLocaleString()}. Reduce the grid before editing.`;
  }
  run = r.data;
  active = true;
  tool = 'paint';
  boxCorner = null;
  undoStack = [];
  redoStack = [];
  strokeActive = false;
  strokeBefore = null;
  strokeChanged = false;
  strokeLastVoxel = null;
  cbMeshUpdate = callbacks.onMeshUpdate;
  cbLockChange = callbacks.onLockChange ?? null;
  cbStateChange = callbacks.onStateChange ?? null;
  attachPointerHandler();
  cbLockChange?.(true);
  cbMeshUpdate(run.mesh);
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
  run = null;
  boxCorner = null;
  undoStack = [];
  redoStack = [];
  strokeActive = false;
  strokeBefore = null;
  strokeChanged = false;
  strokeLastVoxel = null;
  notify?.();
}

/** Paint or erase the voxel that owns the given triangle — the legacy
 *  single-voxel primitive driven by the `eraser` flag. Kept for the
 *  `paintVoxelFace` API + its tests; the studio's tools go through
 *  {@link applyAtTriangle}. Returns true iff the grid changed. */
export function paintTriangle(triangleIndex: number): boolean {
  if (!active) return false;
  const v = triangleVoxel(triangleIndex);
  if (!v) return false;
  const [x, y, z] = v;
  return mutate(() => {
    if (!run) return false;
    if (eraser) {
      if (!run.grid.has(x, y, z)) return false;
      run.grid.remove(x, y, z);
      return true;
    }
    const rgb = colorRgb();
    if (run.grid.get(x, y, z) === rgb) return false;
    run.grid.set(x, y, z, color);
    return true;
  });
}

/** Apply the active tool at the clicked triangle. This is what the pointer
 *  handler and the `voxelStudioApply` API call. Returns true iff the grid
 *  changed (a box tool's first click stores a corner and returns false).
 *
 *  Box tools are always single-shot (two clicks). Other tools run inside the
 *  current stroke if one is open (so a drag collapses to one undo step), else
 *  as a standalone undo-able edit. */
export function applyAtTriangle(triangleIndex: number): boolean {
  if (!active || !run) return false;
  const idx = triangleIndex * 3;
  if (idx < 0 || idx + 2 >= run.triVoxel.length) return false;
  if (tool === 'boxAdd' || tool === 'boxRemove') {
    const x = run.triVoxel[idx], y = run.triVoxel[idx + 1], z = run.triVoxel[idx + 2];
    return applyBox(x, y, z);
  }
  if (strokeActive) {
    const changed = runOp(triangleIndex);
    if (changed) { strokeChanged = true; remeshAndPush(); cbStateChange?.(); }
    return changed;
  }
  return mutate(() => runOp(triangleIndex));
}

/** Mutate the grid for the active (non-box) tool at the clicked triangle.
 *  Returns whether anything changed. Does NOT touch undo/remesh — callers
 *  (`mutate` for single edits, the stroke loop for drags) handle that. */
function runOp(triangleIndex: number): boolean {
  if (!run) return false;
  const idx = triangleIndex * 3;
  if (idx < 0 || idx + 2 >= run.triVoxel.length) return false;
  const x = run.triVoxel[idx], y = run.triVoxel[idx + 1], z = run.triVoxel[idx + 2];
  const nx = run.triNormal[idx], ny = run.triNormal[idx + 1], nz = run.triNormal[idx + 2];
  const density = spray ? sprayDensity : 1;
  switch (tool) {
    case 'paint':
      return brushApply(run.grid, [x, y, z], brushRadius, brushShape, 'paint', color, density) > 0;
    case 'remove':
      return brushApply(run.grid, [x, y, z], brushRadius, brushShape, 'remove', color, density) > 0;
    case 'add': {
      const target = addTarget([x, y, z], [nx, ny, nz]);
      if (!target) return false;
      return brushApply(run.grid, target, brushRadius, brushShape, 'add', color, density) > 0;
    }
    case 'bucket':
      return bucketRecolor(run.grid, [x, y, z], color) > 0;
    case 'level':
      return levelRecolor(run.grid, levelAxis, [x, y, z][levelAxis], color) > 0;
    default: return false;
  }
}

/** Undo the last edit. Returns true iff anything was undone. */
export function undo(): boolean {
  if (!run || undoStack.length === 0) return false;
  redoStack.push(run.grid.clone());
  run = { ...run, grid: undoStack.pop()! };
  boxCorner = null;
  remeshAndPush();
  cbStateChange?.();
  return true;
}

/** Redo the last undone edit. Returns true iff anything was redone. */
export function redo(): boolean {
  if (!run || redoStack.length === 0) return false;
  undoStack.push(run.grid.clone());
  run = { ...run, grid: redoStack.pop()! };
  boxCorner = null;
  remeshAndPush();
  cbStateChange?.();
  return true;
}

/** Bake the current grid into `voxels.decode(...)` editor code. Returns null
 *  when the studio isn't active. */
export function bakeToCode(filename = 'painted'): string | null {
  if (!run) return null;
  return generateVoxelImportCode(run.grid, filename);
}

// ── internal ───────────────────────────────────────────────────────────────

function colorRgb(): number { return (color[0] << 16) | (color[1] << 8) | color[2]; }

/** Run a grid mutation with undo bookkeeping. `fn` mutates `run.grid` and
 *  returns whether anything changed; only then do we snapshot + re-mesh. */
function mutate(fn: () => boolean): boolean {
  if (!run) return false;
  const before = run.grid.clone();
  const changed = fn();
  if (!changed) return false;
  undoStack.push(before);
  if (undoStack.length > UNDO_CAP) undoStack.shift();
  redoStack = [];
  remeshAndPush();
  cbStateChange?.();
  return true;
}

/** Two-click box: the first click banks a corner (no mutation); the second
 *  fills (boxAdd) or clears (boxRemove) the inclusive box between them. */
function applyBox(x: number, y: number, z: number): boolean {
  if (!run) return false;
  if (!boxCorner) {
    boxCorner = [x, y, z];
    cbStateChange?.();
    return false;
  }
  const a = boxCorner;
  boxCorner = null;
  return mutate(() => tool === 'boxRemove'
    ? clearBox(run!.grid, a, [x, y, z]) > 0
    : fillBoxRecolor(run!.grid, a, [x, y, z], color) > 0);
}

function remeshAndPush(): void {
  if (!run) return;
  const { mesh, triVoxel, triNormal } = gridToMeshWithProvenance(run.grid);
  run = { ...run, mesh, triVoxel, triNormal };
  cbMeshUpdate?.(mesh);
}

/** The voxel a triangle maps back to (or null) — used to dedupe drag samples. */
function triangleVoxel(triangleIndex: number): [number, number, number] | null {
  if (!run) return null;
  const idx = triangleIndex * 3;
  if (idx < 0 || idx + 2 >= run.triVoxel.length) return null;
  return [run.triVoxel[idx], run.triVoxel[idx + 1], run.triVoxel[idx + 2]];
}

function sameVoxel(a: [number, number, number] | null, b: [number, number, number] | null): boolean {
  return !!a && !!b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

// Pointer Events (not mouse) so click-drag strokes work for mouse, touch, and
// stylus alike. The active drag pointer is captured so moves keep flowing even
// if it leaves the canvas.
let capturedPointerId: number | null = null;

function onPointerDown(event: PointerEvent): void {
  if (!active || event.button !== 0) return;
  const hit = pickFace(event);
  if (!hit) return;
  // Brush tools paint a drag stroke (one undo step); other tools are single
  // clicks. Box tools manage their own two-click state.
  if (isBrushTool(tool)) {
    const canvas = getRenderer().domElement;
    try { canvas.setPointerCapture(event.pointerId); capturedPointerId = event.pointerId; } catch { /* not capturable */ }
    beginStroke();
    strokeLastVoxel = triangleVoxel(hit.triangleIndex);
    applyAtTriangle(hit.triangleIndex);
  } else {
    applyAtTriangle(hit.triangleIndex);
  }
}

function onPointerMove(event: PointerEvent): void {
  if (!active || !strokeActive || (event.buttons & 1) === 0) return;
  const hit = pickFace(event);
  if (!hit) return;
  const v = triangleVoxel(hit.triangleIndex);
  // Skip if the cursor is still over the same source voxel (avoids redundant
  // re-stamps + re-meshes as the pointer jitters within one cell).
  if (sameVoxel(v, strokeLastVoxel)) return;
  strokeLastVoxel = v;
  applyAtTriangle(hit.triangleIndex);
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
  // pointerdown + pointermove on the CONTAINER in capture phase so they run
  // before the viewport's capture-phase OrbitControls suppressor, which calls
  // stopImmediatePropagation on the canvas for model hits (that's what swallows
  // a canvas-level pointerdown — the bug that broke touch/pointer painting).
  // pointerup on window (capture) so a release is never missed even when the
  // suppressor or pointer-capture retargets the event. See paintMode.ts.
  const container = canvas.parentElement ?? canvas;
  container.addEventListener('pointerdown', onPointerDown, { capture: true });
  container.addEventListener('pointermove', onPointerMove, { capture: true });
  window.addEventListener('pointerup', onPointerUp, { capture: true });
  canvas.style.cursor = 'crosshair';
  canvas.style.touchAction = 'none'; // claim the gesture so touch-drag paints
  // Veto OrbitControls on primary-button hits over the model so editing
  // doesn't orbit. Off-model clicks fall through so the camera still rotates.
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
