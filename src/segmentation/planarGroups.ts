// `planar-groups` — "Flat & smooth faces": a seedless detector for mechanical,
// CAD-like and low-poly parts, where the natural parts are the faces of the
// original model (a bracket's top, its bolt holes' walls, a fillet, a boss).
//
//   1. Group triangles into faces. Two modes:
//        smooth — union-find over every mesh edge whose dihedral angle is ≤
//                 angleDeg. Regions are bounded by sharp edges only, so a
//                 cylinder wall or a fillet stays ONE face, like a BREP face.
//        flat   — region growing for near-planar groups: seed from the
//                 largest unvisited triangle and BFS outward, taking a
//                 neighbour only if its fold is ≤ angleDeg AND its normal is
//                 within angleDeg of the group's running area-weighted mean
//                 normal. A gentle curve can't creep (the mean pins the
//                 group), so curved surfaces split into facets.
//      (The same idea as `computeFaceGroups` in src/color/faceGroups.ts — a
//      coplanar flood fill — but over the shared MeshFeatures adjacency, so it
//      honours the allow mask and costs no second adjacency build.)
//   2. Merge up: repeatedly fold the SMALLEST face into the neighbour it
//      shares the most boundary with, until every face is ≥ minPartPct of the
//      surface and at most maxParts remain (so the cap is exact, not "bar
//      ties"). Smallest-first, one merge at a time, matters on noisy meshes:
//      a jittered scan breaks into 10^4–10^5 specks, which round-based
//      `absorbSmallRegions` clears slowly and can't cap at a part count.
//   3. Number faces by descending area.
//
// Step 1 is the expensive part and depends only on (features, mode, angle,
// allowed area), so it is cached in the runner's per-mesh cache: the
// minPartPct / maxParts sliders only re-run steps 2–3.
//
// Honest limits: on organic sculpts and scans everything is smooth, so smooth
// mode fuses the whole surface into one part and flat mode shatters it into
// shards. Use auto-merge / crease-watershed there.

import { featureOptionsKey, maskKey } from './features';
import { AbortedError } from './growth';
import type { DetectorContext, DetectorResult, MeshFeatures, PartDetector } from './types';

interface RawGroups {
  /** Dense group id per triangle (−1 where not allowed). */
  group: Int32Array;
  groupCount: number;
}

/** How often (in loop iterations, power of two) the grouping loops check abort / report progress. */
const CHECK_EVERY = 1 << 15;

function groupSmooth(f: MeshFeatures, angleDeg: number, ctx: DetectorContext): RawGroups {
  const n = f.triCount, allow = ctx.allow;
  const parent = new Int32Array(n);
  for (let t = 0; t < n; t++) parent[t] = t;
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let e = 0; e < f.edgeA.length; e++) {
    if ((e & (CHECK_EVERY - 1)) === 0 && ctx.signal?.aborted) throw new AbortedError();
    const a = f.edgeA[e], b = f.edgeB[e];
    if (f.dihedralDeg[e] > angleDeg || (allow && (!allow[a] || !allow[b]))) continue;
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra < rb ? rb : ra] = ra < rb ? ra : rb;
  }
  const group = new Int32Array(n).fill(-1);
  const id = new Int32Array(n).fill(-1);
  let groupCount = 0;
  for (let t = 0; t < n; t++) {
    if (allow && !allow[t]) continue;
    const r = find(t);
    if (id[r] < 0) id[r] = groupCount++;
    group[t] = id[r];
  }
  return { group, groupCount };
}

