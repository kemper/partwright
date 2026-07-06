// Extract rigid-body invariants of a mesh: bbox, principal axes, and RANSAC
// primitive fits (sphere for socket cavities and ball ends). These are the
// scaffold the AI iterator reads before proposing a candidate.

import { meshBBox } from './stl.mjs';
import { samplePoints, makeRng } from './sampleMesh.mjs';

export function principalAxes(points) {
  const n = points.length / 3;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) {
    cx += points[i * 3]; cy += points[i * 3 + 1]; cz += points[i * 3 + 2];
  }
  cx /= n; cy /= n; cz /= n;
  let xx = 0, yy = 0, zz = 0, xy = 0, xz = 0, yz = 0;
  for (let i = 0; i < n; i++) {
    const dx = points[i * 3] - cx, dy = points[i * 3 + 1] - cy, dz = points[i * 3 + 2] - cz;
    xx += dx * dx; yy += dy * dy; zz += dz * dz;
    xy += dx * dy; xz += dx * dz; yz += dy * dz;
  }
  const cov = [
    [xx / n, xy / n, xz / n],
    [xy / n, yy / n, yz / n],
    [xz / n, yz / n, zz / n],
  ];
  const { values, vectors } = jacobiEigen(cov);
  return { center: [cx, cy, cz], eigenvalues: values, axes: vectors };
}

// Jacobi eigen-decomposition of a 3×3 symmetric matrix. Returns eigenvalues
// sorted descending with matching eigenvectors as an array of 3 unit vectors.
function jacobiEigen(a) {
  const A = [a[0].slice(), a[1].slice(), a[2].slice()];
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    const off =
      Math.abs(A[0][1]) + Math.abs(A[0][2]) + Math.abs(A[1][2]);
    if (off < 1e-12) break;
    for (let p = 0; p < 2; p++) {
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(A[p][q]) < 1e-14) continue;
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        let t;
        if (Math.abs(theta) > 1e14) t = 1 / (2 * theta);
        else {
          const sign = theta < 0 ? -1 : 1;
          t = sign / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        }
        const c = 1 / Math.sqrt(1 + t * t);
        const s = t * c;
        const apq = A[p][q];
        A[p][p] -= t * apq;
        A[q][q] += t * apq;
        A[p][q] = 0; A[q][p] = 0;
        for (let r = 0; r < 3; r++) {
          if (r !== p && r !== q) {
            const arp = A[r][p], arq = A[r][q];
            A[r][p] = c * arp - s * arq;
            A[p][r] = A[r][p];
            A[r][q] = s * arp + c * arq;
            A[q][r] = A[r][q];
          }
          const vrp = V[r][p], vrq = V[r][q];
          V[r][p] = c * vrp - s * vrq;
          V[r][q] = s * vrp + c * vrq;
        }
      }
    }
  }
  const idx = [0, 1, 2].sort((i, j) => A[j][j] - A[i][i]);
  const values = idx.map((i) => A[i][i]);
  const vectors = idx.map((i) => [V[0][i], V[1][i], V[2][i]]);
  return { values, vectors };
}

// Fit a sphere through 4 non-degenerate points by solving the linearized
// equation `x²+y²+z² = 2·cx·x + 2·cy·y + 2·cz·z + (r²−cx²−cy²−cz²)` as a
// 4×4 system. Returns null on degeneracy.
function fitSphere4(p0, p1, p2, p3) {
  const A = [];
  const b = [];
  for (const p of [p0, p1, p2, p3]) {
    A.push([2 * p[0], 2 * p[1], 2 * p[2], 1]);
    b.push(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]);
  }
  const x = solve4x4(A, b);
  if (!x) return null;
  const [cx, cy, cz, w] = x;
  const r2 = w + cx * cx + cy * cy + cz * cz;
  if (r2 <= 0) return null;
  return { center: [cx, cy, cz], radius: Math.sqrt(r2) };
}

