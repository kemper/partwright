// `random-walker` — seeded part detection by diffusion (Lai et al. 2008,
// "Fast Mesh Segmentation using Random Walks"). It takes the same named seeds
// as `crease-watershed`, but instead of letting seeds race along cheapest
// paths it asks: starting from this triangle, which seed would a random walker
// reach first, when it is reluctant to cross creases?
//
// The triangles are nodes of the edge-adjacency graph. Each edge gets a
// weight w = exp(−β · d / d̄) · (edge length / centroid distance), where
// d = η (1 − cos θ) is the dihedral "dissimilarity" (η = 1 on concave folds /
// grooves, `convexFactor` on convex ridges) and d̄ its mean over the mesh — so
// β means the same thing on every model, and the length ratio keeps the walk
// roughly resolution-independent. For every label k we solve the Dirichlet
// problem L_uu x_k = b_k (seed triangles fixed to 1 for k, 0 for the other
// labels); x_k[t] is the probability a walker from t hits a k-seed first. A
// triangle takes the label of the largest probability.
//
// Why it is worth having next to the watershed: the result is a *harmonic*
// field, so a boundary is decided by the whole surrounding geometry rather
// than the cheapest single path. It pulls smoothly toward the strongest nearby
// fold instead of leaking through the first gap in a groove (a sleeve that the
// watershed lets run into the arm is reclaimed by the shirt), and the soft
// probabilities double as a smooth paint-clip field (`vertexCosts`).
//
// Cost control — the solve is the whole price, so it is kept lean for
// 500k-triangle scans: Jacobi-preconditioned conjugate gradient on a
// fixed-width (ELLPACK) table over only the unknown triangles, numbered in
// breadth-first order for cache locality, warm-started from a hybrid
// crease-watershed labelling. The warm start makes a truncated solve still
// sensible (it only has to *correct* the watershed, and the iteration cap
// bounds the time) and supplies reachability: triangles in a seedless piece
// are dropped from the system, which keeps it non-singular.

import { AbortedError, growFromSeeds } from './growth';
import { resolveSeeds } from './detectors';
import { absorbSmallRegions, adjacencyFromPairs } from '../geometry/triSetOps';
import type { DetectorResult, MeshFeatures, PartDetector, SegMesh, VertexCostField } from './types';

/** Relative-residual stopping tolerance of the fine conjugate-gradient solve. */
const CG_TOLERANCE = 1e-4;
/** Check for cancellation / report progress every this many CG iterations. */
const CG_REPORT_EVERY = 25;
/** Edge weights never drop below this, so a very sharp groove weakens the
 *  coupling without disconnecting (and ill-conditioning) the system. */
const MIN_EDGE_WEIGHT = 1e-6;

/** Per-edge diffusion weights (see header). */
function edgeWeights(f: MeshFeatures, beta: number, convexFactor: number): Float64Array {
  const E = f.edgeA.length;
  const d = new Float64Array(E);
  let sum = 0;
  for (let e = 0; e < E; e++) {
    const eta = f.concave[e] ? 1 : convexFactor;
    const cosT = Math.cos(f.dihedralDeg[e] * (Math.PI / 180));
    d[e] = eta * (1 - cosT);
    sum += d[e];
  }
  const mean = Math.max(E ? sum / E : 0, 1e-12);
  const w = d; // in place
  for (let e = 0; e < E; e++) {
    w[e] = Math.max(MIN_EDGE_WEIGHT, Math.exp(-beta * d[e] / mean));
    // Cotangent-like geometric factor: longer shared edges conduct more, and
    // far-apart centroids conduct less.
    w[e] *= f.edgeLen[e] / Math.max(f.centroidDist[e], 1e-12);
  }
  return w;
}

/** A symmetric positive-definite system A = diag − W in fixed-width
 *  (ELLPACK) layout: row i's neighbours are `nbr[i*width ..]` with weights
 *  `w[...]` (padding points at the row itself with weight 0). */
interface Laplacian {
  m: number;
  width: number;
  nbr: Int32Array;
  w: Float64Array;
  /** Weighted degree, including edges to pinned triangles / other rows' fixed
   *  boundary, i.e. the diagonal of A. */
  diag: Float64Array;
}