function groupFlat(f: MeshFeatures, angleDeg: number, ctx: DetectorContext): RawGroups {
  const n = f.triCount, allow = ctx.allow, nrm = f.smoothNormal;
  const cosTol = Math.cos((angleDeg * Math.PI) / 180);
  // Largest triangles seed first so big planes claim their area before slivers.
  const order = new Uint32Array(n);
  for (let t = 0; t < n; t++) order[t] = t;
  order.sort((a, b) => f.triArea[b] - f.triArea[a]);
  const group = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let groupCount = 0, visited = 0;
  for (let s = 0; s < n; s++) {
    const seed = order[s];
    if (group[seed] >= 0 || (allow && !allow[seed])) continue;
    const g = groupCount++;
    let sx = nrm[seed * 3] * f.triArea[seed], sy = nrm[seed * 3 + 1] * f.triArea[seed], sz = nrm[seed * 3 + 2] * f.triArea[seed];
    let head = 0, tail = 0;
    queue[tail++] = seed;
    group[seed] = g;
    while (head < tail) {
      const t = queue[head++];
      if ((++visited & (CHECK_EVERY - 1)) === 0) {
        if (ctx.signal?.aborted) throw new AbortedError();
        ctx.progress?.(0.05 + 0.7 * (visited / n), 'Growing flat faces…');
      }
      for (let j = f.adjStart[t]; j < f.adjStart[t + 1]; j++) {
        const e = f.adjPair[j];
        const o = f.edgeA[e] === t ? f.edgeB[e] : f.edgeA[e];
        if (group[o] >= 0 || (allow && !allow[o]) || f.dihedralDeg[e] > angleDeg) continue;
        const len = Math.hypot(sx, sy, sz);
        // Degenerate (cancelling) mean: fall back to the fold test alone.
        const dot = len > 1e-20 ? (nrm[o * 3] * sx + nrm[o * 3 + 1] * sy + nrm[o * 3 + 2] * sz) / len : 1;
        if (dot < cosTol) continue;
        group[o] = g;
        const a = f.triArea[o];
        sx += nrm[o * 3] * a; sy += nrm[o * 3 + 1] * a; sz += nrm[o * 3 + 2] * a;
        queue[tail++] = o;
      }
    }
  }
  return { group, groupCount };
}

/** Binary min-heap of (key, id) pairs; stale entries are skipped by the caller. */
class MinHeap {
  private keys: number[] = [];
  private ids: number[] = [];
  get size(): number { return this.keys.length; }
  push(key: number, id: number): void {
    const k = this.keys, d = this.ids;
    let i = k.length;
    k.push(key); d.push(id);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; d[i] = d[p]; i = p;
    }
    k[i] = key; d[i] = id;
  }
  /** Pops the smallest entry (caller checks `size` first). */
  pop(): { key: number; id: number } {
    const k = this.keys, d = this.ids;
    const top = { key: k[0], id: d[0] };
    const key = k.pop()!, id = d.pop()!;
    const n = k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= key) break;
        k[i] = k[c]; d[i] = d[c]; i = c;
      }
      k[i] = key; d[i] = id;
    }
    return top;
  }
}

/** Agglomerate groups: fold the smallest into its longest-bordering neighbour
 *  until all are ≥ minArea and at most maxParts remain. Groups with no
 *  neighbour (separate pieces) are left alone. Returns the final group per
 *  triangle (root group ids, −1 where unallowed). */
function mergeSmallest(f: MeshFeatures, raw: RawGroups, minArea: number, maxParts: number, ctx: DetectorContext): Int32Array {
  const G = raw.groupCount;
  const area = new Float64Array(G);
  for (let t = 0; t < f.triCount; t++) if (raw.group[t] >= 0) area[raw.group[t]] += f.triArea[t];
  // Region adjacency: neighbour → shared boundary length.
  const nbr: Map<number, number>[] = Array.from({ length: G }, () => new Map());
  for (let e = 0; e < f.edgeA.length; e++) {
    const a = raw.group[f.edgeA[e]], b = raw.group[f.edgeB[e]];
    if (a === b || a < 0 || b < 0) continue;
    nbr[a].set(b, (nbr[a].get(b) ?? 0) + f.edgeLen[e]);
    nbr[b].set(a, (nbr[b].get(a) ?? 0) + f.edgeLen[e]);
  }
  const parent = Int32Array.from({ length: G }, (_, i) => i);
  const heap = new MinHeap();
  for (let g = 0; g < G; g++) heap.push(area[g], g);
  let alive = G, steps = 0;
  while (heap.size > 0) {
    const { key, id: r } = heap.pop();
    if (parent[r] !== r || key !== area[r]) continue; // merged away, or a stale entry (area grew since)
    if (key >= minArea && alive <= maxParts) break; // smallest remaining face is big enough and the count fits
    if ((++steps & 0x3fff) === 0 && ctx.signal?.aborted) throw new AbortedError();
    let best = -1, bestLen = -1;
    for (const [k, len] of nbr[r]) if (len > bestLen || (len === bestLen && k < best)) { best = k; bestLen = len; }
    if (best < 0) continue; // isolated piece: cannot merge
    // Fold r into best.
    parent[r] = best;
    area[best] += area[r];
    nbr[best].delete(r);
    for (const [k, len] of nbr[r]) {
      if (k === best) continue;
      nbr[k].delete(r);
      nbr[k].set(best, (nbr[k].get(best) ?? 0) + len);
      nbr[best].set(k, (nbr[best].get(k) ?? 0) + len);
    }
    nbr[r].clear();
    heap.push(area[best], best);
    alive--;
  }
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const out = new Int32Array(f.triCount);
  for (let t = 0; t < f.triCount; t++) out[t] = raw.group[t] < 0 ? -1 : find(raw.group[t]);
  return out;
}

