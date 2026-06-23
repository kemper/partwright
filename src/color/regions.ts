// ColorRegionStore — manages per-face color regions for the current mesh

import type { MeshData } from '../geometry/types';
import type { ShapeType } from './boxPaint';
import type { BrushShape } from './subdivide';
import type { ColorPatternKind } from './colorPattern';

export interface ColorRegion {
  id: number;
  name: string;
  color: [number, number, number]; // RGB 0..1
  source: 'face-pick' | 'slab' | 'subtree' | 'paintbrush' | 'model' | 'imagePaint';
  descriptor: RegionDescriptor;
  order: number;
  visible: boolean;
  triangles: Set<number>; // resolved triangle indices (transient, not persisted)
  // Optional palette-slot attribution (filament/AMS slot). `color` stays the
  // render source of truth; when `slotId` is set it mirrors that slot's colour,
  // so recolouring a slot recolours every region on it, and export can group
  // by slot order. Unset = ad-hoc colour (unslotted) — back-compat default.
  slotId?: string;
  /** Per-triangle colors for image-paint regions; overrides `color` per
   *  triangle in buildTriColors. Transient — rebuilt from the descriptor. */
  perTriColors?: Map<number, [number, number, number]>;
}

export type RegionDescriptor =
  | { kind: 'coplanar'; seedPoint: [number, number, number]; seedNormal: [number, number, number]; normalTolerance: number }
  // Slab / oriented-shape descriptors carry optional smoothing: when `smooth`
  // is set, the mesh is locally subdivided near the region's boundary until
  // boundary triangles fall below `maxEdge`, so the painted edge follows the
  // analytic boundary instead of the coarse base tessellation. Descriptors
  // saved before smoothing existed simply omit both fields (no subdivision).
  | { kind: 'slab'; normal: [number, number, number]; offset: number; thickness: number; smooth?: boolean; maxEdge?: number }
  | { kind: 'box'; center: [number, number, number]; size: [number, number, number]; quaternion: [number, number, number, number]; shape?: ShapeType; smooth?: boolean; maxEdge?: number }
  // Cylindrical-shell selector — `rMin === 0` collapses to a solid cylinder,
  // otherwise an annular ring. `topOnly` / `normalCone` / `coverageMode` /
  // `maxTriangleArea` carry over from the original `paintInCylinder` API so
  // descriptors round-trip identically. Smoothing subdivides boundary
  // triangles at the inner / outer wall and the z-caps until they fall below
  // `maxEdge`, giving crisp painted edges that follow the analytic cylinder
  // rather than the coarse base tessellation.
  | { kind: 'cylinder'; center: [number, number]; rMin: number; rMax: number; zMin: number; zMax: number;
      // World axis the shell runs along — radius measured in the plane normal
      // to it, the zMin..zMax band along it. Omitted = 'z' (the legacy XY-radius
      // behaviour), so descriptors saved before axis support round-trip cleanly.
      axis?: 'x' | 'y' | 'z';
      normalCone?: { axis: [number, number, number]; angleDeg: number };
      // Coverage mode literal — kept as a string union (not an imported type)
      // so this descriptor stays serializable without pulling in main.ts.
      coverageMode?: 'centroid' | 'fully_inside' | 'any_vertex_inside';
      maxTriangleArea?: number;
      smooth?: boolean; maxEdge?: number }
  | { kind: 'triangles'; ids: number[] }
  | { kind: 'byLabel'; label: string }
  // Color magic-wand (the bucket tool's Color mode). Stores a stable world-space
  // seed plus the matched color and tolerance, so it re-floods by color on every
  // re-resolve — surviving subdivision/re-runs the way `coplanar` does for the
  // geometry bucket. A raw `triangles` snapshot can't: a fill over a brush-refined
  // mesh lives at sub-base-triangle resolution that base-indexed ids can't carry.
  // `seedColor` (0–1 RGB) is the color under the cursor at paint time, used as the
  // flood anchor so the match survives even after this region recolors those
  // triangles (the re-resolve excludes this region's own color from the lookup).
  | { kind: 'colorFlood'; seedPoint: [number, number, number]; seedNormal: [number, number, number];
      seedColor: [number, number, number]; colorTolerance: number }
  | { kind: 'connectedFromSeed'; seedPoint: [number, number, number]; seedNormal: [number, number, number]; maxDeviationDeg: number;
      // Optional AABB clamp — flood-fill won't walk into triangles whose
      // centroid falls outside this box. Used to constrain `paintConnected`
      // on fused meshes where the topology is one connected component but
      // the *intended* paint region only spans part of the bounding volume
      // (e.g. paint the dome of an e-stop without bleeding into the collar).
      // Persisted so a re-resolve after geometry edit walks the same path;
      // descriptors saved before the clamp existed omit both fields.
      clampMin?: [number, number, number]; clampMax?: [number, number, number] }
  // Smooth paintbrush stroke: surface samples + brush footprint, plus a target
  // edge length. Resolving it locally refines the mesh under the stroke until
  // boundary triangles are below `maxEdge`, so the painted edge follows the
  // brush outline regardless of base-mesh coarseness. See src/color/subdivide.ts.
  // `surface`/`depth` constrain the footprint to a thin shell on the picked
  // surface (so paint doesn't bleed through thin/hollow walls); descriptors
  // saved before this omit both and are read as `slab` with an auto depth.
  // `spray` turns the stroke into a geodesic airbrush: a soft speckle whose
  // coverage fades from the core out via a per-triangle dither (no hard edge).
  // `wrapAngleDeg` is the wrap tolerance (0–180°): paint only flows across an
  // edge when the faces bend by ≤ this angle, so a stroke stops at sharp corners
  // (≥90°) but flows over gentle curves. Omitted ⇒ 180° (no gate) for back-compat
  // with strokes saved before the slider existed.
  | { kind: 'brushStroke'; samples: [number, number, number][]; radius: number; shape: BrushShape; maxEdge: number; surface?: 'geodesic' | 'slab'; depth?: number; wrapAngleDeg?: number; spray?: { strength: number; softness: number; seed: number } }
  // Image projection: per-triangle colors computed at apply-time by projecting
  // an image onto the mesh from a chosen axis direction. The projected result is
  // stored as a flat [triIdx, r, g, b, …] array (r/g/b in 0–255) so the region
  // survives serialization and re-resolves correctly after mesh subdivision via
  // the parentToChildren map. `avgColor` (0–1) is the mean of all painted
  // triangles — used as the `color` field for the region list swatch.
  // For smooth stamps: `imageDataUrl` (PNG, ≤256×256) + stamp params are stored
  // so the stamp can be replayed verbatim on session reload (see rehydrateColorRegions).
  | { kind: 'imagePaint'; entries: number[]; avgColor: [number, number, number]; axis?: string;
      smooth?: boolean; maxEdge?: number;
      hitPoint?: [number, number, number]; hitNormal?: [number, number, number];
      stampSize?: number; rotationDeg?: number;
      imageDataUrl?: string;
      removeBackground?: boolean;
      manualBgColor?: [number, number, number];
      bgTolerance?: number }
  // Algorithmic colour pattern (the colour twin of `api.surface.*` textures):
  // a field evaluated per-triangle assigns each triangle in `scope` one palette
  // colour. Resolved by `computePatternColors` (src/color/colorPattern.ts), which
  // produces a `perTriColors` map. `scope.label` restricts it to an `api.label`
  // region (e.g. the body) so it never touches eyes/nose; absent ⇒ whole mesh.
  | { kind: 'pattern'; pattern: ColorPatternKind; colors: [number, number, number][];
      scope?: { label?: string };
      scale?: number; axis?: 'x' | 'y' | 'z'; warp?: number; coverage?: number; seed?: number };

