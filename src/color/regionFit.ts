// Analytic shape fitting for detected mesh regions (crease-watershed segments,
// see `computeFaceGroups` in `faceGroups.ts`). A ragged triangle set following
// tessellation seams paints badly with a raw triangle-set brush — long "fan
// wedge" triangles at the boundary bleed past the intended feature. Fitting a
// plane / circle-disc / sphere to the region's boundary gives callers an
// analytic shape they can hand to the app's smooth shape-selector instead,
// which paints a clean disc/sphere regardless of how ragged the underlying
// tessellation is.
//
// Pure math only: no DOM, no engine imports — just `MeshData` + the welded
// adjacency helpers in `adjacency.ts`.

import type { MeshData } from '../geometry/types';

export interface FitPlane {
  center: [number, number, number];
  normal: [number, number, number];
  rms: number;
}

export interface FitCircle {
  center: [number, number, number];
  axis: [number, number, number];
  radius: number;
  rms: number;
}

export interface FitSphere {
  center: [number, number, number];
  radius: number;
  rms: number;
}

export interface RegionShapeFit {
  pointCount: number;
  plane: FitPlane;
  circle: FitCircle | null; // null if plane fit degenerate
  sphere: FitSphere | null; // null if <4 well-conditioned points
  /** which fit explains the boundary best, by rms normalized to feature size */
  best: 'circle' | 'sphere' | 'plane';
}

type Vec3 = [number, number, number];

const EPS = 1e-9;

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function length(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}

function normalize(a: Vec3): Vec3 {
  const len = length(a);
  if (len < EPS) return [0, 0, 1];
  return [a[0] / len, a[1] / len, a[2] / len];
}

/** Boundary points of a triangle set: endpoints of edges that have no
 *  neighbouring triangle inside the set. Vertices are welded by exact
 *  position (same technique `buildAdjacency` uses) so STL vertex duplication
 *  at shared corners doesn't fake extra boundary. Returns one point per
 *  welded vertex incident to a boundary edge — a fan center whose spokes are
 *  all internal (every wedge triangle around it is in the set) is correctly
 *  excluded, only the outer rim is returned. */
export function boundaryPoints(triangles: Set<number>, mesh: MeshData): Vec3[] {
  const { triVerts, vertProperties, numVert, numProp } = mesh;

  // Weld vertices by exact position, same as buildAdjacency.
  const canon = new Int32Array(numVert);
  const posId = new Map<string, number>();
  const canonPoint = new Map<number, Vec3>();
  for (let v = 0; v < numVert; v++) {
    const x = vertProperties[v * numProp];
    const y = vertProperties[v * numProp + 1];
    const z = vertProperties[v * numProp + 2];
    const key = `${x},${y},${z}`;
    let id = posId.get(key);
    if (id === undefined) {
      id = posId.size;
      posId.set(key, id);
      canonPoint.set(id, [x, y, z]);
    }
    canon[v] = id;
  }

  // Edge (welded vertex-pair) -> triangles of the WHOLE mesh touching it, so
  // we can tell a mesh-boundary edge (only ever owned by one triangle) apart
  // from an interior edge shared with a triangle outside the set.
  const edgeOwners = new Map<string, number[]>();
  const edgeKey = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);

  for (const t of triangles) {
    const v0 = canon[triVerts[t * 3]];
    const v1 = canon[triVerts[t * 3 + 1]];
    const v2 = canon[triVerts[t * 3 + 2]];
    for (const [a, b] of [[v0, v1], [v1, v2], [v2, v0]] as [number, number][]) {
      const key = edgeKey(a, b);
      let list = edgeOwners.get(key);
      if (!list) { list = []; edgeOwners.set(key, list); }
      // Only need the owners once per (triangle, edge) — but a triangle
      // touching this edge more than once would be degenerate, so a plain
      // push per encountered edge occurrence is fine.
      list.push(t);
    }
  }

  // Also need edges from triangles OUTSIDE the set that might share an edge
  // with a set triangle (to detect "shared with a triangle outside the
  // set"). Fold every mesh triangle's edges into the same map.
  for (let t = 0; t < mesh.numTri; t++) {
    if (triangles.has(t)) continue; // already added above
    const v0 = canon[triVerts[t * 3]];
    const v1 = canon[triVerts[t * 3 + 1]];
    const v2 = canon[triVerts[t * 3 + 2]];
    for (const [a, b] of [[v0, v1], [v1, v2], [v2, v0]] as [number, number][]) {
      const key = edgeKey(a, b);
      let list = edgeOwners.get(key);
      if (!list) { list = []; edgeOwners.set(key, list); }
      list.push(t);
    }
  }

  const boundaryCanon = new Set<number>();
  for (const t of triangles) {
    const v0 = canon[triVerts[t * 3]];
    const v1 = canon[triVerts[t * 3 + 1]];
    const v2 = canon[triVerts[t * 3 + 2]];
    for (const [a, b] of [[v0, v1], [v1, v2], [v2, v0]] as [number, number][]) {
      const key = edgeKey(a, b);
      const owners = edgeOwners.get(key) ?? [];
      const others = owners.filter((o) => o !== t);
      const hasInsideNeighbor = others.some((o) => triangles.has(o));
      if (!hasInsideNeighbor) {
        boundaryCanon.add(a);
        boundaryCanon.add(b);
      }
    }
  }

  const result: Vec3[] = [];
  for (const id of boundaryCanon) {
    const p = canonPoint.get(id);
    if (p) result.push(p);
  }
  return result;
}

