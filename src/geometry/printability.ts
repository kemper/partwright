// Design-for-3D-printing analysis. Pure functions over a MeshData (+ a few
// printer settings) that surface the manufacturability problems the geometry
// stats don't: overhangs that need support, walls thinner than the nozzle can
// lay down, features too small to resolve, parts that won't fit the bed, and
// models that would tip over on the plate. The output is both a structured
// report (for the AI agent to read and self-correct against) and a list of
// human-readable summary lines (for the UI panel).
//
// Everything here is geometric and heuristic — it is design-stage advice, not
// a slicer. Wall thickness in particular is a sampled estimate, flagged as
// such, not an exact medial-axis computation.

import type { MeshData } from './types';

export type CheckLevel = 'pass' | 'warn' | 'fail' | 'info';

export interface PrintabilityCheck {
  id: string;
  level: CheckLevel;
  text: string;
}

export interface PrintabilityReport {
  ok: boolean;
  bed: [number, number, number];
  nozzleWidth: number;
  overhangAngleDeg: number;
  boundingBox: { min: [number, number, number]; max: [number, number, number]; dimensions: [number, number, number] } | null;
  bedFit: { fits: boolean; overBy: [number, number, number] };
  overhangs: { thresholdDeg: number; triangleCount: number; area: number; areaFraction: number; worstAngleDeg: number | null; samples: { point: [number, number, number]; angleDeg: number }[] };
  thinWalls: { estimate: true; nozzleWidth: number; minThickness: number | null; samples: number; thinCount: number; thinnest: [number, number, number] | null } | null;
  smallestDimension: number | null;
  stability: { computed: boolean; centerOfMass: [number, number, number] | null; supported: boolean | null; marginMm: number | null; footprintArea: number | null };
  isManifold: boolean;
  checks: PrintabilityCheck[];
}

export interface PrintabilityOptions {
  bed: [number, number, number];
  nozzleWidth: number;
  overhangAngleDeg: number;
  /** Whether the source manifold is watertight/valid. From geometry stats. */
  isManifold: boolean;
}

type Vec3 = [number, number, number];

function vget(v: Float32Array, stride: number, i: number): Vec3 {
  const o = i * stride;
  return [v[o], v[o + 1], v[o + 2]];
}

function sub(a: Vec3, b: Vec3): Vec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a: Vec3, b: Vec3): Vec3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function len(a: Vec3): number { return Math.hypot(a[0], a[1], a[2]); }

function boundingBox(mesh: MeshData): { min: Vec3; max: Vec3; dimensions: Vec3 } | null {
  if (mesh.numVert === 0) return null;
  const v = mesh.vertProperties;
  const n = mesh.numProp;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < mesh.numVert; i++) {
    const x = v[i * n], y = v[i * n + 1], z = v[i * n + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ], dimensions: [maxX - minX, maxY - minY, maxZ - minZ] };
}

/** Mass-properties via signed tetrahedra from the origin. Accurate only for a
 *  closed, consistently-wound mesh; returns null volume on a degenerate one. */
export function computeCenterOfMass(mesh: MeshData): { volume: number; com: Vec3 } | null {
  const v = mesh.vertProperties;
  const t = mesh.triVerts;
  const n = mesh.numProp;
  let vol = 0;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < mesh.numTri; i++) {
    const a = vget(v, n, t[i * 3]);
    const b = vget(v, n, t[i * 3 + 1]);
    const c = vget(v, n, t[i * 3 + 2]);
    const sv = dot(a, cross(b, c)) / 6; // signed tetra volume
    vol += sv;
    // tetra centroid = (a + b + c + origin) / 4
    cx += sv * (a[0] + b[0] + c[0]) / 4;
    cy += sv * (a[1] + b[1] + c[1]) / 4;
    cz += sv * (a[2] + b[2] + c[2]) / 4;
  }
  if (Math.abs(vol) < 1e-9) return null;
  return { volume: Math.abs(vol), com: [cx / vol, cy / vol, cz / vol] };
}

