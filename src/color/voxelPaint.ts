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

import * as THREE from 'three';
import type { MeshData } from '../geometry/types';
import { normalizeColor, type VoxelGrid, type Surfacing, type Vec3 } from '../geometry/voxel/grid';
import { gridToMeshWithProvenance, meshGrid } from '../geometry/voxel/mesher';
import { runVoxelForPaint, type VoxelPaintRun } from '../geometry/engines/voxel';
import { bucketRecolor, clearBox, fillBoxRecolor, addBlock, addBlockCells, extrudeBox, brushApply, levelRecolor, inBrush, type BrushShape } from '../geometry/voxel/edits';
import { diffGrids, type VoxelEditOps } from '../geometry/voxel/editCodegen';
import { generateVoxelImportCode } from '../import/imageToVoxel';
import { addPointerSuppressor, isPointerWithinModelBounds, getRenderer, getScene, requestRender } from '../renderer/viewport';
import { pickFace, type FacePickResult } from './facePicker';
import { registerExclusiveMode, deactivateMode } from '../ui/modeExclusion';
import { isPaletteConstrained, nearestSlot, hexToRgb, onPaletteChange } from './palette';

export type { BrushShape } from '../geometry/voxel/edits';

/** The edit tools the studio offers. `view` is the non-editing default: it
 *  orbits the model and shows the rounded preview (editing tools can't pick
 *  voxels on a rounded mesh, so editing renders blocks). `paint`/`add`/`remove`
 *  are brush tools (size + shape, drag to stroke); `bucket` flood-fills a
 *  same-color region; `level` recolors a whole axis layer; `boxAdd`/`boxRemove`
 *  are two-click region ops (click one corner, then the opposite corner). */
export type VoxelTool = 'view' | 'paint' | 'add' | 'remove' | 'bucket' | 'level' | 'boxAdd' | 'boxRemove';

/** Whether a tool edits the grid (everything except the non-editing `view`). */
export function isEditTool(t: VoxelTool): boolean { return t !== 'view'; }

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
// Snapshot of the grid as the code produced it, taken at activate — the "Update
// code" action diffs the edited grid against this to emit only the changes.
let baselineGrid: VoxelGrid | null = null;
let color: [number, number, number] = [255, 0, 0];
let eraser = false;            // legacy single-voxel paint/erase modifier
let tool: VoxelTool = 'view';
let boxCorner: [number, number, number] | null = null;
// Brush settings (shared by the paint/add/remove tools).
let brushRadius = 0;            // 0 = single voxel (preserves click-to-paint)
let brushShape: BrushShape = 'sphere';
// Add-block settings (the `add` tool only): a world-axis box laid against the
// clicked face. [1,1,1] + depth 0 reduces to the legacy single-voxel add.
let blockSize: [number, number, number] = [1, 1, 1];
let addDepth = 0;              // layers the block sinks into the surface (0 = on top)
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
  enforceVoxelConstraint();
}

/** When the palette is constrained, snap the active voxel colour (0–255 RGB)
 *  onto the nearest filament slot — the voxel-studio counterpart of mesh
 *  paint's enforcement, so the global "Constrain to palette" toggle holds here
 *  too. No-op when unconstrained or the palette is empty. */
