// PartDraft — the editable, scored result of a detection run.
//
// Owned by the foundation (not by detectors) so every algorithm's output is
// summarized, scored, edited and undone the same way. Detection never
// mutates the session; a draft only becomes persistent on acceptParts.
//
// Public part ids are 1-based (the numbers drawn on the overlay legend), so
// a user or AI can say "part 4". Internally triPart holds 0-based indices
// (-1 = unassigned).
//
// Parts own their PINS (`seeds`, keyed by part name): every part has at least
// one — the user's/AI's, or an automatic one in the middle of each region.
// Renaming or merging a part carries its pins along. The partition stays the
// source of truth; pins steer it: adding, moving or removing a pin re-grows
// only that part and its neighbours, and hand fixes (`reassign`) become FIXED
// triangles a re-grow leaves alone. Re-detecting the whole model stays explicit
// (detect / rerun).

import {
  absorbSmallRegions, adjacencyFromPairs, majorityFilter, partitionRegions, type TriAdjacency,
} from '../geometry/triSetOps';
import { resolveSeeds } from './detectors';
import { nearestTriangle } from './features';
import { growFromSeeds, type GrowthRule } from './growth';
import { getDetector, resolveParams } from './registry';
import type { DetectorContext, DetectorResult, FeatureOptions, MeshFeatures, ParamValues, SegMesh, SegSeed } from './types';

/** Overlay colour candidates: 36 hues around the wheel in three
 *  lightness/saturation tiers (displayColors picks among them so neighbours
 *  stay distinct). */
const PALETTE: string[] = (() => {
  const out: string[] = [];
  const tiers: [number, number][] = [[0.72, 0.55], [0.85, 0.38], [0.55, 0.7]];
  for (let k = 0; k < 36; k++) {
    const [sat, light] = tiers[k % 3];
    out.push(hslToHex((k * 137.508) % 360, sat, light));
  }
  return out;
})();
/** "Redmean" RGB distance below which two neighbouring parts' colours count
 *  as clashing. Part of the colour metric's definition, not a knob. */
