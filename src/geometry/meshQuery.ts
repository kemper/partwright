/**
 * meshQuery — ray and nearest-surface queries on a triangle mesh, for model
 * code (`api.raycast` / `api.closestPoint`, see meshOps.ts).
 *
 * Slicing finds a slanted socket only partially, and guessing at "first
 * contact" depths is how an agent ends up optimising numbers that don't match
 * the real surface. A ray or a closest-point query reads the surface directly:
 * "where does a ray down this peg's axis first hit the jaw?", "how far is this
 * tooth tip from the gum?".
 *
 * Pure (no WASM, no three.js) so the unit tier can cover it. A small
 * median-split bounding-volume tree makes each query roughly O(log n), and it
 * is built once per mesh — model code that probes the same shape in a loop
 * pays the build only once.
 */

export type Vec3 = [number, number, number];

/** The fields of a manifold-3d `Mesh` this module reads. */
export interface QueryMesh {
  numProp: number;
  vertProperties: ArrayLike<number>;
  triVerts: ArrayLike<number>;
}

export interface RayHit {
  /** World-space hit point. */
  point: Vec3;
  /** Outward unit normal of the hit triangle. */
  normal: Vec3;
  /** Distance from the ray origin along the (normalised) direction. */
  distance: number;
  /** Index of the hit triangle in the mesh. */
  triangle: number;
  /** True when the ray enters the solid here (hits the outside of a face). */
  entering: boolean;
}

export interface ClosestPoint {
  /** The nearest point on the surface. */
  point: Vec3;
  /** Outward unit normal of the triangle the nearest point lies on. */
  normal: Vec3;
  /** Distance from the query point to `point`. */
  distance: number;
  triangle: number;
  /** Whether the query point is inside the solid (ray parity — assumes a
   *  closed mesh, which every Manifold is). */
  inside: boolean;
}

const LEAF_SIZE = 8;

/** A flat bounding-volume tree. Node i owns `boxes[6i..6i+6)` (minX, minY,
 *  minZ, maxX, maxY, maxZ). An inner node has `count[i] === 0` and children
 *  `left[i]` / `left[i] + 1`; a leaf holds `tris[start[i] .. start[i]+count[i])`. */
export interface MeshBvh {
  mesh: QueryMesh;
  numTri: number;
  boxes: Float64Array;
  left: Int32Array;
  start: Int32Array;
  count: Int32Array;
  tris: Int32Array;
}

function vert(m: QueryMesh, tri: number, k: number, out: number[]): void {
  const v = (m.triVerts[tri * 3 + k] as number) * m.numProp;
  out[0] = m.vertProperties[v] as number;
  out[1] = m.vertProperties[v + 1] as number;
  out[2] = m.vertProperties[v + 2] as number;
}