/** Smallest-eigenvalue eigenvector of a symmetric 3x3 matrix given by its
 *  upper triangle, via power iteration on (trace*I - M) — that matrix is
 *  positive semi-definite (M's eigenvalues are in [0, trace] for a
 *  covariance matrix), and its top eigenvector is M's smallest-eigenvalue
 *  eigenvector, which converges reliably without a cubic solver. */
function smallestEigenvector(
  xx: number, xy: number, xz: number,
  yy: number, yz: number,
  zz: number,
): Vec3 {
  const trace = xx + yy + zz;
  const mxx = trace - xx, mxy = -xy, mxz = -xz;
  const myy = trace - yy, myz = -yz;
  const mzz = trace - zz;

  let v: Vec3 = [0.5773502691896258, 0.5773502691896258, 0.5773502691896258];
  for (let iter = 0; iter < 64; iter++) {
    const nx = mxx * v[0] + mxy * v[1] + mxz * v[2];
    const ny = mxy * v[0] + myy * v[1] + myz * v[2];
    const nz = mxz * v[0] + myz * v[1] + mzz * v[2];
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len < 1e-12) break; // fully degenerate (all points coincident) — keep last v
    v = [nx / len, ny / len, nz / len];
  }
  return v;
}

/** Fit a plane through `points` by centroid + covariance eigen-decomposition
 *  (normal = eigenvector of the smallest eigenvalue). Degenerate input
 *  (0-2 points, or exactly collinear points) still returns a well-formed
 *  result — the normal direction is under-determined in that case, but
 *  numerically stable and NaN-free. */
export function fitPlane(points: Vec3[]): FitPlane {
  const n = points.length;
  if (n === 0) return { center: [0, 0, 0], normal: [0, 0, 1], rms: Infinity };

  let cx = 0, cy = 0, cz = 0;
  for (const p of points) { cx += p[0]; cy += p[1]; cz += p[2]; }
  cx /= n; cy /= n; cz /= n;
  const center: Vec3 = [cx, cy, cz];

  if (n === 1) return { center, normal: [0, 0, 1], rms: 0 };

  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (const p of points) {
    const dx = p[0] - cx, dy = p[1] - cy, dz = p[2] - cz;
    xx += dx * dx; xy += dx * dy; xz += dx * dz;
    yy += dy * dy; yz += dy * dz; zz += dz * dz;
  }

  const normal = smallestEigenvector(xx, xy, xz, yy, yz, zz);

  let sumSq = 0;
  for (const p of points) {
    const d = dot(sub(p, center), normal);
    sumSq += d * d;
  }
  const rms = Math.sqrt(sumSq / n);

  return { center, normal, rms };
}

/** Gauss-Jordan elimination with partial pivoting. Returns null when the
 *  system is singular/ill-conditioned (pivot below tolerance) rather than
 *  propagating NaN/Infinity. */
function solveLinear(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  const m = matrix.map((row, i) => [...row, rhs[i]]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let pivotVal = Math.abs(m[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(m[r][col]);
      if (v > pivotVal) { pivotVal = v; pivotRow = r; }
    }
    if (pivotVal < 1e-10) return null;
    if (pivotRow !== col) { const tmp = m[col]; m[col] = m[pivotRow]; m[pivotRow] = tmp; }

    const pivot = m[col][col];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = m[r][col] / pivot;
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) m[r][c] -= factor * m[col][c];
    }
  }

  const out: number[] = new Array(n);
  for (let i = 0; i < n; i++) out[i] = m[i][n] / m[i][i];
  return out;
}

