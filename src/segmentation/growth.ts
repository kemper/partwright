// Seeded multi-label growth over the triangle-adjacency graph — the kernel of
// the `crease-watershed` detector and of the draft's `split` edit.
//
// Every triangle is claimed by the seed with the cheapest path to it, where
// the path cost is a lexicographic pair (primary, secondary):
//
//   'minimax' — primary = the strongest concave crease crossed on the path;
//               secondary = summed cost (tie-break only).
//   'summed'  — primary = summed cost (path length + creaseWeight × crease
//               degrees); no secondary.
//   'hybrid'  — primary = the strongest crossed crease *quantized* to
//               `creaseQuantumDeg` buckets; secondary = summed cost.
//
// Minimax keeps a seed that sits inside a closed groove contained (it can
// only escape by crossing the groove), but on flat stretches every path ties
// and the split is arbitrary. Summed cost splits flat stretches naturally but
// lets a small enclosed seed leak once it has paid the groove toll. Hybrid
// gives minimax the decision wherever a real crease separates the seeds and
// lets summed cost decide everything else — the quantization is what makes
// the tie-break actually fire (with continuous maxima, exact ties never
// happen). Review log: GitHub issue #1025 §4.2.

import type { MeshFeatures, VertexCostField } from './types';

export type GrowthRule = 'minimax' | 'summed' | 'hybrid';

export interface GrowthOptions {
  growth: GrowthRule;
  /** Bucket width for hybrid's quantized crease maximum. */
  creaseQuantumDeg: number;
  /** Summed-cost weight of one crease degree, in median-edge-lengths. */
  creaseWeight: number;
  /** Only triangles with allow[t] = 1 may be claimed (undefined = all). */
  allow?: Uint8Array;
  signal?: AbortSignal;
  progress?: (frac: number, msg?: string) => void;
}

export interface GrowthResult {
  /** Seed label per triangle, -1 where no seed could reach. */
  triLabel: Int32Array;
  /** Summed path cost per claimed triangle (Infinity when unclaimed). */
  cost: Float64Array;
}

export class AbortedError extends Error {
  constructor() { super('Part detection cancelled'); this.name = 'AbortedError'; }
}

/** Binary min-heap over (k1, k2) with an int payload pair. */
class PairHeap {
  private k1: Float64Array;
  private k2: Float64Array;
  private tri: Int32Array;
  private lab: Int32Array;
  size = 0;
  constructor(cap: number) {
    this.k1 = new Float64Array(cap); this.k2 = new Float64Array(cap);
    this.tri = new Int32Array(cap); this.lab = new Int32Array(cap);
  }
  private less(i: number, j: number): boolean {
    return this.k1[i] < this.k1[j] || (this.k1[i] === this.k1[j] && this.k2[i] < this.k2[j]);
  }
  private swap(i: number, j: number): void {
    let t = this.k1[i]; this.k1[i] = this.k1[j]; this.k1[j] = t;
    t = this.k2[i]; this.k2[i] = this.k2[j]; this.k2[j] = t;
    let u = this.tri[i]; this.tri[i] = this.tri[j]; this.tri[j] = u;
    u = this.lab[i]; this.lab[i] = this.lab[j]; this.lab[j] = u;
  }
  push(k1: number, k2: number, tri: number, lab: number): void {
    if (this.size === this.k1.length) {
      const cap = this.k1.length * 2;
      const grow = <T extends Float64Array | Int32Array>(a: T, C: new (n: number) => T): T => { const b = new C(cap); b.set(a); return b; };
      this.k1 = grow(this.k1, Float64Array); this.k2 = grow(this.k2, Float64Array);
      this.tri = grow(this.tri, Int32Array); this.lab = grow(this.lab, Int32Array);
    }
    let i = this.size++;
    this.k1[i] = k1; this.k2[i] = k2; this.tri[i] = tri; this.lab[i] = lab;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p); i = p;
    }
  }
  /** Pops the minimum into `out` = [k1, k2, tri, lab]. */
  pop(out: Float64Array): void {
    out[0] = this.k1[0]; out[1] = this.k2[0]; out[2] = this.tri[0]; out[3] = this.lab[0];
    const last = --this.size;
    if (last > 0) {
      this.k1[0] = this.k1[last]; this.k2[0] = this.k2[last];
      this.tri[0] = this.tri[last]; this.lab[0] = this.lab[last];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < last && this.less(l, m)) m = l;
        if (r < last && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m); i = m;
      }
    }
  }
}

/**
 * Grow labelled seeds across the mesh. `seedTris[i]` gets label
 * `seedLabels[i]`; several seeds may share a label.
 */
