// Wall-thickness map: for EVERY triangle, the distance from it straight
// through the solid to the opposite surface (a ray along −normal against the
// mesh's cached BVH). checkPrintability's thin-wall check only samples a few
// hundred triangles and reports one thinnest point; this measures the whole
// surface so an agent can see WHERE walls are thin — a list of thin spots
// (connected thin areas, thinnest first) and a heatmap render.
//
// "Thickness" here is the local wall thickness of a shell (or the diameter of
// a solid): exact for a flat wall, a close estimate on curved ones. Triangles
// whose inward ray escapes (an open or non-manifold mesh) read as NaN.

import * as THREE from 'three';
import type { MeshData } from './types';
import { raycastGeometry } from './rayCast';

type Vec3 = [number, number, number];

export interface ThinSpot {
  /** Area-weighted centre of the thin area. */
  center: Vec3;
  /** Thinnest wall in the spot, and where it is. */
  thickness: number;
  thinnest: Vec3;
  /** Surface area of the spot and its triangle count. */
  area: number;
  triangleCount: number;
}

export interface ThicknessSummary {
  threshold: number;
  /** Thinnest measured wall anywhere, and where. */
  minThickness: number | null;
  thinnest: Vec3 | null;
  /** Area-weighted median wall thickness. */
  medianThickness: number | null;
  /** Surface measured below `threshold`. */
  thinArea: number;
  thinFraction: number;
  thinTriangleCount: number;
  /** Connected thin areas, thinnest first (capped at `limit`). */
  spots: ThinSpot[];
  spotCount: number;
  /** Triangles whose ray found no opposite wall (open mesh). */
  unmeasured: number;
}

const fieldCache = new WeakMap<MeshData, { numTri: number; field: Float32Array }>();

function vertex(mesh: MeshData, i: number): Vec3 {
  const o = i * mesh.numProp;
  return [mesh.vertProperties[o], mesh.vertProperties[o + 1], mesh.vertProperties[o + 2]];
}

/** Per-triangle wall thickness (NaN where unmeasured). Cached per mesh. */
export function thicknessField(mesh: MeshData): Float32Array {
  const hit = fieldCache.get(mesh);
  if (hit && hit.numTri === mesh.numTri) return hit.field;
  const geometry = raycastGeometry(mesh);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bvh = (geometry as any).boundsTree;
  const field = new Float32Array(mesh.numTri).fill(NaN);
  geometry.computeBoundingBox();
  const diag = geometry.boundingBox ? geometry.boundingBox.getSize(new THREE.Vector3()).length() : 1;
  // Start just inside the surface so the ray can't hit its own triangle.
  const eps = Math.max(1e-6, diag * 1e-6);
  const ray = new THREE.Ray();
  const vp = mesh.vertProperties, tv = mesh.triVerts, np = mesh.numProp;
  for (let t = 0; t < mesh.numTri; t++) {
    const a = tv[t * 3] * np, b = tv[t * 3 + 1] * np, c = tv[t * 3 + 2] * np;
    const ux = vp[b] - vp[a], uy = vp[b + 1] - vp[a + 1], uz = vp[b + 2] - vp[a + 2];
    const vx = vp[c] - vp[a], vy = vp[c + 1] - vp[a + 1], vz = vp[c + 2] - vp[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz);
    if (!(nl > 0)) continue; // degenerate triangle
    nx /= nl; ny /= nl; nz /= nl;
    const cx = (vp[a] + vp[b] + vp[c]) / 3, cy = (vp[a + 1] + vp[b + 1] + vp[c + 1]) / 3, cz = (vp[a + 2] + vp[b + 2] + vp[c + 2]) / 3;
    ray.origin.set(cx - nx * eps, cy - ny * eps, cz - nz * eps);
    ray.direction.set(-nx, -ny, -nz);
    const h = bvh.raycastFirst(ray, THREE.DoubleSide, 0, diag * 2);
    if (h) field[t] = h.distance + eps;
  }
  fieldCache.set(mesh, { numTri: mesh.numTri, field });
  return field;
}