function enforceVoxelConstraint(): void {
  if (!isPaletteConstrained()) return;
  const slot = nearestSlot([color[0] / 255, color[1] / 255, color[2] / 255]);
  if (!slot) return;
  const [r, g, b] = hexToRgb(slot.hex);
  color = [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

// Re-snap the active colour whenever constrain is toggled or the palette is
// edited, so a constrained voxel session can never keep an off-palette colour.
onPaletteChange(enforceVoxelConstraint);
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
  // `view` shows the rounded preview; any edit tool needs the blocky pickable
  // mesh, so revert immediately (synchronously) before the next pick.
  if (t === 'view') showRoundingPreview();
  else endRoundingPreview();
  refreshPreview();
  cbStateChange?.();
}

// ── Brush / level settings ───────────────────────────────────────────────
const MAX_BRUSH_RADIUS = 16;
export function getBrushRadius(): number { return brushRadius; }
export function setBrushRadius(r: number): void {
  brushRadius = Math.max(0, Math.min(MAX_BRUSH_RADIUS, Math.round(r) || 0));
  refreshPreview();
  cbStateChange?.();
}
export function getBrushShape(): BrushShape { return brushShape; }
export function setBrushShape(s: BrushShape): void { brushShape = s; refreshPreview(); cbStateChange?.(); }

// Add-block dimensions (X/Y/Z, in voxels) and how deep the block sinks into the
// clicked surface. Used only by the `add` tool; the preview reflects them live.
const MAX_BLOCK_SIZE = 32;
export function getBlockSize(): [number, number, number] { return [...blockSize]; }
export function setBlockSize(axis: 0 | 1 | 2, n: number): void {
  blockSize[axis] = Math.max(1, Math.min(MAX_BLOCK_SIZE, Math.round(n) || 1));
  refreshPreview();
  cbStateChange?.();
}
export function getAddDepth(): number { return addDepth; }
// No upper clamp: the slider tops out at 16, but a typed value can go deeper.
export function setAddDepth(n: number): void {
  addDepth = Math.max(0, Math.round(n) || 0);
  refreshPreview();
  cbStateChange?.();
}
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

/** Options the Rounding panel can set (a subset of `VoxelGrid.smooth`'s opts;
 *  `lockBox`/`detail` aren't exposed in the studio). */
export type RoundingOpts = { strength?: number; iterations?: number; algorithm?: 'taubin' | 'surfaceNets'; flatBottom?: boolean; baseLayers?: number };

/** Current surfacing of the edited grid, for the Rounding panel to prefill. */
export function getSurfacing(): Surfacing | null { return run?.grid.surfacing() ?? null; }

/** Set the grid's surfacing from the Rounding panel — `null` = hard blocks,
 *  otherwise smooth with the given options. The panel only owns
 *  `strength`/`flatBottom`/`baseLayers`, so we MERGE onto the grid's current
 *  surfacing to preserve source-declared fields the panel doesn't expose
 *  (`iterations`/`detail`/`algorithm`/`lockBox`) — otherwise touching the slider
 *  would reset them to defaults. Live-previews the result in the viewport (see
 *  {@link showRoundingPreview}); the preview reverts to the blocky, pickable
 *  mesh the moment the user edits on the canvas. Not routed through `mutate()`
 *  on purpose: a surfacing tweak isn't an undo-able grid edit (the slider is its
 *  own revert affordance), and it's reflected live by refreshControls. */
export function setRounding(opts: RoundingOpts | null): void {
  if (!run) return;
  if (opts === null) {
    run.grid.blocky();
  } else {
    const cur = run.grid.surfacing();
    const merged: RoundingOpts & { detail?: number; lockBox?: [Vec3, Vec3] } = {
      algorithm: cur.algorithm,
      iterations: cur.iterations,
      detail: cur.detail,
      ...opts, // strength / flatBottom / baseLayers from the panel
    };
    if (cur.lockBox) merged.lockBox = [cur.lockBox.min, cur.lockBox.max];
    run.grid.smooth(merged);
  }
  showRoundingPreview();
  cbStateChange?.();
}

// ── Rounding live preview ────────────────────────────────────────────────────
// The studio edits on the blocky provenance mesh (picking maps a clicked
// triangle back to a voxel via run.triVoxel). To preview rounding without
// breaking that, we *temporarily* show the smoothed mesh while the Rounding
// panel is in use and swap back to the blocky mesh the instant the user edits.
let roundingPreview = false; // true while the smoothed preview mesh is displayed
let previewRaf = 0;          // pending rebuild handle (coalesces slider drags)

/** Show the rounded mesh for the current surfacing while in the non-editing
 *  `view` tool (editing tools need the blocky pickable mesh, so they show
 *  blocks). Coalesced to one rebuild per frame so a slider drag stays
 *  responsive; re-meshing reads the live grid at flush time, so coalescing never
 *  shows a stale preview. */
function showRoundingPreview(): void {
  if (!active || !cbMeshUpdate || previewRaf) return;
  previewRaf = requestAnimationFrame(() => {
    previewRaf = 0;
    if (!active || !run || !cbMeshUpdate) return;
    if (tool === 'view' && run.grid.surfacing().mode === 'smooth') {
      cbMeshUpdate(meshGrid(run.grid));
      roundingPreview = true;
    } else if (roundingPreview) {
      cbMeshUpdate(run.mesh);
      roundingPreview = false;
    }
  });
}

/** Drop the rounded preview and restore the blocky provenance mesh so picking
 *  and editing operate on voxel-accurate triangles again. Also cancels any
 *  pending preview rebuild so it can't flash back over an edit. */
function endRoundingPreview(): void {
  if (previewRaf) { cancelAnimationFrame(previewRaf); previewRaf = 0; }
  if (roundingPreview && run) { cbMeshUpdate?.(run.mesh); roundingPreview = false; }
}

/** Whether the user changed surfacing since activation — drives whether the
 *  "Update code" commit appends an explicit `.smooth(...)`/`.blocky()` call (so
 *  an untouched model keeps whatever its source already declared). */
export function roundingChanged(): boolean {
  if (!run || !baselineGrid) return false;
  return JSON.stringify(run.grid.surfacing()) !== JSON.stringify(baselineGrid.surfacing());
}

/** The delta from the code's own output to the current edited grid — what the
 *  "Update code" action appends to the source. Empty when nothing changed. */
export function getEditOps(): VoxelEditOps {
  if (!run || !baselineGrid) return { set: [], remove: [] };
  return diffGrids(baselineGrid, run.grid);
}

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
  // A smooth grid is editable: per-voxel picking runs on the hard-faced
  // provenance mesh (gridToMeshWithProvenance ignores surfacing), so the studio
  // preview shows blocks while editing. The grid keeps its surfacing setting —
  // the Rounding panel reads/updates it and it's re-applied to the rendered
  // model on save (see getSurfacing / setRounding and commitVoxelEdits).
  // Soft cap: edits re-mesh on every click on the main thread, so very large
  // grids tank interactivity. The blocky-art / image-import range is far below
  // this; refuse at the door with a useful number.
  const MAX_PAINT_VOXELS = 200_000;
  if (r.data.grid.size > MAX_PAINT_VOXELS) {
    return `Voxel Studio is capped at ${MAX_PAINT_VOXELS.toLocaleString()} voxels for responsiveness; this model has ${r.data.grid.size.toLocaleString()}. Reduce the grid before editing.`;
  }
  run = r.data;
  baselineGrid = r.data.grid.clone();
  active = true;
  enforceVoxelConstraint(); // a constrained palette must not paint the held-over default colour
  tool = 'view'; // open in the non-editing view so the rounded result is shown first
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
  // Exclusive with the mesh-paint and annotate tools: they each attach a
  // capture-phase pointer handler to the same canvas, so only one may own it.
  // UI visibility alone doesn't enforce this (the AI API can drive either tool
  // regardless of the active language), so coordinate through modeExclusion.
  deactivateMode('paint');
  deactivateMode('imagePaint');
  deactivateMode('pen', { keepSession: false });
  deactivateMode('text', { keepSession: false });
  deactivateMode('select', { keepSession: false });
  attachPointerHandler();
  cbLockChange?.(true);
  cbMeshUpdate(run.mesh);
  // If the grid opens already smooth (e.g. a model whose source declares
  // .smooth(), or one rounded in a prior session), show that rounded result
  // immediately instead of the blocky provenance mesh — otherwise reopening the
  // studio appears to "lose" the rounding even though the surfacing is intact.
  showRoundingPreview();
  cbStateChange?.();
  return null;
}