/** The fine system over the free triangles, plus what ties it to the mesh. */
interface FineSystem extends Laplacian {
  /** Triangle index of each unknown. */
  tri: Int32Array;
  /** Edges from an unknown to a seed triangle: unknown index, its label, weight. */
  seedEdgeU: Int32Array;
  seedEdgeLabel: Int32Array;
  seedEdgeW: Float64Array;
}

function buildFineSystem(
  f: MeshFeatures, ew: Float64Array, free: Uint8Array, seedLabelOf: Int32Array,
): FineSystem {
  const n = f.triCount;
  const idx = new Int32Array(n).fill(-1);
  let m = 0;
  for (let t = 0; t < n; t++) if (free[t]) m++;
  // Number the unknowns in breadth-first order. Scan meshes list triangles in
  // arbitrary order, which makes neighbour gathers cache-hostile; BFS order
  // keeps a triangle's neighbours a few rows away (and gives the aggregation
  // below contiguous regions for free).
  const tri = new Int32Array(m);
  m = 0;
  for (let s = 0; s < n; s++) {
    if (!free[s] || idx[s] >= 0) continue;
    let head = m;
    idx[s] = m; tri[m++] = s;
    while (head < m) {
      const t = tri[head++];
      for (let j = f.adjStart[t]; j < f.adjStart[t + 1]; j++) {
        const e = f.adjPair[j];
        const o = f.edgeA[e] === t ? f.edgeB[e] : f.edgeA[e];
        if (free[o] && idx[o] < 0) { idx[o] = m; tri[m++] = o; }
      }
    }
  }
  let width = 1, seedEdges = 0;
  for (let i = 0; i < m; i++) {
    const t = tri[i];
    let c = 0;
    for (let j = f.adjStart[t]; j < f.adjStart[t + 1]; j++) {
      const e = f.adjPair[j];
      const o = f.edgeA[e] === t ? f.edgeB[e] : f.edgeA[e];
      if (idx[o] >= 0) c++; else if (seedLabelOf[o] >= 0) seedEdges++;
    }
    if (c > width) width = c;
  }
  const nbr = new Int32Array(m * width);
  const w = new Float64Array(m * width);
  const diag = new Float64Array(m);
  const seedEdgeU = new Int32Array(seedEdges);
  const seedEdgeLabel = new Int32Array(seedEdges);
  const seedEdgeW = new Float64Array(seedEdges);
  let se = 0;
  for (let i = 0; i < m; i++) {
    const t = tri[i];
    let c = 0;
    for (let j = f.adjStart[t]; j < f.adjStart[t + 1]; j++) {
      const e = f.adjPair[j];
      const o = f.edgeA[e] === t ? f.edgeB[e] : f.edgeA[e];
      if (idx[o] >= 0) { nbr[i * width + c] = idx[o]; w[i * width + c] = ew[e]; c++; diag[i] += ew[e]; }
      else if (seedLabelOf[o] >= 0) {
        seedEdgeU[se] = i; seedEdgeLabel[se] = seedLabelOf[o]; seedEdgeW[se] = ew[e]; se++;
        diag[i] += ew[e];
      }
    }
    for (; c < width; c++) nbr[i * width + c] = i; // padding: weight 0
  }
  return { m, width, nbr, w, diag, tri, seedEdgeU, seedEdgeLabel, seedEdgeW };
}

/**
 * Jacobi-preconditioned conjugate gradient for A x = b, starting from the
 * given `x` (overwritten with the result). Stops at relative residual `tol`
 * or `maxIterations`. `tick` is called every `CG_REPORT_EVERY` iterations
 * (fraction of the cap) and may throw to cancel.
 */
