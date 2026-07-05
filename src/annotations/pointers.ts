// Pointer-annotation store — module-level state for the AI-planning pointer
// system. A pointer is a *mesh-anchored* labelled callout: the AI drops one at
// a surface point it believes corresponds to a specific feature (an iris, a
// foot, a button), the user approves / drags / corrects it, and downstream
// paint tools resolve it back to a triangle set via the existing
// `connectedFromSeed` / `coplanar` / `colorFlood` flood-fills.
//
// This is intentionally separate from the freehand `annotations.ts` store:
// strokes/text are plane-projected display marks (frozen-camera billboards),
// while pointers are surface-anchored and must survive mesh re-runs via
// `resolveSeed`. Lifecycle, persistence (per-SESSION vs per-VERSION), and
// resolution semantics are different enough to keep the modules apart.

import type { AdjacencyGraph } from '../color/adjacency';
import { resolveSeed, findNearestTriangle } from '../color/adjacency';
import type { MeshData } from '../geometry/types';

export type PointerPaintHintKind = 'connected' | 'coplanar' | 'colorFlood';

/** Per-pointer flood-fill recipe the AI proposes; the user can tweak the
 *  threshold before committing. Maps directly onto a `RegionDescriptor`
 *  variant at commit time. */
export type PointerPaintHint =
  | { kind: 'connected'; maxDeviationDeg: number }
  | { kind: 'coplanar'; normalToleranceDeg: number }
  | { kind: 'colorFlood'; colorTolerance: number };

export type PointerStatus = 'proposed' | 'approved' | 'painted';

export interface PointerAnnotation {
  id: string;
  label: string;
  /** Surface anchor in world coords. Re-resolved against the live mesh on
   *  every run via {@link resolvePointersAgainstMesh}. */
  point: [number, number, number];
  normal: [number, number, number];
  /** Last resolved triangle index. -1 when unresolved (no live mesh yet, or
   *  resolveSeed found no hit — see `orphaned`). */
  triangleId: number;
  paintHint?: PointerPaintHint;
  /** Suggested colour the AI plans to paint with — RGB 0..1. The user can
   *  override at commit time. */
  proposedColor?: [number, number, number];
  status: PointerStatus;
  authoredBy: 'ai' | 'user';
  /** Hidden from the viewport overlay but kept in the list. AI hide/show
   *  tools and the panel's per-pointer eye toggle both flip this. */
  hidden: boolean;
  /** Set when the live mesh moved enough that `resolveSeed` snapped the
   *  pointer to a triangle with a divergent normal. The panel + AI both see
   *  it via `listPointers` and decide whether to re-aim or clear. */
  stale: boolean;
  /** Set when no triangle was found at all (the surface this pointer
   *  anchored to has been deleted / moved out of the ray). */
  orphaned: boolean;
  /** Free-form reason for the most recent stale/orphan flag — surfaced in
   *  the panel tooltip and tool result. */
  staleReason?: string;
  /** Set on commit, kept for the audit trail. */
  regionId?: number;
  lastPaintedAt?: number;
  createdAt: number;
}

export interface SerializedPointer {
  id: string;
  label: string;
  point: { x: number; y: number; z: number };
  normal: { x: number; y: number; z: number };
  paintHint?: PointerPaintHint;
  proposedColor?: [number, number, number];
  status: PointerStatus;
  authoredBy: 'ai' | 'user';
  hidden?: boolean;
  createdAt: number;
}

let pointers: PointerAnnotation[] = [];
const listeners: Array<() => void> = [];
let nextLocalId = 1;

function notify(): void {
  for (const fn of listeners) fn();
}

export function onPointersChange(fn: () => void): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

export function getPointers(): readonly PointerAnnotation[] {
  return pointers;
}

export function getPointerById(id: string): PointerAnnotation | null {
  return pointers.find(p => p.id === id) ?? null;
}

export function getPointerCount(): number {
  return pointers.length;
}

/** Lightweight readable id for log lines + chat replay — falls back to a
 *  stable counter so console-driven runs don't depend on the host's
 *  generateId.  Pass an explicit id to {@link addPointer} for production. */
function makeLocalId(): string {
  return `ptr_${nextLocalId++}`;
}

export interface AddPointerInput {
  id?: string;
  label: string;
  point: [number, number, number];
  normal: [number, number, number];
  triangleId?: number;
  paintHint?: PointerPaintHint;
  proposedColor?: [number, number, number];
  authoredBy?: 'ai' | 'user';
  status?: PointerStatus;
  createdAt?: number;
}