export interface SerializedColorRegion {
  id: number;
  name: string;
  color: [number, number, number];
  source: ColorRegion['source'];
  descriptor: RegionDescriptor;
  order: number;
  visible?: boolean; // optional for backward compat — defaults to true on load
  slotId?: string;   // palette-slot attribution (schema 1.11+); omitted = unslotted
}

type ChangeListener = () => void;

let regions: ColorRegion[] = [];
let nextOrder = 1;
// Model-declared color underlay — rebuilt from `api.label(shape, name, { color })`
// declarations on every run (see setModelColorRegions). Kept SEPARATE from the
// user `regions` array on purpose: these colors come from code, so they must
// NOT lock the editor (the lock keys on hasRegions()), must NOT be serialized
// into the paint sidecar (serialize() only walks `regions`), and must NOT show
// up in the paint region list / undo stack. They render and export by
// compositing UNDERNEATH the user's paint in buildTriColors — so manual paint
// always wins and stays an optional override.
let modelRegions: ColorRegion[] = [];
// Monotonic, session-unique region id source. Deliberately never reset (not
// even on clearRegions) so an id can't collide with a region still held in an
// undo snapshot. Ids are runtime-only — the rehydrate path assigns fresh ones
// via addRegion rather than restoring the serialized id.
let nextRegionId = 1;
let visible = true;
const listeners: ChangeListener[] = [];
const visibilityListeners: ChangeListener[] = [];
const redoListeners: ChangeListener[] = [];
const clearSnapshotListeners: ChangeListener[] = [];