/** Fit a circle to `points`: `fitPlane` first, project into the plane's 2D
 *  basis, then a Kåsa algebraic circle fit (linear least squares) in-plane.
 *  `rms` folds in-plane radial residual and out-of-plane deviation together
 *  in quadrature, so a "circle" that isn't actually planar scores worse
 *  than a true planar disc. Returns null for <3 points or a degenerate
 *  (e.g. collinear) in-plane fit. */
export function fitCircle3D(points: Vec3[]): FitCircle | null {
  if (points.length < 3) return null;

  const plane = fitPlane(points);
  const normal = plane.normal;
  if (length(normal) < 0.5) return null; // degenerate plane normal

  // Orthonormal in-plane basis.
  const arbitrary: Vec3 = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = normalize(cross(normal, arbitrary));
  const v = cross(normal, u);

  const proj: { x: number; y: number; z: number }[] = points.map((p) => {
    const d = sub(p, plane.center);
    return { x: dot(d, u), y: dot(d, v), z: dot(d, normal) };
  });

  // Kåsa fit: x^2+y^2 + D x + E y + F = 0, linear least squares on [x,y,1].
  let Sxx = 0, Sxy = 0, Sx = 0, Syy = 0, Sy = 0, Sn = 0;
  let Sbx = 0, Sby = 0, Sb = 0;
  for (const { x, y } of proj) {
    const b = -(x * x + y * y);
    Sxx += x * x; Sxy += x * y; Sx += x;
    Syy += y * y; Sy += y;
    Sn += 1;
    Sbx += x * b; Sby += y * b; Sb += b;
  }

  const sol = solveLinear(
    [
      [Sxx, Sxy, Sx],
      [Sxy, Syy, Sy],
      [Sx, Sy, Sn],
    ],
    [Sbx, Sby, Sb],
  );
  if (!sol) return null;
  const [D, E, F] = sol;

  const ccx = -D / 2, ccy = -E / 2;
  const r2 = ccx * ccx + ccy * ccy - F;
  if (!(r2 > 1e-12) || !Number.isFinite(r2)) return null;
  const radius = Math.sqrt(r2);

  const center3D: Vec3 = [
    plane.center[0] + ccx * u[0] + ccy * v[0],
    plane.center[1] + ccx * u[1] + ccy * v[1],
    plane.center[2] + ccx * u[2] + ccy * v[2],
  ];

  let sumSq = 0;
  for (const { x, y, z } of proj) {
    const radial = Math.sqrt((x - ccx) * (x - ccx) + (y - ccy) * (y - ccy)) - radius;
    sumSq += radial * radial + z * z; // out-of-plane deviation folded in quadrature
  }
  const rms = Math.sqrt(sumSq / proj.length);

  return { center: center3D, axis: normal, radius, rms };
}

/** Fit a sphere to `points` via the algebraic (Coope/linear) least-squares
 *  formulation: x²+y²+z² + Dx+Ey+Fz+G = 0, solved as a 4x4 linear system.
 *  Returns null for <4 points or an ill-conditioned/degenerate fit
 *  (near-coplanar points, non-positive radius²). */
export function fitSphere(points: Vec3[]): FitSphere | null {
  if (points.length < 4) return null;

  let Sxx = 0, Sxy = 0, Sxz = 0, Sx = 0;
  let Syy = 0, Syz = 0, Sy = 0;
  let Szz = 0, Sz = 0;
  let Sn = 0;
  let Sbx = 0, Sby = 0, Sbz = 0, Sb = 0;

  for (const [x, y, z] of points) {
    const b = -(x * x + y * y + z * z);
    Sxx += x * x; Sxy += x * y; Sxz += x * z; Sx += x;
    Syy += y * y; Syz += y * z; Sy += y;
    Szz += z * z; Sz += z;
    Sn += 1;
    Sbx += x * b; Sby += y * b; Sbz += z * b; Sb += b;
  }

  const sol = solveLinear(
    [
      [Sxx, Sxy, Sxz, Sx],
      [Sxy, Syy, Syz, Sy],
      [Sxz, Syz, Szz, Sz],
      [Sx, Sy, Sz, Sn],
    ],
    [Sbx, Sby, Sbz, Sb],
  );
  if (!sol) return null;
  const [D, E, F, G] = sol;

  const center: Vec3 = [-D / 2, -E / 2, -F / 2];
  const r2 = center[0] * center[0] + center[1] * center[1] + center[2] * center[2] - G;
  if (!(r2 > 1e-12) || !Number.isFinite(r2)) return null;
  const radius = Math.sqrt(r2);

  let sumSq = 0;
  for (const p of points) {
    const d = length(sub(p, center)) - radius;
    sumSq += d * d;
  }
  const rms = Math.sqrt(sumSq / points.length);

  return { center, radius, rms };
}