function triArea(mesh: MeshData, t: number): { area: number; centroid: Vec3 } {
  const a = vertex(mesh, mesh.triVerts[t * 3]);
  const b = vertex(mesh, mesh.triVerts[t * 3 + 1]);
  const c = vertex(mesh, mesh.triVerts[t * 3 + 2]);
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const area = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  return { area, centroid: [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3] };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const roundV = (v: Vec3): Vec3 => [round3(v[0]), round3(v[1]), round3(v[2])];

/** Summarise a thickness field against `threshold`: totals plus the thin
 *  spots — thin triangles joined across shared corners (by position, so a
 *  vertex split on a seam still connects), thinnest first. */
export function summarizeThickness(mesh: MeshData, field: Float32Array, threshold: number, limit: number): ThicknessSummary {
  const n = mesh.numTri;
  let total = 0, thinArea = 0, thinCount = 0, unmeasured = 0;
  let min = Infinity, minAt: Vec3 | null = null;
  const measured: { t: number; area: number }[] = [];
  const areas = new Float64Array(n);
  const centroids = new Float64Array(n * 3);
  for (let t = 0; t < n; t++) {
    const { area, centroid } = triArea(mesh, t);
    areas[t] = area;
    centroids[t * 3] = centroid[0]; centroids[t * 3 + 1] = centroid[1]; centroids[t * 3 + 2] = centroid[2];
    const d = field[t];
    if (!(d >= 0)) { unmeasured++; continue; }
    total += area;
    measured.push({ t, area });
    if (d < min) { min = d; minAt = centroid; }
    if (d < threshold) { thinArea += area; thinCount++; }
  }

  // Area-weighted median.
  let median: number | null = null;
  if (measured.length > 0) {
    measured.sort((x, y) => field[x.t] - field[y.t]);
    let acc = 0;
    for (const m of measured) { acc += m.area; if (acc >= total / 2) { median = field[m.t]; break; } }
  }

  // Union-find over thin triangles that share a corner position.
  const parent = new Int32Array(n).fill(-1);
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const firstAt = new Map<string, number>();
  for (let t = 0; t < n; t++) {
    if (!(field[t] < threshold)) continue;
    parent[t] = t;
    for (let k = 0; k < 3; k++) {
      const [x, y, z] = vertex(mesh, mesh.triVerts[t * 3 + k]);
      const key = `${x.toFixed(5)},${y.toFixed(5)},${z.toFixed(5)}`;
      const other = firstAt.get(key);
      if (other === undefined) firstAt.set(key, t);
      else { const ra = find(t), rb = find(other); if (ra !== rb) parent[ra] = rb; }
    }
  }
  const spots = new Map<number, { area: number; cx: number; cy: number; cz: number; min: number; at: number; count: number }>();
  for (let t = 0; t < n; t++) {
    if (parent[t] < 0) continue;
    const r = find(t);
    let s = spots.get(r);
    if (!s) { s = { area: 0, cx: 0, cy: 0, cz: 0, min: Infinity, at: t, count: 0 }; spots.set(r, s); }
    const a = areas[t];
    s.area += a; s.count++;
    s.cx += centroids[t * 3] * a; s.cy += centroids[t * 3 + 1] * a; s.cz += centroids[t * 3 + 2] * a;
    if (field[t] < s.min) { s.min = field[t]; s.at = t; }
  }
  const list: ThinSpot[] = [...spots.values()]
    .sort((p, q) => p.min - q.min || q.area - p.area)
    .map(s => ({
      center: roundV(s.area > 0 ? [s.cx / s.area, s.cy / s.area, s.cz / s.area] : [centroids[s.at * 3], centroids[s.at * 3 + 1], centroids[s.at * 3 + 2]]),
      thickness: round3(s.min),
      thinnest: roundV([centroids[s.at * 3], centroids[s.at * 3 + 1], centroids[s.at * 3 + 2]]),
      area: round3(s.area),
      triangleCount: s.count,
    }));

  return {
    threshold,
    minThickness: min === Infinity ? null : round3(min),
    thinnest: minAt ? roundV(minAt) : null,
    medianThickness: median === null ? null : round3(median),
    thinArea: round3(thinArea),
    thinFraction: total > 0 ? round3(thinArea / total) : 0,
    thinTriangleCount: thinCount,
    spots: list.slice(0, limit),
    spotCount: list.length,
    unmeasured,
  };
}

/** Heatmap colours: red at (and below) half the threshold, through orange and
 *  yellow at the threshold, to a neutral grey at twice it and beyond; dark
 *  grey where unmeasured. */
export function thicknessColors(field: Float32Array, threshold: number): Uint8Array {
  const out = new Uint8Array(field.length * 3);
  const stops: [number, Vec3][] = [[0.5, [220, 38, 38]], [0.75, [249, 115, 22]], [1, [250, 204, 21]], [1.5, [163, 230, 53]], [2, [170, 172, 178]]];
  for (let t = 0; t < field.length; t++) {
    const d = field[t];
    let rgb: Vec3;
    if (!(d >= 0)) rgb = [90, 90, 96];
    else {
      const r = d / threshold;
      if (r <= stops[0][0]) rgb = stops[0][1];
      else if (r >= stops[stops.length - 1][0]) rgb = stops[stops.length - 1][1];
      else {
        let i = 1;
        while (r > stops[i][0]) i++;
        const [r0, c0] = stops[i - 1], [r1, c1] = stops[i];
        const s = (r - r0) / (r1 - r0);
        rgb = [c0[0] + (c1[0] - c0[0]) * s, c0[1] + (c1[1] - c0[1]) * s, c0[2] + (c1[2] - c0[2]) * s];
      }
    }
    out[t * 3] = Math.round(rgb[0]); out[t * 3 + 1] = Math.round(rgb[1]); out[t * 3 + 2] = Math.round(rgb[2]);
  }
  return out;
}