export function deactivate(): void {
  if (!active) return;
  active = false;
  if (previewRaf) { cancelAnimationFrame(previewRaf); previewRaf = 0; }
  roundingPreview = false;
  detachPointerHandler();
  cbLockChange?.(false);
  cbLockChange = null;
  cbMeshUpdate = null;
  const notify = cbStateChange;
  cbStateChange = null;
  run = null;
  baselineGrid = null;
  boxCorner = null;
  undoStack = [];
  redoStack = [];
  strokeActive = false;
  strokeBefore = null;
  strokeChanged = false;
  strokeLastVoxel = null;
  notify?.();
}

// Take our turn in the exclusive-tool registry so activating a mesh-paint or
// annotate tool tears the studio down (and vice-versa, via activate() above).
registerExclusiveMode('voxelStudio', () => deactivate());

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
    const nx = run.triNormal[idx], ny = run.triNormal[idx + 1], nz = run.triNormal[idx + 2];
    return applyBox(x, y, z, [nx, ny, nz]);
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
    case 'add':
      // A block laid against the clicked face: per-axis size, anchored along
      // the normal so it won't poke out the far side of a thin tile.
      return addBlock(run.grid, [x, y, z], [nx, ny, nz], blockSize, addDepth, color) > 0;
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
 *  fills (boxAdd) or clears (boxRemove) the inclusive box between them. The
 *  `addDepth` setting extrudes the box along the second click's face normal —
 *  a fill grows a slab outward, a subtract carves inward (see {@link extrudeBox}).
 *  The completing click's `normal` sets the extrusion direction. */
