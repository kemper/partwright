// Planar mesh slicing + closed-contour extraction + polygon simplification.
//
// Ported from the headless inverse-CAD kernel (scripts/inverse-cad/slice.mjs)
// for the in-app mesh→code reconstruction feature. Pure math, Worker-clean:
// no DOM, no engine, no filesystem.
//
// sliceMesh cuts a triangle soup with an axis-aligned plane and chains the
// intersection segments into closed 2D contours; douglasPeucker simplifies a
// closed polygon to a tolerance. Plane→2D coordinate mapping (u, v):
//   axis 'z' → (x, y)     axis 'x' → (y, z)     axis 'y' → (x, z)

/** A triangle soup: 9 floats (3 xyz vertices) per triangle. */
export interface TriangleSoup {
  triangles: Float32Array;
}

export type SliceAxis = 'x' | 'y' | 'z';

export interface SliceContour {
  /** Flat [u0,v0,u1,v1,...] loop points. */
  points: Float64Array;
  signedArea: number;
  area: number;
  /** True when the chain failed to close (non-watertight input). */
  open: boolean;
  /** True when this closed contour sits inside an odd number of others. */
  isHole: boolean;
}

const AXIS_UV: Record<SliceAxis, [number, number]> = {
  x: [1, 2],
  y: [0, 2],
  z: [0, 1],
};
const AXIS_IDX: Record<SliceAxis, number> = { x: 0, y: 1, z: 2 };

/**
 * Slice a triangle soup at axis=value. Returns closed contours (plus open
 * chains flagged `open`, excluded from hole classification), sorted by area
 * descending.
 */
export function sliceMesh(mesh: TriangleSoup, axis: SliceAxis, value: number): SliceContour[] {
  const { triangles } = mesh;
  const ai = AXIS_IDX[axis];
  const [ui, vi] = AXIS_UV[axis];
  const nTri = triangles.length / 9;

  // Collect intersection segments. Vertices exactly on the plane get nudged
  // to the positive side (consistent tie-break → every crossing triangle
  // yields exactly one segment, no degenerate point-touches).
  const segs: number[] = []; // [u0, v0, u1, v1] per segment
  const s = new Float64Array(3);
  const P = new Float64Array(9);
  for (let t = 0; t < nTri; t++) {
    const o = t * 9;
    for (let k = 0; k < 3; k++) {
      P[k * 3] = triangles[o + k * 3];
      P[k * 3 + 1] = triangles[o + k * 3 + 1];
      P[k * 3 + 2] = triangles[o + k * 3 + 2];
      const d = P[k * 3 + ai] - value;
      s[k] = d === 0 ? 1e-12 : d;
    }
    const pts: number[] = [];
    for (let k = 0; k < 3; k++) {
      const k2 = (k + 1) % 3;
      if (s[k] > 0 !== s[k2] > 0) {
        const f = s[k] / (s[k] - s[k2]);
        const u = P[k * 3 + ui] + f * (P[k2 * 3 + ui] - P[k * 3 + ui]);
        const v = P[k * 3 + vi] + f * (P[k2 * 3 + vi] - P[k * 3 + vi]);
        pts.push(u, v);
      }
    }
    if (pts.length === 4) segs.push(pts[0], pts[1], pts[2], pts[3]);
  }
  if (segs.length === 0) return [];

  // Chain segments into loops by welding endpoints on a quantized grid.
  let minU = Infinity,
    maxU = -Infinity,
    minV = Infinity,
    maxV = -Infinity;
  for (let i = 0; i < segs.length; i += 2) {
    const u = segs[i],
      v = segs[i + 1];
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  const diag = Math.hypot(maxU - minU, maxV - minV) || 1;
  const tol = 1e-5 * diag;
  const inv = 1 / tol;
  const key = (u: number, v: number) => Math.round(u * inv) + ',' + Math.round(v * inv);

  const nSeg = segs.length / 4;
  const endsAt = new Map<string, Array<[number, number]>>(); // key -> [segIdx, whichEnd]
  for (let i = 0; i < nSeg; i++) {
    for (const e of [0, 1]) {
      const k = key(segs[i * 4 + e * 2], segs[i * 4 + e * 2 + 1]);
      let arr = endsAt.get(k);
      if (!arr) endsAt.set(k, (arr = []));
      arr.push([i, e]);
    }
  }

  const used = new Uint8Array(nSeg);
  const contours: SliceContour[] = [];
  for (let start = 0; start < nSeg; start++) {
    if (used[start]) continue;
    used[start] = 1;
    const pts: number[] = [segs[start * 4], segs[start * 4 + 1]];
    let curU = segs[start * 4 + 2],
      curV = segs[start * 4 + 3];
    const startKey = key(pts[0], pts[1]);
    let closed = false;
    for (;;) {
      const k = key(curU, curV);
      if (k === startKey) {
        closed = true;
        break;
      }
      pts.push(curU, curV);
      const cands = endsAt.get(k);
      let next: [number, number] | null = null;
      if (cands) {
        for (const [si, e] of cands) {
          if (!used[si]) {
            next = [si, e];
            break;
          }
        }
      }
      if (!next) break; // open chain (non-watertight or tolerance miss)
      const [si, e] = next;
      used[si] = 1;
      const oe = 1 - e; // walk out the other end
      curU = segs[si * 4 + oe * 2];
      curV = segs[si * 4 + oe * 2 + 1];
    }
    if (pts.length < 6) continue; // degenerate sliver
    const points = Float64Array.from(pts);
    const signedArea = polygonSignedArea(points);
    contours.push({ points, signedArea, area: Math.abs(signedArea), open: !closed, isHole: false });
  }

  // Hole classification by containment depth (even-odd on other contours).
  const closedContours = contours.filter((c) => !c.open);
  for (const c of contours) {
    if (c.open) continue;
    let depth = 0;
    for (const other of closedContours) {
      if (other === c) continue;
      if (pointInPolygon(c.points[0], c.points[1], other.points)) depth++;
    }
    c.isHole = depth % 2 === 1;
  }
  contours.sort((a, b) => b.area - a.area);
  return contours;
}

export function polygonSignedArea(points: Float64Array): number {
  const n = points.length / 2;
  let a = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += points[i * 2] * points[j * 2 + 1] - points[j * 2] * points[i * 2 + 1];
  }
  return a / 2;
}