// Redo stack — regions removed via `removeLastRegion()`. Any other mutation
// (add, clear, deserialize) drops the stack so redo can never resurrect a
// region into a state where the user wouldn't expect it.
let regionRedoStack: ColorRegion[] = [];

// Clear snapshot — saved when clearRegions() is called. Nulled when a new
// region is added so undo-clear is only valid until the next paint operation.
let clearSnapshot: ColorRegion[] | null = null;
// True when the snapshot came from a *scoped* clear (clearRegionsBySource) that
// removed only some regions and left the rest in place. undoClear then merges
// the snapshot back into the surviving regions instead of replacing the whole
// array, so a scoped clear doesn't resurrect regions the user never cleared.
let clearSnapshotPartial = false;

function notify(): void {
  for (const fn of listeners) fn();
}

function notifyVisibility(): void {
  for (const fn of visibilityListeners) fn();
}

function notifyRedo(): void {
  for (const fn of redoListeners) fn();
}

function notifyClearSnapshot(): void {
  for (const fn of clearSnapshotListeners) fn();
}

function clearRedoStack(): void {
  if (regionRedoStack.length === 0) return;
  regionRedoStack = [];
  notifyRedo();
}

export function onChange(fn: ChangeListener): void {
  listeners.push(fn);
}


export function onVisibilityChange(fn: ChangeListener): () => void {
  visibilityListeners.push(fn);
  return () => {
    const i = visibilityListeners.indexOf(fn);
    if (i >= 0) visibilityListeners.splice(i, 1);
  };
}

export function onRedoChange(fn: ChangeListener): () => void {
  redoListeners.push(fn);
  return () => {
    const i = redoListeners.indexOf(fn);
    if (i >= 0) redoListeners.splice(i, 1);
  };
}

export function onClearSnapshotChange(fn: ChangeListener): () => void {
  clearSnapshotListeners.push(fn);
  return () => {
    const i = clearSnapshotListeners.indexOf(fn);
    if (i >= 0) clearSnapshotListeners.splice(i, 1);
  };
}

export function canUndoClear(): boolean {
  return clearSnapshot !== null;
}

export function undoClear(): void {
  if (!clearSnapshot) return;
  // A scoped clear (clearRegionsBySource) left other regions in place, so merge
  // the removed ones back in. A full clear replaces the (now-empty) array. Render
  // priority keys on each region's `order` field, not array position, so a plain
  // append restores the original layering. `nextOrder` only ever grows.
  regions = clearSnapshotPartial ? [...regions, ...clearSnapshot] : [...clearSnapshot];
  nextOrder = regions.reduce((max, r) => Math.max(max, r.order + 1), clearSnapshotPartial ? nextOrder : 1);
  clearSnapshot = null;
  clearSnapshotPartial = false;
  clearRedoStack();
  notify();
  notifyClearSnapshot();
}

export function isVisible(): boolean {
  return visible;
}

export function setVisible(v: boolean): void {
  if (visible === v) return;
  visible = v;
  notifyVisibility();
}

export function getRegions(): readonly ColorRegion[] {
  return regions;
}

export function hasRegions(): boolean {
  return regions.length > 0;
}

export function addRegion(
  name: string,
  color: [number, number, number],
  source: ColorRegion['source'],
  descriptor: RegionDescriptor,
  triangles: Set<number>,
  visible: boolean = true,
  slotId?: string,
  perTriColors?: Map<number, [number, number, number]>,
): ColorRegion {
  const id = nextRegionId++;
  const region: ColorRegion = {
    id,
    name,
    color,
    source,
    descriptor,
    order: nextOrder++,
    visible,
    triangles,
    slotId,
    perTriColors,
  };
  regions.push(region);
  clearRedoStack();
  if (clearSnapshot !== null) {
    clearSnapshot = null;
    notifyClearSnapshot();
  }
  notify();
  return region;
}