function conjugateGradient(
  A: Laplacian, b: Float64Array, x: Float64Array, tol: number, maxIterations: number,
  tick?: (frac: number) => void,
): { iterations: number; residual: number } {
  const { m, width, nbr, w, diag } = A;
  const r = new Float64Array(m), p = new Float64Array(m), Ap = new Float64Array(m);
  let bb = 0;
  for (let i = 0; i < m; i++) bb += b[i] * b[i];
  const normB = Math.sqrt(bb);
  if (normB === 0) { x.fill(0); return { iterations: 0, residual: 0 }; }
  const fast3 = width === 3;
  // r = b − A x ;  p = M⁻¹ r
  let rz = 0, rr = 0;
  for (let i = 0; i < m; i++) {
    let s = diag[i] * x[i];
    for (let j = i * width; j < (i + 1) * width; j++) s -= w[j] * x[nbr[j]];
    const ri = b[i] - s;
    r[i] = ri; p[i] = ri / diag[i];
    rz += ri * p[i]; rr += ri * ri;
  }
  let it = 0;
  let rel = Math.sqrt(rr) / normB;
  while (it < maxIterations && rel > tol) {
    let pAp = 0;
    if (fast3) {
      for (let i = 0, j = 0; i < m; i++, j += 3) {
        const pi = p[i];
        const s = diag[i] * pi - w[j] * p[nbr[j]] - w[j + 1] * p[nbr[j + 1]] - w[j + 2] * p[nbr[j + 2]];
        Ap[i] = s; pAp += pi * s;
      }
    } else {
      for (let i = 0; i < m; i++) {
        let s = diag[i] * p[i];
        for (let j = i * width; j < (i + 1) * width; j++) s -= w[j] * p[nbr[j]];
        Ap[i] = s; pAp += p[i] * s;
      }
    }
    if (!(pAp > 0)) break;
    const alpha = rz / pAp;
    let rzNew = 0;
    rr = 0;
    for (let i = 0; i < m; i++) {
      x[i] += alpha * p[i];
      const ri = r[i] - alpha * Ap[i];
      r[i] = ri;
      rzNew += ri * ri / diag[i]; rr += ri * ri;
    }
    const bet = rzNew / rz;
    rz = rzNew;
    for (let i = 0; i < m; i++) p[i] = r[i] / diag[i] + bet * p[i];
    it++;
    rel = Math.sqrt(rr) / normB;
    if (tick && it % CG_REPORT_EVERY === 0) tick(it / maxIterations);
  }
  return { iterations: it, residual: rel };
}

