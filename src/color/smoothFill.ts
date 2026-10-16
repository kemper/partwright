// Smooth bucket fills — a clean painted edge for `paintRegion` /
// `paintConnected` instead of the triangle sawtooth.
//
// A flood fill selects whole triangles, so its boundary follows the mesh's
// triangulation. To smooth it we turn the fill into a *coverage field* on the
// pristine base mesh and let the existing refine pipeline clip along it:
//
//   1. Re-flood the descriptor on the base mesh (deterministic, so a reload or
//      the subdivision worker reproduces it exactly).
//   2. Give every vertex its coverage: the fraction of its incident triangle
//      area that is in the fill (1 deep inside, 0 outside, fractional on the
//      boundary).
//   3. Blur that coverage `smoothness` times across the vertex graph — only in
//      a band around the boundary, so the cost tracks the boundary length, not
//      the mesh size. This averages the sawtooth's teeth out.
//   4. Coverage at any surface point = barycentric interpolation on the base
//      triangle it lies on. The painted area is coverage > 0.5, and the
//      `RefineRegion.field` (0.5 − coverage) makes `clipByField` cut the mesh
//      exactly along that contour.
//
// Because the field is linear inside each base triangle, the clipped edge is a
// polyline with one straight segment per base triangle it crosses — no teeth,
// and no extra subdivision. Points being evaluated always lie on the base
// surface (subdivision and clipping are planar), so "the base triangle it lies
// on" is just the nearest one.

import type { MeshData } from '../geometry/types';
import type { RegionDescriptor } from './regions';
import { buildAdjacency, findCoplanarRegion, resolveSeed, resolveConnectedFromSeed, type AdjacencyGraph } from './adjacency';
import type { RefineRegion, TriClass } from './subdivide';

export type SmoothFillDescriptor = Extract<RegionDescriptor, { kind: 'coplanar' | 'connectedFromSeed' }>;

/** Default blur passes — enough to flatten a one-triangle sawtooth. */
export const DEFAULT_FILL_SMOOTHNESS = 4;
/** Upper bound on `smoothness` (each pass widens the blurred band one ring). */
export const MAX_FILL_SMOOTHNESS = 32;
/** A fill edge that runs along a fold sharper than this is already a clean
 *  line (a CAD face edge, a sole crease) and is kept exactly where it is.
 *  Deliberately a fixed constant, not an appConfig knob: the subdivision
 *  worker can't see user config overrides, and both threads (and every reload)
 *  must cut the identical edge. */
const CREASE_DEG = 45;
/** Coverage within this of 0.5 counts as a tie (pinned crease vertices). */
const TIE_EPS = 1e-6;

/** True for a bucket-fill descriptor with boundary smoothing on. */
export function isSmoothFill(d: RegionDescriptor): d is SmoothFillDescriptor {
  return (d.kind === 'coplanar' || d.kind === 'connectedFromSeed') && !!d.smooth;
}

export interface SmoothFillField {
  /** Blurred fill coverage (0..1) at a point on the base surface. */
  coverage(px: number, py: number, pz: number): number;
  /** Whether a surface point is painted: coverage above 0.5, with an exact tie
   *  (a face bounded entirely by pinned crease vertices) decided by the raw
   *  fill's membership of the base triangle under the point. */
  inside(px: number, py: number, pz: number): boolean;
  /** Refine region for the subdivision pipeline: clip-only (no subdivision),
   *  cutting along coverage = 0.5. */
  refine: RefineRegion;
  /** False only when the point is certainly NOT near the blurred band —
   *  i.e. its coverage is the constant 0 or 1 of a whole patch. */
  nearBand(px: number, py: number, pz: number): boolean;
  /** Base triangles of the raw (unsmoothed) fill. */
  rawTriangles: Set<number>;
  /** True when blurring left nothing above 0.5 (the fill was thinner than the
   *  blur — e.g. a sliver). The region would paint nothing. */
  empty: boolean;
}

const adjacencyCache = new WeakMap<MeshData, AdjacencyGraph>();
const fieldCache = new WeakMap<MeshData, WeakMap<object, SmoothFillField>>();