export function setRegionVisibility(id: number, visible: boolean): boolean {
  const region = regions.find(r => r.id === id);
  if (!region) return false;
  if (region.visible === visible) return true;
  region.visible = visible;
  notify();
  return true;
}


export function removeRegion(id: number): boolean {
  const idx = regions.findIndex(r => r.id === id);
  if (idx < 0) return false;
  regions.splice(idx, 1);
  clearRedoStack();
  notify();
  return true;
}

/** Pop the most recently added region and push it onto the redo stack. */
export function removeLastRegion(): ColorRegion | null {
  if (regions.length === 0) return null;
  const region = regions.pop()!;
  regionRedoStack.push(region);
  notifyRedo();
  notify();
  return region;
}

/** Pop the redo stack and re-add the region. Returns null if nothing to redo. */
export function redoLastRegion(): ColorRegion | null {
  const region = regionRedoStack.pop() ?? null;
  if (!region) return null;
  regions.push(region);
  notifyRedo();
  notify();
  return region;
}

export function canRedoRegion(): boolean {
  return regionRedoStack.length > 0;
}

export function updateRegionColor(id: number, color: [number, number, number]): void {
  const region = regions.find(r => r.id === id);
  if (region) {
    region.color = color;
    notify();
  }
}

/** Recolour every region attributed to a palette slot — used when the user
 *  edits that slot's colour in the palette editor, so all regions painted with
 *  it update at once. Returns the number of regions changed and fires a single
 *  notify (which drives the live re-render). */
export function recolorRegionsForSlot(slotId: string, color: [number, number, number]): number {
  let changed = 0;
  for (const region of regions) {
    if (region.slotId === slotId) {
      region.color = color;
      changed++;
    }
  }
  if (changed > 0) notify();
  return changed;
}

/** Distinct palette slots in use across the current user regions. Drives the
 *  paint panel's over-budget badge (count vs. palette capacity). */
export function usedSlotIds(): Set<string> {
  const ids = new Set<string>();
  for (const region of regions) if (region.slotId) ids.add(region.slotId);
  return ids;
}

const colorDist = (a: readonly number[], b: readonly number[]) =>
  Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);

/** Reconcile a model colour: recolour every region within `tolerance` of
 *  `fromColor` to `toColor`, and set their palette attribution to `toSlotId`
 *  (pass `undefined` to clear it — the colour is now ad-hoc). This is the
 *  primitive behind the palette tool's Replace (swap to a palette/history
 *  colour) and Merge (collapse one model colour into another). Returns the
 *  number of regions changed. */
export function reassignRegionColor(
  fromColor: [number, number, number],
  toColor: [number, number, number],
  toSlotId: string | undefined,
  tolerance = 0.02,
): number {
  let count = 0;
  for (const r of regions) {
    if (colorDist(r.color, fromColor) <= tolerance) {
      r.color = [...toColor] as [number, number, number];
      r.slotId = toSlotId;
      count++;
    }
  }
  if (count > 0) notify();
  return count;
}

/** Auto-match every user region to the nearest palette slot (Euclidean RGB),
 *  recolouring it to that slot's colour and stamping its `slotId`. Used by the
 *  palette tool's "Apply palette" to reconcile an off-palette or freshly
 *  imported model in one step. `slots` is the ordered palette. Returns the
 *  number of regions changed. */
export function applyPaletteAutoMatch(
  slots: ReadonlyArray<{ id: string; color: [number, number, number] }>,
): number {
  if (slots.length === 0) return 0;
  let count = 0;
  for (const r of regions) {
    let best = slots[0];
    let bestD = Infinity;
    for (const s of slots) {
      const d = colorDist(r.color, s.color);
      if (d < bestD) { bestD = d; best = s; }
    }
    // Skip a no-op (already exactly this slot's colour and attribution).
    if (r.slotId === best.id && colorDist(r.color, best.color) === 0) continue;
    r.color = [...best.color] as [number, number, number];
    r.slotId = best.id;
    count++;
  }
  if (count > 0) notify();
  return count;
}