function applyBox(x: number, y: number, z: number, normal: [number, number, number]): boolean {
  if (!run) return false;
  if (!boxCorner) {
    boxCorner = [x, y, z];
    cbStateChange?.();
    return false;
  }
  const a = boxCorner;
  boxCorner = null;
  const remove = tool === 'boxRemove';
  const [c0, c1] = extrudeBox(a, [x, y, z], normal, addDepth, remove);
  return mutate(() => remove
    ? clearBox(run!.grid, c0, c1) > 0
    : fillBoxRecolor(run!.grid, c0, c1, color) > 0);
}

function remeshAndPush(): void {
  if (!run) return;
  const { mesh, triVoxel, triNormal } = gridToMeshWithProvenance(run.grid);
  run = { ...run, mesh, triVoxel, triNormal };
  // Any edit/undo/redo pushes the blocky provenance mesh, so a rounded preview
  // is no longer what's on screen — keep the flag in sync.
  roundingPreview = false;
  cbMeshUpdate?.(mesh);
}

/** The voxel a triangle maps back to (or null) — used to dedupe drag samples. */
function triangleVoxel(triangleIndex: number): [number, number, number] | null {
  if (!run) return null;
  const idx = triangleIndex * 3;
  if (idx < 0 || idx + 2 >= run.triVoxel.length) return null;
  return [run.triVoxel[idx], run.triVoxel[idx + 1], run.triVoxel[idx + 2]];
}

/** The integer face-normal baked for a triangle (a unit axis vector), or null.
 *  Preferred over the raycast normal for the add block since it's exact. */
function triangleNormal(triangleIndex: number): [number, number, number] | null {
  if (!run) return null;
  const idx = triangleIndex * 3;
  if (idx < 0 || idx + 2 >= run.triNormal.length) return null;
  return [run.triNormal[idx], run.triNormal[idx + 1], run.triNormal[idx + 2]];
}