export function addPointer(input: AddPointerInput): PointerAnnotation {
  const p: PointerAnnotation = {
    id: input.id ?? makeLocalId(),
    label: input.label,
    point: [input.point[0], input.point[1], input.point[2]],
    normal: [input.normal[0], input.normal[1], input.normal[2]],
    triangleId: input.triangleId ?? -1,
    paintHint: input.paintHint,
    proposedColor: input.proposedColor,
    status: input.status ?? 'proposed',
    authoredBy: input.authoredBy ?? 'user',
    hidden: false,
    stale: false,
    orphaned: false,
    createdAt: input.createdAt ?? Date.now(),
  };
  pointers.push(p);
  notify();
  return p;
}

export interface UpdatePointerPatch {
  label?: string;
  point?: [number, number, number];
  normal?: [number, number, number];
  triangleId?: number;
  paintHint?: PointerPaintHint;
  proposedColor?: [number, number, number];
  status?: PointerStatus;
  hidden?: boolean;
  stale?: boolean;
  orphaned?: boolean;
  staleReason?: string;
  regionId?: number;
  lastPaintedAt?: number;
}

export function updatePointer(id: string, patch: UpdatePointerPatch): PointerAnnotation | null {
  const p = pointers.find(x => x.id === id);
  if (!p) return null;
  if (patch.label !== undefined) p.label = patch.label;
  if (patch.point) p.point = [patch.point[0], patch.point[1], patch.point[2]];
  if (patch.normal) p.normal = [patch.normal[0], patch.normal[1], patch.normal[2]];
  if (patch.triangleId !== undefined) p.triangleId = patch.triangleId;
  if (patch.paintHint !== undefined) p.paintHint = patch.paintHint;
  if (patch.proposedColor !== undefined) p.proposedColor = patch.proposedColor;
  if (patch.status !== undefined) p.status = patch.status;
  if (patch.hidden !== undefined) p.hidden = patch.hidden;
  if (patch.stale !== undefined) p.stale = patch.stale;
  if (patch.orphaned !== undefined) p.orphaned = patch.orphaned;
  if (patch.staleReason !== undefined) p.staleReason = patch.staleReason;
  if (patch.regionId !== undefined) p.regionId = patch.regionId;
  if (patch.lastPaintedAt !== undefined) p.lastPaintedAt = patch.lastPaintedAt;
  notify();
  return p;
}

export function removePointer(id: string): boolean {
  const i = pointers.findIndex(p => p.id === id);
  if (i < 0) return false;
  pointers.splice(i, 1);
  notify();
  return true;
}

export interface ClearFilter {
  status?: PointerStatus;
  ids?: string[];
}

export function clearPointers(filter?: ClearFilter): number {
  const before = pointers.length;
  if (!filter || (filter.status === undefined && !filter.ids)) {
    pointers = [];
  } else {
    const idSet = filter.ids ? new Set(filter.ids) : null;
    pointers = pointers.filter(p => {
      if (filter.status !== undefined && p.status !== filter.status) return true;
      if (idSet && !idSet.has(p.id)) return true;
      return false;
    });
  }
  const removed = before - pointers.length;
  if (removed > 0) notify();
  return removed;
}

export function setHidden(ids: string[] | undefined, hidden: boolean): number {
  let changed = 0;
  const idSet = ids ? new Set(ids) : null;
  for (const p of pointers) {
    if (idSet && !idSet.has(p.id)) continue;
    if (p.hidden !== hidden) {
      p.hidden = hidden;
      changed++;
    }
  }
  if (changed > 0) notify();
  return changed;
}

/** Replace the entire pointer set — used on session open + import. */
export function loadSerialized(serialized: SerializedPointer[]): void {
  pointers = serialized.map((s): PointerAnnotation => ({
    id: s.id,
    label: s.label,
    point: [s.point.x, s.point.y, s.point.z],
    normal: [s.normal.x, s.normal.y, s.normal.z],
    triangleId: -1,
    paintHint: s.paintHint,
    proposedColor: s.proposedColor,
    status: s.status,
    authoredBy: s.authoredBy,
    hidden: !!s.hidden,
    stale: false,
    orphaned: false,
    createdAt: s.createdAt,
  }));
  notify();
}

export function serializeAll(): SerializedPointer[] {
  return pointers.map((p): SerializedPointer => ({
    id: p.id,
    label: p.label,
    point: { x: p.point[0], y: p.point[1], z: p.point[2] },
    normal: { x: p.normal[0], y: p.normal[1], z: p.normal[2] },
    ...(p.paintHint ? { paintHint: p.paintHint } : {}),
    ...(p.proposedColor ? { proposedColor: p.proposedColor } : {}),
    status: p.status,
    authoredBy: p.authoredBy,
    ...(p.hidden ? { hidden: true } : {}),
    createdAt: p.createdAt,
  }));
}