/** Batch-replace the color of every user region whose color is within
 *  `tolerance` (Euclidean distance in normalised [0,1]³ RGB) of `sourceColor`.
 *  Returns the number of regions changed. */
export function replaceRegionColors(
  sourceColor: [number, number, number],
  targetColor: [number, number, number],
  tolerance = 0.01,
): number {
  let count = 0;
  for (const r of regions) {
    const dr = r.color[0] - sourceColor[0];
    const dg = r.color[1] - sourceColor[1];
    const db = r.color[2] - sourceColor[2];
    if (Math.sqrt(dr * dr + dg * dg + db * db) <= tolerance) {
      r.color = [...targetColor] as [number, number, number];
      count++;
    }
  }
  if (count > 0) notify();
  return count;
}

/** Return distinct RGB colors from user paint regions, ordered by first
 *  occurrence. Used by the Replace tool to build its source swatch row. */
export function getDistinctRegionColors(): [number, number, number][] {
  const seen = new Set<string>();
  const result: [number, number, number][] = [];
  for (const r of regions) {
    const key = r.color.map(c => Math.round(c * 255)).join(',');
    if (!seen.has(key)) {
      seen.add(key);
      result.push([...r.color] as [number, number, number]);
    }
  }
  return result;
}

export function updateRegionName(id: number, name: string): void {
  const region = regions.find(r => r.id === id);
  if (region) {
    region.name = name;
    notify();
  }
}

/** Move a region within the regions list. Index out of range is clamped. */
export function reorderRegion(id: number, toIndex: number): void {
  const from = regions.findIndex(r => r.id === id);
  if (from < 0) return;
  const target = Math.max(0, Math.min(regions.length - 1, toIndex));
  if (from === target) return;
  const [r] = regions.splice(from, 1);
  regions.splice(target, 0, r);
  notify();
}

/** Replace a region's resolved triangle set (and optional per-triangle colors)
 *  in place. Used when the working mesh changes (e.g. subdivision) and every
 *  region must be re-resolved. Does not notify — the caller drives a single
 *  re-render after re-resolving all regions. */
export function setRegionTriangles(
  id: number,
  triangles: Set<number>,
  perTriColors?: Map<number, [number, number, number]>,
): void {
  const region = regions.find(r => r.id === id);
  if (region) {
    region.triangles = triangles;
    region.perTriColors = perTriColors;
  }
}

export function clearRegions(): void {
  if (regions.length === 0) return;
  clearSnapshot = [...regions];
  clearSnapshotPartial = false;
  regions = [];
  nextOrder = 1;
  clearRedoStack();
  notify();
  notifyClearSnapshot();
}

/** Clear only the regions with the given `source` (e.g. `'imagePaint'` stamps),
 *  leaving every other region (brush strokes, face picks, …) untouched. Saves a
 *  partial snapshot so "Undo clear" restores exactly the removed regions back
 *  into the surviving list. No-op when nothing matches. */
export function clearRegionsBySource(source: ColorRegion['source']): void {
  const removed = regions.filter(r => r.source === source);
  if (removed.length === 0) return;
  clearSnapshot = removed;
  clearSnapshotPartial = true;
  regions = regions.filter(r => r.source !== source);
  clearRedoStack();
  notify();
  notifyClearSnapshot();
}

/** Replace the model-declared color underlay. Called once per run with the
 *  colors declared in code, already resolved to triangle sets against that run's
 *  mesh / labelMap. Two sources feed it: `api.label(shape, name, { color })`
 *  (byLabel) and `api.paint.*` (box / slab / cylinder / label), each carrying its
 *  own `descriptor` so paintExplain and re-renders see the true predicate. Pass
 *  `[]` (or run code that declares no colors) to clear the layer. Does NOT
 *  notify — the run path drives a single re-render after setting these. */
export function setModelColorRegions(
  decls: ReadonlyArray<{ name: string; color: [number, number, number]; triangles: Set<number>; descriptor?: RegionDescriptor }>,
): void {
  modelRegions = decls.map((d, i) => ({
    id: -(i + 1), // negative ids never collide with the positive user-region ids
    name: d.name,
    color: d.color,
    source: 'model' as const,
    descriptor: d.descriptor ?? { kind: 'byLabel' as const, label: d.name },
    order: i + 1, // order within the model band; the user paint layer sits above
    visible: true,
    triangles: d.triangles,
  }));
}