function sameVoxel(a: [number, number, number] | null, b: [number, number, number] | null): boolean {
  return !!a && !!b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

// ── Brush hover preview ──────────────────────────────────────────────────────
// A translucent overlay of the cells the active brush tool would touch at the
// hovered voxel, so the user can judge brush size/shape before committing —
// most useful for the delete tool, where it shows exactly which voxels will be
// removed. Rendered as a single InstancedMesh of slightly-oversized unit cubes
// added to the scene (a transient overlay, like the mesh-paint brush ring).
const PREVIEW_TINT_REMOVE = 0xff4d4d; // red = "this gets deleted"
const PREVIEW_CELL_SCALE = 1.06;      // a touch larger than a voxel → reads as a shell
let previewMesh: THREE.InstancedMesh | null = null;
let previewCapacity = 0;
let lastHoverEvent: { clientX: number; clientY: number } | null = null;
const previewMatrix = new THREE.Matrix4();

function disposePreview(): void {
  if (!previewMesh) return;
  previewMesh.parent?.remove(previewMesh);
  previewMesh.geometry.dispose();
  (previewMesh.material as THREE.Material).dispose();
  previewMesh = null;
  previewCapacity = 0;
}

function clearPreview(): void {
  if (previewMesh && previewMesh.count > 0) { previewMesh.count = 0; requestRender(); }
}

function ensurePreviewCapacity(n: number): void {
  if (previewMesh && previewCapacity >= n) return;
  disposePreview();
  const cap = Math.max(8, n);
  const geo = new THREE.BoxGeometry(PREVIEW_CELL_SCALE, PREVIEW_CELL_SCALE, PREVIEW_CELL_SCALE);
  const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false });
  previewMesh = new THREE.InstancedMesh(geo, mat, cap);
  previewMesh.frustumCulled = false;
  previewMesh.renderOrder = 1000;
  previewMesh.count = 0;
  getScene().add(previewMesh);
  previewCapacity = cap;
}

/** The occupied voxel cells the paint/remove brush would affect at `center` —
 *  what gets recolored or deleted. (The `add` tool previews a block instead;
 *  see {@link previewCells}.) */
function brushFootprintCells(center: [number, number, number]): [number, number, number][] {
  const cells: [number, number, number][] = [];
  if (!run) return cells;
  const ri = Math.max(0, Math.floor(brushRadius));
  const [cx, cy, cz] = center;
  for (let dx = -ri; dx <= ri; dx++)
    for (let dy = -ri; dy <= ri; dy++)
      for (let dz = -ri; dz <= ri; dz++) {
        if (!inBrush(brushShape, dx, dy, dz, ri)) continue;
        const x = cx + dx, y = cy + dy, z = cz + dz;
        if (!run.grid.has(x, y, z)) continue; // paint/remove act on existing cells
        cells.push([x, y, z]);
      }
  return cells;
}

/** Cells the active brush/block tool would touch at the hovered face — the
 *  set the preview overlay draws. For `add` this is the anchored block (so the
 *  user sees its size and how far it sinks in); for paint/remove it's the
 *  occupied brush footprint. */
function previewCells(hit: FacePickResult): [number, number, number][] {
  if (!run) return [];
  const v = triangleVoxel(hit.triangleIndex);
  if (!v) return [];
  if (tool === 'add') {
    const n = triangleNormal(hit.triangleIndex);
    return n ? addBlockCells(v, n, blockSize, addDepth) : [];
  }
  return brushFootprintCells(v);
}

function renderPreviewFromHit(hit: FacePickResult | null): void {
  if (!active || !run || !isBrushTool(tool) || !hit) { clearPreview(); return; }
  const cells = previewCells(hit);
  if (cells.length === 0) { clearPreview(); return; }
  ensurePreviewCapacity(cells.length);
  if (!previewMesh) return;
  (previewMesh.material as THREE.MeshBasicMaterial).color.setHex(tool === 'remove' ? PREVIEW_TINT_REMOVE : colorRgb());
  for (let i = 0; i < cells.length; i++) {
    const [x, y, z] = cells[i];
    previewMatrix.makeTranslation(x + 0.5, y + 0.5, z + 0.5);
    previewMesh.setMatrixAt(i, previewMatrix);
  }
  previewMesh.count = cells.length;
  previewMesh.instanceMatrix.needsUpdate = true;
  requestRender();
}

/** Re-evaluate the preview at the last hovered point — used when the brush
 *  size/shape or the active tool changes while the cursor is stationary. */
function refreshPreview(): void {
  if (!active || !isBrushTool(tool) || !lastHoverEvent) { clearPreview(); return; }
  renderPreviewFromHit(pickFace(lastHoverEvent as MouseEvent));
}

// Pointer Events (not mouse) so click-drag strokes work for mouse, touch, and
// stylus alike. The active drag pointer is captured so moves keep flowing even
// if it leaves the canvas.
let capturedPointerId: number | null = null;