const MIN_NEIGHBOR_COLOR_DISTANCE = 120;

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Perceptual-ish RGB distance ("redmean" weighting). */
function colorDistance(a: [number, number, number], b: [number, number, number]): number {
  const rm = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

export const UNASSIGNED_COLOR = '#3a3a3a';

export function overlayColor(index: number, explicit: string | null | undefined): string {
  return explicit ?? PALETTE[index % PALETTE.length];
}

export interface PartSummary {
  /** 1-based id shown on the overlay legend. */
  id: number;
  name: string;
  /** Explicit colour (committed as model colour on accept), or null. */
  color: string | null;
  /** Colour the overlay uses (explicit colour, else a palette colour). */
  displayColor: string;
  triCount: number;
  areaFrac: number;
  centroid: [number, number, number];
  /** On-surface point near the centroid — where the legend number goes. */
  anchor: [number, number, number];
  bbox: { min: [number, number, number]; max: [number, number, number] };
  /** Ids of parts sharing a boundary with this one. */
  neighbors: number[];
  /** Same-label connected regions (1 = one clean piece). */
  regions: number;
  /** Locked parts keep their triangles when detection re-runs. */
  locked: boolean;
  /** Pins this part owns (see `seeds`). */
  pins: number;
}

export interface DraftQuality {
  partCount: number;
  /** Length-weighted mean concave-crease strength (°) along part
   *  boundaries — higher means boundaries sit on real seams. */
  boundaryCreaseMean: number;
  boundaryLength: number;
  /** Extra disconnected regions beyond one per part — expected for paired
   *  parts (two eyes), otherwise usually a leak. */
  islandCount: number;
  /** Area fraction in those extra regions. */
  islandAreaFrac: number;
  unassignedAreaFrac: number;
  /** Normalized entropy of part areas (1 = all parts equal size). */
  sizeBalance: number;
  /** Mean boundaryLength/√area per part (lower = more compact parts). */
  compactness: number;
  /** Share of the mesh's strong-groove length (≥ STRONG_GROOVE_DEG) that
   *  lies on a part boundary — recall: are the real seams used? */
  grooveCoverage: number;
  /** Share of the boundary length that runs along strong grooves —
   *  precision: do boundaries sit on real seams? */
  grooveFidelity: number;
}

export interface DraftSummary {
  detectorId: string;
  params: ParamValues;
  featureOptions: FeatureOptions;
  seeds: SegSeed[];
  triCount: number;
  parts: PartSummary[];
  unassigned: { triCount: number; areaFrac: number };
  quality: DraftQuality;
  diagnostics?: Record<string, unknown>;
  canUndo: boolean;
  /** Present while detection is focused on one area (see the 'focus' op). */
  focus: { triCount: number } | null;
  /** Boundary-smoothing passes for smooth (sub-triangle) part edges; 0 = off. */
  edgeSmoothing: number;
}

export type PartRef = number | string;

/** Batch edit operations (editParts). Part refs are 1-based ids or names. */
export type PartEditOp =
  | { op: 'merge'; ids: PartRef[]; name?: string }
  | { op: 'rename'; id: PartRef; name: string }
  | { op: 'setColor'; id: PartRef; color: string | null }
  | { op: 'delete'; id: PartRef }
  | { op: 'reassign'; point: [number, number, number]; to: PartRef; radius?: number }
  | { op: 'split'; id: PartRef; seeds: SegSeed[] }
  | { op: 'absorbSmall'; minAreaFrac: number }
  | { op: 'smoothBoundaries'; iterations?: number }
  | { op: 'addSeed'; seed: SegSeed; rerun?: boolean }
  | { op: 'removeSeed'; index: number; rerun?: boolean }
  | { op: 'moveSeed'; index: number; point: [number, number, number]; rerun?: boolean }
  | { op: 'seedsFromParts'; minRegionFrac?: number }
  | { op: 'lock'; id: PartRef; locked?: boolean }
  | { op: 'focus'; id: PartRef | null }
  | { op: 'setEdgeSmoothing'; iterations: number }
  | { op: 'reorder'; id: PartRef; position: number }
  | { op: 'clear' }
  | { op: 'rerun' }
  | { op: 'undo' };

interface Snapshot {
  triPart: Int32Array;
  names: string[];
  colors: (string | null)[];
  seeds: SegSeed[];
  diagnostics?: Record<string, unknown>;
  locked: string[];
  focusMask: Uint8Array | null;
  detectorId: string;
  params: ParamValues;
  featureOptions: FeatureOptions;
  edgeSmoothing: number;
  /** Detection may switch the crease field (feature options): undo must
   *  restore the one the restored partition was measured on. */
  features: MeshFeatures;
  fixedTri: Int32Array | null;
}

/** A crease at least this sharp (°) counts as a real seam for the
 *  grooveCoverage / grooveFidelity metrics. Part of the metrics' definition
 *  (changing it changes what they mean), not a tuning knob. */
const STRONG_GROOVE_DEG = 15;

/** Default boundary-smoothing passes for smooth part edges. */
export const DEFAULT_EDGE_SMOOTHING = 3;
/** Upper bound on boundary-smoothing passes (cost guard). */
export const MAX_EDGE_SMOOTHING = 20;


export class PartDraftModel {
  readonly mesh: SegMesh;
  /** Features of the last detection (crease strength depends on its feature
   *  options; adjacency does not). */
  features: MeshFeatures;
  readonly adjacency: TriAdjacency;
  /** Part names whose triangles detection must not touch. */
  lockedNames = new Set<string>();
  /** When set, detection only relabels these triangles (a focused part). */
  focusMask: Uint8Array | null = null;
  edgeSmoothing = DEFAULT_EDGE_SMOOTHING;
  /** Part index per triangle a hand fix pinned there (−1 = not fixed): a
   *  local re-grow leaves these triangles alone, so it can't undo the fix. */
  fixedTri: Int32Array | null = null;
  /** Automatic pins skip regions smaller than this fraction of their part
   *  (appConfig.segmentation.seedsFromPartsMinRegionFrac, threaded in). */
  anchorMinRegionFrac = 0.01;
  /** Overlay colour remembered per part name, so colours stay put across
   *  edits (see displayColors). */
  private colorMemo = new Map<string, string>();
  /** Runner-owned per-mesh cache handed to detectors (see DetectorContext). */
  cache?: Map<string, unknown>;
  detectorId: string;
  params: ParamValues;
  featureOptions: FeatureOptions;
  seeds: SegSeed[];
  triPart: Int32Array;
  names: string[];
  colors: (string | null)[];
  diagnostics?: Record<string, unknown>;
  private undoStack: Snapshot[] = [];
  /** Snapshots kept for undo (appConfig.segmentation.undoDepth, threaded in
   *  by the runner because the model lives in a Worker). */
  undoDepth = 20;

  constructor(
    mesh: SegMesh,
    features: MeshFeatures,
    run: { detectorId: string; params: ParamValues; featureOptions: FeatureOptions; seeds: SegSeed[] },
    result: DetectorResult,
  ) {
    this.mesh = mesh;
    this.features = features;
    this.adjacency = adjacencyFromPairs(features.triCount, features.edgeA, features.edgeB);
    this.detectorId = run.detectorId;
    this.params = run.params;
    this.featureOptions = run.featureOptions;
    this.seeds = getDetector(run.detectorId)?.seeds === 'none' ? [] : run.seeds.map(cloneSeed);
    this.diagnostics = result.diagnostics;
    this.triPart = result.triPart;
    this.names = [];
    this.colors = [];
    this.adoptResult(result);
    this.syncAnchors();
  }

  /** Rebuild a draft from parts saved on an import (re-opening accepted
   *  parts for editing): partition, names, colours and the seeds/params that
   *  produced them. */
  static fromSaved(
    mesh: SegMesh,
    features: MeshFeatures,
    saved: { triPart: Int32Array; names: string[]; colors: (string | null)[]; detectorId: string; params: ParamValues; featureOptions: FeatureOptions; seeds: SegSeed[] },
  ): PartDraftModel {
    const model = new PartDraftModel(
      mesh, features,
      { detectorId: saved.detectorId, params: saved.params, featureOptions: saved.featureOptions, seeds: saved.seeds },
      { triPart: saved.triPart.slice(), partNames: saved.names, diagnostics: { reopened: true } },
    );
    const byName = new Map(saved.names.map((nm, i) => [nm, saved.colors[i] ?? null] as const));
    model.colors = model.names.map((nm) => byName.get(nm) ?? null);
    model.seeds = saved.seeds.map(cloneSeed);
    model.syncAnchors();
    return model;
  }

  /** Independent copy (previews run detection on a copy so the real draft —
   *  with its locks and focus honoured — is untouched). */
  clone(): PartDraftModel {
    const c = PartDraftModel.fromSaved(this.mesh, this.features, {
      triPart: this.triPart, names: this.names, colors: this.colors, detectorId: this.detectorId,
      params: this.params, featureOptions: this.featureOptions, seeds: this.seeds,
    });
    c.lockedNames = new Set(this.lockedNames);
    c.focusMask = this.focusMask ? this.focusMask.slice() : null;
    c.fixedTri = this.fixedTri ? this.fixedTri.slice() : null;
    c.anchorMinRegionFrac = this.anchorMinRegionFrac;
    c.edgeSmoothing = this.edgeSmoothing;
    c.cache = this.cache;
    c.undoDepth = this.undoDepth;
    return c;
  }

  private adoptResult(result: DetectorResult): void {
    this.triPart = result.triPart;
    let maxIdx = -1;
    for (let t = 0; t < this.triPart.length; t++) if (this.triPart[t] > maxIdx) maxIdx = this.triPart[t];
    const count = Math.max(maxIdx + 1, result.partNames?.length ?? 0);
    this.names = Array.from({ length: count }, (_, i) => result.partNames?.[i] ?? `part ${i + 1}`);
    this.colors = Array.from({ length: count }, () => null);
    this.diagnostics = result.diagnostics;
    this.compact();
  }

  // ---------------------------------------------------------------- summary

  summary(): DraftSummary {
    const f = this.features;
    const n = this.names.length;
    const area = new Float64Array(n);
    const tris = new Int32Array(n);
    const cx = new Float64Array(n), cy = new Float64Array(n), cz = new Float64Array(n);
    const bmin = Array.from({ length: n }, () => [Infinity, Infinity, Infinity] as [number, number, number]);
    const bmax = Array.from({ length: n }, () => [-Infinity, -Infinity, -Infinity] as [number, number, number]);
    let unTris = 0, unArea = 0;
    const p = this.mesh.positions, tv = this.mesh.triVerts;
    for (let t = 0; t < f.triCount; t++) {
      const L = this.triPart[t];
      const a = f.triArea[t];
      if (L < 0) { unTris++; unArea += a; continue; }
      tris[L]++; area[L] += a;
      cx[L] += f.triCentroid[t * 3] * a; cy[L] += f.triCentroid[t * 3 + 1] * a; cz[L] += f.triCentroid[t * 3 + 2] * a;
      for (let k = 0; k < 3; k++) {
        const v = tv[t * 3 + k] * 3;
        for (let d = 0; d < 3; d++) {
          const x = p[v + d];
          if (x < bmin[L][d]) bmin[L][d] = x;
          if (x > bmax[L][d]) bmax[L][d] = x;
        }
      }
    }
    // Boundaries, neighbours, crease strength.
    const nbrSets = Array.from({ length: n }, () => new Set<number>());
    const bLen = new Float64Array(n);
    let boundaryLength = 0, creaseSum = 0, strongLen = 0, strongOnBoundary = 0;
    for (let e = 0; e < f.edgeA.length; e++) {
      const la = this.triPart[f.edgeA[e]], lb = this.triPart[f.edgeB[e]];
      const strong = f.creaseCost[e] >= STRONG_GROOVE_DEG;
      if (strong) strongLen += f.edgeLen[e];
      if (la === lb || la < 0 || lb < 0) continue;
      if (strong) strongOnBoundary += f.edgeLen[e];
      nbrSets[la].add(lb); nbrSets[lb].add(la);
      const len = f.edgeLen[e];
      bLen[la] += len; bLen[lb] += len;
      boundaryLength += len;
      creaseSum += f.creaseCost[e] * len;
    }
    // Regions per part (islands).
    const { compOf, count } = partitionRegions(this.triPart, this.adjacency);
    const regionArea = new Float64Array(count);
    const regionLabel = new Int32Array(count).fill(-1);
    for (let t = 0; t < f.triCount; t++) { regionArea[compOf[t]] += f.triArea[t]; regionLabel[compOf[t]] = this.triPart[t]; }
    const regions = new Int32Array(n);
    const largest = new Float64Array(n);
    for (let c = 0; c < count; c++) {
      const L = regionLabel[c];
      if (L < 0) continue;
      regions[L]++;
      if (regionArea[c] > largest[L]) largest[L] = regionArea[c];
    }
    let islandCount = 0, islandArea = 0;
    for (let L = 0; L < n; L++) { islandCount += Math.max(0, regions[L] - 1); islandArea += area[L] - largest[L]; }

    const total = f.totalArea || 1;
    let entropy = 0, compactSum = 0;
    for (let L = 0; L < n; L++) {
      const q = area[L] / Math.max(1e-30, total - unArea);
      if (q > 0) entropy -= q * Math.log(q);
      compactSum += area[L] > 0 ? bLen[L] / Math.sqrt(area[L]) : 0;
    }

    // Anchors: each part's triangle nearest its centroid, in one O(n) pass
    // (a per-part scan is O(parts × n) — too slow with hundreds of patches).
    const bestT = new Int32Array(n).fill(-1);
    const bestD = new Float64Array(n).fill(Infinity);
    for (let t = 0; t < f.triCount; t++) {
      const L = this.triPart[t];
      if (L < 0) continue;
      const a = area[L] || 1;
      const dx = f.triCentroid[t * 3] - cx[L] / a, dy = f.triCentroid[t * 3 + 1] - cy[L] / a, dz = f.triCentroid[t * 3 + 2] - cz[L] / a;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD[L]) { bestD[L] = d; bestT[L] = t; }
    }

    const display = this.displayColors(nbrSets);
    const pinCount = new Map<string, number>();
    for (const sd of this.seeds) pinCount.set(sd.label, (pinCount.get(sd.label) ?? 0) + 1);
    const parts: PartSummary[] = [];
    for (let L = 0; L < n; L++) {
      const a = area[L] || 1;
      const centroid: [number, number, number] = [cx[L] / a, cy[L] / a, cz[L] / a];
      const at = bestT[L];
      const anchor: [number, number, number] = at >= 0
        ? [f.triCentroid[at * 3], f.triCentroid[at * 3 + 1], f.triCentroid[at * 3 + 2]]
        : centroid;
      parts.push({
        id: L + 1,
        name: this.names[L],
        color: this.colors[L],
        displayColor: display[L],
        triCount: tris[L],
        areaFrac: round4(area[L] / total),
        centroid: round3v(centroid),
        anchor: round3v(anchor),
        bbox: { min: round3v(bmin[L]), max: round3v(bmax[L]) },
        neighbors: [...nbrSets[L]].sort((x, y) => x - y).map((x) => x + 1),
        regions: regions[L],
        locked: this.lockedNames.has(this.names[L]),
        pins: pinCount.get(this.names[L]) ?? 0,
      });
    }

    return {
      detectorId: this.detectorId,
      params: { ...this.params },
      featureOptions: { ...this.featureOptions },
      seeds: this.seeds.map(cloneSeed),
      triCount: f.triCount,
      parts,
      unassigned: { triCount: unTris, areaFrac: round4(unArea / total) },
      quality: {
        partCount: n,
        boundaryCreaseMean: round3(boundaryLength > 0 ? creaseSum / boundaryLength : 0),
        boundaryLength: round3(boundaryLength),
        islandCount,
        islandAreaFrac: round4(islandArea / total),
        unassignedAreaFrac: round4(unArea / total),
        sizeBalance: round3(n > 1 ? entropy / Math.log(n) : 1),
        compactness: round3(n > 0 ? compactSum / n : 0),
        grooveCoverage: round4(strongLen > 0 ? strongOnBoundary / strongLen : 0),
        grooveFidelity: round4(boundaryLength > 0 ? strongOnBoundary / boundaryLength : 0),
      },
      diagnostics: this.diagnostics,
      canUndo: this.undoStack.length > 0,
      focus: this.focusMask ? { triCount: countSet(this.focusMask) } : null,
      edgeSmoothing: this.edgeSmoothing,
    };
  }

  /** RGB (0–255) per source triangle for the overlay. */
  triColors(): Uint8Array {
    const out = new Uint8Array(this.triPart.length * 3);
    const rgb = this.summary().parts.map((p) => hexToRgb(p.displayColor));
    const un = hexToRgb(UNASSIGNED_COLOR);
    for (let t = 0; t < this.triPart.length; t++) {
      const L = this.triPart[t];
      const c = L >= 0 ? rgb[L] : un;
      out[t * 3] = c[0]; out[t * 3 + 1] = c[1]; out[t * 3 + 2] = c[2];
    }
    return out;
  }

  // ------------------------------------------------------------------ edits

  /** Apply a batch of ops atomically (all-or-nothing for validation errors:
   *  the pre-batch state is restored if any op throws). */
  edit(ops: PartEditOp[]): void {
    if (ops.length > 1 && ops.some((o) => o.op === 'undo')) {
      throw new Error('undo must be sent on its own (it reverts the previous batch).');
    }
    const before = this.snapshot();
    try {
      for (const op of ops) this.applyOp(op);
      if (!(ops.length === 1 && ops[0].op === 'undo')) this.syncAnchors();
    } catch (e) {
      this.restore(before);
      throw e;
    }
    if (ops.length && !(ops.length === 1 && ops[0].op === 'undo')) {
      this.undoStack.push(before);
      if (this.undoStack.length > this.undoDepth) this.undoStack.shift();
    }
  }

  private applyOp(op: PartEditOp): void {
    switch (op.op) {
      case 'merge': {
        if (!Array.isArray(op.ids) || op.ids.length < 2) throw new Error('merge needs ids: [a, b, …] (at least two parts)');
        const idx = op.ids.map((r) => this.resolvePart(r));
        const keep = Math.min(...idx);
        const set = new Set(idx);
        const anyLocked = idx.some((i) => this.lockedNames.has(this.names[i]));
        const mergedNames = new Set(idx.map((i) => this.names[i]));
        for (let t = 0; t < this.triPart.length; t++) if (set.has(this.triPart[t])) this.triPart[t] = keep;
        if (this.fixedTri) for (let t = 0; t < this.fixedTri.length; t++) if (set.has(this.fixedTri[t])) this.fixedTri[t] = keep;
        // keep is the lowest merged index, so compaction (which only drops the
        // now-empty merged parts) leaves it in place; name it afterwards so the
        // new name may reuse a merged part's name.
        this.compact();
        if (op.name !== undefined) this.names[keep] = this.uniqueNameFor(keep, op.name);
        if (anyLocked) this.lockedNames.add(this.names[keep]);
        // The merged part owns every merged part's pins.
        for (const sd of this.seeds) if (mergedNames.has(sd.label)) sd.label = this.names[keep];
        this.pruneLocks();
        return;
      }
      case 'rename': {
        const i = this.resolvePart(op.id);
        const nm = cleanName(op.name);
        const holder = this.names.indexOf(nm);
        // Giving a part another part's name merges the two (names are labels:
        // two parts that share one are one part).
        if (holder >= 0 && holder !== i) { this.applyOp({ op: 'merge', ids: [holder + 1, i + 1], name: nm }); return; }
        const was = this.names[i];
        this.names[i] = nm;
        if (this.lockedNames.delete(was)) this.lockedNames.add(nm);
        for (const sd of this.seeds) if (sd.label === was) sd.label = nm;
        const memo = this.colorMemo.get(was);
        if (memo) this.colorMemo.set(nm, memo);
        return;
      }
      case 'setColor': {
        const i = this.resolvePart(op.id);
        if (op.color !== null && !/^#[0-9a-fA-F]{6}$/.test(op.color)) throw new Error('setColor.color must be "#rrggbb" or null');
        this.colors[i] = op.color === null ? null : op.color.toLowerCase();
        return;
      }
      case 'delete': {
        const i = this.resolvePart(op.id);
        for (let t = 0; t < this.triPart.length; t++) if (this.triPart[t] === i) this.triPart[t] = -1;
        this.compact();
        this.pruneLocks();
        return;
      }
      case 'reassign': {
        const target = this.resolveOrCreate(op.to);
        const seedTri = nearestTriangle(this.features, op.point);
        if (seedTri < 0) throw new Error('reassign.point: mesh is empty');
        const f = this.features;
        if (typeof op.radius === 'number') {
          if (!(op.radius > 0)) throw new Error('reassign.radius must be > 0');
          const r2 = op.radius * op.radius;
          const piece = f.pieceOfTri[seedTri];
          for (let t = 0; t < f.triCount; t++) {
            if (f.pieceOfTri[t] !== piece) continue;
            const dx = f.triCentroid[t * 3] - op.point[0], dy = f.triCentroid[t * 3 + 1] - op.point[1], dz = f.triCentroid[t * 3 + 2] - op.point[2];
            if (dx * dx + dy * dy + dz * dz <= r2) { this.triPart[t] = target; this.fix(t, target); }
          }
        } else {
          // Flood the same-label connected region under the point.
          const { compOf } = partitionRegions(this.triPart, this.adjacency);
          const c = compOf[seedTri];
          for (let t = 0; t < f.triCount; t++) if (compOf[t] === c) { this.triPart[t] = target; this.fix(t, target); }
        }
        this.compact();
        return;
      }
      case 'split': {
        const i = this.resolvePart(op.id);
        if (!Array.isArray(op.seeds) || op.seeds.length < 2) throw new Error('split needs at least two seeds ({ label, point })');
        const allow = new Uint8Array(this.triPart.length);
        for (let t = 0; t < allow.length; t++) if (this.triPart[t] === i) allow[t] = 1;
        const { names, seedTris, seedLabels } = resolveSeeds(this.features, op.seeds, allow);
        if (names.length < 2) throw new Error('split needs seeds with at least two distinct labels');
        const g = growFromSeeds(this.features, seedTris, seedLabels, this.growthOptions(allow));
        const map = names.map((nm, k) => (k === 0 ? i : this.createPart(nm)));
        if (names[0] !== this.names[i]) this.names[i] = names[0];
        for (let t = 0; t < allow.length; t++) if (allow[t] && g.triLabel[t] >= 0) this.triPart[t] = map[g.triLabel[t]];
        this.compact();
        // The split's seeds become the new parts' pins.
        const splitNames = new Set(names);
        this.seeds = this.seeds.filter((sd) => !(sd.auto && splitNames.has(sd.label)));
        for (const sd of op.seeds) if (sd.label.trim()) this.seeds.push({ label: sd.label.trim(), point: [sd.point[0], sd.point[1], sd.point[2]] });
        return;
      }
      case 'absorbSmall': {
        if (!(typeof op.minAreaFrac === 'number' && op.minAreaFrac >= 0 && op.minAreaFrac < 1)) throw new Error('absorbSmall.minAreaFrac must be in [0, 1)');
        absorbSmallRegions(this.triPart, this.adjacency, this.features.triArea, op.minAreaFrac * this.features.totalArea);
        this.compact();
        return;
      }
      case 'smoothBoundaries': {
        const it = op.iterations ?? 2;
        if (!Number.isInteger(it) || it < 1 || it > 50) throw new Error('smoothBoundaries.iterations must be an integer 1–50');
        majorityFilter(this.triPart, this.adjacency, it);
        this.compact();
        return;
      }
      case 'addSeed': {
        if (!op.seed || typeof op.seed.label !== 'string' || !Array.isArray(op.seed.point) || op.seed.point.length !== 3) {
          throw new Error('addSeed.seed must be { label, point: [x,y,z] }');
        }
        const sd = cloneSeed(op.seed);
        sd.label = cleanName(sd.label);
        delete sd.auto;
        this.seeds.push(sd);
        if (op.rerun !== false) {
          // A pin for an existing part grows it there; a new name makes a new
          // part. Either way only the parts around the pin re-grow.
          this.createPart(sd.label);
          this.regrowAround([sd.label, this.partNameAt(sd.point)]);
        }
        return;
      }
      case 'removeSeed': {
        if (!Number.isInteger(op.index) || op.index < 0 || op.index >= this.seeds.length) throw new Error(`removeSeed.index must be 0–${this.seeds.length - 1}`);
        const [gone] = this.seeds.splice(op.index, 1);
        if (op.rerun !== false) this.regrowAround([gone.label, this.partNameAt(gone.point)]);
        return;
      }
      case 'moveSeed': {
        if (!Number.isInteger(op.index) || op.index < 0 || op.index >= this.seeds.length) throw new Error(`moveSeed.index must be 0–${this.seeds.length - 1}`);
        if (!Array.isArray(op.point) || op.point.length !== 3 || op.point.some((x) => !Number.isFinite(x))) throw new Error('moveSeed.point must be [x, y, z]');
        const was = this.seeds[op.index];
        // A moved pin is the user's now, even if the draft placed it.
        this.seeds[op.index] = { label: was.label, point: [op.point[0], op.point[1], op.point[2]] };
        if (op.rerun !== false) this.regrowAround([was.label, this.partNameAt(was.point), this.partNameAt(op.point)]);
        return;
      }
      case 'seedsFromParts':
        // Reset every part to automatic pins (one per sizeable region).
        this.seeds = this.seedsFromParts(op.minRegionFrac).map((sd) => ({ ...sd, auto: true }));
        // Seeds only mean something to a seeded detector: switch a seedless
        // draft (auto patches, pieces) to crease-watershed so add/move/remove
        // seed + rerun refine from here.
        if (getDetector(this.detectorId)?.seeds === 'none') {
          const cw = getDetector('crease-watershed')!;
          this.detectorId = cw.id;
          this.params = resolveParams(cw, {});
        }
        return;
      case 'lock': {
        const i = this.resolvePart(op.id);
        if (op.locked === false) this.lockedNames.delete(this.names[i]);
        else this.lockedNames.add(this.names[i]);
        return;
      }
      case 'focus': {
        if (op.id === null) { this.focusMask = null; return; }
        const i = this.resolvePart(op.id);
        const mask = new Uint8Array(this.triPart.length);
        for (let t = 0; t < mask.length; t++) if (this.triPart[t] === i) mask[t] = 1;
        this.focusMask = mask;
        return;
      }
      case 'setEdgeSmoothing':
        if (!Number.isInteger(op.iterations) || op.iterations < 0 || op.iterations > MAX_EDGE_SMOOTHING) {
          throw new Error(`setEdgeSmoothing.iterations must be an integer 0–${MAX_EDGE_SMOOTHING}`);
        }
        this.edgeSmoothing = op.iterations;
        return;
      case 'reorder': {
        const i = this.resolvePart(op.id);
        if (!Number.isInteger(op.position) || op.position < 1 || op.position > this.names.length) throw new Error(`reorder.position must be 1–${this.names.length}`);
        const order = this.names.map((_, k) => k);
        order.splice(i, 1);
        order.splice(op.position - 1, 0, i);
        this.permute(order);
        return;
      }
      case 'clear':
        this.triPart.fill(-1);
        this.names = [];
        this.colors = [];
        this.seeds = [];
        this.fixedTri = null;
        this.lockedNames.clear();
        this.focusMask = null;
        return;
      case 'rerun':
        this.rerun();
        return;
      case 'undo': {
        const prev = this.undoStack.pop();
        if (!prev) throw new Error('Nothing to undo');
        this.restore(prev);
        return;
      }
      default:
        throw new Error(`Unknown edit op "${(op as { op: string }).op}"`);
    }
  }

  /** Re-run the draft's detector with its current seeds/params. Locked
   *  parts (and everything outside a focused area) keep their triangles;
   *  part colours carry over by name. */
  rerun(): void {
    this.applyDetection(this.detectorId, this.params, this.featureOptions, this.seeds, this.features);
  }

  /** Triangles a detection may relabel, or null when it may relabel all
   *  (no locks, no focus). */
  detectionMask(): Uint8Array | null {
    if (!this.focusMask && this.lockedNames.size === 0) return null;
    const allow = this.focusMask ? this.focusMask.slice() : new Uint8Array(this.triPart.length).fill(1);
    if (this.lockedNames.size) {
      const lockedIdx = new Set<number>();
      this.names.forEach((nm, i) => { if (this.lockedNames.has(nm)) lockedIdx.add(i); });
      for (let t = 0; t < allow.length; t++) if (lockedIdx.has(this.triPart[t])) allow[t] = 0;
    }
    return allow;
  }

  /**
   * Run a detector and merge its result into this draft: triangles outside
   * the detection mask keep their part; inside it, the detector's parts
   * replace them — a detected name that matches an existing part joins that
   * part (so a focused re-detection can grow "skin" into the existing skin).
   * Without locks or focus this simply replaces the partition. Colours carry
   * over by name either way.
   */
  /** Re-detect into this draft as an undoable step (the runner's path for
   *  every detection after the first, so a preset flip can be undone). */
  detectUndoable(
    detectorId: string, params: ParamValues, featureOptions: FeatureOptions, seeds: SegSeed[], features: MeshFeatures,
    run?: Pick<DetectorContext, 'signal' | 'progress'>,
  ): void {
    const before = this.snapshot();
    this.applyDetection(detectorId, params, featureOptions, seeds, features, run);
    this.undoStack.push(before);
    if (this.undoStack.length > this.undoDepth) this.undoStack.shift();
  }

  applyDetection(
    detectorId: string, params: ParamValues, featureOptions: FeatureOptions, seeds: SegSeed[], features: MeshFeatures,
    run?: Pick<DetectorContext, 'signal' | 'progress'>,
  ): void {
    const d = getDetector(detectorId);
    if (!d) throw new Error(`Unknown detector "${detectorId}"`);
    const allow = this.detectionMask();
    const result = d.run(this.mesh, features, { params, seeds, allow: allow ?? undefined, cache: this.cache, signal: run?.signal, progress: run?.progress });
    const keepColors = new Map(this.names.map((nm, i) => [nm, this.colors[i]] as const));
    if (!allow) {
      this.adoptResult(result);
    } else {
      const index = new Map(this.names.map((nm, i) => [nm, i] as const));
      const map = (result.partNames ?? []).map((raw, i) => {
        let nm = (raw ?? `part ${i + 1}`).trim() || `part ${i + 1}`;
        if (result.genericNames && index.has(nm)) {
          // Placeholder names never join an existing part: take the next
          // free number with the same prefix ("patch 3" → "patch 12").
          const prefix = nm.replace(/\s*\d+$/, '') || 'part';
          let k = 1;
          while (index.has(`${prefix} ${k}`)) k++;
          nm = `${prefix} ${k}`;
        }
        let j = index.get(nm);
        if (j === undefined) { j = this.names.length; this.names.push(nm); this.colors.push(null); index.set(nm, j); }
        return j;
      });
      for (let t = 0; t < this.triPart.length; t++) {
        if (!allow[t]) continue;
        const r = result.triPart[t];
        this.triPart[t] = r >= 0 ? (map[r] ?? -1) : -1;
      }
      this.diagnostics = result.diagnostics;
      this.compact();
    }
    this.colors = this.names.map((nm, i) => keepColors.get(nm) ?? this.colors[i] ?? null);
    this.detectorId = d.id;
    this.params = { ...params };
    this.featureOptions = { ...featureOptions };
    // Pins: a seeded detector's seeds are the detected parts' pins; outside a
    // detection mask the existing pins stay. syncAnchors drops pins whose
    // part vanished and gives anchorless parts automatic ones.
    const used = d.seeds === 'none' ? [] : seeds.map(cloneSeed);
    const kept = allow ? this.seeds.filter((sd) => { const t = this.pinTriangle(sd); return t >= 0 && !allow[t]; }) : [];
    this.seeds = [...kept, ...used];
    this.features = features;
    // A full re-detection replaces hand fixes too; a masked one keeps those
    // outside the mask.
    if (this.fixedTri) {
      if (!allow) this.fixedTri = null;
      else for (let t = 0; t < this.fixedTri.length; t++) if (allow[t]) this.fixedTri[t] = -1;
    }
    this.pruneLocks();
    this.syncAnchors();
  }

  /**
   * One seed per sizeable region of every part, placed on the region's
   * deepest triangle (farthest from its border) — turns auto patches or any
   * edited partition into seeds the seeded detector can refine.
   */
  /** One seed per region of each part (regions under `minRegionFrac` of
   *  their part are skipped — they follow the part's main seed). */
  seedsFromParts(minRegionFrac = 0.01): SegSeed[] {
    const n = this.triPart.length, adj = this.adjacency, part = this.triPart;
    const dist = new Int32Array(n).fill(-1);
    const queue = new Int32Array(n);
    let head = 0, tail = 0;
    for (let t = 0; t < n; t++) {
      if (part[t] < 0) continue;
      const deg = adj.start[t + 1] - adj.start[t];
      let border = deg < 3; // open mesh edge
      for (let j = adj.start[t]; j < adj.start[t + 1] && !border; j++) if (part[adj.nbr[j]] !== part[t]) border = true;
      if (border) { dist[t] = 0; queue[tail++] = t; }
    }
    while (head < tail) {
      const t = queue[head++];
      for (let j = adj.start[t]; j < adj.start[t + 1]; j++) {
        const o = adj.nbr[j];
        if (dist[o] === -1 && part[o] === part[t]) { dist[o] = dist[t] + 1; queue[tail++] = o; }
      }
    }
    const { compOf, count } = partitionRegions(part, adj);
    const regionArea = new Float64Array(count);
    const regionBest = new Int32Array(count).fill(-1);
    const partArea = new Float64Array(this.names.length);
    for (let t = 0; t < n; t++) {
      if (part[t] < 0) continue;
      const c = compOf[t];
      regionArea[c] += this.features.triArea[t];
      partArea[part[t]] += this.features.triArea[t];
      // A region with no border at all (a whole closed piece) has dist −1:
      // any triangle of it will do.
      if (regionBest[c] < 0 || dist[t] > dist[regionBest[c]]) regionBest[c] = t;
    }
    const seeds: SegSeed[] = [];
    for (let c = 0; c < count; c++) {
      const t = regionBest[c];
      if (t < 0) continue;
      const L = part[t];
      // Skip specks (they follow the part's main seed).
      if (regionArea[c] < minRegionFrac * partArea[L]) continue;
      const cen = this.features.triCentroid;
      seeds.push({ label: this.names[L], point: [cen[t * 3], cen[t * 3 + 1], cen[t * 3 + 2]], triangle: t });
    }
    return seeds;
  }

  // ------------------------------------------------------------------ pins

  /** Triangle a pin sits on (its resolved triangle, else the nearest). */
  private pinTriangle(sd: SegSeed): number {
    if (typeof sd.triangle === 'number' && sd.triangle >= 0 && sd.triangle < this.triPart.length) return sd.triangle;
    return nearestTriangle(this.features, sd.point);
  }

  private partNameAt(point: [number, number, number]): string | null {
    const t = nearestTriangle(this.features, point);
    const L = t >= 0 ? this.triPart[t] : -1;
    return L >= 0 ? this.names[L] : null;
  }

  /** Keep the "every part owns ≥ 1 pin" invariant: drop pins of vanished
   *  parts and automatic pins their part no longer covers, then give each
   *  anchorless part automatic pins (one per sizeable region). */
  private syncAnchors(): void {
    const index = new Map(this.names.map((nm, i) => [nm, i] as const));
    this.seeds = this.seeds.filter((sd) => {
      const L = index.get(sd.label);
      if (L === undefined) return false;
      if (!sd.auto) return true;
      const t = this.pinTriangle(sd);
      return t >= 0 && this.triPart[t] === L;
    });
    const anchored = new Set(this.seeds.map((sd) => sd.label));
    if (this.names.every((nm) => anchored.has(nm))) return;
    for (const sd of this.seedsFromParts(this.anchorMinRegionFrac)) {
      if (!anchored.has(sd.label)) this.seeds.push({ ...sd, auto: true });
    }
  }

  /**
   * Re-grow the named parts and their neighbours from their pins, leaving
   * the rest of the model alone. Locked parts and fixed (hand-fixed)
   * triangles are kept out; triangles no pin reaches keep their part.
   */
  private regrowAround(names: Iterable<string | null>): void {
    const core = new Set<number>();
    for (const nm of names) {
      if (nm === null) continue;
      const i = this.names.indexOf(nm);
      if (i >= 0 && !this.lockedNames.has(nm)) core.add(i);
    }
    if (core.size === 0) return;
    const f = this.features;
    const area = new Set(core);
    for (let e = 0; e < f.edgeA.length; e++) {
      const a = this.triPart[f.edgeA[e]], b = this.triPart[f.edgeB[e]];
      if (a === b) continue;
      if (core.has(a) && b >= 0 && !this.lockedNames.has(this.names[b])) area.add(b);
      if (core.has(b) && a >= 0 && !this.lockedNames.has(this.names[a])) area.add(a);
    }
    const allow = new Uint8Array(this.triPart.length);
    // Brand-new parts (a pin with a new name) have no triangles yet: their
    // pins decide which region they compete for.
    const newParts = [...core].filter((i) => !this.triPart.includes(i));
    // Fixed (hand-fixed) triangles stay as they are: out of the re-grow.
    for (let t = 0; t < allow.length; t++) if (area.has(this.triPart[t]) && !(this.fixedTri && this.fixedTri[t] >= 0)) allow[t] = 1;
    const seedTris: number[] = [], seedLabels: number[] = [];
    const taken = new Set<number>();
    // Placed pins first: where a placed pin and an automatic pin land on the
    // same triangle, the placed one wins (an auto pin is only a stand-in).
    const ordered = [...this.seeds.filter((sd) => !sd.auto), ...this.seeds.filter((sd) => sd.auto)];
    for (const sd of ordered) {
      const L = this.names.indexOf(sd.label);
      if (L < 0 || (!area.has(L) && !newParts.includes(L))) continue;
      const t = this.pinTriangle(sd);
      if (t < 0 || !allow[t] || taken.has(t)) continue;
      taken.add(t);
      seedTris.push(t); seedLabels.push(L);
    }
    if (seedTris.length === 0) return;
    const g = growFromSeeds(f, seedTris, seedLabels, this.growthOptions(allow));
    for (let t = 0; t < allow.length; t++) if (allow[t] && g.triLabel[t] >= 0) this.triPart[t] = g.triLabel[t];
    this.compact();
  }

  private fix(t: number, part: number): void {
    if (!this.fixedTri) this.fixedTri = new Int32Array(this.triPart.length).fill(-1);
    this.fixedTri[t] = part;
  }

  /** Reorder parts: `order[k]` is the old index of the part now at k. */
  private permute(order: number[]): void {
    const inv = new Int32Array(order.length);
    order.forEach((old, k) => { inv[old] = k; });
    this.names = order.map((k) => this.names[k]);
    this.colors = order.map((k) => this.colors[k]);
    for (let t = 0; t < this.triPart.length; t++) if (this.triPart[t] >= 0) this.triPart[t] = inv[this.triPart[t]];
    if (this.fixedTri) for (let t = 0; t < this.fixedTri.length; t++) if (this.fixedTri[t] >= 0) this.fixedTri[t] = inv[this.fixedTri[t]];
  }

  /**
   * Overlay colour per part: an explicit colour wins; otherwise the part
   * keeps the colour it had (remembered by name) unless a neighbour now has
   * a near-identical one, and new parts get the candidate farthest from
   * their neighbours' colours — so adjacent parts never look alike, even
   * with dozens of parts.
   */
  private displayColors(neighbors: Set<number>[]): string[] {
    const out: string[] = new Array(this.names.length);
    const rgbOf = (hex: string) => hexToRgb(hex);
    const order = this.names.map((_, i) => i);
    // Explicit and remembered colours first, so new parts fit around them.
    order.sort((a, b) => Number(!(this.colors[a] ?? this.colorMemo.get(this.names[a]))) - Number(!(this.colors[b] ?? this.colorMemo.get(this.names[b]))));
    const useCount = new Map<string, number>();
    for (const i of order) {
      const nbrCols = [...neighbors[i]].map((j) => out[j]).filter((c): c is string => !!c).map(rgbOf);
      const explicit = this.colors[i];
      if (explicit) { out[i] = explicit; continue; }
      const memo = this.colorMemo.get(this.names[i]);
      if (memo && nbrCols.every((c) => colorDistance(c, rgbOf(memo)) >= MIN_NEIGHBOR_COLOR_DISTANCE)) {
        out[i] = memo;
      } else {
        let best = PALETTE[0], bestScore = -Infinity;
        for (const cand of PALETTE) {
          const c = rgbOf(cand);
          const nearest = nbrCols.length ? Math.min(...nbrCols.map((n) => colorDistance(c, n))) : 1000;
          const score = Math.min(nearest, 300) - 25 * (useCount.get(cand) ?? 0);
          if (score > bestScore) { bestScore = score; best = cand; }
        }
        out[i] = best;
        this.colorMemo.set(this.names[i], best);
      }
      useCount.set(out[i], (useCount.get(out[i]) ?? 0) + 1);
    }
    return out;
  }

  /** Forget locks on names that no longer exist. */
  private pruneLocks(): void {
    for (const nm of [...this.lockedNames]) if (!this.names.includes(nm)) this.lockedNames.delete(nm);
  }

  private growthOptions(allow?: Uint8Array) {
    // Split re-uses the draft's crease-watershed params when it has them.
    const p = this.detectorId === 'crease-watershed'
      ? this.params
      : resolveParams(getDetector('crease-watershed')!, {});
    return {
      growth: p.growth as GrowthRule,
      creaseQuantumDeg: Number(p.creaseQuantumDeg),
      creaseWeight: Number(p.creaseWeight),
      allow,
    };
  }

  // -------------------------------------------------------------- helpers

  private resolvePart(ref: PartRef): number {
    if (typeof ref === 'number') {
      if (Number.isInteger(ref) && ref >= 1 && ref <= this.names.length) return ref - 1;
      throw new Error(`No part with id ${ref} (ids are 1–${this.names.length})`);
    }
    if (typeof ref === 'string') {
      const i = this.names.indexOf(ref);
      if (i >= 0) return i;
      throw new Error(`No part named "${ref}". Parts: ${this.names.join(', ')}`);
    }
    throw new Error('Part reference must be a 1-based id or a part name');
  }

  /** Validate a new name for part `i`: part names are labels, so they must
   *  stay unique — two parts that should share a name are one part (merge). */
  private uniqueNameFor(i: number, name: unknown): string {
    const nm = cleanName(name);
    const holder = this.names.indexOf(nm);
    if (holder >= 0 && holder !== i) {
      throw new Error(`Another part (id ${holder + 1}) is already named "${nm}" — names must be unique; merge the two parts instead.`);
    }
    return nm;
  }

  private resolveOrCreate(ref: PartRef): number {
    if (typeof ref === 'string' && !this.names.includes(ref)) return this.createPart(ref);
    return this.resolvePart(ref);
  }

  private createPart(name: string): number {
    const nm = cleanName(name);
    const existing = this.names.indexOf(nm);
    if (existing >= 0) return existing;
    this.names.push(nm);
    this.colors.push(null);
    return this.names.length - 1;
  }

  /** Drop empty parts and renumber densely (order preserved). */
  private compact(): void {
    const used = new Uint8Array(this.names.length);
    for (let t = 0; t < this.triPart.length; t++) if (this.triPart[t] >= 0) used[this.triPart[t]] = 1;
    const remap = new Int32Array(this.names.length).fill(-1);
    const names: string[] = [];
    const colors: (string | null)[] = [];
    for (let i = 0; i < this.names.length; i++) {
      if (!used[i]) continue;
      remap[i] = names.length;
      names.push(this.names[i]);
      colors.push(this.colors[i]);
    }
    if (names.length !== this.names.length) {
      for (let t = 0; t < this.triPart.length; t++) if (this.triPart[t] >= 0) this.triPart[t] = remap[this.triPart[t]];
      if (this.fixedTri) for (let t = 0; t < this.fixedTri.length; t++) if (this.fixedTri[t] >= 0) this.fixedTri[t] = remap[this.fixedTri[t]];
    }
    // Disambiguate duplicate names (e.g. two detector outputs with one
    // label) so name-refs and labels stay unique: later duplicates get the
    // first free "name N" suffix.
    const taken = new Set<string>();
    for (let i = 0; i < names.length; i++) {
      if (!taken.has(names[i])) { taken.add(names[i]); continue; }
      let k = 2;
      while (taken.has(`${names[i]} ${k}`) || names.includes(`${names[i]} ${k}`)) k++;
      names[i] = `${names[i]} ${k}`;
      taken.add(names[i]);
    }
    this.names = names;
    this.colors = colors;
  }

  private snapshot(): Snapshot {
    return {
      triPart: this.triPart.slice(), names: [...this.names], colors: [...this.colors], seeds: this.seeds.map(cloneSeed),
      diagnostics: this.diagnostics, locked: [...this.lockedNames], focusMask: this.focusMask ? this.focusMask.slice() : null,
      detectorId: this.detectorId, params: { ...this.params }, featureOptions: { ...this.featureOptions }, edgeSmoothing: this.edgeSmoothing,
      features: this.features,
      fixedTri: this.fixedTri ? this.fixedTri.slice() : null,
    };
  }

  private restore(s: Snapshot): void {
    this.triPart = s.triPart; this.names = s.names; this.colors = s.colors; this.seeds = s.seeds; this.diagnostics = s.diagnostics;
    this.lockedNames = new Set(s.locked); this.focusMask = s.focusMask;
    this.detectorId = s.detectorId; this.params = s.params; this.featureOptions = s.featureOptions; this.edgeSmoothing = s.edgeSmoothing; this.features = s.features; this.fixedTri = s.fixedTri;
  }
}

function countSet(mask: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) n += mask[i];
  return n;
}

function cloneSeed(s: SegSeed): SegSeed {
  const out: SegSeed = { label: s.label, point: [s.point[0], s.point[1], s.point[2]] };
  if (typeof s.triangle === 'number') out.triangle = s.triangle;
  if (s.auto) out.auto = true;
  return out;
}

function cleanName(name: unknown): string {
  if (typeof name !== 'string' || !name.trim()) throw new Error('Part name must be a non-empty string');
  return name.trim().slice(0, 64);
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;
const round4 = (x: number) => Math.round(x * 10000) / 10000;
const round3v = (v: readonly number[]): [number, number, number] => [round3(v[0]), round3(v[1]), round3(v[2])];