export const planarGroupsDetector: PartDetector = {
  id: 'planar-groups',
  name: 'Flat & smooth faces',
  description: 'No seeds needed: groups triangles into faces bounded by sharp edges, one part per face of the original CAD model. "Smooth" keeps a cylinder wall or fillet as one face; "flat" splits curved surfaces into planar facets. Min size and max parts are instant to adjust.',
  bestFor: 'Mechanical, CAD-like and low-poly parts with crisp edges (brackets, enclosures, gears, boxy props). Poor on organic sculpts and scans: there everything is smooth, so smooth mode fuses it into one part and flat mode shatters it into many shards — use Auto patches instead.',
  seeds: 'none',
  params: [
    {
      key: 'surfaces', label: 'Surfaces', type: 'enum', default: 'smooth', options: ['smooth', 'flat'],
      hint: '"smooth": a face is everything connected without a sharp edge, so cylinders and fillets stay whole. "flat": a face must stay near-planar, so curved surfaces split into facets.',
    },
    {
      key: 'angleDeg', label: 'Sharp edge (°)', type: 'number', default: 20, min: 0.5, max: 90, step: 0.5,
      hint: 'A fold sharper than this many degrees is a face boundary (in flat mode, also the allowed drift from the face\'s average normal). Lower = more, smaller faces.',
    },
    {
      key: 'minPartPct', label: 'Absorb below (%)', type: 'number', default: 0.1, min: 0, max: 10, step: 0.05,
      hint: 'Faces smaller than this percentage of the surface are folded into their neighbour (chamfer slivers, tessellation scraps).',
    },
    {
      key: 'maxParts', label: 'Max parts', type: 'integer', default: 64, min: 2, max: 500,
      hint: 'Keep at most this many faces: the smallest are folded into neighbours until the count fits (ties and unconnected pieces may leave a few more).',
    },
  ],
  presets: [
    { name: 'CAD faces', params: {} },
    { name: 'Sharp edges only', params: { angleDeg: 45 } },
    { name: 'Flat facets', params: { surfaces: 'flat', angleDeg: 8 } },
    { name: 'Coarse', params: { minPartPct: 1 } },
    { name: 'Fine', params: { angleDeg: 10, minPartPct: 0.02 } },
    { name: 'Top 8 faces', params: { maxParts: 8 } },
  ],
  run(_mesh, f, ctx): DetectorResult {
    const surfaces = String(ctx.params.surfaces);
    const angleDeg = Number(ctx.params.angleDeg);
    const key = `planar-groups:${featureOptionsKey(f.options)}:${surfaces}:${angleDeg}:${maskKey(ctx.allow)}`;
    let raw = ctx.cache?.get(key) as RawGroups | undefined;
    if (!raw) {
      ctx.progress?.(0.05, 'Grouping faces…');
      raw = surfaces === 'flat' ? groupFlat(f, angleDeg, ctx) : groupSmooth(f, angleDeg, ctx);
      ctx.cache?.set(key, raw);
    }
    if (ctx.signal?.aborted) throw new AbortedError();
    ctx.progress?.(0.8, 'Merging small faces…');
    const minArea = (Number(ctx.params.minPartPct) / 100) * f.totalArea;
    const triPart = mergeSmallest(f, raw, minArea, Number(ctx.params.maxParts), ctx);
    // Number faces by area (largest first).
    const area = new Float64Array(raw.groupCount);
    for (let t = 0; t < f.triCount; t++) if (triPart[t] >= 0) area[triPart[t]] += f.triArea[t];
    const used = new Uint8Array(raw.groupCount);
    for (let t = 0; t < f.triCount; t++) if (triPart[t] >= 0) used[triPart[t]] = 1;
    const order: number[] = [];
    for (let g = 0; g < raw.groupCount; g++) if (used[g]) order.push(g);
    order.sort((x, y) => area[y] - area[x]);
    const remap = new Int32Array(raw.groupCount).fill(-1);
    order.forEach((g, i) => { remap[g] = i; });
    for (let t = 0; t < f.triCount; t++) if (triPart[t] >= 0) triPart[t] = remap[triPart[t]];
    return {
      triPart,
      partNames: order.map((_, i) => `face ${i + 1}`),
      genericNames: true,
      diagnostics: { rawGroups: raw.groupCount, parts: order.length },
    };
  },
};
