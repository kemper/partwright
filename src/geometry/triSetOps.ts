// Triangle-set operations over an abstract triangle adjacency graph.
//
// Shared by part detection (draft clean-up: absorb islands, smooth
// boundaries — #1025) and paint-region clean-up (grow / shrink / despeckle /
// union / subtract — #1023), so both features use one implementation.
// Pure + Worker-safe. Masks are Uint8Array (1 = in the set); partitions are
// Int32Array of labels per triangle, where -1 means "unassigned".

/** CSR adjacency: neighbours of triangle t are nbr[start[t] .. start[t+1]). */
export interface TriAdjacency {
  start: Int32Array;
  nbr: Int32Array;
}

/** Adapt per-triangle neighbour lists to CSR. */
export function adjacencyFromNeighborLists(neighbors: ArrayLike<ArrayLike<number>>): TriAdjacency {
  const n = neighbors.length;
  const start = new Int32Array(n + 1);
  for (let t = 0; t < n; t++) start[t + 1] = start[t] + neighbors[t].length;
  const nbr = new Int32Array(start[n]);
  for (let t = 0; t < n; t++) {
    const list = neighbors[t];
    for (let j = 0; j < list.length; j++) nbr[start[t] + j] = list[j];
  }
  return { start, nbr };
}

/** Adapt edge pairs (a[e] — b[e]) to CSR. */
export function adjacencyFromPairs(triCount: number, a: ArrayLike<number>, b: ArrayLike<number>): TriAdjacency {
  const start = new Int32Array(triCount + 1);
  for (let e = 0; e < a.length; e++) { start[a[e] + 1]++; start[b[e] + 1]++; }
  for (let t = 0; t < triCount; t++) start[t + 1] += start[t];
  const nbr = new Int32Array(start[triCount]);
  const fill = start.slice(0, triCount);
  for (let e = 0; e < a.length; e++) { nbr[fill[a[e]]++] = b[e]; nbr[fill[b[e]]++] = a[e]; }
  return { start, nbr };
}

export function maskFromIndices(triCount: number, indices: Iterable<number>): Uint8Array {
  const m = new Uint8Array(triCount);
  for (const t of indices) if (t >= 0 && t < triCount) m[t] = 1;
  return m;
}

export function maskToIndices(mask: Uint8Array): number[] {
  const out: number[] = [];
  for (let t = 0; t < mask.length; t++) if (mask[t]) out.push(t);
  return out;
}

export function unionMask(a: Uint8Array, b: Uint8Array): Uint8Array {
  const o = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) o[i] = a[i] | b[i];
  return o;
}

export function subtractMask(a: Uint8Array, b: Uint8Array): Uint8Array {
  const o = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) o[i] = a[i] & (b[i] ^ 1);
  return o;
}

export function intersectMask(a: Uint8Array, b: Uint8Array): Uint8Array {
  const o = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) o[i] = a[i] & b[i];
  return o;
}

/** Dilate by `steps` rings of neighbours. `allow` (optional) vetoes
 *  individual triangles, so a grow can't leak past a clamp. */
export function growMask(mask: Uint8Array, adj: TriAdjacency, steps = 1, allow?: (t: number) => boolean): Uint8Array {
  let cur = mask.slice();
  for (let s = 0; s < steps; s++) {
    const next = cur.slice();
    let grew = false;
    for (let t = 0; t < cur.length; t++) {
      if (!cur[t]) continue;
      for (let j = adj.start[t]; j < adj.start[t + 1]; j++) {
        const o = adj.nbr[j];
        if (next[o] || (allow && !allow(o))) continue;
        next[o] = 1;
        grew = true;
      }
    }
    cur = next;
    if (!grew) break;
  }
  return cur;
}

/** Erode by `steps` rings: drop any member with a non-member neighbour. */
export function shrinkMask(mask: Uint8Array, adj: TriAdjacency, steps = 1): Uint8Array {
  let cur = mask.slice();
  for (let s = 0; s < steps; s++) {
    const next = cur.slice();
    for (let t = 0; t < cur.length; t++) {
      if (!cur[t]) continue;
      for (let j = adj.start[t]; j < adj.start[t + 1]; j++) {
        if (!cur[adj.nbr[j]]) { next[t] = 0; break; }
      }
    }
    cur = next;
  }
  return cur;
}

/** Connected components of the triangles where `same(t, neighbour)` holds.
 *  Returns a component id per triangle (-1 where `include(t)` is false). */
