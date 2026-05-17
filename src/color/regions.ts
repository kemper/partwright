// ColorRegionStore — manages per-face color regions for the current mesh

import type { MeshData } from '../geometry/types';

export interface ColorRegion {
  id: number;
  name: string;
  color: [number, number, number]; // RGB 0..1
  source: 'face-pick' | 'slab' | 'subtree' | 'paintbrush';
  descriptor: RegionDescriptor;
  order: number;
  triangles: Set<number>; // resolved triangle indices (transient, not persisted)
}

export type RegionDescriptor =
  | { kind: 'coplanar'; seedPoint: [number, number, number]; seedNormal: [number, number, number]; normalTolerance: number }
  | { kind: 'slab'; normal: [number, number, number]; offset: number; thickness: number }
  | { kind: 'triangles'; ids: number[] }
  | { kind: 'byLabel'; label: string }
  | { kind: 'connectedFromSeed'; seedPoint: [number, number, number]; seedNormal: [number, number, number]; maxDeviationDeg: number };

export interface SerializedColorRegion {
  id: number;
  name: string;
  color: [number, number, number];
  source: ColorRegion['source'];
  descriptor: RegionDescriptor;
  order: number;
}

type ChangeListener = () => void;

let regions: ColorRegion[] = [];
let nextOrder = 1;
let visible = true;
const listeners: ChangeListener[] = [];
const visibilityListeners: ChangeListener[] = [];
const redoListeners: ChangeListener[] = [];

// Redo stack — regions removed via `removeLastRegion()`. Any other mutation
// (add, clear, deserialize) drops the stack so redo can never resurrect a
// region into a state where the user wouldn't expect it.
let regionRedoStack: ColorRegion[] = [];

function notify(): void {
  for (const fn of listeners) fn();
}

function notifyVisibility(): void {
  for (const fn of visibilityListeners) fn();
}

function notifyRedo(): void {
  for (const fn of redoListeners) fn();
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
): ColorRegion {
  const id = Date.now() + Math.floor(Math.random() * 1000);
  const region: ColorRegion = {
    id,
    name,
    color,
    source,
    descriptor,
    order: nextOrder++,
    triangles,
  };
  regions.push(region);
  clearRedoStack();
  notify();
  return region;
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

export function clearRegions(): void {
  if (regions.length === 0) return;
  regions = [];
  nextOrder = 1;
  clearRedoStack();
  notify();
}

/** Build triColors (Uint8Array, numTri*3 RGB) from current regions.
 *  Higher-order regions win on overlap. Returns null if no regions. */
export function buildTriColors(numTri: number): Uint8Array | null {
  if (regions.length === 0) return null;

  const buf = new Uint8Array(numTri * 3); // default 0,0,0 — will be ignored for unpainted tris

  // Track which triangles are painted and with what priority
  const triOrder = new Int32Array(numTri); // 0 = unpainted
  triOrder.fill(0);

  // Sort by order ascending so higher-order regions overwrite lower
  const sorted = [...regions].sort((a, b) => a.order - b.order);

  for (const region of sorted) {
    const r = Math.round(region.color[0] * 255);
    const g = Math.round(region.color[1] * 255);
    const b = Math.round(region.color[2] * 255);
    for (const tri of region.triangles) {
      if (tri >= 0 && tri < numTri && region.order >= triOrder[tri]) {
        buf[tri * 3] = r;
        buf[tri * 3 + 1] = g;
        buf[tri * 3 + 2] = b;
        triOrder[tri] = region.order;
      }
    }
  }

  // Mark which triangles are painted (any with order > 0)
  // We use a separate flag array to distinguish "painted black" from "unpainted"
  const painted = new Uint8Array(numTri);
  for (let i = 0; i < numTri; i++) {
    if (triOrder[i] > 0) painted[i] = 1;
  }

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
  }));
}

export function deserialize(data: SerializedColorRegion[]): void {
  regions = data.map(d => ({
    ...d,
    triangles: new Set<number>(),
  }));
  nextOrder = regions.reduce((max, r) => Math.max(max, r.order + 1), 1);
  clearRedoStack();
}

/** Apply triColors to a MeshData, returning a new object (non-destructive). */
export function applyTriColors(mesh: MeshData): MeshData {
  const triColors = buildTriColors(mesh.numTri);
  if (!triColors) return mesh;
  return { ...mesh, triColors };
}

/** Same as `applyTriColors` but returns the mesh unchanged when paint
 *  visibility is toggled off. Use this for viewport rendering; exports should
 *  call `applyTriColors` directly so colors persist regardless of UI state. */
export function applyTriColorsIfVisible(mesh: MeshData): MeshData {
  if (!visible) return mesh;
  return applyTriColors(mesh);
}
