// Where do seeds land? (pure — used by previewSeeds, unit-tested)
//
// A seed is a world point; detection snaps it to the nearest triangle. A point
// picked off a render that is slightly off (or a typo'd coordinate) snaps
// SOMEWHERE — often to the wrong side of a thin feature — and the detection
// result is the first sign anything was wrong. Checking the landing spot
// first (triangle, distance off the surface) catches that before a run.

export interface SeedLanding {
  /** Nearest triangle (−1 on an empty mesh). */
  triangle: number;
  /** Closest point on that triangle. */
  point: [number, number, number];
  /** Distance from the seed to `point`. */
  distance: number;
  /** Unit face normal of `triangle`. */
  normal: [number, number, number];
}

/** Closest point to p on triangle (a, b, c) — Ericson, Real-Time Collision
 *  Detection §5.1.5. */
export function closestOnTriangle(
  p: ArrayLike<number>, a: ArrayLike<number>, b: ArrayLike<number>, c: ArrayLike<number>,
): [number, number, number] {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const dot = (u: number[], v: number[]) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const at = (s: number, t: number): [number, number, number] => [a[0] + s * ab[0] + t * ac[0], a[1] + s * ab[1] + t * ac[1], a[2] + s * ab[2] + t * ac[2]];
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return [a[0], a[1], a[2]];
  const bp = [p[0] - b[0], p[1] - b[1], p[2] - b[2]];
  const d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return [b[0], b[1], b[2]];
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return at(d1 / (d1 - d3), 0);
  const cp = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
  const d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return [c[0], c[1], c[2]];
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return at(0, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return [b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2])];
  }
  const denom = 1 / (va + vb + vc);
  return at(vb * denom, vc * denom);
}

/** Uniform grid of triangle centroids, for nearest-triangle queries that
 *  visit only the cells around the query point. */
interface CentroidGrid {
  min: [number, number, number];
  cell: number;
  dims: [number, number, number];
  start: Int32Array;
  tris: Int32Array;
  /** Largest centroid-to-corner distance of any triangle. */
  reach: number;
}

function buildCentroidGrid(positions: Float32Array, triVerts: Uint32Array): CentroidGrid {
  const nTri = triVerts.length / 3;
  const cen = new Float32Array(nTri * 3);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let reach = 0;
  for (let t = 0; t < nTri; t++) {
    for (let k = 0; k < 3; k++) {
      const v = triVerts[t * 3 + k] * 3;
      for (let a = 0; a < 3; a++) cen[t * 3 + a] += positions[v + a] / 3;
    }
    for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], cen[t * 3 + a]); max[a] = Math.max(max[a], cen[t * 3 + a]); }
    for (let k = 0; k < 3; k++) {
      const v = triVerts[t * 3 + k] * 3;
      reach = Math.max(reach, Math.hypot(positions[v] - cen[t * 3], positions[v + 1] - cen[t * 3 + 1], positions[v + 2] - cen[t * 3 + 2]));
    }
  }
  const ext = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1e-9);
  // ~2 triangles per cell on average, at most 128 cells per axis.
  const per = Math.max(1, Math.min(128, Math.round(Math.cbrt(nTri / 2))));
  const cell = ext / per;
  const dims: [number, number, number] = [0, 1, 2].map((a) => Math.max(1, Math.floor((max[a] - min[a]) / cell) + 1)) as [number, number, number];
  const cellOf = (t: number) => {
    const ix = Math.min(dims[0] - 1, Math.floor((cen[t * 3] - min[0]) / cell));
    const iy = Math.min(dims[1] - 1, Math.floor((cen[t * 3 + 1] - min[1]) / cell));
    const iz = Math.min(dims[2] - 1, Math.floor((cen[t * 3 + 2] - min[2]) / cell));
    return (iz * dims[1] + iy) * dims[0] + ix;
  };
  const nCells = dims[0] * dims[1] * dims[2];
  const start = new Int32Array(nCells + 1);
  for (let t = 0; t < nTri; t++) start[cellOf(t) + 1]++;
  for (let i = 0; i < nCells; i++) start[i + 1] += start[i];
  const fill = start.slice(0, nCells);
  const tris = new Int32Array(nTri);
  for (let t = 0; t < nTri; t++) tris[fill[cellOf(t)]++] = t;
  return { min, cell, dims, start, tris, reach };
}