function components(
  n: number,
  adj: TriAdjacency,
  include: (t: number) => boolean,
  same: (t: number, o: number) => boolean,
): { compOf: Int32Array; count: number } {
  const compOf = new Int32Array(n).fill(-1);
  const stack: number[] = [];
  let count = 0;
  for (let s = 0; s < n; s++) {
    if (compOf[s] !== -1 || !include(s)) continue;
    compOf[s] = count;
    stack.push(s);
    while (stack.length) {
      const t = stack.pop()!;
      for (let j = adj.start[t]; j < adj.start[t + 1]; j++) {
        const o = adj.nbr[j];
        if (compOf[o] === -1 && include(o) && same(t, o)) { compOf[o] = count; stack.push(o); }
      }
    }
    count++;
  }
  return { compOf, count };
}

/** Connected components of a mask. */
export function maskComponents(mask: Uint8Array, adj: TriAdjacency): { compOf: Int32Array; count: number } {
  return components(mask.length, adj, (t) => mask[t] === 1, () => true);
}

/** Same-label connected regions of a partition (unassigned −1 included as
 *  its own label so gaps can be found and absorbed). */
export function partitionRegions(triPart: Int32Array, adj: TriAdjacency): { compOf: Int32Array; count: number } {
  return components(triPart.length, adj, () => true, (t, o) => triPart[t] === triPart[o]);
}

export interface DespeckleOptions {
  /** Drop islands (member components) smaller than this many triangles. */
  minIsland?: number;
  /** Fill holes (non-member components touching the set) smaller than this. */
  maxHole?: number;
  /** Never drop the largest island, so despeckle can't erase a small set. */
  keepLargestIsland?: boolean;
  /** Never fill the set's *outside*: on a closed surface the outside also
   *  touches the set, and on a low-poly piece it can be under `maxHole`. With
   *  this on, the largest non-member patch touching the set — and any patch at
   *  least as big as the set — is never treated as a hole. */
  protectOutside?: boolean;
}

export interface DespeckleReport {
  mask: Uint8Array;
  islandsRemoved: number;
  islandTrianglesRemoved: number;
  holesFilled: number;
  holeTrianglesFilled: number;
}

/** Drop islands smaller than `minIsland` triangles and fill holes (enclosed
 *  non-member regions) smaller than `maxHole` triangles. */
export function despeckleMask(mask: Uint8Array, adj: TriAdjacency, opts: DespeckleOptions): Uint8Array {
  return despeckleMaskReport(mask, adj, opts).mask;
}

/** `despeckleMask`, plus counts of what it removed and filled. */
export function despeckleMaskReport(mask: Uint8Array, adj: TriAdjacency, opts: DespeckleOptions): DespeckleReport {
  const out = mask.slice();
  const minIsland = opts.minIsland ?? 0;
  const maxHole = opts.maxHole ?? 0;
  let islandsRemoved = 0, islandTrianglesRemoved = 0, holesFilled = 0, holeTrianglesFilled = 0;
  if (minIsland > 0) {
    const { compOf, count } = maskComponents(mask, adj);
    const size = new Int32Array(count);
    for (let t = 0; t < compOf.length; t++) if (compOf[t] >= 0) size[compOf[t]]++;
    let largest = -1;
    if (opts.keepLargestIsland) for (let c = 0; c < count; c++) if (largest < 0 || size[c] > size[largest]) largest = c;
    const drop = new Uint8Array(count);
    for (let c = 0; c < count; c++) {
      if (c === largest || size[c] >= minIsland) continue;
      drop[c] = 1;
      islandsRemoved++;
      islandTrianglesRemoved += size[c];
    }
    for (let t = 0; t < compOf.length; t++) if (compOf[t] >= 0 && drop[compOf[t]]) out[t] = 0;
  }
  if (maxHole > 0) {
    const inv = new Uint8Array(out.length);
    let setSize = 0;
    for (let i = 0; i < out.length; i++) { inv[i] = out[i] ^ 1; setSize += out[i]; }
    const { compOf, count } = maskComponents(inv, adj);
    const size = new Int32Array(count);
    const touchesSet = new Uint8Array(count);
    for (let t = 0; t < compOf.length; t++) {
      const c = compOf[t];
      if (c < 0) continue;
      size[c]++;
      if (touchesSet[c]) continue;
      for (let j = adj.start[t]; j < adj.start[t + 1]; j++) if (out[adj.nbr[j]]) { touchesSet[c] = 1; break; }
    }
    let outside = -1;
    if (opts.protectOutside) {
      for (let c = 0; c < count; c++) if (touchesSet[c] && (outside < 0 || size[c] > size[outside])) outside = c;
    }
    const fill = new Uint8Array(count);
    for (let c = 0; c < count; c++) {
      if (!touchesSet[c] || size[c] >= maxHole) continue;
      if (opts.protectOutside && (c === outside || size[c] >= setSize)) continue;
      fill[c] = 1;
      holesFilled++;
      holeTrianglesFilled += size[c];
    }
    for (let t = 0; t < compOf.length; t++) if (compOf[t] >= 0 && fill[compOf[t]]) out[t] = 1;
  }
  return { mask: out, islandsRemoved, islandTrianglesRemoved, holesFilled, holeTrianglesFilled };
}

