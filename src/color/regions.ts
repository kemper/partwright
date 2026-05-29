// ColorRegionStore — manages per-face color regions for the current mesh

import type { MeshData } from '../geometry/types';
import type { ShapeType } from './boxPaint';
import type { BrushShape } from './subdivide';

export interface ColorRegion {
  id: number;
  name: string;
  color: [number, number, number]; // RGB 0..1
  source: 'face-pick' | 'slab' | 'subtree' | 'paintbrush' | 'model';
  descriptor: RegionDescriptor;
  order: number;
  visible: boolean;
  triangles: Set<number>; // resolved triangle indices (transient, not persisted)
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
      normalCone?: { axis: [number, number, number]; angleDeg: number };
      // Coverage mode literal — kept as a string union (not an imported type)
      // so this descriptor stays serializable without pulling in main.ts.
      coverageMode?: 'centroid' | 'fully_inside' | 'any_vertex_inside';
      maxTriangleArea?: number;
      smooth?: boolean; maxEdge?: number }
  | { kind: 'triangles'; ids: number[] }
  | { kind: 'byLabel'; label: string }
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
  | { kind: 'brushStroke'; samples: [number, number, number][]; radius: number; shape: BrushShape; maxEdge: number; surface?: 'geodesic' | 'slab'; depth?: number; spray?: { strength: number; softness: number; seed: number } };

export interface SerializedColorRegion {
  id: number;
  name: string;
  color: [number, number, number];
  source: ColorRegion['source'];
  descriptor: RegionDescriptor;
  order: number;
  visible?: boolean; // optional for backward compat — defaults to true on load
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

export function removeChangeListener(fn: ChangeListener): void {
  const idx = listeners.indexOf(fn);
  if (idx >= 0) listeners.splice(idx, 1);
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
  regions = [...clearSnapshot];
  nextOrder = regions.reduce((max, r) => Math.max(max, r.order + 1), 1);
  clearSnapshot = null;
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

export function getRegion(id: number): ColorRegion | undefined {
  return regions.find(r => r.id === id);
}

export function setRegionVisibility(id: number, visible: boolean): boolean {
  const region = regions.find(r => r.id === id);
  if (!region) return false;
  if (region.visible === visible) return true;
  region.visible = visible;
  notify();
  return true;
}

export function isRegionVisible(id: number): boolean | undefined {
  const region = regions.find(r => r.id === id);
  return region?.visible;
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

/** Replace a region's resolved triangle set in place. Used when the working
 *  mesh changes (e.g. a smooth brush stroke subdivides it) and every region
 *  must be re-resolved against the new tessellation. Does not notify — the
 *  caller drives a single re-render after re-resolving all regions. */
export function setRegionTriangles(id: number, triangles: Set<number>): void {
  const region = regions.find(r => r.id === id);
  if (region) region.triangles = triangles;
}

export function clearRegions(): void {
  if (regions.length === 0) return;
  clearSnapshot = [...regions];
  regions = [];
  nextOrder = 1;
  clearRedoStack();
  notify();
  notifyClearSnapshot();
}

/** Replace the model-declared color underlay. Called once per run with the
 *  colors declared via `api.label(shape, name, { color })`, already resolved to
 *  triangle sets against that run's labelMap. Pass `[]` (or run code that
 *  declares no colors) to clear the layer. Does NOT notify — the run path drives
 *  a single re-render after setting these. */
export function setModelColorRegions(
  decls: ReadonlyArray<{ name: string; color: [number, number, number]; triangles: Set<number> }>,
): void {
  modelRegions = decls.map((d, i) => ({
    id: -(i + 1), // negative ids never collide with the positive user-region ids
    name: d.name,
    color: d.color,
    source: 'model' as const,
    descriptor: { kind: 'byLabel' as const, label: d.name },
    order: i + 1, // order within the model band; the user paint layer sits above
    visible: true,
    triangles: d.triangles,
  }));
}

export function hasModelColorRegions(): boolean {
  return modelRegions.length > 0;
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
 *  so a hidden-in-UI region still ships in the GLB/3MF. */
export function buildTriColors(numTri: number, respectPerRegionVisibility = false): Uint8Array | null {
  if (regions.length === 0 && modelRegions.length === 0) return null;

  const buf = new Uint8Array(numTri * 3); // default 0,0,0 — ignored for un-colored tris
  // `painted[t] === 1` once ANY layer colors triangle `t`. Tracked separately
  // from order so a region can legitimately paint pure black (and so the
  // model-color base layer counts as painted even though it sits below paint).
  const painted = new Uint8Array(numTri);

  // Stamp one layer of regions onto buf, higher `order` winning WITHIN the
  // layer. Layers are applied in call order, so a later layer overwrites an
  // earlier one wherever they overlap.
  const stampLayer = (layer: ColorRegion[]) => {
    const eligible = respectPerRegionVisibility ? layer.filter(r => r.visible) : layer;
    const sorted = [...eligible].sort((a, b) => a.order - b.order);
    const layerOrder = new Int32Array(numTri).fill(-1); // -1 = untouched in this layer
    for (const region of sorted) {
      const r = Math.round(region.color[0] * 255);
      const g = Math.round(region.color[1] * 255);
      const b = Math.round(region.color[2] * 255);
      for (const tri of region.triangles) {
        if (tri >= 0 && tri < numTri && region.order >= layerOrder[tri]) {
          buf[tri * 3] = r;
          buf[tri * 3 + 1] = g;
          buf[tri * 3 + 2] = b;
          layerOrder[tri] = region.order;
          painted[tri] = 1;
        }
      }
    }
  };

  // Model-declared colors are the base; the user's manual paint composites on
  // top and always wins (it's an optional override of the code's colors).
  stampLayer(modelRegions);
  stampLayer(regions);

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
  }));
}

/** Apply triColors to a MeshData, returning a new object (non-destructive).
 *  Use for EXPORTS — all regions are baked in regardless of UI visibility flags. */
export function applyTriColors(mesh: MeshData): MeshData {
  const triColors = buildTriColors(mesh.numTri, false);
  if (!triColors) return mesh;
  return { ...mesh, triColors };
}

/** Viewport-facing variant: returns the mesh unchanged when the global paint
 *  visibility is toggled off, and skips individual regions whose per-region
 *  `visible` flag is false (eye-icon toggles in the region list). */
export function applyTriColorsIfVisible(mesh: MeshData): MeshData {
  if (!visible) return mesh;
  const triColors = buildTriColors(mesh.numTri, true);
  if (!triColors) return mesh;
  return { ...mesh, triColors };
}