function onPointerDown(event: PointerEvent): void {
  if (!active || event.button !== 0) return;
  // This listener is on the container in the CAPTURE phase, so it also sees
  // pointerdowns on the floating Voxel Studio panel (and other overlays) that
  // sit in front of the 3D view. Only start an edit when the press landed on
  // the canvas itself — otherwise a tap on the panel raycasts a hit on the
  // model behind it and paints, and setPointerCapture binds the pointer to the
  // canvas so a drag across menu buttons keeps stamping. See paintMode.ts.
  if (event.target !== getRenderer().domElement) return;
  // The non-editing `view` tool shows the rounded preview and just orbits — no
  // picking or editing (the rounded mesh isn't voxel-pickable anyway).
  if (tool === 'view') return;
  const hit = pickFace(event);
  if (!hit) return;
  clearPreview(); // the action commits; the preview rebuilds on the next move
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
  if (!active || !run) return;
  lastHoverEvent = { clientX: event.clientX, clientY: event.clientY };
  // While the rounded preview is up, the displayed mesh isn't voxel-pickable, so
  // don't draw a (misplaced) brush footprint over it; just orbit/hover.
  if (roundingPreview) { clearPreview(); return; }
  // One raycast feeds both the hover preview and the active stroke.
  const hit = isBrushTool(tool) ? pickFace(event) : null;
  renderPreviewFromHit(hit);
  if (!strokeActive || (event.buttons & 1) === 0) return;
  if (!hit) return;
  const v = triangleVoxel(hit.triangleIndex);
  // Skip if the cursor is still over the same source voxel (avoids redundant
  // re-stamps + re-meshes as the pointer jitters within one cell).
  if (sameVoxel(v, strokeLastVoxel)) return;
  strokeLastVoxel = v;
  applyAtTriangle(hit.triangleIndex);
}

function onPointerLeave(): void {
  lastHoverEvent = null;
  clearPreview();
}

function onPointerUp(): void {
  if (capturedPointerId !== null) {
    try { getRenderer().domElement.releasePointerCapture(capturedPointerId); } catch { /* already released */ }
    capturedPointerId = null;
  }
  if (strokeActive) endStroke();
  // The stroke may have changed which cells are occupied — refresh the preview.
  refreshPreview();
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
  container.addEventListener('pointerleave', onPointerLeave);
  window.addEventListener('pointerup', onPointerUp, { capture: true });
  canvas.style.cursor = 'crosshair';
  canvas.style.touchAction = 'none'; // claim the gesture so touch-drag paints
  // Veto OrbitControls on primary-button presses within the model's bounds so
  // editing doesn't orbit. We test the bounding box rather than the surface
  // (unlike mesh paint) because the delete tool carves holes straight through
  // the mesh — a surface-only test would let a click that lands in a just-made
  // hole fall through and rotate the camera mid-edit. Presses clearly outside
  // the model still fall through so the camera can rotate.
  removeSuppressor = addPointerSuppressor((event) => {
    if (event.button !== 0) return false;
    // In the non-editing view, never veto orbit — the user is inspecting the
    // rounded model, not editing, so dragging anywhere should rotate the camera.
    if (tool === 'view') return false;
    return isPointerWithinModelBounds(event);
  });
}

function detachPointerHandler(): void {
  const canvas = getRenderer().domElement;
  const container = canvas.parentElement ?? canvas;
  container.removeEventListener('pointerdown', onPointerDown, { capture: true } as EventListenerOptions);
  container.removeEventListener('pointermove', onPointerMove, { capture: true } as EventListenerOptions);
  container.removeEventListener('pointerleave', onPointerLeave);
  window.removeEventListener('pointerup', onPointerUp, { capture: true } as EventListenerOptions);
  canvas.style.cursor = '';
  canvas.style.touchAction = '';
  if (capturedPointerId !== null) {
    try { canvas.releasePointerCapture(capturedPointerId); } catch { /* already released */ }
    capturedPointerId = null;
  }
  lastHoverEvent = null;
  disposePreview();
  if (removeSuppressor) { removeSuppressor(); removeSuppressor = null; }
}