/** Hand the field builder an adjacency graph the caller already built for
 *  this exact base mesh, so a smooth fill on an unrefined mesh doesn't build it
 *  twice (it's the most expensive step on a large scan). */
export function primeBaseAdjacency(base: MeshData, adjacency: AdjacencyGraph): void {
  if (!adjacencyCache.has(base)) adjacencyCache.set(base, adjacency);
}

function baseAdjacency(base: MeshData): AdjacencyGraph {
  let a = adjacencyCache.get(base);
  if (!a) { a = buildAdjacency(base); adjacencyCache.set(base, a); }
  return a;
}

/** The raw (whole-triangle) fill of a bucket descriptor on `mesh`. Mirrors the
 *  main-thread resolver for `coplanar` / `connectedFromSeed`. */
export function bucketFillTriangles(d: SmoothFillDescriptor, mesh: MeshData, adjacency: AdjacencyGraph): Set<number> {
  if (d.kind === 'coplanar') {
    const seed = resolveSeed(d.seedPoint, d.seedNormal, mesh, adjacency, d.normalTolerance);
    return seed >= 0 ? findCoplanarRegion(seed, adjacency, d.normalTolerance) : new Set<number>();
  }
  return resolveConnectedFromSeed(d, mesh, adjacency);
}

/** Clamp a requested smoothness to the supported integer range. */
export function fillSmoothness(d: { smoothness?: number }): number {
  const s = d.smoothness ?? DEFAULT_FILL_SMOOTHNESS;
  return Math.max(0, Math.min(MAX_FILL_SMOOTHNESS, Math.round(s)));
}

/** The smooth-fill field for a descriptor against a base mesh, cached per
 *  (base, descriptor object) — descriptors are stable references in the region
 *  store, so the field is built once per base mesh. */
export function smoothFillFor(d: SmoothFillDescriptor, base: MeshData): SmoothFillField {
  let perBase = fieldCache.get(base);
  if (!perBase) { perBase = new WeakMap(); fieldCache.set(base, perBase); }
  let f = perBase.get(d);
  if (!f) {
    const tris = bucketFillTriangles(d, base, baseAdjacency(base));
    f = buildSmoothFillField(base, tris, fillSmoothness(d));
    perBase.set(d, f);
  }
  return f;
}

/** Triangles of `mesh` (the base, or a refinement of it) that the smooth fill
 *  paints: those whose centroid has blurred coverage above 0.5. After the
 *  refine pipeline has clipped `mesh` along the field, every triangle is wholly
 *  on one side, so this is exact.
 *
 *  With `adjacency` (for `mesh`), only triangles near the blurred band pay for
 *  a point lookup. The rest sit on base triangles whose corners are uniformly
 *  0 or 1, and any two of them sharing a vertex share that value — so each
 *  connected patch of them is wholly in or out and one lookup decides it. */