/** Andrew's monotone-chain convex hull of 2D points. Returns hull vertices CCW. */
function convexHull2D(pts: [number, number][]): [number, number][] {
  if (pts.length < 3) return pts.slice();
  const p = pts.slice().sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  const crossZ = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const pt of p) {
    while (lower.length >= 2 && crossZ(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop();
    lower.push(pt);
  }
  const upper: [number, number][] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const pt = p[i];
    while (upper.length >= 2 && crossZ(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop();
    upper.push(pt);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

function polygonArea(hull: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < hull.length; i++) {
    const j = (i + 1) % hull.length;
    a += hull[i][0] * hull[j][1] - hull[j][0] * hull[i][1];
  }
  return Math.abs(a) / 2;
}

/** Signed distance from point to a CCW convex polygon; positive inside. */
function distanceInsideHull(hull: [number, number][], pt: [number, number]): number {
  if (hull.length < 3) return -Infinity;
  let minEdge = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const elen = Math.hypot(ex, ey) || 1e-9;
    // Left-of test (CCW): positive distance = inside.
    const d = ((pt[0] - a[0]) * ey - (pt[1] - a[1]) * ex) / elen * -1;
    if (d < minEdge) minEdge = d;
  }
  return minEdge;
}

/** Möller–Trumbore ray/triangle intersection; returns t>eps or null. */
function rayTri(orig: Vec3, dir: Vec3, a: Vec3, b: Vec3, c: Vec3): number | null {
  const EPS = 1e-7;
  const e1 = sub(b, a), e2 = sub(c, a);
  const pv = cross(dir, e2);
  const det = dot(e1, pv);
  if (det > -EPS && det < EPS) return null;
  const inv = 1 / det;
  const tv = sub(orig, a);
  const u = dot(tv, pv) * inv;
  if (u < 0 || u > 1) return null;
  const qv = cross(tv, e1);
  const vv = dot(dir, qv) * inv;
  if (vv < 0 || u + vv > 1) return null;
  const t = dot(e2, qv) * inv;
  return t > EPS ? t : null;
}

/** Sampled interior thickness: cast a ray from a face inward along its inverse
 *  normal and measure the distance to the first opposite surface. Capped so it
 *  stays sub-second even on heavy meshes — this is an estimate, not exact. */
function estimateThinWalls(mesh: MeshData, nozzleWidth: number, bbDiag: number): PrintabilityReport['thinWalls'] {
  const v = mesh.vertProperties;
  const t = mesh.triVerts;
  const n = mesh.numProp;
  const numTri = mesh.numTri;
  if (numTri === 0) return null;

  // Budget: keep ray-casts × triangles roughly bounded.
  const maxSamples = numTri > 120_000 ? 60 : numTri > 40_000 ? 120 : 250;
  const stride = Math.max(1, Math.floor(numTri / maxSamples));
  const eps = Math.max(1e-4, bbDiag * 1e-5);

  let minThickness = Infinity;
  let thinnest: Vec3 | null = null;
  let samples = 0;
  let thinCount = 0;
  const thinThreshold = nozzleWidth * 2;

  for (let i = 0; i < numTri; i += stride) {
    const a = vget(v, n, t[i * 3]);
    const b = vget(v, n, t[i * 3 + 1]);
    const c = vget(v, n, t[i * 3 + 2]);
    const nrm = cross(sub(b, a), sub(c, a));
    const nl = len(nrm);
    if (nl < 1e-9) continue;
    const un: Vec3 = [nrm[0] / nl, nrm[1] / nl, nrm[2] / nl];
    const centroid: Vec3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    // Step just inside the surface, then shoot inward (−normal).
    const orig: Vec3 = [centroid[0] - un[0] * eps, centroid[1] - un[1] * eps, centroid[2] - un[2] * eps];
    const dir: Vec3 = [-un[0], -un[1], -un[2]];
    samples++;
    let best = Infinity;
    for (let j = 0; j < numTri; j++) {
      if (j === i) continue;
      const ja = vget(v, n, t[j * 3]);
      const jb = vget(v, n, t[j * 3 + 1]);
      const jc = vget(v, n, t[j * 3 + 2]);
      const tt = rayTri(orig, dir, ja, jb, jc);
      if (tt !== null && tt < best) best = tt;
    }
    if (best !== Infinity) {
      if (best < thinThreshold) thinCount++;
      if (best < minThickness) { minThickness = best; thinnest = centroid; }
    }
  }

  return {
    estimate: true,
    nozzleWidth,
    minThickness: minThickness === Infinity ? null : minThickness,
    samples,
    thinCount,
    thinnest,
  };
}

export function analyzePrintability(mesh: MeshData, opts: PrintabilityOptions): PrintabilityReport {
  const { bed, nozzleWidth, overhangAngleDeg, isManifold } = opts;
  const bb = boundingBox(mesh);
  const checks: PrintabilityCheck[] = [];

  // ── Bed fit ─────────────────────────────────────────────────────────────
  const overBy: Vec3 = [0, 0, 0];
  let fits = true;
  if (bb) {
    for (let i = 0; i < 3; i++) {
      const over = bb.dimensions[i] - bed[i];
      overBy[i] = over > 0 ? over : 0;
      if (over > 1e-6) fits = false;
    }
  }
  if (bb) {
    if (fits) {
      checks.push({ id: 'bed', level: 'pass', text: `Fits the ${bed[0]}×${bed[1]}×${bed[2]} build volume (${bb.dimensions.map(d => d.toFixed(1)).join(' × ')}).` });
    } else {
      const axesOver: string[] = [];
      for (let i = 0; i < 3; i++) if (overBy[i] > 0) axesOver.push(`${['X', 'Y', 'Z'][i]} by ${overBy[i].toFixed(1)}mm`);
      checks.push({ id: 'bed', level: 'fail', text: `Too big for the bed — exceeds ${axesOver.join(', ')}. Scale to fit or split for printing.` });
    }
  }

  // ── Overhangs ───────────────────────────────────────────────────────────
  const v = mesh.vertProperties;
  const tri = mesh.triVerts;
  const np = mesh.numProp;
  const heightZ = bb ? bb.dimensions[2] : 0;
  const baseEps = Math.max(0.05, heightZ * 0.005);
  const baseZ = bb ? bb.min[2] : 0;
  let overhangArea = 0;
  let totalArea = 0;
  let overhangTris = 0;
  let worstAngle: number | null = null;
  const overhangSamples: { point: Vec3; angleDeg: number }[] = [];
  for (let i = 0; i < mesh.numTri; i++) {
    const a = vget(v, np, tri[i * 3]);
    const b = vget(v, np, tri[i * 3 + 1]);
    const c = vget(v, np, tri[i * 3 + 2]);
    const nrm = cross(sub(b, a), sub(c, a));
    const nl = len(nrm);
    if (nl < 1e-12) continue;
    const area = nl / 2;
    totalArea += area;
    const nz = nrm[2] / nl;
    if (nz >= -1e-4) continue; // not downward-facing
    const centroidZ = (a[2] + b[2] + c[2]) / 3;
    if (centroidZ <= baseZ + baseEps) continue; // resting on the plate
    // Surface angle from horizontal: 0 = flat ceiling (worst), 90 = vertical.
    const angleFromHorizontal = Math.acos(Math.min(1, Math.abs(nz))) * 180 / Math.PI;
    if (angleFromHorizontal < overhangAngleDeg) {
      overhangArea += area;
      overhangTris++;
      if (worstAngle === null || angleFromHorizontal < worstAngle) worstAngle = angleFromHorizontal;
      if (overhangSamples.length < 5) {
        overhangSamples.push({ point: [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, centroidZ], angleDeg: angleFromHorizontal });
      }
    }
  }
  const areaFraction = totalArea > 0 ? overhangArea / totalArea : 0;
  if (overhangTris === 0) {
    checks.push({ id: 'overhang', level: 'pass', text: `No overhangs below ${overhangAngleDeg}° — prints without support.` });
  } else {
    checks.push({
      id: 'overhang',
      level: 'warn',
      text: `${overhangTris} overhang face${overhangTris === 1 ? '' : 's'} below ${overhangAngleDeg}° (${(areaFraction * 100).toFixed(1)}% of surface, shallowest ${worstAngle?.toFixed(0)}°) — will need support or a re-orientation.`,
    });
  }

  // ── Walls / small features (needs a watertight mesh to be meaningful) ────
  const bbDiag = bb ? len(bb.dimensions) : 0;
  let thinWalls: PrintabilityReport['thinWalls'] = null;
  if (isManifold && mesh.numTri > 0) {
    const tw = estimateThinWalls(mesh, nozzleWidth, bbDiag);
    thinWalls = tw;
    if (tw && tw.minThickness !== null) {
      if (tw.minThickness < nozzleWidth) {
        checks.push({ id: 'walls', level: 'fail', text: `Thinnest wall ≈ ${tw.minThickness.toFixed(2)} mm is below the ${nozzleWidth} mm nozzle — it won't print. (sampled estimate)` });
      } else if (tw.minThickness < nozzleWidth * 2) {
        checks.push({ id: 'walls', level: 'warn', text: `Thinnest wall ≈ ${tw.minThickness.toFixed(2)} mm is under 2 perimeters (${(nozzleWidth * 2).toFixed(1)} mm) — fragile. (sampled estimate)` });
      } else {
        checks.push({ id: 'walls', level: 'pass', text: `Thinnest sampled wall ≈ ${tw.minThickness.toFixed(2)} mm — at least 2 perimeters.` });
      }
    }
  } else if (!isManifold) {
    checks.push({ id: 'walls', level: 'info', text: 'Wall-thickness check skipped — needs a watertight (manifold) model.' });
  }

  const smallestDimension = bb ? Math.min(...bb.dimensions) : null;
  if (smallestDimension !== null && smallestDimension < nozzleWidth * 2) {
    checks.push({ id: 'feature', level: 'warn', text: `Smallest overall dimension ${smallestDimension.toFixed(2)} mm is near the nozzle limit — fine details may not resolve.` });
  }

  // ── Stability (tip-over) ────────────────────────────────────────────────
  let stability: PrintabilityReport['stability'] = { computed: false, centerOfMass: null, supported: null, marginMm: null, footprintArea: null };
  if (isManifold && bb) {
    const mp = computeCenterOfMass(mesh);
    if (mp) {
      const band = Math.max(0.6, heightZ * 0.02);
      const footPts: [number, number][] = [];
      for (let i = 0; i < mesh.numVert; i++) {
        const z = v[i * np + 2];
        if (z <= baseZ + band) footPts.push([v[i * np], v[i * np + 1]]);
      }
      const hull = convexHull2D(footPts);
      const footprintArea = hull.length >= 3 ? polygonArea(hull) : 0;
      const margin = hull.length >= 3 ? distanceInsideHull(hull, [mp.com[0], mp.com[1]]) : -Infinity;
      const supported = margin > 0;
      stability = { computed: true, centerOfMass: mp.com, supported, marginMm: Number.isFinite(margin) ? margin : null, footprintArea };
      if (supported) {
        checks.push({ id: 'stability', level: 'pass', text: `Stable — centre of mass sits ${margin.toFixed(1)} mm inside the footprint.` });
      } else {
        checks.push({ id: 'stability', level: 'warn', text: 'Top-heavy — centre of mass falls outside the base footprint; it may tip over while printing. Add a brim or re-orient.' });
      }
    }
  }

  // ── Manifold / watertight ───────────────────────────────────────────────
  if (isManifold) {
    checks.push({ id: 'manifold', level: 'pass', text: 'Watertight (manifold) — slices cleanly.' });
  } else {
    checks.push({ id: 'manifold', level: 'fail', text: 'Not watertight — render-only or non-manifold geometry will not slice reliably. Repair before printing.' });
  }

  const ok = !checks.some(c => c.level === 'fail');

  return {
    ok,
    bed,
    nozzleWidth,
    overhangAngleDeg,
    boundingBox: bb,
    bedFit: { fits, overBy },
    overhangs: { thresholdDeg: overhangAngleDeg, triangleCount: overhangTris, area: overhangArea, areaFraction, worstAngleDeg: worstAngle, samples: overhangSamples },
    thinWalls,
    smallestDimension,
    stability,
    isManifold,
    checks,
  };
}