export function clearAllPointers(silent = false): void {
  if (pointers.length === 0) return;
  pointers = [];
  if (!silent) notify();
}

// ── Mesh-change invalidation ──────────────────────────────────────────────

const STALE_NORMAL_COS = Math.cos(45 * Math.PI / 180);
const STALE_DISTANCE_FRAC = 0.05;

export interface ResolveReport {
  resolved: number;
  staled: number;
  orphaned: number;
  cleared: number;
}

/** Re-resolve every pointer's anchor against the latest mesh after a run.
 *  Each pointer is ray-cast back onto the surface via `resolveSeed`; when
 *  that fails we fall back to `findNearestTriangle` so a slightly-drifted
 *  point still resolves (and the panel flags it `stale` if the normal has
 *  diverged). The store fires a single change notification at the end.
 *
 *  Returns counts for the panel/AI status surface.
 */
export function resolvePointersAgainstMesh(
  mesh: MeshData,
  adjacency: AdjacencyGraph,
): ResolveReport {
  if (pointers.length === 0) return { resolved: 0, staled: 0, orphaned: 0, cleared: 0 };

  // Mesh diagonal — used to scale the "did the anchor drift" threshold so a
  // tiny mesh and a huge mesh get a proportional cutoff rather than the same
  // absolute one.
  const diag = meshDiagonal(mesh);
  const driftCutoff = diag * STALE_DISTANCE_FRAC;

  let resolved = 0, staled = 0, orphaned = 0;
  for (const p of pointers) {
    const exact = resolveSeed(p.point, p.normal, mesh, adjacency);
    if (exact >= 0) {
      p.triangleId = exact;
      const wasFlagged = p.stale || p.orphaned;
      p.stale = false;
      p.orphaned = false;
      if (wasFlagged) p.staleReason = undefined;
      resolved++;
      continue;
    }
    // Fall back to nearest-triangle so the leader line still draws and the
    // panel can show the user where the AI THINKS the feature went.
    const near = findNearestTriangle(p.point, mesh, adjacency);
    if (near.triIndex < 0) {
      p.triangleId = -1;
      p.orphaned = true;
      p.stale = true;
      p.staleReason = 'no surface found within mesh';
      orphaned++;
      continue;
    }
    p.triangleId = near.triIndex;
    const dotNorm =
      p.normal[0] * near.normal[0] +
      p.normal[1] * near.normal[1] +
      p.normal[2] * near.normal[2];
    if (near.distance > driftCutoff || dotNorm < STALE_NORMAL_COS) {
      p.stale = true;
      p.staleReason = near.distance > driftCutoff
        ? `anchor drifted ${near.distance.toFixed(2)} units from the live surface`
        : 'surface normal at this point has flipped or strongly turned';
      staled++;
    } else {
      // Anchor snapped to a slightly different but consistent triangle — the
      // common case for code-edit re-runs of a near-identical mesh.
      const wasFlagged = p.stale || p.orphaned;
      p.stale = false;
      p.orphaned = false;
      if (wasFlagged) p.staleReason = undefined;
      // Refresh the cached point/normal to keep the leader line glued to
      // the live mesh on the next render.
      p.point = [near.closest[0], near.closest[1], near.closest[2]];
      p.normal = [near.normal[0], near.normal[1], near.normal[2]];
      resolved++;
    }
  }
  notify();
  return { resolved, staled, orphaned, cleared: 0 };
}

/** Hard invalidation: a mesh-replacing bake op fired (surface modifier,
 *  voxelize, transform, language switch). The triangle topology may be
 *  unrelated to what the pointers were anchored on, so we flag everything
 *  stale and let the user/AI decide whether to re-aim or clear. We do NOT
 *  auto-delete — preserving the work matches the explicit user-decisions
 *  rule in CLAUDE.md.
 */
export function markAllStale(reason: string): number {
  let flagged = 0;
  for (const p of pointers) {
    if (!p.stale && !p.orphaned) {
      flagged++;
    }
    p.stale = true;
    p.staleReason = reason;
  }
  if (pointers.length > 0) notify();
  return flagged;
}

function meshDiagonal(mesh: MeshData): number {
  const { vertProperties, numProp, numVert } = mesh;
  if (numVert === 0) return 1;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < numVert; i++) {
    const x = vertProperties[i * numProp];
    const y = vertProperties[i * numProp + 1];
    const z = vertProperties[i * numProp + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return d > 0 ? d : 1;
}

// ── Test seam ────────────────────────────────────────────────────────────
/** Reset the module to a pristine state. Tests only. */
export function __resetForTests(): void {
  pointers = [];
  nextLocalId = 1;
}