export function resolveSmoothFillTriangles(
  d: SmoothFillDescriptor,
  base: MeshData,
  mesh: MeshData,
  adjacency?: { neighbors: ArrayLike<ArrayLike<number>> } | null,
): Set<number> {
  const field = smoothFillFor(d, base);
  const out = new Set<number>();
  if (field.empty) return out;
  const { triVerts, vertProperties: vp, numProp: P, numTri } = mesh;
  const centroid = (t: number): [number, number, number] => {
    const a = triVerts[t * 3] * P, b = triVerts[t * 3 + 1] * P, c = triVerts[t * 3 + 2] * P;
    return [(vp[a] + vp[b] + vp[c]) / 3, (vp[a + 1] + vp[b + 1] + vp[c + 1]) / 3, (vp[a + 2] + vp[b + 2] + vp[c + 2]) / 3];
  };
  if (!adjacency) {
    for (let t = 0; t < numTri; t++) if (field.inside(...centroid(t))) out.add(t);
    return out;
  }
  // 0 = undecided, 1 = in, 2 = out.
  const label = new Uint8Array(numTri);
  const far: number[] = [];
  for (let t = 0; t < numTri; t++) {
    const a = triVerts[t * 3] * P, b = triVerts[t * 3 + 1] * P, c = triVerts[t * 3 + 2] * P;
    const cx = (vp[a] + vp[b] + vp[c]) / 3, cy = (vp[a + 1] + vp[b + 1] + vp[c + 1]) / 3, cz = (vp[a + 2] + vp[b + 2] + vp[c + 2]) / 3;
    if (field.nearBand(cx, cy, cz)) label[t] = field.inside(cx, cy, cz) ? 1 : 2;
    else far.push(t);
  }
  const { neighbors } = adjacency;
  const stack: number[] = [];
  for (const start of far) {
    if (label[start] !== 0) continue;
    const v = field.inside(...centroid(start)) ? 1 : 2;
    label[start] = v;
    stack.push(start);
    while (stack.length > 0) {
      const t = stack.pop()!;
      const ns = neighbors[t];
      for (let i = 0; i < ns.length; i++) {
        const n = ns[i];
        if (label[n] !== 0) continue; // near-band triangles were decided above
        label[n] = v;
        stack.push(n);
      }
    }
  }
  for (let t = 0; t < numTri; t++) if (label[t] === 1) out.add(t);
  return out;
}

/** Build the blurred coverage field for a set of base triangles. Exported for
 *  unit tests; callers normally go through `smoothFillFor`. */