/** Nearest triangle + closest surface point for each query point. A centroid
 *  grid limits each query to the cells within reach of the best hit so far
 *  (exact: a cell ring is only skipped once nothing in it can be closer). */
export function seedLandings(positions: Float32Array, triVerts: Uint32Array, points: [number, number, number][]): SeedLanding[] {
  const nTri = triVerts.length / 3;
  const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
  const load = (out: number[], v: number) => { out[0] = positions[v * 3]; out[1] = positions[v * 3 + 1]; out[2] = positions[v * 3 + 2]; };
  const grid = nTri > 0 ? buildCentroidGrid(positions, triVerts) : null;
  return points.map((p) => {
    let best = -1, bestD2 = Infinity;
    let bestPt: [number, number, number] = [p[0], p[1], p[2]];
    const test = (t: number) => {
      load(a, triVerts[t * 3]); load(b, triVerts[t * 3 + 1]); load(c, triVerts[t * 3 + 2]);
      // Cheap reject: the point's distance to the triangle's bounding box.
      let box = 0;
      for (let k = 0; k < 3; k++) {
        const lo = Math.min(a[k], b[k], c[k]), hi = Math.max(a[k], b[k], c[k]);
        const d = p[k] < lo ? lo - p[k] : p[k] > hi ? p[k] - hi : 0;
        box += d * d;
      }
      if (box >= bestD2) return;
      const q = closestOnTriangle(p, a, b, c);
      const d2 = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2;
      if (d2 < bestD2) { bestD2 = d2; best = t; bestPt = q; }
    };
    if (grid) {
      const { min, cell, dims, start, tris, reach } = grid;
      // Query cell (clamped into the grid) and the ring distance from p to
      // the grid for points outside it.
      const qi = [0, 1, 2].map((ax) => Math.max(0, Math.min(dims[ax] - 1, Math.floor((p[ax] - min[ax]) / cell))));
      let outside = 0;
      for (let ax = 0; ax < 3; ax++) {
        const lo = min[ax], hi = min[ax] + dims[ax] * cell;
        const d = p[ax] < lo ? lo - p[ax] : p[ax] > hi ? p[ax] - hi : 0;
        outside += d * d;
      }
      outside = Math.sqrt(outside);
      const maxRing = Math.max(dims[0], dims[1], dims[2]);
      for (let r = 0; r <= maxRing; r++) {
        // Every centroid in ring r is at least (r − 1) cells, and at least
        // the distance to the grid, from p; its triangle at most `reach`
        // closer than that.
        const lower = Math.max(0, Math.max((r - 1) * cell, outside) - reach);
        if (best >= 0 && lower * lower > bestD2) break;
        for (let iz = qi[2] - r; iz <= qi[2] + r; iz++) {
          if (iz < 0 || iz >= dims[2]) continue;
          for (let iy = qi[1] - r; iy <= qi[1] + r; iy++) {
            if (iy < 0 || iy >= dims[1]) continue;
            for (let ix = qi[0] - r; ix <= qi[0] + r; ix++) {
              if (ix < 0 || ix >= dims[0]) continue;
              if (Math.max(Math.abs(ix - qi[0]), Math.abs(iy - qi[1]), Math.abs(iz - qi[2])) !== r) continue;
              const ci = (iz * dims[1] + iy) * dims[0] + ix;
              for (let j = start[ci]; j < start[ci + 1]; j++) test(tris[j]);
            }
          }
        }
      }
    }
    let normal: [number, number, number] = [0, 0, 0];
    if (best >= 0) {
      load(a, triVerts[best * 3]); load(b, triVerts[best * 3 + 1]); load(c, triVerts[best * 3 + 2]);
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      const len = Math.hypot(nx, ny, nz) || 1;
      normal = [nx / len, ny / len, nz / len];
    }
    return { triangle: best, point: bestPt, distance: Math.sqrt(bestD2), normal };
  });
}