export const randomWalkerDetector: PartDetector = {
  id: 'random-walker',
  name: 'Random walker (seeded)',
  description: 'Same named seeds as the crease watershed, but boundaries come from a diffusion: every triangle takes the seed a random walker (reluctant to cross creases) would most likely reach first. The decision uses the whole surrounding geometry, so boundaries settle smoothly on the strongest nearby fold instead of leaking through the first gap in a groove, and the soft probabilities give a smooth paint-clip field.',
  bestFor: 'Seeded splits where grooves are faint, broken or noisy (scans, hand-sculpted seams) and you want smooth, leak-resistant boundaries rather than jagged ones. Slower than the watershed on huge meshes.',
  seeds: 'required',
  params: [
    {
      key: 'beta', label: 'Crease sharpness', type: 'number', default: 3, min: 0.1, max: 50, step: 0.1,
      hint: 'How strongly creases block the walk. Higher = boundaries cling to grooves (and follow them more raggedly); lower = smoother, more distance-driven splits.',
    },
    {
      key: 'convexFactor', label: 'Ridge weight', type: 'number', default: 0.2, min: 0, max: 1, step: 0.05,
      hint: 'How much convex ridges block the walk compared with concave grooves (1 = equally). 0 ignores ridges entirely.',
    },
    {
      key: 'minIslandPct', label: 'Min island (% area)', type: 'number', default: 0.05, min: 0, max: 5, step: 0.01,
      hint: 'Disconnected islands of a label smaller than this share of the surface are absorbed into their neighbour. Islands holding a seed are always kept.',
    },
    {
      key: 'maxIterations', label: 'Max solver iterations', type: 'integer', default: 300, min: 20, max: 3000, step: 10,
      hint: 'Conjugate-gradient iteration cap per label. The solve starts from a watershed labelling, so a truncated solve is still sensible; lower it (e.g. 80) for a much faster, rougher answer on huge scans (long-range leaks may survive), raise it for a more fully converged diffusion (time grows linearly; ~7 ms per iteration per label at 460k triangles).',
    },
  ],
  presets: [
    { name: 'Balanced', params: {} },
    { name: 'Clingy edges', params: { beta: 10 } },
    { name: 'Smooth edges', params: { beta: 1 } },
    { name: 'Ignore ridges', params: { convexFactor: 0 } },
    { name: 'Ridges count too', params: { convexFactor: 0.6 } },
    { name: 'Fast solve', params: { maxIterations: 80 } },
    { name: 'Precise solve', params: { maxIterations: 1000 } },
  ],
  run(mesh: SegMesh, f: MeshFeatures, ctx): DetectorResult {
    const t0 = performance.now();
    const { names, seedTris, seedLabels } = resolveSeeds(f, ctx.seeds, ctx.allow, 'drop');
    if (names.length === 0) {
      throw new Error(ctx.allow
        ? 'No seeds fall inside the area being detected (focused part / unlocked parts) — place a seed there.'
        : 'random-walker needs at least one seed ({ label, point }).');
    }
    const K = names.length;
    const n = f.triCount;
    const beta = Number(ctx.params.beta);
    const convexFactor = Number(ctx.params.convexFactor);
    const maxIterations = Number(ctx.params.maxIterations);
    const abortCheck = (): void => { if (ctx.signal?.aborted) throw new AbortedError(); };

    // A triangle seeded by several labels: the first wins.
    const seedLabelOf = new Int32Array(n).fill(-1);
    for (let i = 0; i < seedTris.length; i++) {
      const t = seedTris[i];
      if (seedLabelOf[t] < 0) seedLabelOf[t] = seedLabels[i];
    }

    // Reachability: the watershed labels exactly the triangles connected to a
    // seed through allowed triangles. Everything else stays −1.
    ctx.progress?.(0, 'Finding reachable surface…');
    const warm = growFromSeeds(f, seedTris, seedLabels, {
      growth: 'hybrid', creaseQuantumDeg: 5, creaseWeight: 1,
      allow: ctx.allow, signal: ctx.signal,
      progress: (frac) => ctx.progress?.(0.05 * frac, 'Finding reachable surface…'),
    }).triLabel;
    const free = new Uint8Array(n);
    for (let t = 0; t < n; t++) if (warm[t] >= 0 && seedLabelOf[t] < 0) free[t] = 1;

    const sys = buildFineSystem(f, edgeWeights(f, beta, convexFactor), free, seedLabelOf);
    const { m, tri } = sys;

    // Probability field, one Float32Array per label (seeds pinned to 1 / 0).
    const prob: Float32Array[] = [];
    for (let k = 0; k < K; k++) prob.push(new Float32Array(n));
    for (let t = 0; t < n; t++) if (seedLabelOf[t] >= 0) prob[seedLabelOf[t]][t] = 1;

    const x = new Float64Array(m), b = new Float64Array(m);
    const iterations: number[] = [];
    const residuals: number[] = [];
    for (let k = 0; k < K; k++) {
      abortCheck();
      const base = 0.1 + 0.85 * (k / K);
      const span = 0.85 / K;
      const msg = `Solving ${names[k]} (${k + 1}/${K})`;
      ctx.progress?.(base, msg);
      b.fill(0);
      let any = false;
      for (let s = 0; s < sys.seedEdgeU.length; s++) if (sys.seedEdgeLabel[s] === k) { b[sys.seedEdgeU[s]] += sys.seedEdgeW[s]; any = true; }
      if (!any) {
        // No unknown touches a k-seed: the harmonic solution is identically 0.
        iterations.push(0); residuals.push(0);
        continue;
      }
      for (let i = 0; i < m; i++) x[i] = warm[tri[i]] === k ? 1 : 0;
      const res = conjugateGradient(sys, b, x, CG_TOLERANCE, maxIterations, (frac) => {
        abortCheck();
        ctx.progress?.(base + span * frac, msg);
      });
      const pk = prob[k];
      for (let i = 0; i < m; i++) pk[tri[i]] = x[i] < 0 ? 0 : x[i] > 1 ? 1 : x[i];
      iterations.push(res.iterations); residuals.push(+res.residual.toExponential(2));
    }

    // Normalise (a truncated solve doesn't sum to 1) and take the argmax.
    ctx.progress?.(0.95, 'Assigning…');
    const triPart = new Int32Array(n).fill(-1);
    for (let t = 0; t < n; t++) {
      if (warm[t] < 0) continue;
      let sum = 0, best = -1, bestP = -1;
      for (let k = 0; k < K; k++) {
        const v = prob[k][t];
        sum += v;
        if (v > bestP) { bestP = v; best = k; }
      }
      if (sum > 0) for (let k = 0; k < K; k++) prob[k][t] /= sum;
      triPart[t] = best;
    }

    const minArea = (Number(ctx.params.minIslandPct) / 100) * f.totalArea;
    if (minArea > 0) {
      // Seed triangles weigh Infinity so an island holding a seed (a user's
      // deliberately tiny part) is never absorbed.
      const weight = new Float64Array(n);
      for (let t = 0; t < n; t++) weight[t] = seedLabelOf[t] >= 0 ? Infinity : f.triArea[t];
      absorbSmallRegions(triPart, adjacencyFromPairs(n, f.edgeA, f.edgeB), weight, minArea);
      // Absorption may pull unassigned or outside triangles in — keep the
      // allow contract and the unreachable triangles unassigned.
      for (let t = 0; t < n; t++) if ((ctx.allow && !ctx.allow[t]) || warm[t] < 0) triPart[t] = -1;
    }

    let unreached = 0;
    for (let t = 0; t < n; t++) if (triPart[t] < 0 && (!ctx.allow || ctx.allow[t])) unreached++;

    return {
      triPart,
      partNames: names,
      vertexCosts: probabilityCostField(mesh, triPart, prob, K),
      diagnostics: {
        seedCount: seedTris.length, labels: K, iterations, residuals,
        unreachedTriangles: unreached, ms: Math.round(performance.now() - t0),
      },
    };
  },
};