/** Build the tree for `mesh`. */
export function buildMeshBvh(mesh: QueryMesh): MeshBvh {
  const numTri = Math.floor(mesh.triVerts.length / 3);
  const tris = new Int32Array(numTri);
  const cent = new Float64Array(numTri * 3);
  const triBox = new Float64Array(numTri * 6);
  const p = [0, 0, 0];
  let gx0 = Infinity, gy0 = Infinity, gz0 = Infinity, gx1 = -Infinity, gy1 = -Infinity, gz1 = -Infinity;
  for (let t = 0; t < numTri; t++) {
    tris[t] = t;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let k = 0; k < 3; k++) {
      vert(mesh, t, k, p);
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
      if (p[2] < z0) z0 = p[2]; if (p[2] > z1) z1 = p[2];
    }
    triBox.set([x0, y0, z0, x1, y1, z1], t * 6);
    if (x0 < gx0) gx0 = x0; if (y0 < gy0) gy0 = y0; if (z0 < gz0) gz0 = z0;
    if (x1 > gx1) gx1 = x1; if (y1 > gy1) gy1 = y1; if (z1 > gz1) gz1 = z1;
    cent[t * 3] = (x0 + x1) / 2; cent[t * 3 + 1] = (y0 + y1) / 2; cent[t * 3 + 2] = (z0 + z1) / 2;
  }
  // Pad every triangle box a hair (relative to the whole mesh) so a ray that
  // grazes a vertex or edge exactly — a box face, in floating point — isn't
  // pruned before the per-triangle test, which has its own tolerance.
  const eps = 1e-7 * Math.max(gx1 - gx0, gy1 - gy0, gz1 - gz0, 1e-12);
  for (let i = 0; i < triBox.length; i += 6) {
    triBox[i] -= eps; triBox[i + 1] -= eps; triBox[i + 2] -= eps;
    triBox[i + 3] += eps; triBox[i + 4] += eps; triBox[i + 5] += eps;
  }
  // Every leaf holds >= 1 triangle, so the tree has at most 2n - 1 nodes.
  const maxNodes = Math.max(1, 2 * numTri - 1);
  const boxes = new Float64Array(maxNodes * 6);
  const left = new Int32Array(maxNodes);
  const start = new Int32Array(maxNodes);
  const count = new Int32Array(maxNodes);
  let nodes = 1;

  const stack: [number, number, number][] = [[0, 0, numTri]]; // node, start, end
  while (stack.length > 0) {
    const [node, s, e] = stack.pop()!;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    let cx0 = Infinity, cy0 = Infinity, cz0 = Infinity, cx1 = -Infinity, cy1 = -Infinity, cz1 = -Infinity;
    for (let i = s; i < e; i++) {
      const t = tris[i], b = t * 6, c = t * 3;
      if (triBox[b] < x0) x0 = triBox[b]; if (triBox[b + 3] > x1) x1 = triBox[b + 3];
      if (triBox[b + 1] < y0) y0 = triBox[b + 1]; if (triBox[b + 4] > y1) y1 = triBox[b + 4];
      if (triBox[b + 2] < z0) z0 = triBox[b + 2]; if (triBox[b + 5] > z1) z1 = triBox[b + 5];
      if (cent[c] < cx0) cx0 = cent[c]; if (cent[c] > cx1) cx1 = cent[c];
      if (cent[c + 1] < cy0) cy0 = cent[c + 1]; if (cent[c + 1] > cy1) cy1 = cent[c + 1];
      if (cent[c + 2] < cz0) cz0 = cent[c + 2]; if (cent[c + 2] > cz1) cz1 = cent[c + 2];
    }
    boxes.set([x0, y0, z0, x1, y1, z1], node * 6);
    const n = e - s;
    const ex = cx1 - cx0, ey = cy1 - cy0, ez = cz1 - cz0;
    if (n <= LEAF_SIZE || Math.max(ex, ey, ez) <= 0) {
      start[node] = s; count[node] = n;
      continue;
    }
    // Split at the centroid midpoint of the widest axis; fall back to a
    // median split when everything lands on one side.
    const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
    const mid = axis === 0 ? (cx0 + cx1) / 2 : axis === 1 ? (cy0 + cy1) / 2 : (cz0 + cz1) / 2;
    let i = s, j = e - 1;
    while (i <= j) {
      if (cent[tris[i] * 3 + axis] < mid) i++;
      else { const tmp = tris[i]; tris[i] = tris[j]; tris[j] = tmp; j--; }
    }
    let split = i;
    if (split === s || split === e) {
      const sub = Array.from(tris.subarray(s, e)).sort((a, b) => cent[a * 3 + axis] - cent[b * 3 + axis]);
      tris.set(sub, s);
      split = s + (n >> 1);
    }
    const l = nodes;
    nodes += 2;
    left[node] = l; count[node] = 0;
    stack.push([l, s, split], [l + 1, split, e]);
  }
  return { mesh, numTri, boxes: boxes.slice(0, nodes * 6), left, start, count, tris };
}

function triNormal(a: number[], b: number[], c: number[]): Vec3 {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

/** Ray-box slab test: the entry distance, or Infinity on a miss. */
function rayBox(b: Float64Array, i: number, o: Vec3, inv: Vec3, maxT: number): number {
  let t0 = 0, t1 = maxT;
  for (let a = 0; a < 3; a++) {
    let near = (b[i + a] - o[a]) * inv[a];
    let far = (b[i + 3 + a] - o[a]) * inv[a];
    if (near > far) { const tmp = near; near = far; far = tmp; }
    // NaN (0 × ∞ on an axis-parallel ray along a box face) must not reject.
    if (near > t0) t0 = near;
    if (far < t1) t1 = far;
    if (t0 > t1) return Infinity;
  }
  return t0;
}

/** Every triangle the ray crosses within `maxDistance`, nearest first. Both
 *  faces count (`entering` tells them apart). `dir` need not be normalised;
 *  distances are along the normalised direction. */
export function raycastAll(bvh: MeshBvh, origin: Vec3, dir: Vec3, maxDistance = Infinity): RayHit[] {
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  if (!(len > 0)) return [];
  const d: Vec3 = [dir[0] / len, dir[1] / len, dir[2] / len];
  const inv: Vec3 = [1 / d[0], 1 / d[1], 1 / d[2]];
  const hits: RayHit[] = [];
  if (bvh.numTri === 0) return hits;
  const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
  const stack = [0];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (rayBox(bvh.boxes, node * 6, origin, inv, maxDistance) === Infinity) continue;
    if (bvh.count[node] === 0) { stack.push(bvh.left[node], bvh.left[node] + 1); continue; }
    for (let k = bvh.start[node], end = k + bvh.count[node]; k < end; k++) {
      const t = bvh.tris[k];
      vert(bvh.mesh, t, 0, a); vert(bvh.mesh, t, 1, b); vert(bvh.mesh, t, 2, c);
      // Möller–Trumbore, two-sided.
      const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
      const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
      const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-14) continue;
      const id = 1 / det;
      const sx = origin[0] - a[0], sy = origin[1] - a[1], sz = origin[2] - a[2];
      const u = (sx * px + sy * py + sz * pz) * id;
      if (u < -1e-9 || u > 1 + 1e-9) continue;
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
      const v = (d[0] * qx + d[1] * qy + d[2] * qz) * id;
      if (v < -1e-9 || u + v > 1 + 1e-9) continue;
      const dist = (e2x * qx + e2y * qy + e2z * qz) * id;
      if (dist < 0 || dist > maxDistance) continue;
      const normal = triNormal(a, b, c);
      hits.push({
        point: [origin[0] + d[0] * dist, origin[1] + d[1] * dist, origin[2] + d[2] * dist],
        normal,
        distance: dist,
        triangle: t,
        entering: normal[0] * d[0] + normal[1] * d[1] + normal[2] * d[2] < 0,
      });
    }
  }
  hits.sort((p, q) => p.distance - q.distance);
  // A ray through a shared edge or vertex crosses each adjoining triangle at
  // the same distance — report that crossing once.
  const out: RayHit[] = [];
  for (const h of hits) {
    const prev = out[out.length - 1];
    if (prev && prev.entering === h.entering && h.distance - prev.distance <= 1e-9 * (1 + h.distance)) continue;
    out.push(h);
  }
  return out;
}