/**
 * Reassign every same-label region whose weight (sum of `weight[t]`, e.g.
 * triangle area) is below `minWeight` to the neighbouring label it shares the
 * most adjacency with. Repeats until stable (an absorbed island can make a
 * neighbour large enough to stop). Unassigned (−1) regions are absorbed like
 * any other but are never a target. Returns the number of regions absorbed.
 */
export function absorbSmallRegions(
  triPart: Int32Array,
  adj: TriAdjacency,
  weight: ArrayLike<number>,
  minWeight: number,
  maxRounds = 8,
): number {
  let absorbed = 0;
  for (let round = 0; round < maxRounds; round++) {
    const { compOf, count } = partitionRegions(triPart, adj);
    const w = new Float64Array(count);
    const label = new Int32Array(count);
    for (let t = 0; t < triPart.length; t++) { w[compOf[t]] += weight[t]; label[compOf[t]] = triPart[t]; }
    const target = new Int32Array(count).fill(-2);
    // Votes from big neighbours win; a region with only small neighbours may
    // only flow into a LARGER one (ties by component id). Without that
    // direction, two small neighbours each adopt the other's label and just
    // swap every round instead of merging.
    const votes = new Map<number, Map<number, number>>();
    const bigVotes = new Map<number, Map<number, number>>();
    for (let t = 0; t < triPart.length; t++) {
      const c = compOf[t];
      if (w[c] >= minWeight) continue;
      for (let j = adj.start[t]; j < adj.start[t + 1]; j++) {
        const o = adj.nbr[j];
        const oc = compOf[o];
        const L = triPart[o];
        if (oc === c || L < 0) continue;
        const big = w[oc] >= minWeight;
        if (!big && (w[oc] < w[c] || (w[oc] === w[c] && oc < c))) continue;
        const into = big ? bigVotes : votes;
        let m = into.get(c);
        if (!m) { m = new Map(); into.set(c, m); }
        m.set(L, (m.get(L) ?? 0) + 1);
      }
    }
    for (const [c, m] of bigVotes) votes.set(c, m);
    let changed = 0;
    // Smallest regions first so a cluster of slivers resolves into its host.
    const order = [...votes.keys()].sort((x, y) => w[x] - w[y]);
    for (const c of order) {
      let bestL = -2, bestV = -1;
      for (const [L, v] of votes.get(c)!) if (v > bestV || (v === bestV && L < bestL)) { bestV = v; bestL = L; }
      if (bestL !== label[c]) { target[c] = bestL; changed++; }
    }
    if (changed === 0) break;
    for (let t = 0; t < triPart.length; t++) {
      const tg = target[compOf[t]];
      if (tg !== -2) triPart[t] = tg;
    }
    absorbed += changed;
  }
  return absorbed;
}

/**
 * Majority filter: a triangle switches to the label held by a strict
 * majority of its neighbours. Shaves single-triangle stair-steps and spurs
 * off part boundaries. Unassigned triangles never vote and are never
 * changed. Returns the number of triangles changed.
 */
export function majorityFilter(triPart: Int32Array, adj: TriAdjacency, iterations = 1): number {
  let total = 0;
  for (let it = 0; it < iterations; it++) {
    const next = triPart.slice();
    let changed = 0;
    for (let t = 0; t < triPart.length; t++) {
      const own = triPart[t];
      if (own < 0) continue;
      const deg = adj.start[t + 1] - adj.start[t];
      if (deg === 0) continue;
      let ownCount = 0;
      let candL = -1, candCount = 0;
      for (let j = adj.start[t]; j < adj.start[t + 1]; j++) {
        const L = triPart[adj.nbr[j]];
        if (L === own) { ownCount++; continue; }
        if (L < 0) continue;
        let c = 0;
        for (let k = adj.start[t]; k < adj.start[t + 1]; k++) if (triPart[adj.nbr[k]] === L) c++;
        if (c > candCount) { candCount = c; candL = L; }
      }
      if (candL >= 0 && candCount * 2 > deg && candCount > ownCount) { next[t] = candL; changed++; }
    }
    triPart.set(next);
    total += changed;
    if (changed === 0) break;
  }
  return total;
}