function solve4x4(A, b) {
  const M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < 4; i++) {
    let piv = i;
    for (let k = i + 1; k < 4; k++) if (Math.abs(M[k][i]) > Math.abs(M[piv][i])) piv = k;
    if (Math.abs(M[piv][i]) < 1e-10) return null;
    if (piv !== i) [M[i], M[piv]] = [M[piv], M[i]];
    for (let k = i + 1; k < 4; k++) {
      const f = M[k][i] / M[i][i];
      for (let j = i; j < 5; j++) M[k][j] -= f * M[i][j];
    }
  }
  const x = [0, 0, 0, 0];
  for (let i = 3; i >= 0; i--) {
    let s = M[i][4];
    for (let j = i + 1; j < 4; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

// RANSAC sphere finder: repeatedly fits a sphere through 4 random points,
// counts inliers within `tol` of the fit radius, keeps hits whose radius is
// in `[rMin, rMax]` and whose inlier count exceeds `minInliers`. After each
// hit its inlier points are removed from the pool so the next iteration can
// find a different sphere. Returns spheres sorted by inlier count desc.
export function findSpheres(points, opts = {}) {
  const rMin = opts.rMin ?? 2.0;
  const rMax = opts.rMax ?? 4.0;
  const tol = opts.tol ?? 0.15;
  const trials = opts.trials ?? 2000;
  const minInliers = opts.minInliers ?? 80;
  const maxSpheres = opts.maxSpheres ?? 8;
  const rng = opts.rng ?? makeRng(opts.seed ?? 1);
  const active = new Uint8Array(points.length / 3).fill(1);
  const hits = [];
  for (let s = 0; s < maxSpheres; s++) {
    const idxActive = [];
    for (let i = 0; i < active.length; i++) if (active[i]) idxActive.push(i);
    if (idxActive.length < minInliers) break;
    let best = null;
    for (let t = 0; t < trials; t++) {
      const pick = new Set();
      while (pick.size < 4) pick.add(idxActive[Math.floor(rng() * idxActive.length)]);
      const [i0, i1, i2, i3] = [...pick];
      const p0 = point(points, i0), p1 = point(points, i1), p2 = point(points, i2), p3 = point(points, i3);
      const sphere = fitSphere4(p0, p1, p2, p3);
      if (!sphere) continue;
      if (sphere.radius < rMin || sphere.radius > rMax) continue;
      let inliers = 0;
      for (const i of idxActive) {
        const p = point(points, i);
        const d = Math.hypot(p[0] - sphere.center[0], p[1] - sphere.center[1], p[2] - sphere.center[2]);
        if (Math.abs(d - sphere.radius) < tol) inliers++;
      }
      if (!best || inliers > best.inliers) best = { ...sphere, inliers };
    }
    if (!best || best.inliers < minInliers) break;
    // remove inliers from pool so the next iteration finds a different sphere
    let removed = 0;
    for (const i of idxActive) {
      const p = point(points, i);
      const d = Math.hypot(p[0] - best.center[0], p[1] - best.center[1], p[2] - best.center[2]);
      if (Math.abs(d - best.radius) < tol) { active[i] = 0; removed++; }
    }
    // refine via least-squares on the inliers (unweighted; good enough here)
    const inlierPts = [];
    for (let i = 0; i < points.length / 3; i++) {
      const p = point(points, i);
      const d = Math.hypot(p[0] - best.center[0], p[1] - best.center[1], p[2] - best.center[2]);
      if (Math.abs(d - best.radius) < tol) inlierPts.push(p);
    }
    const refined = refineSphereLSQ(inlierPts) ?? best;
    hits.push({
      center: refined.center,
      radius: refined.radius,
      inliers: best.inliers,
      removed,
    });
  }
  hits.sort((a, b) => b.inliers - a.inliers);
  return hits;
}

function point(arr, i) { return [arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]]; }

function refineSphereLSQ(pts) {
  if (pts.length < 4) return null;
  // linearized: x²+y²+z² = 2cx·x + 2cy·y + 2cz·z + w
  const N = pts.length;
  let Sxx = 0, Sxy = 0, Sxz = 0, Sx = 0;
  let Syy = 0, Syz = 0, Sy = 0, Szz = 0, Sz = 0, S1 = N;
  let bx = 0, by = 0, bz = 0, b1 = 0;
  for (const p of pts) {
    const x = p[0], y = p[1], z = p[2];
    const rhs = x * x + y * y + z * z;
    Sxx += 4 * x * x; Sxy += 4 * x * y; Sxz += 4 * x * z; Sx += 2 * x;
    Syy += 4 * y * y; Syz += 4 * y * z; Sy += 2 * y;
    Szz += 4 * z * z; Sz += 2 * z;
    bx += 2 * x * rhs; by += 2 * y * rhs; bz += 2 * z * rhs; b1 += rhs;
  }
  const A = [
    [Sxx, Sxy, Sxz, Sx],
    [Sxy, Syy, Syz, Sy],
    [Sxz, Syz, Szz, Sz],
    [Sx, Sy, Sz, S1],
  ];
  const b = [bx, by, bz, b1];
  const x = solve4x4(A, b);
  if (!x) return null;
  const [cx, cy, cz, w] = x;
  const r2 = w + cx * cx + cy * cy + cz * cz;
  if (r2 <= 0) return null;
  return { center: [cx, cy, cz], radius: Math.sqrt(r2) };
}

// Full invariants summary: bbox + PCA + sphere-fit for a mesh. This is the
// scaffold JSON the AI iterator reads before writing a candidate.
export function meshInvariants(mesh, opts = {}) {
  const bbox = meshBBox(mesh);
  const nSamples = opts.samples ?? 4000;
  const points = samplePoints(mesh, nSamples, { seed: opts.seed ?? 1 });
  const pca = principalAxes(points);
  const spheres = findSpheres(points, opts.spheres ?? {});
  return { bbox, pca, spheres };
}
