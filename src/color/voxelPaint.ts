// Voxel paint mode — per-voxel click-to-color editing.
//
// Architectural note: voxel sessions persist as CODE — the user's `voxels()`
// calls re-run deterministically on load. Painting mutates *state*, so it
// can't be expressed in arbitrary procedural code. The honest path: paint
// edits a live grid held in memory; "bake" replaces the editor's code with
// `voxels.decode(<encoded>)` and saves it as a new version. Until baked, the
// editor is locked (read-only) so a runaway auto-run can't clobber the
// in-progress painted grid.
//
// The voxel engine is pure JS and idempotent, so paint runs the user's code
// once on activate (or whenever the source changes between sessions) to get
// the grid + per-triangle voxel provenance, and all subsequent clicks are
// local — no Worker round-trip, no rebuild from scratch.

import type { MeshData } from '../geometry/types';
import { normalizeColor } from '../geometry/voxel/grid';
import { gridToMeshWithProvenance } from '../geometry/voxel/mesher';
import { runVoxelForPaint, type VoxelPaintRun } from '../geometry/engines/voxel';
import { generateVoxelImportCode } from '../import/imageToVoxel';
import { addPointerSuppressor, isPointerOverModel, getRenderer } from '../renderer/viewport';
import { pickFace } from './facePicker';

export interface VoxelPaintCallbacks {
  /** Called whenever the painted mesh changes (initial activation + each click). */
  onMeshUpdate: (mesh: MeshData) => void;
  /** Called to lock (true) / unlock (false) the editor while paint is live. */
  onLockChange?: (locked: boolean) => void;
}

let active = false;
let run: VoxelPaintRun | null = null;
let color: [number, number, number] = [255, 0, 0];
let eraser = false;
let cbMeshUpdate: ((mesh: MeshData) => void) | null = null;
let cbLockChange: ((locked: boolean) => void) | null = null;
let removeSuppressor: (() => void) | null = null;

export function isActive(): boolean { return active; }
export function setColor(c: [number, number, number] | string | number): void {
  const rgb = normalizeColor(c, 'setColor(color)');
  color = [(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff];
}
export function isEraser(): boolean { return eraser; }
export function setEraser(on: boolean): void { eraser = !!on; }

/** Voxel count in the live grid, or 0 when paint isn't active. */
export function voxelCount(): number { return run?.grid.size ?? 0; }

/** Activate voxel paint on the given code. Runs the code locally to obtain the
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
    return 'Voxel paint cannot run on a smooth-surfaced grid (per-voxel picking only works on hard cube faces). Call `.blocky()` before returning, paint, then re-apply `.smooth()` afterward.';
  }
  // Soft cap: paint re-meshes on every click on the main thread, so very
  // large grids tank interactivity. The blocky-art / image-import range is
  // far below this; refuse at the door with a useful number.
  const MAX_PAINT_VOXELS = 200_000;
  if (r.data.grid.size > MAX_PAINT_VOXELS) {
    return `Voxel paint is capped at ${MAX_PAINT_VOXELS.toLocaleString()} voxels for responsiveness; this model has ${r.data.grid.size.toLocaleString()}. Reduce the grid before painting.`;
  }
  run = r.data;
  active = true;
  cbMeshUpdate = callbacks.onMeshUpdate;
  cbLockChange = callbacks.onLockChange ?? null;
  attachPointerHandler();
  cbLockChange?.(true);
  cbMeshUpdate(run.mesh);
  return null;
}

export function deactivate(): void {
  if (!active) return;
  active = false;
  detachPointerHandler();
  cbLockChange?.(false);
  cbLockChange = null;
  cbMeshUpdate = null;
  run = null;
}

/** Paint or erase the voxel that owns the given triangle. Returns true iff
 *  the grid changed (caller uses this to decide whether to mark the session
 *  dirty). */
export function paintTriangle(triangleIndex: number): boolean {
  if (!active || !run) return false;
  const tv = run.triVoxel;
  const idx = triangleIndex * 3;
  if (idx < 0 || idx + 2 >= tv.length) return false;
  const x = tv[idx], y = tv[idx + 1], z = tv[idx + 2];
  if (eraser) {
    if (!run.grid.has(x, y, z)) return false;
    run.grid.remove(x, y, z);
  } else {
    const rgb = (color[0] << 16) | (color[1] << 8) | color[2];
    if (run.grid.get(x, y, z) === rgb) return false;
    run.grid.set(x, y, z, color);
  }
  remeshAndPush();
  return true;
}

/** Bake the current painted grid into `voxels.decode(...)` editor code.
 *  Returns null when paint isn't active. */
export function bakeToCode(filename = 'painted'): string | null {
  if (!run) return null;
  return generateVoxelImportCode(run.grid, filename);
}

// ── internal ───────────────────────────────────────────────────────────────

function remeshAndPush(): void {
  if (!run) return;
  const { mesh, triVoxel } = gridToMeshWithProvenance(run.grid);
  run = { ...run, mesh, triVoxel };
  cbMeshUpdate?.(mesh);
}

function onPointerDown(event: PointerEvent): void {
  if (!active || event.button !== 0) return;
  const hit = pickFace(event);
  if (!hit) return;
  paintTriangle(hit.triangleIndex);
}

function attachPointerHandler(): void {
  const canvas = getRenderer().domElement;
  // pointerdown on the container in CAPTURE phase so it runs before the
  // viewport's capture-phase OrbitControls suppressor (which stops propagation
  // on the canvas) — see the matching note in paintMode.ts.
  const container = canvas.parentElement ?? canvas;
  container.addEventListener('pointerdown', onPointerDown, { capture: true });
  canvas.style.cursor = 'crosshair';
  // Veto OrbitControls on left-button hits over the model so paint doesn't
  // orbit. Off-model clicks fall through so the camera still rotates.
  removeSuppressor = addPointerSuppressor((event) => {
    if (event.button !== 0) return false;
    return isPointerOverModel(event);
  });
}

function detachPointerHandler(): void {
  const canvas = getRenderer().domElement;
  const container = canvas.parentElement ?? canvas;
  container.removeEventListener('pointerdown', onPointerDown, { capture: true } as EventListenerOptions);
  canvas.style.cursor = '';
  if (removeSuppressor) { removeSuppressor(); removeSuppressor = null; }
}