export function buildSmoothFillField(base: MeshData, tris: Set<number>, smoothness: number): SmoothFillField {
  const { triVerts, vertProperties: vp, numProp: P, numTri, numVert } = base;

  // 1. Weld vertices by exact position so coverage flows across split copies
  //    (render meshes carry per-face vertex duplicates at hard edges).
  const canon = new Int32Array(numVert);
  const byPos = new Map<string, number>();
  let nCanon = 0;
  for (let v = 0; v < numVert; v++) {
    const k = `${vp[v * P]},${vp[v * P + 1]},${vp[v * P + 2]}`;
    let c = byPos.get(k);
    if (c === undefined) { c = nCanon++; byPos.set(k, c); }
    canon[v] = c;
  }

  // 2. Area-weighted coverage per (welded) vertex.
  const inArea = new Float64Array(nCanon);
  const totArea = new Float64Array(nCanon);
  const deg = new Int32Array(nCanon);
  for (let t = 0; t < numTri; t++) {
    const i0 = triVerts[t * 3], i1 = triVerts[t * 3 + 1], i2 = triVerts[t * 3 + 2];
    const ax = vp[i0 * P], ay = vp[i0 * P + 1], az = vp[i0 * P + 2];
    const ux = vp[i1 * P] - ax, uy = vp[i1 * P + 1] - ay, uz = vp[i1 * P + 2] - az;
    const wx = vp[i2 * P] - ax, wy = vp[i2 * P + 1] - ay, wz = vp[i2 * P + 2] - az;
    const area = 0.5 * Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx);
    const inside = tris.has(t);
    for (const i of [i0, i1, i2]) {
      const c = canon[i];
      totArea[c] += area;
      if (inside) inArea[c] += area;
      deg[c] += 2;
    }
  }
  const s = new Float64Array(nCanon);
  for (let c = 0; c < nCanon; c++) s[c] = totArea[c] > 0 ? inArea[c] / totArea[c] : 0;

  // Pin the fill edge where it already follows a sharp fold: a vertex whose
  // every in/out edge is a crease (faces bending more than CREASE_DEG) sits
  // exactly on the 0.5 contour and is never blurred, so the cut lands on the
  // crease itself — a CAD face keeps its crisp outline and only the jagged
  // parts get smoothed. A vertex where a jagged edge meets a crease stays free
  // (pinning it would drag a one-triangle notch along the crease).
  const pinned = new Uint8Array(nCanon);
  const softEdge = new Uint8Array(nCanon);
  {
    const creaseCos = Math.cos(CREASE_DEG * Math.PI / 180);
    const normal = (t: number): [number, number, number] => {
      const i0 = triVerts[t * 3] * P, i1 = triVerts[t * 3 + 1] * P, i2 = triVerts[t * 3 + 2] * P;
      const ux = vp[i1] - vp[i0], uy = vp[i1 + 1] - vp[i0 + 1], uz = vp[i1 + 2] - vp[i0 + 2];
      const wx = vp[i2] - vp[i0], wy = vp[i2 + 1] - vp[i0 + 1], wz = vp[i2 + 2] - vp[i0 + 2];
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      const l = Math.hypot(nx, ny, nz) || 1;
      return [nx / l, ny / l, nz / l];
    };
    // Edge (welded vertex pair) → first triangle seen on it.
    const edgeTri = new Map<number, number>();
    for (let t = 0; t < numTri; t++) {
      for (let k = 0; k < 3; k++) {
        const a = canon[triVerts[t * 3 + k]], b = canon[triVerts[t * 3 + ((k + 1) % 3)]];
        const key = a < b ? a * nCanon + b : b * nCanon + a;
        const other = edgeTri.get(key);
        if (other === undefined) { edgeTri.set(key, t); continue; }
        if (tris.has(t) === tris.has(other)) continue;
        const n1 = normal(t), n2 = normal(other);
        if (n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2] < creaseCos) {
          pinned[a] = 1; pinned[b] = 1;
        } else {
          softEdge[a] = 1; softEdge[b] = 1;
        }
      }
    }
    for (let c = 0; c < nCanon; c++) {
      if (softEdge[c]) pinned[c] = 0;
      else if (pinned[c]) s[c] = 0.5;
    }
  }

  // Vertex graph (CSR). Interior edges appear once per incident triangle,
  // which weights the blur uniformly enough for this purpose.
  const start = new Int32Array(nCanon + 1);
  for (let c = 0; c < nCanon; c++) start[c + 1] = start[c] + deg[c];
  const fill = start.slice(0, nCanon);
  const nbr = new Int32Array(start[nCanon]);
  for (let t = 0; t < numTri; t++) {
    const a = canon[triVerts[t * 3]], b = canon[triVerts[t * 3 + 1]], c = canon[triVerts[t * 3 + 2]];
    nbr[fill[a]++] = b; nbr[fill[a]++] = c;
    nbr[fill[b]++] = c; nbr[fill[b]++] = a;
    nbr[fill[c]++] = a; nbr[fill[c]++] = b;
  }

  // 3. Blur inside a band around the boundary: boundary vertices plus
  //    `smoothness` rings (a pass can only move values one ring outward).
  const isBoundary = (c: number) => s[c] > 0 && s[c] < 1 && !pinned[c];
  const inBand = new Uint8Array(nCanon);
  let frontier: number[] = [];
  for (let c = 0; c < nCanon; c++) if (isBoundary(c)) { inBand[c] = 1; frontier.push(c); }
  for (let r = 0; r < smoothness && frontier.length > 0; r++) {
    const next: number[] = [];
    for (const c of frontier) {
      for (let k = start[c]; k < start[c + 1]; k++) {
        const n = nbr[k];
        if (!inBand[n]) { inBand[n] = 1; next.push(n); }
      }
    }
    frontier = next;
  }
  const band: number[] = [];
  for (let c = 0; c < nCanon; c++) if (inBand[c] && !pinned[c]) band.push(c);
  const tmp = new Float64Array(band.length);
  for (let pass = 0; pass < smoothness; pass++) {
    for (let i = 0; i < band.length; i++) {
      const c = band[i];
      const k0 = start[c], k1 = start[c + 1];
      if (k1 === k0) { tmp[i] = s[c]; continue; }
      let sum = 0;
      for (let k = k0; k < k1; k++) sum += s[nbr[k]];
      tmp[i] = 0.5 * s[c] + 0.5 * (sum / (k1 - k0));
    }
    for (let i = 0; i < band.length; i++) s[band[i]] = tmp[i];
  }

  // Per-triangle corner coverage + the band's bounds (only triangles with a
  // fractional corner can host the 0.5 contour).
  const corner = new Float32Array(numTri * 3);
  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let anyInside = false;
  const bandTris: number[] = [];
  for (let t = 0; t < numTri; t++) {
    let mixed = false;
    let above = false, below = false;
    for (let k = 0; k < 3; k++) {
      const v = s[canon[triVerts[t * 3 + k]]];
      corner[t * 3 + k] = v;
      if (v > 0.5) above = true; else below = true;
      if (v > 0 && v < 1) mixed = true;
    }
    if (!anyInside) {
      const mean = (corner[t * 3] + corner[t * 3 + 1] + corner[t * 3 + 2]) / 3;
      anyInside = mean > 0.5 + TIE_EPS || (Math.abs(mean - 0.5) <= TIE_EPS && tris.has(t));
    }
    if (mixed || (above && below)) {
      bandTris.push(t);
      for (let k = 0; k < 3; k++) {
        const i = triVerts[t * 3 + k] * P;
        for (let a = 0; a < 3; a++) {
          const x = vp[i + a];
          if (x < lo[a]) lo[a] = x;
          if (x > hi[a]) hi[a] = x;
        }
      }
    }
  }

  // 4. Point lookup: nearest base triangle (points lie on the surface), then
  //    barycentric interpolation of its corner coverage.
  const sgrid = surfaceGrid(base);
  let lastTri = -1;
  const coverage = (px: number, py: number, pz: number): number => {
    let best = Infinity, val = 0;
    lastTri = -1;
    sgrid.candidates(px, py, pz, (t) => {
      const r = baryOnTriangle(base, t, px, py, pz);
      if (r.d2 < best) {
        best = r.d2;
        lastTri = t;
        val = r.u * corner[t * 3] + r.v * corner[t * 3 + 1] + r.w * corner[t * 3 + 2];
      }
    });
    return val;
  };
  // Cells within one of a band triangle's centroid: a surface point outside
  // them lies on a base triangle whose corners are all 0 or all 1, so its
  // coverage is constant across that whole patch (see resolveSmoothFillTriangles).
  // A band triangle bigger than a cell can't be localised by cell; then every
  // point counts as near (correct, just no shortcut).
  const bandHasOversize = sgrid.oversize.size > 0 && bandTris.some(bt => sgrid.oversize.has(bt));
  const bandCells = new Set<number>();
  for (const bt of bandTris) {
    const a = triVerts[bt * 3] * P, b = triVerts[bt * 3 + 1] * P, c = triVerts[bt * 3 + 2] * P;
    for (const k of sgrid.neighbourhood((vp[a] + vp[b] + vp[c]) / 3, (vp[a + 1] + vp[b + 1] + vp[c + 1]) / 3, (vp[a + 2] + vp[b + 2] + vp[c + 2]) / 3)) bandCells.add(k);
  }
  const nearBand = (px: number, py: number, pz: number): boolean =>
    bandHasOversize || bandCells.has(sgrid.cellOf(px, py, pz));

  const inside = (px: number, py: number, pz: number): boolean => {
    const c = coverage(px, py, pz);
    if (c > 0.5 + TIE_EPS) return true;
    if (c < 0.5 - TIE_EPS) return false;
    return lastTri >= 0 && tris.has(lastTri);
  };

  const bandFound = lo[0] <= hi[0];
  const pad = bandFound ? 1e-6 * (Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) + 1) : 0;
  const field = (px: number, py: number, pz: number) => 0.5 - coverage(px, py, pz);
  const classify = (a: number[], b: number[], c: number[]): TriClass => {
    const fa = field(a[0], a[1], a[2]), fb = field(b[0], b[1], b[2]), fc = field(c[0], c[1], c[2]);
    if (fa < 0 && fb < 0 && fc < 0) return 'inside';
    if (fa > 0 && fb > 0 && fc > 0) return 'outside';
    return 'straddle';
  };
  const refine: RefineRegion = {
    // An empty band means no contour anywhere: an unreachable box skips all work.
    aabb: bandFound
      ? { min: [lo[0] - pad, lo[1] - pad, lo[2] - pad], max: [hi[0] + pad, hi[1] + pad, hi[2] + pad] }
      : { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] },
    // The field is linear inside every base triangle, so subdividing buys
    // nothing — clip only. (selectByClassify skips triangles finer than this,
    // and this is ≥ every edge.)
    maxEdge: Infinity,
    classify,
    field,
  };

  return { coverage, inside, nearBand, refine, rawTriangles: tris, empty: !anyInside };
}