export function growFromSeeds(
  f: MeshFeatures,
  seedTris: ArrayLike<number>,
  seedLabels: ArrayLike<number>,
  opts: GrowthOptions,
): GrowthResult {
  const n = f.triCount;
  const triLabel = new Int32Array(n).fill(-1);
  const best1 = new Float64Array(n).fill(Infinity);
  const best2 = new Float64Array(n).fill(Infinity);
  const cost = new Float64Array(n).fill(Infinity);
  const heap = new PairHeap(Math.max(16, seedTris.length * 4));
  const q = opts.growth === 'hybrid' ? Math.max(1e-6, opts.creaseQuantumDeg) : 1;
  const w = Math.max(0, opts.creaseWeight) * (f.medianEdgeLen || 1);
  const allow = opts.allow;

  for (let i = 0; i < seedTris.length; i++) {
    const t = seedTris[i];
    if (t < 0 || t >= n || (allow && !allow[t])) continue;
    if (best1[t] === 0 && best2[t] === 0) continue; // first seed on a tri wins
    best1[t] = 0; best2[t] = 0;
    heap.push(0, 0, t, seedLabels[i]);
  }

  const out = new Float64Array(4);
  let done = 0;
  const reportEvery = Math.max(4096, n >> 6);
  while (heap.size > 0) {
    heap.pop(out);
    const k1 = out[0], k2 = out[1], t = out[2], lab = out[3];
    if (triLabel[t] !== -1) continue;
    if (k1 !== best1[t] || k2 !== best2[t]) continue; // stale entry
    triLabel[t] = lab;
    // The summed component lives in k1 for 'summed', k2 otherwise.
    const summed = opts.growth === 'summed' ? k1 : k2;
    cost[t] = summed;
    if (++done % reportEvery === 0) {
      if (opts.signal?.aborted) throw new AbortedError();
      opts.progress?.(done / n);
    }
    for (let j = f.adjStart[t]; j < f.adjStart[t + 1]; j++) {
      const e = f.adjPair[j];
      const o = f.edgeA[e] === t ? f.edgeB[e] : f.edgeA[e];
      if (triLabel[o] !== -1 || (allow && !allow[o])) continue;
      const crease = f.creaseCost[e];
      const step = f.centroidDist[e] + w * crease;
      let n1: number, n2: number;
      if (opts.growth === 'summed') { n1 = summed + step; n2 = 0; }
      else if (opts.growth === 'minimax') { n1 = Math.max(k1, crease); n2 = summed + step; }
      else { n1 = Math.max(k1, Math.floor(crease / q)); n2 = summed + step; }
      if (n1 < best1[o] || (n1 === best1[o] && n2 < best2[o])) {
        best1[o] = n1; best2[o] = n2;
        heap.push(n1, n2, o, lab);
      }
    }
  }
  if (opts.signal?.aborted) throw new AbortedError();
  return { triLabel, cost };
}

/**
 * Per-vertex best-two (label, cost) from the triangles incident to each
 * vertex. Because it is read off the final labelling, a vertex only carries a
 * second label where two parts actually meet — so a paint-time clip along
 * `cost(P) − cost(other)` can never stray from the triangle-level boundary.
 */
export function vertexCostField(
  triVerts: Uint32Array,
  nVert: number,
  triLabel: Int32Array,
  cost: Float64Array,
): VertexCostField {
  const label1 = new Int32Array(nVert).fill(-1);
  const label2 = new Int32Array(nVert).fill(-1);
  const cost1 = new Float32Array(nVert).fill(Infinity);
  const cost2 = new Float32Array(nVert).fill(Infinity);
  for (let t = 0; t < triLabel.length; t++) {
    const L = triLabel[t];
    if (L < 0) continue;
    const c = cost[t];
    for (let k = 0; k < 3; k++) {
      const v = triVerts[t * 3 + k];
      if (label1[v] === L) { if (c < cost1[v]) cost1[v] = c; continue; }
      if (label2[v] === L) {
        if (c < cost2[v]) cost2[v] = c;
      } else if (c < cost1[v] || label1[v] === -1) {
        label2[v] = label1[v]; cost2[v] = cost1[v];
        label1[v] = L; cost1[v] = c;
        continue;
      } else if (c < cost2[v] || label2[v] === -1) {
        label2[v] = L; cost2[v] = c;
      }
      if (label2[v] !== -1 && cost2[v] < cost1[v]) {
        const tl = label1[v]; label1[v] = label2[v]; label2[v] = tl;
        const tc = cost1[v]; cost1[v] = cost2[v]; cost2[v] = tc;
      }
    }
  }
  return { label1, cost1, label2, cost2 };
}