export function hasModelColorRegions(): boolean {
  return modelRegions.length > 0;
}

/** Replace a model-region's resolved triangle set in place (negative id). Used
 *  by the refine path: when a smooth brush stroke subdivides the working mesh,
 *  the code-declared underlay (`api.label({color})` / `api.paint.*`) must be
 *  re-resolved against the refined tessellation too, or its triangle indices go
 *  stale. Does not notify — the caller drives a single re-render. */
export function setModelRegionTriangles(id: number, triangles: Set<number>): void {
  const region = modelRegions.find(r => r.id === id);
  if (region) region.triangles = triangles;
}

export function getModelRegions(): readonly ColorRegion[] {
  return modelRegions;
}

/** Drop the model-declared underlay (e.g. on session/part teardown). The next
 *  run repopulates it; clearing here avoids a stale color flashing onto a
 *  freshly-loaded mesh whose triangle indices differ. */
export function clearModelColorRegions(): void {
  modelRegions = [];
}

/** Build triColors (Uint8Array, numTri*3 RGB) from current regions.
 *  Higher-order regions win on overlap. Returns null if no regions.
 *
 *  `respectPerRegionVisibility` (default false) skips regions with `visible:false`
 *  so the viewport reflects per-region eye-toggle state. Exports leave it false
 *  so a hidden-in-UI region still ships in the GLB/3MF.
 *
 *  `excludeRegionId` omits one user region from the composite. A `colorFlood`
 *  region re-resolves by matching colors, so it must read the surface color
 *  *underneath* itself — without this, its own freshly-stamped color would mask
 *  the source color it's meant to follow and the flood would collapse to the seed. */
export function buildTriColors(numTri: number, respectPerRegionVisibility = false, excludeRegionId?: number, baseColors?: Uint8Array | null): Uint8Array | null {
  // Model-declared colors are the base layer; the user's manual paint composites
  // on top and always wins (it's an optional override of the code's colors).
  return composeTriColors(numTri, [modelRegions, regions], { respectPerRegionVisibility, excludeRegionId, baseColors });
}

/**
 * Pure triColors compositor — the engine behind {@link buildTriColors}, exposed
 * so callers that hold their OWN region lists (e.g. baking a non-active part's
 * mesh for multi-part export, off the live editor state) can reuse the exact
 * same stamping rules without touching the module globals.
 *
 * `layers` are stamped in order (earlier = lower); within a layer higher
 * `order` wins. Returns null when every layer is empty and there are no
 * `baseColors` to seed from.
 */
export function composeTriColors(
  numTri: number,
  layers: ColorRegion[][],
  opts: { respectPerRegionVisibility?: boolean; excludeRegionId?: number; baseColors?: Uint8Array | null } = {},
): Uint8Array | null {
  const { respectPerRegionVisibility = false, excludeRegionId, baseColors } = opts;
  const hasBase = !!(baseColors && baseColors.length >= numTri * 3);
  if (layers.every(l => l.length === 0) && !hasBase) return null;

  const buf = new Uint8Array(numTri * 3); // default 0,0,0 — ignored for un-colored tris
  // `painted[t] === 1` once ANY layer colors triangle `t`. Tracked separately
  // from order so a region can legitimately paint pure black (and so the
  // model-color base layer counts as painted even though it sits below paint).
  const painted = new Uint8Array(numTri);

  // Seed from the mesh's own per-triangle colours (e.g. a voxel grid's colours
  // or an imported coloured model's) so painting a few regions doesn't blank the
  // rest of the model back to the default shade — the regions composite on top.
  if (hasBase && baseColors) {
    buf.set(baseColors.subarray(0, numTri * 3));
    const basePainted = (baseColors as Uint8Array & { _painted?: Uint8Array })._painted;
    for (let t = 0; t < numTri; t++) {
      const seeded = basePainted
        ? basePainted[t] === 1
        : (buf[t * 3] !== 0 || buf[t * 3 + 1] !== 0 || buf[t * 3 + 2] !== 0);
      if (seeded) painted[t] = 1;
    }
  }

  // Stamp one layer of regions onto buf, higher `order` winning WITHIN the
  // layer. Layers are applied in call order, so a later layer overwrites an
  // earlier one wherever they overlap.
  const stampLayer = (layer: ColorRegion[]) => {
    let eligible = respectPerRegionVisibility ? layer.filter(r => r.visible) : layer;
    if (excludeRegionId !== undefined) eligible = eligible.filter(r => r.id !== excludeRegionId);
    const sorted = [...eligible].sort((a, b) => a.order - b.order);
    const layerOrder = new Int32Array(numTri).fill(-1); // -1 = untouched in this layer
    for (const region of sorted) {
      const fr = Math.round(region.color[0] * 255);
      const fg = Math.round(region.color[1] * 255);
      const fb = Math.round(region.color[2] * 255);
      const ptc = region.perTriColors;
      for (const tri of region.triangles) {
        if (tri >= 0 && tri < numTri && region.order >= layerOrder[tri]) {
          let r = fr, g = fg, b = fb;
          if (ptc) {
            const c = ptc.get(tri);
            if (c) { r = Math.round(c[0] * 255); g = Math.round(c[1] * 255); b = Math.round(c[2] * 255); }
          }
          buf[tri * 3] = r;
          buf[tri * 3 + 1] = g;
          buf[tri * 3 + 2] = b;
          layerOrder[tri] = region.order;
          painted[tri] = 1;
        }
      }
    }
  };

  for (const layer of layers) stampLayer(layer);

  // Store the painted mask on the result for the renderer
  (buf as Uint8Array & { _painted?: Uint8Array })._painted = painted;
  return buf;
}