interface SurfaceGrid {
  /** Visit every base triangle the surface point could lie on. */
  candidates(px: number, py: number, pz: number, visit: (t: number) => void): void;
  /** Numeric key of the cell holding a point (−1 when off the grid). */
  cellOf(px: number, py: number, pz: number): number;
  /** Keys of a cell's 27-neighbourhood (itself included). */
  neighbourhood(px: number, py: number, pz: number): number[];
  /** Triangles bigger than a cell — not binned, visited on every lookup. */
  oversize: ReadonlySet<number>;
}
const surfaceGridCache = new WeakMap<MeshData, SurfaceGrid>();

/** Candidate base triangles for a point ON the surface: a uniform grid whose
 *  cells are sized to the triangles (≈2× the mean centroid→vertex extent), so a
 *  lookup visits the point's cell and its 26 neighbours — a handful of
 *  triangles. (`triGridFor` sizes cells to the volume, which on a surface mesh
 *  puts hundreds of triangles in every cell.) Triangles larger than a cell are
 *  always visited. Cached per base mesh. */
function surfaceGrid(base: MeshData): SurfaceGrid {
  const cached = surfaceGridCache.get(base);
  if (cached) return cached;
  const { triVerts, vertProperties: vp, numProp: P, numTri } = base;
  const cx = new Float64Array(numTri), cy = new Float64Array(numTri), cz = new Float64Array(numTri);
  const ext = new Float64Array(numTri);
  let extSum = 0;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < numTri; t++) {
    const a = triVerts[t * 3] * P, b = triVerts[t * 3 + 1] * P, c = triVerts[t * 3 + 2] * P;
    const mx = (vp[a] + vp[b] + vp[c]) / 3, my = (vp[a + 1] + vp[b + 1] + vp[c + 1]) / 3, mz = (vp[a + 2] + vp[b + 2] + vp[c + 2]) / 3;
    cx[t] = mx; cy[t] = my; cz[t] = mz;
    const e = Math.sqrt(Math.max(
      (vp[a] - mx) ** 2 + (vp[a + 1] - my) ** 2 + (vp[a + 2] - mz) ** 2,
      (vp[b] - mx) ** 2 + (vp[b + 1] - my) ** 2 + (vp[b + 2] - mz) ** 2,
      (vp[c] - mx) ** 2 + (vp[c + 1] - my) ** 2 + (vp[c + 2] - mz) ** 2,
    ));
    ext[t] = e; extSum += e;
    if (mx < lo[0]) lo[0] = mx; if (my < lo[1]) lo[1] = my; if (mz < lo[2]) lo[2] = mz;
    if (mx > hi[0]) hi[0] = mx; if (my > hi[1]) hi[1] = my; if (mz > hi[2]) hi[2] = mz;
  }
  const diag = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
  const cell = Math.max(numTri ? (2 * extSum) / numTri : 1, diag / 2048, 1e-9);
  // Numeric cell keys over a one-cell-padded box (points can sit up to a
  // triangle extent outside the centroid bounds).
  const nx = Math.floor((hi[0] - lo[0]) / cell) + 3, ny = Math.floor((hi[1] - lo[1]) / cell) + 3, nz = Math.floor((hi[2] - lo[2]) / cell) + 3;
  const key = (ix: number, iy: number, iz: number) =>
    (ix < -1 || iy < -1 || iz < -1 || ix > nx - 2 || iy > ny - 2 || iz > nz - 2) ? -1 : ((iz + 1) * ny + (iy + 1)) * nx + (ix + 1);
  const bins = new Map<number, number[]>();
  const oversize: number[] = [];
  for (let t = 0; t < numTri; t++) {
    if (ext[t] > cell) { oversize.push(t); continue; }
    const k = key(Math.floor((cx[t] - lo[0]) / cell), Math.floor((cy[t] - lo[1]) / cell), Math.floor((cz[t] - lo[2]) / cell));
    const arr = bins.get(k);
    if (arr) arr.push(t); else bins.set(k, [t]);
  }
  const ijk = (px: number, py: number, pz: number) =>
    [Math.floor((px - lo[0]) / cell), Math.floor((py - lo[1]) / cell), Math.floor((pz - lo[2]) / cell)];
  const grid: SurfaceGrid = {
    candidates(px, py, pz, visit) {
      for (const t of oversize) visit(t);
      // A binned triangle's centroid is within `cell` of every point on it, so
      // the point's cell ± 1 covers every triangle the point can lie on.
      const [ix, iy, iz] = ijk(px, py, pz);
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const k = key(ix + dx, iy + dy, iz + dz);
        if (k < 0) continue;
        const arr = bins.get(k);
        if (arr) for (const t of arr) visit(t);
      }
    },
    cellOf(px, py, pz) {
      return key(Math.floor((px - lo[0]) / cell), Math.floor((py - lo[1]) / cell), Math.floor((pz - lo[2]) / cell));
    },
    oversize: new Set(oversize),
    neighbourhood(px, py, pz) {
      const [ix, iy, iz] = ijk(px, py, pz);
      const out: number[] = [];
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const k = key(ix + dx, iy + dy, iz + dz);
        if (k >= 0) out.push(k);
      }
      return out;
    },
  };
  surfaceGridCache.set(base, grid);
  return grid;
}

