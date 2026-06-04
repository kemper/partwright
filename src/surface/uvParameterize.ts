// Alternative UV parameterizations for surface texturing.
//
// The knit displacement loop tiles a stitch pattern in a 2D UV plane; the
// *quality* of the result is dominated by how that UV plane is laid out over
// the surface. This module offers three strategies behind one dispatcher:
//
//   - 'bfs'      — triangle-unfolding (uvUnwrap.ts). Fast, but accumulates
//                  angular drift on curved surfaces and has a hard wrap seam.
//   - 'lscm'     — Least-Squares Conformal Maps (Lévy et al. 2002). Solves a
//                  sparse least-squares system for an angle-preserving map with
//                  two pinned vertices. Low local distortion; the global scale
//                  varies (you can't flatten a closed surface without cuts) but
//                  stitch *shape* stays clean.
//   - 'harmonic' — a harmonic scalar field drives the row ("latitude")
//                  direction: solve the cotangent-Laplace equation with two
//                  pole constraints so rows follow smooth level sets with no
//                  BFS drift. Columns use the azimuth around the pole axis.
//
// All three return per-vertex UV in *world units* (so stitchWidth/stitchHeight
// map to the same physical stitch size regardless of algorithm).
//
// The solvers (conjugate gradient / CGLS) are matrix-free and run on the CPU.
// Their tolerance and iteration caps are structural numerical-method constants,
// not product tuning knobs, so they live here rather than in appConfig.
//
// Pure logic (no DOM/WASM) → unit-tested in the vitest tier.

import { bfsUnwrapMesh, type UVResult } from './uvUnwrap';

export type UVAlgorithm = 'bfs' | 'lscm' | 'harmonic';

/** Convergence tolerance on the relative residual norm for the iterative solvers. */
const SOLVER_TOL = 1e-5;
/** Iteration cap for the LSCM least-squares solve (CGLS). */
const LSCM_MAX_ITER = 600;
/** Iteration cap for the harmonic-field Laplace solve (CG). */
const HARMONIC_MAX_ITER = 800;

// --- Dispatcher ---------------------------------------------------------------

/** Unwrap a mesh to per-vertex UV using the requested algorithm. */
export function unwrapMesh(
  positions: Float32Array,
  triVerts: Uint32Array,
  algorithm: UVAlgorithm = 'bfs',
): UVResult {
  switch (algorithm) {
    case 'lscm':     return lscmUnwrapMesh(positions, triVerts);
    case 'harmonic': return harmonicUnwrapMesh(positions, triVerts);
    case 'bfs':
    default:         return bfsUnwrapMesh(positions, triVerts);
  }
}

// --- Iterative solvers (matrix-free) ------------------------------------------

/**
 * Conjugate gradient for a symmetric positive-definite operator A (matrix-free).
 * `applyA(x, out)` must write A·x into `out`. Solves A·x = b in place on `x`.
 */
function conjugateGradient(
  applyA: (x: Float64Array, out: Float64Array) => void,
  b: Float64Array,
  x: Float64Array,
  maxIter: number,
  tol: number,
): void {
  const n = b.length;
  const r = new Float64Array(n);
  const p = new Float64Array(n);
  const Ap = new Float64Array(n);

  applyA(x, Ap);
  for (let i = 0; i < n; i++) { r[i] = b[i] - Ap[i]; p[i] = r[i]; }

  let rsold = dot(r, r);
  const bnorm = Math.sqrt(dot(b, b)) || 1;
  if (Math.sqrt(rsold) / bnorm < tol) return;

  for (let k = 0; k < maxIter; k++) {
    applyA(p, Ap);
    const pAp = dot(p, Ap);
    if (pAp <= 1e-300) break;
    const alpha = rsold / pAp;
    for (let i = 0; i < n; i++) { x[i] += alpha * p[i]; r[i] -= alpha * Ap[i]; }
    const rsnew = dot(r, r);
    if (Math.sqrt(rsnew) / bnorm < tol) break;
    const beta = rsnew / rsold;
    for (let i = 0; i < n; i++) p[i] = r[i] + beta * p[i];
    rsold = rsnew;
  }
}