/** Which triangles are painted in a triColors buffer? */
export function isPainted(triColors: Uint8Array, triIndex: number): boolean {
  const painted = (triColors as Uint8Array & { _painted?: Uint8Array })._painted;
  return painted ? painted[triIndex] === 1 : (triColors[triIndex * 3] !== 0 || triColors[triIndex * 3 + 1] !== 0 || triColors[triIndex * 3 + 2] !== 0);
}

/** Allocate an empty (all-zero) triColors buffer with the `_painted`
 *  sidecar attached. Use this when you need a paintable buffer but the
 *  current regions list is empty (so `buildTriColors` returned null). */
export function createEmptyTriColors(numTri: number): Uint8Array {
  const buf = new Uint8Array(numTri * 3);
  (buf as Uint8Array & { _painted?: Uint8Array })._painted = new Uint8Array(numTri);
  return buf;
}

/** Overlay a color onto specific triangles in a triColors buffer
 *  (typically one returned by buildTriColors). Keeps the `_painted`
 *  sidecar in sync. Used by paintPreview / paintExplain to highlight
 *  a candidate or committed region in bright yellow over the existing
 *  paint layer. */
export function overlayPainted(
  triColors: Uint8Array,
  indices: Iterable<number>,
  color: [number, number, number],
): void {
  const painted = (triColors as Uint8Array & { _painted?: Uint8Array })._painted;
  const r = Math.round(color[0] * 255);
  const g = Math.round(color[1] * 255);
  const b = Math.round(color[2] * 255);
  for (const t of indices) {
    triColors[t * 3] = r;
    triColors[t * 3 + 1] = g;
    triColors[t * 3 + 2] = b;
    if (painted) painted[t] = 1;
  }
}

export function serialize(): SerializedColorRegion[] {
  return regions.map(r => ({
    id: r.id,
    name: r.name,
    color: r.color,
    source: r.source,
    descriptor: r.descriptor,
    order: r.order,
    visible: r.visible,
    ...(r.slotId ? { slotId: r.slotId } : {}),
  }));
}

/** Apply triColors to a MeshData, returning a new object (non-destructive).
 *  Use for EXPORTS — all regions are baked in regardless of UI visibility flags. */
export function applyTriColors(mesh: MeshData): MeshData {
  const triColors = buildTriColors(mesh.numTri, false, undefined, mesh.triColors);
  if (!triColors) return mesh;
  return { ...mesh, triColors };
}

/** Viewport-facing variant: returns the mesh unchanged when the global paint
 *  visibility is toggled off, and skips individual regions whose per-region
 *  `visible` flag is false (eye-icon toggles in the region list). */
export function applyTriColorsIfVisible(mesh: MeshData): MeshData {
  if (!visible) return mesh;
  const triColors = buildTriColors(mesh.numTri, true, undefined, mesh.triColors);
  if (!triColors) return mesh;
  return { ...mesh, triColors };
}
