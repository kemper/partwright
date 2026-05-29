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
import { bucketRecolor, clearBox, fillBoxRecolor, addTarget } from '../geometry/voxel/edits';
import { generateVoxelImportCode } from '../import/imageToVoxel';
import { addPointerSuppressor, isPointerOverModel, getRenderer } from '../renderer/viewport';
import { pickFace } from './facePicker';

/** The edit tools the studio offers. `boxAdd`/`boxRemove` are two-click region
 *  ops (click one corner, then the opposite corner). */
export type VoxelTool = 'paint' | 'add' | 'remove' | 'bucket' | 'boxAdd' | 'boxRemove';

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
let undoStack: VoxelGrid[] = [];
let redoStack: VoxelGrid[] = [];
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
  tool = t;
  boxCorner = null;
  cbStateChange?.();
}

/** Voxel count in the live grid, or 0 when the studio isn't active. */
export function voxelCount(): number { return run?.grid.size ?? 0; }
export function canUndo(): boolean { return undoStack.length > 0; }
export function canRedo(): boolean { return redoStack.length > 0; }
/** The first corner of an in-progress box selection (null when none pending). */
export function pendingBoxCorner(): [number, number, number] | null {
  return boxCorner ? [...boxCorner] : null;
}

/** Activate the studio on the given code. Runs the code locally to obtain the
 *  grid + provenance, attaches a click handler, and pushes the meshed grid
 *  through `onMeshUpdate`. Returns null on success or an error string. */
export function activate(code: string, callbacks: VoxelPaintCallbacks): string | null {
  if (active) deactivate();
  const r = runVoxelForPaint(code);
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
  notify?.();
}

/** Paint or erase the voxel that owns the given triangle — the legacy
 *  single-voxel primitive driven by the `eraser` flag. Kept for the
 *  `paintVoxelFace` API + its tests; the studio's tools go through
 *  {@link applyAtTriangle}. Returns true iff the grid changed. */
export function paintTriangle(triangleIndex: number): boolean {
  const v = voxelOfTriangle(triangleIndex);
  if (!v) return false;
  const [x, y, z] = v;
  return mutate(() => (eraser ? doRemove(x, y, z) : doPaint(x, y, z)));
}

/** Apply the active tool at the clicked triangle. This is what the pointer
 *  handler and the `voxelStudioApply` API call. Returns true iff the grid
 *  changed (a box tool's first click stores a corner and returns false). */
export function applyAtTriangle(triangleIndex: number): boolean {
  if (!active || !run) return false;
  const idx = triangleIndex * 3;
  if (idx < 0 || idx + 2 >= run.triVoxel.length) return false;
  const x = run.triVoxel[idx], y = run.triVoxel[idx + 1], z = run.triVoxel[idx + 2];
  const nx = run.triNormal[idx], ny = run.triNormal[idx + 1], nz = run.triNormal[idx + 2];

  switch (tool) {
    case 'paint': return mutate(() => doPaint(x, y, z));
    case 'remove': return mutate(() => doRemove(x, y, z));
    case 'add': return mutate(() => doAdd([x, y, z], [nx, ny, nz]));
    case 'bucket': return mutate(() => doBucket(x, y, z));
    case 'boxAdd':
    case 'boxRemove': return applyBox(x, y, z);
    default: { const _exhaustive: never = tool; void _exhaustive; return false; }
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

function voxelOfTriangle(triangleIndex: number): [number, number, number] | null {
  if (!active || !run) return null;
  const idx = triangleIndex * 3;
  if (idx < 0 || idx + 2 >= run.triVoxel.length) return null;
  return [run.triVoxel[idx], run.triVoxel[idx + 1], run.triVoxel[idx + 2]];
}

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

function doPaint(x: number, y: number, z: number): boolean {
  if (!run) return false;
  const rgb = colorRgb();
  if (run.grid.get(x, y, z) === rgb) return false;
  run.grid.set(x, y, z, color);
  return true;
}

function doRemove(x: number, y: number, z: number): boolean {
  if (!run || !run.grid.has(x, y, z)) return false;
  run.grid.remove(x, y, z);
  return true;
}

function doAdd(voxel: [number, number, number], normal: [number, number, number]): boolean {
  if (!run) return false;
  const target = addTarget(voxel, normal);
  if (!target) return false; // out of coordinate range
  const rgb = colorRgb();
  if (run.grid.get(target[0], target[1], target[2]) === rgb) return false;
  run.grid.set(target[0], target[1], target[2], color);
  return true;
}

function doBucket(x: number, y: number, z: number): boolean {
  if (!run) return false;
  return bucketRecolor(run.grid, [x, y, z], color) > 0;
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

function onPointerDown(event: MouseEvent): void {
  if (!active || event.button !== 0) return;
  const hit = pickFace(event);
  if (!hit) return;
  applyAtTriangle(hit.triangleIndex);
}

function attachPointerHandler(): void {
  const canvas = getRenderer().domElement;
  canvas.addEventListener('mousedown', onPointerDown);
  canvas.style.cursor = 'crosshair';
  // Veto OrbitControls on left-button hits over the model so editing doesn't
  // orbit. Off-model clicks fall through so the camera still rotates.
  removeSuppressor = addPointerSuppressor((event) => {
    if (event.button !== 0) return false;
    return isPointerOverModel(event);
  });
}

function detachPointerHandler(): void {
  const canvas = getRenderer().domElement;
  canvas.removeEventListener('mousedown', onPointerDown);
  canvas.style.cursor = '';
  if (removeSuppressor) { removeSuppressor(); removeSuppressor = null; }
}