/**
 * Conjugate Gradient Least Squares — solves min‖A·x − b‖ for a non-square A
 * given matrix-free `applyA` (x → out, length m) and `applyAT` (y → out,
 * length n). Numerically stabler than forming the normal equations.
 */
function cgls(
  applyA: (x: Float64Array, out: Float64Array) => void,
  applyAT: (y: Float64Array, out: Float64Array) => void,
  b: Float64Array,
  n: number,
  maxIter: number,
  tol: number,
): Float64Array {
  const m = b.length;
  const x = new Float64Array(n);
  const r = new Float64Array(m);
  const s = new Float64Array(n);
  const p = new Float64Array(n);
  const q = new Float64Array(m);

  for (let i = 0; i < m; i++) r[i] = b[i];   // r = b − A·0
  applyAT(r, s);
  for (let i = 0; i < n; i++) p[i] = s[i];

  let gamma = dot(s, s);
  const g0 = Math.sqrt(gamma) || 1;
  if (Math.sqrt(gamma) / g0 < tol) return x;

  for (let k = 0; k < maxIter; k++) {
    applyA(p, q);
    const qq = dot(q, q);
    if (qq <= 1e-300) break;
    const alpha = gamma / qq;
    for (let i = 0; i < n; i++) x[i] += alpha * p[i];
    for (let i = 0; i < m; i++) r[i] -= alpha * q[i];
    applyAT(r, s);
    const gammaNew = dot(s, s);
    if (Math.sqrt(gammaNew) / g0 < tol) break;
    const beta = gammaNew / gamma;
    for (let i = 0; i < n; i++) p[i] = s[i] + beta * p[i];
    gamma = gammaNew;
  }
  return x;
}