/**
 * Per-vertex best-two (label, 1 − p) where p is the label's probability
 * averaged over the vertex's incident assigned triangles. Candidates are the
 * labels that actually occur on those triangles, so (as with the watershed's
 * field) a vertex only carries a second label where two parts meet and a
 * paint-time clip can't stray from the triangle-level boundary.
 */
function probabilityCostField(mesh: SegMesh, triPart: Int32Array, prob: Float32Array[], K: number): VertexCostField {
  const nVert = mesh.positions.length / 3;
  const tv = mesh.triVerts;
  const nTri = triPart.length;
  const label1 = new Int32Array(nVert).fill(-1);
  const label2 = new Int32Array(nVert).fill(-1);
  const cost1 = new Float32Array(nVert).fill(Infinity);
  const cost2 = new Float32Array(nVert).fill(Infinity);
  // Vertex → incident assigned triangles (CSR).
  const vStart = new Int32Array(nVert + 1);
  for (let t = 0; t < nTri; t++) if (triPart[t] >= 0) for (let c = 0; c < 3; c++) vStart[tv[t * 3 + c] + 1]++;
  for (let v = 0; v < nVert; v++) vStart[v + 1] += vStart[v];
  const vTri = new Int32Array(vStart[nVert]);
  const fill = vStart.slice(0, nVert);
  for (let t = 0; t < nTri; t++) if (triPart[t] >= 0) for (let c = 0; c < 3; c++) vTri[fill[tv[t * 3 + c]]++] = t;
  const present = new Uint8Array(K);
  for (let v = 0; v < nVert; v++) {
    const a = vStart[v], z = vStart[v + 1];
    if (a === z) continue;
    for (let j = a; j < z; j++) present[triPart[vTri[j]]] = 1;
    // Seen labels, ordered by mean probability.
    let b1 = -1, b2 = -1, s1 = -1, s2 = -1;
    for (let k = 0; k < K; k++) {
      if (!present[k]) continue;
      let s = 0;
      for (let j = a; j < z; j++) s += prob[k][vTri[j]];
      s /= z - a;
      if (s > s1) { b2 = b1; s2 = s1; b1 = k; s1 = s; }
      else if (s > s2) { b2 = k; s2 = s; }
    }
    for (let j = a; j < z; j++) present[triPart[vTri[j]]] = 0;
    label1[v] = b1; cost1[v] = 1 - s1;
    if (b2 >= 0) { label2[v] = b2; cost2[v] = 1 - s2; }
  }
  return { label1, cost1, label2, cost2 };
}
