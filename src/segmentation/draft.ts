// PartDraft — the editable, scored result of a detection run.
//
// Owned by the foundation (not by detectors) so every algorithm's output is
// summarized, scored, edited and undone the same way. Detection never
// mutates the session; a draft only becomes persistent on acceptParts.
//
// Public part ids are 1-based (the numbers drawn on the overlay legend), so
// a user or AI can say "part 4". Internally triPart holds 0-based indices
// (-1 = unassigned).

import {
  absorbSmallRegions, adjacencyFromPairs, majorityFilter, partitionRegions, type TriAdjacency,
} from '../geometry/triSetOps';
import { resolveSeeds } from './detectors';
import { nearestTriangle } from './features';
import { growFromSeeds, type GrowthRule } from './growth';
import { getDetector, resolveParams } from './registry';
import type { DetectorResult, FeatureOptions, MeshFeatures, ParamValues, SegMesh, SegSeed } from './types';

/** Distinct overlay colours for parts without an explicit colour. */
const PALETTE = [
  '#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#46f0f0', '#f032e6',
  '#bcf60c', '#fabebe', '#008080', '#e6beff', '#9a6324', '#fffac8', '#800000', '#aaffc3',
  '#808000', '#ffd8b1', '#000075', '#808080',
];
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
  | { op: 'rerun' }
  | { op: 'undo' };

interface Snapshot {
  triPart: Int32Array;
  names: string[];
  colors: (string | null)[];
  seeds: SegSeed[];
  diagnostics?: Record<string, unknown>;
}


export class PartDraftModel {
  readonly mesh: SegMesh;
  readonly features: MeshFeatures;
  readonly adjacency: TriAdjacency;
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
    this.seeds = run.seeds.map(cloneSeed);
    this.diagnostics = result.diagnostics;
    this.triPart = result.triPart;
    this.names = [];
    this.colors = [];
    this.adoptResult(result);
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
    let boundaryLength = 0, creaseSum = 0;
    for (let e = 0; e < f.edgeA.length; e++) {
      const la = this.triPart[f.edgeA[e]], lb = this.triPart[f.edgeB[e]];
      if (la === lb || la < 0 || lb < 0) continue;
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

    const parts: PartSummary[] = [];
    for (let L = 0; L < n; L++) {
      const a = area[L] || 1;
      const centroid: [number, number, number] = [cx[L] / a, cy[L] / a, cz[L] / a];
      const at = nearestTriangle(f, centroid, (t) => this.triPart[t] === L);
      const anchor: [number, number, number] = at >= 0
        ? [f.triCentroid[at * 3], f.triCentroid[at * 3 + 1], f.triCentroid[at * 3 + 2]]
        : centroid;
      parts.push({
        id: L + 1,
        name: this.names[L],
        color: this.colors[L],
        displayColor: overlayColor(L, this.colors[L]),
        triCount: tris[L],
        areaFrac: round4(area[L] / total),
        centroid: round3v(centroid),
        anchor: round3v(anchor),
        bbox: { min: round3v(bmin[L]), max: round3v(bmax[L]) },
        neighbors: [...nbrSets[L]].sort((x, y) => x - y).map((x) => x + 1),
        regions: regions[L],
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
      },
      diagnostics: this.diagnostics,
      canUndo: this.undoStack.length > 0,
    };
  }

  /** RGB (0–255) per source triangle for the overlay. */
  triColors(): Uint8Array {
    const out = new Uint8Array(this.triPart.length * 3);
    const rgb = this.names.map((_, i) => hexToRgb(overlayColor(i, this.colors[i])));
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
        for (let t = 0; t < this.triPart.length; t++) if (set.has(this.triPart[t])) this.triPart[t] = keep;
        // keep is the lowest merged index, so compaction (which only drops the
        // now-empty merged parts) leaves it in place; name it afterwards so the
        // new name may reuse a merged part's name.
        this.compact();
        if (op.name !== undefined) this.names[keep] = this.uniqueNameFor(keep, op.name);
        return;
      }
      case 'rename': {
        const i = this.resolvePart(op.id);
        this.names[i] = this.uniqueNameFor(i, op.name);
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
            if (dx * dx + dy * dy + dz * dz <= r2) this.triPart[t] = target;
          }
        } else {
          // Flood the same-label connected region under the point.
          const { compOf } = partitionRegions(this.triPart, this.adjacency);
          const c = compOf[seedTri];
          for (let t = 0; t < f.triCount; t++) if (compOf[t] === c) this.triPart[t] = target;
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
      case 'addSeed':
        if (!op.seed || typeof op.seed.label !== 'string' || !Array.isArray(op.seed.point) || op.seed.point.length !== 3) {
          throw new Error('addSeed.seed must be { label, point: [x,y,z] }');
        }
        this.seeds.push(cloneSeed(op.seed));
        if (op.rerun !== false) this.rerun();
        return;
      case 'removeSeed':
        if (!Number.isInteger(op.index) || op.index < 0 || op.index >= this.seeds.length) throw new Error(`removeSeed.index must be 0–${this.seeds.length - 1}`);
        this.seeds.splice(op.index, 1);
        if (op.rerun !== false) this.rerun();
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

  /** Re-run the draft's detector with its current seeds/params (manual
   *  edits since the last run are replaced; part colours carry over by name). */
  rerun(): void {
    const d = getDetector(this.detectorId);
    if (!d) throw new Error(`Unknown detector "${this.detectorId}"`);
    const keepColors = new Map(this.names.map((nm, i) => [nm, this.colors[i]] as const));
    const result = d.run(this.mesh, this.features, { params: this.params, seeds: this.seeds });
    this.adoptResult(result);
    this.colors = this.names.map((nm) => keepColors.get(nm) ?? null);
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
    return { triPart: this.triPart.slice(), names: [...this.names], colors: [...this.colors], seeds: this.seeds.map(cloneSeed), diagnostics: this.diagnostics };
  }

  private restore(s: Snapshot): void {
    this.triPart = s.triPart; this.names = s.names; this.colors = s.colors; this.seeds = s.seeds; this.diagnostics = s.diagnostics;
  }
}

function cloneSeed(s: SegSeed): SegSeed {
  const out: SegSeed = { label: s.label, point: [s.point[0], s.point[1], s.point[2]] };
  if (typeof s.triangle === 'number') out.triangle = s.triangle;
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