/** Pick the fit that best explains the boundary, normalizing each fit's rms
 *  to its own feature size (circle/sphere: radius; plane: the points'
 *  bounding radius around the plane center) so a large disc and a small one
 *  are judged on the same relative scale.
 *
 *  `circle.rms` is NOT used directly: `fitCircle3D` reuses `fitPlane`'s exact
 *  center+normal, so its rms structurally decomposes as
 *  `circle.rms² = plane.rms² + meanRadialResidual²` — a circle can only ever
 *  be reported as WORSE than the plane it's built on top of, so comparing
 *  raw rms would make "plane" win every tie and "circle" could never be
 *  picked. We isolate `meanRadialResidual` (how far the boundary deviates
 *  from being round, independent of how planar it already is) and score
 *  circle on that instead — a true circular disc then scores circle ≈ plane
 *  (both near the mesh's own noise floor), which the tie preference below
 *  resolves in circle's favor.
 *
 *  Discs are the common sculpted feature (eye domes, iris rings, blush
 *  dots): the more specific shape (circle > sphere > plane) wins whenever
 *  its score is within `TIE_FACTOR` of the current best, checked from most
 *  to least specific, so a near-tie prefers the more descriptive fit rather
 *  than the generic one. The tie check is `candidate <= best*TIE_FACTOR +
 *  ABS_TOL`, not a pure ratio: for a geometrically exact fit both scores sit
 *  near floating-point noise (~1e-19 for the plane, ~1e-8 for the circle,
 *  purely from accumulated rounding in the projection/solve), and a ratio
 *  alone blows up comparing two numbers that are both "zero" for any
 *  practical purpose. `ABS_TOL` gives every score an equal floor below which
 *  it's treated as a perfect fit, so the tie resolves the same way whether
 *  the input is exact or has ordinary mesh-scale noise. */
function pickBestFit(
  plane: FitPlane,
  circle: FitCircle | null,
  sphere: FitSphere | null,
  featureSize: number,
): 'circle' | 'sphere' | 'plane' {
  const TIE_FACTOR = 1.2;
  const ABS_TOL = 1e-4;

  const planeScore = plane.rms / Math.max(featureSize, EPS);

  let circleScore = Infinity;
  if (circle) {
    const radialMeanSq = Math.max(0, circle.rms * circle.rms - plane.rms * plane.rms);
    circleScore = Math.sqrt(radialMeanSq) / Math.max(circle.radius, EPS);
  }
  const sphereScore = sphere ? sphere.rms / Math.max(sphere.radius, EPS) : Infinity;

  let best: 'plane' | 'sphere' | 'circle' = 'plane';
  let bestScore = planeScore;
  if (Number.isFinite(sphereScore) && sphereScore <= bestScore * TIE_FACTOR + ABS_TOL) {
    best = 'sphere'; bestScore = sphereScore;
  }
  if (Number.isFinite(circleScore) && circleScore <= bestScore * TIE_FACTOR + ABS_TOL) {
    best = 'circle'; bestScore = circleScore;
  }
  return best;
}

/** One-call orchestrator: boundary points → all three fits → best pick. */
export function fitRegionShape(triangles: Set<number>, mesh: MeshData): RegionShapeFit | { error: string } {
  const points = boundaryPoints(triangles, mesh);
  if (points.length < 3) {
    return { error: `need at least 3 boundary points to fit a shape, got ${points.length}` };
  }

  const plane = fitPlane(points);
  const circle = fitCircle3D(points);
  const sphere = fitSphere(points);

  let featureSize = 0;
  for (const p of points) {
    featureSize = Math.max(featureSize, length(sub(p, plane.center)));
  }

  const best = pickBestFit(plane, circle, sphere, featureSize);

  return { pointCount: points.length, plane, circle, sphere, best };
}