/** Barycentric coordinates of the point on triangle `t` closest to p, plus the
 *  squared distance to it. */
function baryOnTriangle(mesh: MeshData, t: number, px: number, py: number, pz: number): { u: number; v: number; w: number; d2: number } {
  const { triVerts, vertProperties: vp, numProp: P } = mesh;
  const a = triVerts[t * 3] * P, b = triVerts[t * 3 + 1] * P, c = triVerts[t * 3 + 2] * P;
  const ax = vp[a], ay = vp[a + 1], az = vp[a + 2];
  const abx = vp[b] - ax, aby = vp[b + 1] - ay, abz = vp[b + 2] - az;
  const acx = vp[c] - ax, acy = vp[c + 1] - ay, acz = vp[c + 2] - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  // Ericson, Real-Time Collision Detection §5.1.5 — closest point by region.
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  let v: number, w: number;
  if (d1 <= 0 && d2 <= 0) { v = 0; w = 0; }
  else {
    const bpx = px - vp[b], bpy = py - vp[b + 1], bpz = pz - vp[b + 2];
    const d3 = abx * bpx + aby * bpy + abz * bpz;
    const d4 = acx * bpx + acy * bpy + acz * bpz;
    const cpx = px - vp[c], cpy = py - vp[c + 1], cpz = pz - vp[c + 2];
    const d5 = abx * cpx + aby * cpy + abz * cpz;
    const d6 = acx * cpx + acy * cpy + acz * cpz;
    const vc = d1 * d4 - d3 * d2;
    const vb = d5 * d2 - d1 * d6;
    const va = d3 * d6 - d5 * d4;
    if (d3 >= 0 && d4 <= d3) { v = 1; w = 0; }
    else if (vc <= 0 && d1 >= 0 && d3 <= 0) { v = d1 / (d1 - d3); w = 0; }
    else if (d6 >= 0 && d5 <= d6) { v = 0; w = 1; }
    else if (vb <= 0 && d2 >= 0 && d6 <= 0) { v = 0; w = d2 / (d2 - d6); }
    else if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) { w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); v = 1 - w; }
    else { const den = 1 / (va + vb + vc); v = vb * den; w = vc * den; }
  }
  const qx = ax + abx * v + acx * w, qy = ay + aby * v + acy * w, qz = az + abz * v + acz * w;
  const dx = px - qx, dy = py - qy, dz = pz - qz;
  return { u: 1 - v - w, v, w, d2: dx * dx + dy * dy + dz * dz };
}