export function pointInPolygon(u: number, v: number, points: Float64Array): boolean {
  const n = points.length / 2;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ui = points[i * 2],
      vi2 = points[i * 2 + 1];
    const uj = points[j * 2],
      vj = points[j * 2 + 1];
    if (vi2 > v !== vj > v && u < ((uj - ui) * (v - vi2)) / (vj - vi2) + ui) inside = !inside;
  }
  return inside;
}

/**
 * Douglas-Peucker for a CLOSED polygon: split at the two mutually farthest
 * points, simplify each open half, rejoin.
 */
export function douglasPeucker(points: Float64Array, tol: number): Float64Array {
  const n = points.length / 2;
  if (n <= 4) return Float64Array.from(points);
  let far = 1,
    farD = -1;
  for (let i = 1; i < n; i++) {
    const d = (points[i * 2] - points[0]) ** 2 + (points[i * 2 + 1] - points[1]) ** 2;
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const idx = (i: number): [number, number] => [points[i * 2], points[i * 2 + 1]];
  const half1: Array<[number, number]> = [];
  for (let i = 0; i <= far; i++) half1.push(idx(i));
  const half2: Array<[number, number]> = [];
  for (let i = far; i < n; i++) half2.push(idx(i));
  half2.push(idx(0));
  const s1 = dpOpen(half1, tol);
  const s2 = dpOpen(half2, tol);
  const out = [...s1.slice(0, -1), ...s2.slice(0, -1)];
  const flat = new Float64Array(out.length * 2);
  out.forEach(([u, v], i) => {
    flat[i * 2] = u;
    flat[i * 2 + 1] = v;
  });
  return flat;
}

function dpOpen(pts: Array<[number, number]>, tol: number): Array<[number, number]> {
  if (pts.length <= 2) return pts;
  const [au, av] = pts[0];
  const [bu, bv] = pts[pts.length - 1];
  const dx = bu - au,
    dy = bv - av;
  const len = Math.hypot(dx, dy) || 1e-12;
  let maxD = -1,
    maxI = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((pts[i][0] - au) * dy - (pts[i][1] - av) * dx) / len;
    if (d > maxD) {
      maxD = d;
      maxI = i;
    }
  }
  if (maxD <= tol) return [pts[0], pts[pts.length - 1]];
  const left = dpOpen(pts.slice(0, maxI + 1), tol);
  const right = dpOpen(pts.slice(maxI), tol);
  return [...left.slice(0, -1), ...right];
}
