// Boundary loops between two triangle sets (parts / labels) — pure, Worker-
// and unit-test-safe.
//
// The seam between part A and part B is the set of mesh edges with an A
// triangle on one side and a B triangle on the other. Chained end to end those
// edges form polylines: a closed loop for a collar or cuff that runs all the
// way round, an open chain where the seam ends (a third part interrupts it, or
// it reaches a mesh border). `partBoundary` returns them so a caller can paint
// a band along the seam (`paintAlongBoundary`), measure it, or place things on
// it.
//
// Vertices are matched by POSITION (quantized), not index, so meshes whose
// vertices are split at attribute seams (or STL soups) still chain.

import type { MeshData } from '../geometry/types';

export interface BoundaryLoop {
  /** Ordered points along the seam. For a closed loop the first point is
   *  NOT repeated at the end. */
  points: [number, number, number][];
  closed: boolean;
  /** Polyline length (including the closing segment of a closed loop). */
  length: number;
}

/** Ordered seam polylines between triangle sets `a` and `b` on `mesh`,
 *  longest first. Empty when the parts don't touch. */
export function partBoundaryLoops(mesh: MeshData, a: ReadonlySet<number>, b: ReadonlySet<number>): BoundaryLoop[] {
  const { vertProperties: vp, triVerts: tv, numProp: P } = mesh;
  // --- weld by quantized position over the triangles of a ∪ b only --------
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const tris: number[] = [];
  for (const set of [a, b]) for (const t of set) if (t >= 0 && t < mesh.numTri) tris.push(t);
  for (const t of tris) {
    for (let k = 0; k < 3; k++) {
      const v = tv[t * 3 + k] * P;
      const x = vp[v], y = vp[v + 1], z = vp[v + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
  }
  if (tris.length === 0) return [];
  const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const q = diag * 1e-7;
  const weld = new Map<string, number>();
  const pos: number[] = [];
  const welded = new Map<number, number>(); // raw vertex → welded id
  const wid = (raw: number): number => {
    const hit = welded.get(raw);
    if (hit !== undefined) return hit;
    const o = raw * P;
    const key = `${Math.round(vp[o] / q)},${Math.round(vp[o + 1] / q)},${Math.round(vp[o + 2] / q)}`;
    let id = weld.get(key);
    if (id === undefined) {
      id = pos.length / 3;
      weld.set(key, id);
      pos.push(vp[o], vp[o + 1], vp[o + 2]);
    }
    welded.set(raw, id);
    return id;
  };

  // --- edges: which side(s) own each welded edge -------------------------
  // bit 1 = an A triangle uses the edge, bit 2 = a B triangle does.
  const edgeSide = new Map<string, number>();
  const mark = (set: ReadonlySet<number>, bit: number) => {
    for (const t of set) {
      if (t < 0 || t >= mesh.numTri) continue;
      const w = [wid(tv[t * 3]), wid(tv[t * 3 + 1]), wid(tv[t * 3 + 2])];
      for (let k = 0; k < 3; k++) {
        const u = w[k], v = w[(k + 1) % 3];
        if (u === v) continue;
        const key = u < v ? `${u},${v}` : `${v},${u}`;
        edgeSide.set(key, (edgeSide.get(key) ?? 0) | bit);
      }
    }
  };
  mark(a, 1);
  mark(b, 2);

  // --- seam graph ---------------------------------------------------------
  const adj = new Map<number, number[]>();
  const link = (u: number, v: number) => {
    let l = adj.get(u);
    if (!l) { l = []; adj.set(u, l); }
    l.push(v);
  };
  const edgeUsed = new Set<string>();
  for (const [key, side] of edgeSide) {
    if (side !== 3) continue;
    const [u, v] = key.split(',').map(Number);
    link(u, v); link(v, u);
  }
  if (adj.size === 0) return [];

  const ek = (u: number, v: number) => (u < v ? `${u},${v}` : `${v},${u}`);
  const walk = (start: number, first: number): number[] => {
    const chain = [start];
    let prev = start, cur = first;
    edgeUsed.add(ek(start, first));
    for (;;) {
      chain.push(cur);
      const nbrs = adj.get(cur)!;
      // Stop at a junction (degree ≠ 2) — the chain ends there.
      if (nbrs.length !== 2) break;
      const next = nbrs[0] === prev ? nbrs[1] : nbrs[0];
      const e = ek(cur, next);
      if (edgeUsed.has(e)) break;
      edgeUsed.add(e);
      prev = cur; cur = next;
      if (cur === start) { chain.push(cur); break; }
    }
    return chain;
  };

  const chains: number[][] = [];
  // Open chains first: start at every endpoint / junction.
  for (const [v, nbrs] of adj) {
    if (nbrs.length === 2) continue;
    for (const n of nbrs) if (!edgeUsed.has(ek(v, n))) chains.push(walk(v, n));
  }
  // What remains are simple cycles.
  for (const [v, nbrs] of adj) {
    for (const n of nbrs) if (!edgeUsed.has(ek(v, n))) chains.push(walk(v, n));
  }

  const loops: BoundaryLoop[] = chains.map((c) => {
    const closed = c.length > 2 && c[0] === c[c.length - 1];
    const ids = closed ? c.slice(0, -1) : c;
    const points = ids.map((id) => [pos[id * 3], pos[id * 3 + 1], pos[id * 3 + 2]] as [number, number, number]);
    let length = 0;
    for (let i = 1; i < c.length; i++) {
      const p = c[i - 1] * 3, r = c[i] * 3;
      length += Math.hypot(pos[r] - pos[p], pos[r + 1] - pos[p + 1], pos[r + 2] - pos[p + 2]);
    }
    return { points, closed, length };
  });
  loops.sort((x, y) => y.length - x.length);
  return loops;
}

/** Resample a polyline at (about) even arc-length spacing `step`, keeping its
 *  first and last points. A closed loop is treated as returning to its first
 *  point, and the result repeats that point at the end (ready to use as a
 *  closed stroke path). */
export function resamplePolyline(points: [number, number, number][], closed: boolean, step: number): [number, number, number][] {
  const path = closed && points.length > 1 ? [...points, points[0]] : points;
  if (path.length < 2 || !(step > 0)) return path.map((p) => [p[0], p[1], p[2]]);
  const out: [number, number, number][] = [[path[0][0], path[0][1], path[0][2]]];
  let carry = 0; // distance travelled since the last emitted point
  for (let i = 1; i < path.length; i++) {
    const p = path[i - 1], r = path[i];
    const seg = Math.hypot(r[0] - p[0], r[1] - p[1], r[2] - p[2]);
    let s = step - carry;
    while (s <= seg) {
      const t = s / seg;
      out.push([p[0] + t * (r[0] - p[0]), p[1] + t * (r[1] - p[1]), p[2] + t * (r[2] - p[2])]);
      s += step;
    }
    carry = seg - (s - step);
  }
  const last = path[path.length - 1];
  const tail = out[out.length - 1];
  if (tail[0] !== last[0] || tail[1] !== last[1] || tail[2] !== last[2]) out.push([last[0], last[1], last[2]]);
  return out;
}