function dot(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

// --- Cotangent Laplacian ------------------------------------------------------

interface CotanLaplacian {
  /** CSR-style off-diagonal columns per row. */
  rowStart: Int32Array;
  colIdx: Int32Array;
  weight: Float64Array;
  /** Diagonal = sum of incident edge weights. */
  diag: Float64Array;
}

/**
 * Build the cotangent-weighted graph Laplacian. Edge weight w_ij = (cot α +
 * cot β)/2 with α,β the angles opposite edge (i,j). Weights are clamped to ≥0
 * to keep the operator positive-semidefinite on near-degenerate triangles.
 */
function buildCotanLaplacian(positions: Float32Array, triVerts: Uint32Array): CotanLaplacian {
  const numVert = positions.length / 3;
  const numTri = triVerts.length / 3;
  const acc = new Map<number, number>();   // key i*numVert+j (i<j) → weight

  const cot = (ax: number, ay: number, az: number, bx: number, by: number, bz: number): number => {
    // cot of angle between vectors a and b = (a·b) / |a×b|.
    const d = ax * bx + ay * by + az * bz;
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    const cross = Math.hypot(cx, cy, cz);
    return cross < 1e-12 ? 0 : d / cross;
  };

  for (let t = 0; t < numTri; t++) {
    const v = [triVerts[t * 3], triVerts[t * 3 + 1], triVerts[t * 3 + 2]];
    for (let k = 0; k < 3; k++) {
      const i = v[(k + 1) % 3], j = v[(k + 2) % 3], o = v[k];   // edge (i,j), opposite vertex o
      // vectors from o to i and o to j
      const oix = positions[i * 3] - positions[o * 3];
      const oiy = positions[i * 3 + 1] - positions[o * 3 + 1];
      const oiz = positions[i * 3 + 2] - positions[o * 3 + 2];
      const ojx = positions[j * 3] - positions[o * 3];
      const ojy = positions[j * 3 + 1] - positions[o * 3 + 1];
      const ojz = positions[j * 3 + 2] - positions[o * 3 + 2];
      const w = 0.5 * Math.max(0, cot(oix, oiy, oiz, ojx, ojy, ojz));
      const a = Math.min(i, j), b = Math.max(i, j);
      const key = a * numVert + b;
      acc.set(key, (acc.get(key) ?? 0) + w);
    }
  }

  // Flatten to CSR.
  const adj: Array<Array<[number, number]>> = Array.from({ length: numVert }, () => []);
  for (const [key, w] of acc) {
    const a = Math.floor(key / numVert), b = key % numVert;
    adj[a].push([b, w]);
    adj[b].push([a, w]);
  }
  const rowStart = new Int32Array(numVert + 1);
  let nnz = 0;
  for (let i = 0; i < numVert; i++) { rowStart[i] = nnz; nnz += adj[i].length; }
  rowStart[numVert] = nnz;
  const colIdx = new Int32Array(nnz);
  const weight = new Float64Array(nnz);
  const diag = new Float64Array(numVert);
  let p = 0;
  for (let i = 0; i < numVert; i++) {
    let d = 0;
    for (const [j, w] of adj[i]) { colIdx[p] = j; weight[p] = w; d += w; p++; }
    diag[i] = d;
  }
  return { rowStart, colIdx, weight, diag };
}

// --- Harmonic field unwrap ----------------------------------------------------

/**
 * Row coordinate from a harmonic field between two poles; column coordinate
 * from the azimuth around the pole axis. The harmonic V follows smooth level
 * sets over the whole surface (no BFS drift); the azimuthal U has a single
 * clean meridian seam (expected for any cylindrical map).
 */
export function harmonicUnwrapMesh(positions: Float32Array, triVerts: Uint32Array): UVResult {
  const numVert = positions.length / 3;
  const uvs = new Float32Array(numVert * 2);
  if (numVert === 0 || triVerts.length === 0) return { uvs };

  // Pole axis = longest bounding-box axis. Poles = extreme vertices along it.
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < numVert; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const ext = [maxX - minX, maxY - minY, maxZ - minZ];
  const axis = ext[0] >= ext[1] && ext[0] >= ext[2] ? 0 : ext[1] >= ext[2] ? 1 : 2;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;

  let srcV = 0, sinkV = 0, lo = Infinity, hi = -Infinity;
  for (let i = 0; i < numVert; i++) {
    const a = positions[i * 3 + axis];
    if (a < lo) { lo = a; srcV = i; }
    if (a > hi) { hi = a; sinkV = i; }
  }
  const axisLen = hi - lo || 1;

  // Solve the cotangent-Laplace equation φ with φ(src)=0, φ(sink)=1.
  const L = buildCotanLaplacian(positions, triVerts);
  const fixed = new Uint8Array(numVert);
  const fixedVal = new Float64Array(numVert);
  fixed[srcV] = 1;  fixedVal[srcV] = 0;
  fixed[sinkV] = 1; fixedVal[sinkV] = 1;

  // L_ff operator: (L·x) on free rows, treating fixed entries of the input as 0.
  const applyLff = (xFree: Float64Array, out: Float64Array): void => {
    // scatter free values into a full vector (fixed = 0)
    const full = scatterFree(xFree, fixed, numVert);
    for (let i = 0, f = 0; i < numVert; i++) {
      if (fixed[i]) continue;
      let s = L.diag[i] * full[i];
      for (let p = L.rowStart[i]; p < L.rowStart[i + 1]; p++) s -= L.weight[p] * full[L.colIdx[p]];
      out[f++] = s;
    }
  };

  // RHS b = −L applied to the fixed-only vector, read on free rows.
  const nFree = numVert - 2;
  const b = new Float64Array(nFree);
  {
    const full = new Float64Array(numVert);
    for (let i = 0; i < numVert; i++) if (fixed[i]) full[i] = fixedVal[i];
    for (let i = 0, f = 0; i < numVert; i++) {
      if (fixed[i]) continue;
      let s = L.diag[i] * full[i];
      for (let p = L.rowStart[i]; p < L.rowStart[i + 1]; p++) s -= L.weight[p] * full[L.colIdx[p]];
      b[f++] = -s;
    }
  }

  const phiFree = new Float64Array(nFree);
  conjugateGradient(applyLff, b, phiFree, HARMONIC_MAX_ITER, SOLVER_TOL);
  const phi = scatterFree(phiFree, fixed, numVert);
  phi[srcV] = 0; phi[sinkV] = 1;

  // Build a stable orthonormal basis (e1,e2) in the plane perpendicular to the axis.
  const ax = [0, 0, 0]; ax[axis] = 1;
  const ref = axis === 0 ? [0, 1, 0] : [1, 0, 0];
  const e1 = normalize(cross(ax, ref));
  const e2 = normalize(cross(ax, e1));

  // Mean radius to scale azimuth into world units (so U spacing ≈ stitch size).
  let meanR = 0;
  for (let i = 0; i < numVert; i++) {
    const rx = positions[i * 3] - cx, ry = positions[i * 3 + 1] - cy, rz = positions[i * 3 + 2] - cz;
    const a = rx * e1[0] + ry * e1[1] + rz * e1[2];
    const bb = rx * e2[0] + ry * e2[1] + rz * e2[2];
    meanR += Math.hypot(a, bb);
  }
  meanR = (meanR / numVert) || 1;

  for (let i = 0; i < numVert; i++) {
    const rx = positions[i * 3] - cx, ry = positions[i * 3 + 1] - cy, rz = positions[i * 3 + 2] - cz;
    const a = rx * e1[0] + ry * e1[1] + rz * e1[2];
    const bb = rx * e2[0] + ry * e2[1] + rz * e2[2];
    const theta = Math.atan2(bb, a);          // [−π, π]
    uvs[i * 2] = theta * meanR;                // U: world-unit azimuth
    uvs[i * 2 + 1] = phi[i] * axisLen;         // V: world-unit harmonic latitude
  }
  return { uvs };
}

// --- LSCM unwrap --------------------------------------------------------------

/**
 * Least-Squares Conformal Map with two pinned vertices (free-boundary LSCM).
 * Builds the per-triangle conformality equations and solves the resulting
 * least-squares system with CGLS. Pins the two extreme vertices along the
 * longest axis to world-unit positions so UV scale tracks physical size.
 */
export function lscmUnwrapMesh(positions: Float32Array, triVerts: Uint32Array): UVResult {
  const numVert = positions.length / 3;
  const numTri = triVerts.length / 3;
  const uvs = new Float32Array(numVert * 2);
  if (numVert < 3 || numTri === 0) return { uvs };

  // Pick two pins: extreme vertices along the longest bounding-box axis.
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < numVert; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const ext = [maxX - minX, maxY - minY, maxZ - minZ];
  const axis = ext[0] >= ext[1] && ext[0] >= ext[2] ? 0 : ext[1] >= ext[2] ? 1 : 2;
  let pinA = 0, pinB = 0, lo = Infinity, hi = -Infinity;
  for (let i = 0; i < numVert; i++) {
    const a = positions[i * 3 + axis];
    if (a < lo) { lo = a; pinA = i; }
    if (a > hi) { hi = a; pinB = i; }
  }
  if (pinA === pinB) pinB = (pinA + 1) % numVert;
  const pinDist = Math.hypot(
    positions[pinA * 3] - positions[pinB * 3],
    positions[pinA * 3 + 1] - positions[pinB * 3 + 1],
    positions[pinA * 3 + 2] - positions[pinB * 3 + 2],
  ) || 1;

  // Pinned UVs: A→(0,0), B→(pinDist,0).
  const fixed = new Uint8Array(numVert);
  const pinU = new Float64Array(numVert);
  const pinV = new Float64Array(numVert);
  fixed[pinA] = 1; pinU[pinA] = 0;       pinV[pinA] = 0;
  fixed[pinB] = 1; pinU[pinB] = pinDist; pinV[pinB] = 0;

  // Map vertex → free index (its u is freeIdx, its v is nFree+freeIdx).
  const freeIdx = new Int32Array(numVert).fill(-1);
  let nFree = 0;
  for (let i = 0; i < numVert; i++) if (!fixed[i]) freeIdx[i] = nFree++;
  const nUnknown = 2 * nFree;

  // Per-triangle complex coefficients W_j (real, imag) for the 3 vertices,
  // scaled by 1/sqrt(2·area). Stored flat: 6 floats per triangle.
  const wr = new Float64Array(numTri * 3);
  const wi = new Float64Array(numTri * 3);
  for (let t = 0; t < numTri; t++) {
    const a = triVerts[t * 3], b = triVerts[t * 3 + 1], c = triVerts[t * 3 + 2];
    // Local isometric 2D coords.
    const e1x = positions[b * 3] - positions[a * 3];
    const e1y = positions[b * 3 + 1] - positions[a * 3 + 1];
    const e1z = positions[b * 3 + 2] - positions[a * 3 + 2];
    const e2x = positions[c * 3] - positions[a * 3];
    const e2y = positions[c * 3 + 1] - positions[a * 3 + 1];
    const e2z = positions[c * 3 + 2] - positions[a * 3 + 2];
    const len1 = Math.hypot(e1x, e1y, e1z) || 1e-9;
    const xax = [e1x / len1, e1y / len1, e1z / len1];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const nlen = Math.hypot(nx, ny, nz);
    const area = 0.5 * nlen;
    const yax = normalize([ny * xax[2] - nz * xax[1], nz * xax[0] - nx * xax[2], nx * xax[1] - ny * xax[0]]);
    const x0 = 0, y0 = 0;
    const x1 = len1, y1 = 0;
    const x2 = e2x * xax[0] + e2y * xax[1] + e2z * xax[2];
    const y2 = e2x * yax[0] + e2y * yax[1] + e2z * yax[2];
    const scale = 1 / Math.sqrt(2 * Math.max(area, 1e-12));
    // W_j = edge opposite vertex j (complex), scaled.
    wr[t * 3]     = (x2 - x1) * scale; wi[t * 3]     = (y2 - y1) * scale;
    wr[t * 3 + 1] = (x0 - x2) * scale; wi[t * 3 + 1] = (y0 - y2) * scale;
    wr[t * 3 + 2] = (x1 - x0) * scale; wi[t * 3 + 2] = (y1 - y0) * scale;
  }

  const tri = (t: number, k: number) => triVerts[t * 3 + k];

  // A·x → length 2·numTri (real rows [0,numTri), imag rows [numTri,2numTri)).
  const applyA = (x: Float64Array, out: Float64Array): void => {
    for (let t = 0; t < numTri; t++) {
      let re = 0, im = 0;
      for (let k = 0; k < 3; k++) {
        const v = tri(t, k);
        if (fixed[v]) continue;
        const u = x[freeIdx[v]];
        const vv = x[nFree + freeIdx[v]];
        const r = wr[t * 3 + k], i2 = wi[t * 3 + k];
        re += r * u - i2 * vv;
        im += i2 * u + r * vv;
      }
      out[t] = re;
      out[numTri + t] = im;
    }
  };

  // Aᵀ·y → length nUnknown.
  const applyAT = (y: Float64Array, out: Float64Array): void => {
    out.fill(0);
    for (let t = 0; t < numTri; t++) {
      const yr = y[t], yi = y[numTri + t];
      for (let k = 0; k < 3; k++) {
        const v = tri(t, k);
        if (fixed[v]) continue;
        const r = wr[t * 3 + k], i2 = wi[t * 3 + k];
        const fi = freeIdx[v];
        out[fi]         += r * yr + i2 * yi;
        out[nFree + fi] += -i2 * yr + r * yi;
      }
    }
  };

  // b = −(contribution of pinned vertices to each row).
  const b = new Float64Array(2 * numTri);
  for (let t = 0; t < numTri; t++) {
    let re = 0, im = 0;
    for (let k = 0; k < 3; k++) {
      const v = tri(t, k);
      if (!fixed[v]) continue;
      const r = wr[t * 3 + k], i2 = wi[t * 3 + k];
      re += r * pinU[v] - i2 * pinV[v];
      im += i2 * pinU[v] + r * pinV[v];
    }
    b[t] = -re;
    b[numTri + t] = -im;
  }

  const sol = cgls(applyA, applyAT, b, nUnknown, LSCM_MAX_ITER, SOLVER_TOL);

  for (let i = 0; i < numVert; i++) {
    if (fixed[i]) { uvs[i * 2] = pinU[i]; uvs[i * 2 + 1] = pinV[i]; }
    else { uvs[i * 2] = sol[freeIdx[i]]; uvs[i * 2 + 1] = sol[nFree + freeIdx[i]]; }
  }
  return { uvs };
}

// --- Small vector helpers -----------------------------------------------------

function scatterFree(xFree: Float64Array, fixed: Uint8Array, numVert: number): Float64Array {
  const full = new Float64Array(numVert);
  for (let i = 0, f = 0; i < numVert; i++) if (!fixed[i]) full[i] = xFree[f++];
  return full;
}

function cross(a: number[], b: number[]): number[] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(v: number[]): number[] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