/** Closest point on triangle abc to p (Ericson, Real-Time Collision Detection 5.1.5). */
function closestOnTriangle(p: Vec3, a: number[], b: number[], c: number[]): Vec3 {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
  const apx = p[0] - a[0], apy = p[1] - a[1], apz = p[2] - a[2];
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return [a[0], a[1], a[2]];
  const bpx = p[0] - b[0], bpy = p[1] - b[1], bpz = p[2] - b[2];
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return [b[0], b[1], b[2]];
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return [a[0] + abx * v, a[1] + aby * v, a[2] + abz * v];
  }
  const cpx = p[0] - c[0], cpy = p[1] - c[1], cpz = p[2] - c[2];
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return [c[0], c[1], c[2]];
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return [a[0] + acx * w, a[1] + acy * w, a[2] + acz * w];
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return [b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w];
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  return [a[0] + abx * v + acx * w, a[1] + aby * v + acy * w, a[2] + abz * v + acz * w];
}

function boxDistSq(b: Float64Array, i: number, p: Vec3): number {
  let s = 0;
  for (let a = 0; a < 3; a++) {
    const v = p[a] < b[i + a] ? b[i + a] - p[a] : p[a] > b[i + 3 + a] ? p[a] - b[i + 3 + a] : 0;
    s += v * v;
  }
  return s;
}

// Parity ray for the inside test: an irrational-ish direction so it almost
// never grazes an edge or vertex of an axis-aligned model exactly.
const PARITY_DIR: Vec3 = [0.5773502691896258 + 0.0123, 0.5773502691896258 - 0.0217, 0.5773502691896258 + 0.0071];

/** Whether `p` is inside the closed mesh (ray parity). */
export function meshContains(bvh: MeshBvh, p: Vec3): boolean {
  // raycastAll already merges coincident crossings on a shared edge.
  return raycastAll(bvh, p, PARITY_DIR).length % 2 === 1;
}

/** The nearest surface point to `p`, or null for an empty mesh. */
export function closestPoint(bvh: MeshBvh, p: Vec3): ClosestPoint | null {
  if (bvh.numTri === 0) return null;
  let best = Infinity, bestTri = -1;
  let bestPt: Vec3 = [0, 0, 0];
  const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
  // Visit the nearer child first so `best` shrinks fast and prunes the rest.
  const stack: number[] = [0];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (boxDistSq(bvh.boxes, node * 6, p) >= best) continue;
    if (bvh.count[node] === 0) {
      const l = bvh.left[node], r = l + 1;
      const dl = boxDistSq(bvh.boxes, l * 6, p), dr = boxDistSq(bvh.boxes, r * 6, p);
      if (dl < dr) stack.push(r, l); else stack.push(l, r);
      continue;
    }
    for (let k = bvh.start[node], end = k + bvh.count[node]; k < end; k++) {
      const t = bvh.tris[k];
      vert(bvh.mesh, t, 0, a); vert(bvh.mesh, t, 1, b); vert(bvh.mesh, t, 2, c);
      const q = closestOnTriangle(p, a, b, c);
      const dsq = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2;
      if (dsq < best) { best = dsq; bestTri = t; bestPt = q; }
    }
  }
  vert(bvh.mesh, bestTri, 0, a); vert(bvh.mesh, bestTri, 1, b); vert(bvh.mesh, bestTri, 2, c);
  return { point: bestPt, normal: triNormal(a, b, c), distance: Math.sqrt(best), triangle: bestTri, inside: meshContains(bvh, p) };
}
