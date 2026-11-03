// Pure helpers for `api.splitParts` (meshSdfOps.ts): the seam between one part
// and the rest of a mesh, a best-fit plane through it, and per-triangle
// originalID rewriting. No WASM — unit-tested in tests/unit/splitParts.test.ts.

export type Vec3 = [number, number, number];

export interface SplitMesh {
  vertProperties: ArrayLike<number>;
  triVerts: ArrayLike<number>;
  numProp: number;
  runIndex?: ArrayLike<number>;
  runOriginalID?: ArrayLike<number>;
}

/** Per-triangle originalID from the mesh's runs (0 where a mesh has none). */
export function triangleIds(mesh: SplitMesh): Uint32Array {
  const numTri = Math.floor(mesh.triVerts.length / 3);
  const out = new Uint32Array(numTri);
  const ri = mesh.runIndex, rid = mesh.runOriginalID;
  if (!ri || !rid) return out;
  for (let r = 0; r < rid.length; r++) {
    const a = Math.floor(ri[r] / 3), b = Math.min(numTri, Math.floor(ri[r + 1] / 3));
    for (let t = a; t < b; t++) out[t] = rid[r];
  }
  return out;
}

/** Runs (contiguous equal ids) for a per-triangle id array — the inverse of
 *  triangleIds, without reordering triangles. */
export function runsFromIds(ids: ArrayLike<number>): { runIndex: Uint32Array; runOriginalID: Uint32Array } {
  const starts: number[] = [];
  const vals: number[] = [];
  for (let t = 0; t < ids.length; t++) {
    if (t === 0 || ids[t] !== ids[t - 1]) { starts.push(t * 3); vals.push(ids[t]); }
  }
  const runIndex = new Uint32Array(starts.length + 1);
  starts.forEach((s, i) => { runIndex[i] = s; });
  runIndex[starts.length] = ids.length * 3;
  return { runIndex, runOriginalID: Uint32Array.from(vals) };
}

/** Canonical vertex index per vertex, merging vertices at the same position
 *  (a mesh can split one position into several vertices at property seams). */
function canonicalVerts(mesh: SplitMesh): Int32Array {
  const vp = mesh.vertProperties, np = mesh.numProp;
  const nv = Math.floor(vp.length / np);
  const out = new Int32Array(nv);
  const seen = new Map<string, number>();
  for (let v = 0; v < nv; v++) {
    const key = `${vp[v * np]},${vp[v * np + 1]},${vp[v * np + 2]}`;
    const hit = seen.get(key);
    if (hit === undefined) { seen.set(key, v); out[v] = v; } else out[v] = hit;
  }
  return out;
}

export interface SeamFit {
  /** Length-weighted centre of the seam. */
  point: Vec3;
  /** Unit normal of the best-fit plane, pointing INTO the part. */
  normal: Vec3;
  /** RMS distance of the seam from the plane. */
  rms: number;
  /** RMS distance of the seam from its centre (its size). */
  radius: number;
  /** Separate closed seam loops (an arm on a torso: 1; a torso: one per neighbour). */
  loops: number;
  /** Total seam length. */
  length: number;
}

/** The seam between the masked triangles and the rest (edges with a masked
 *  face on one side only) and its best-fit plane. Null when there is no seam
 *  (the part is a separate piece, or the whole mesh). Edges against
 *  `ignore`d faces aren't seam. */
export function fitSeam(mesh: SplitMesh, mask: Uint8Array, ignore?: Uint8Array): SeamFit | null {
  const tv = mesh.triVerts, vp = mesh.vertProperties, np = mesh.numProp;
  const numTri = Math.floor(tv.length / 3);
  const canon = canonicalVerts(mesh);
  // Edge key -> mask parity: +1 per masked face, +1000 per unmasked face.
  const nv = canon.length;
  const edges = new Map<number, number>();
  for (let t = 0; t < numTri; t++) {
    // Faces in `ignore` (pieces already cut away) don't make a seam.
    if (ignore && ignore[t] && !mask[t]) continue;
    const w = mask[t] ? 1 : 1000;
    for (let k = 0; k < 3; k++) {
      const a = canon[tv[t * 3 + k]], b = canon[tv[t * 3 + ((k + 1) % 3)]];
      const lo = a < b ? a : b, hi = a < b ? b : a;
      const key = lo * nv + hi;
      edges.set(key, (edges.get(key) ?? 0) + w);
    }
  }
  const seam: [number, number][] = [];
  for (const [key, w] of edges) {
    if (w % 1000 > 0 && w >= 1000) seam.push([Math.floor(key / nv), key % nv]);
  }
  if (seam.length === 0) return null;
  // Loops: connected components of the seam graph.
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r)! !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c)! !== r) { const n = parent.get(c)!; parent.set(c, r); c = n; }
    return r;
  };
  for (const [a, b] of seam) {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  const roots = new Set<number>();
  for (const v of parent.keys()) roots.add(find(v));
  // Length-weighted centroid + covariance of the edge midpoints.
  const P = (v: number): Vec3 => [vp[v * np], vp[v * np + 1], vp[v * np + 2]];
  let L = 0;
  const c: Vec3 = [0, 0, 0];
  const mids: { m: Vec3; w: number }[] = [];
  for (const [a, b] of seam) {
    const pa = P(a), pb = P(b);
    const w = Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]);
    if (w <= 0) continue;
    const m: Vec3 = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2];
    mids.push({ m, w });
    L += w;
    for (let k = 0; k < 3; k++) c[k] += w * m[k];
  }
  if (L <= 0) return null;
  for (let k = 0; k < 3; k++) c[k] /= L;
  const cov = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const { m, w } of mids) {
    const d = [m[0] - c[0], m[1] - c[1], m[2] - c[2]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i * 3 + j] += w * d[i] * d[j];
  }
  for (let i = 0; i < 9; i++) cov[i] /= L;
  const { vectors, values } = symmetricEigen3(cov);
  // Smallest eigenvalue's vector is the plane normal.
  let n = vectors[0];
  const rms = Math.sqrt(Math.max(0, values[0]));
  const radius = Math.sqrt(Math.max(0, values[0] + values[1] + values[2]));
  // Orient into the part: towards the masked faces' area-weighted centroid.
  const pc = maskCentroid(mesh, mask);
  if (pc && (pc[0] - c[0]) * n[0] + (pc[1] - c[1]) * n[1] + (pc[2] - c[2]) * n[2] < 0) n = [-n[0], -n[1], -n[2]];
  return { point: c, normal: n, rms, radius, loops: roots.size, length: L };
}

/** Area-weighted centroid of the masked triangles (null when none). */
function maskCentroid(mesh: SplitMesh, mask: Uint8Array): Vec3 | null {
  const r = maskAreaNormal(mesh, mask);
  return r ? r.centroid : null;
}

/** Area, area-weighted centroid and (unit) mean outward normal of the masked
 *  triangles. Null when none have area. */
export function maskAreaNormal(mesh: SplitMesh, mask: Uint8Array): { area: number; centroid: Vec3; normal: Vec3 } | null {
  const tv = mesh.triVerts, vp = mesh.vertProperties, np = mesh.numProp;
  const numTri = Math.floor(tv.length / 3);
  let area = 0;
  const c: Vec3 = [0, 0, 0], n: Vec3 = [0, 0, 0];
  for (let t = 0; t < numTri; t++) {
    if (!mask[t]) continue;
    const a = tv[t * 3] * np, b = tv[t * 3 + 1] * np, d = tv[t * 3 + 2] * np;
    const ux = vp[b] - vp[a], uy = vp[b + 1] - vp[a + 1], uz = vp[b + 2] - vp[a + 2];
    const vx = vp[d] - vp[a], vy = vp[d + 1] - vp[a + 1], vz = vp[d + 2] - vp[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const ar = 0.5 * Math.hypot(cx, cy, cz);
    n[0] += 0.5 * cx; n[1] += 0.5 * cy; n[2] += 0.5 * cz;
    for (let k = 0; k < 3; k++) c[k] += ar * (vp[a + k] + vp[b + k] + vp[d + k]) / 3;
    area += ar;
  }
  if (area <= 0) return null;
  const nl = Math.hypot(n[0], n[1], n[2]);
  return {
    area,
    centroid: [c[0] / area, c[1] / area, c[2] / area],
    normal: nl > 0 ? [n[0] / nl, n[1] / nl, n[2] / nl] : [0, 0, 1],
  };
}

/** Eigen-decomposition of a symmetric 3×3 (row-major) by Jacobi rotations.
 *  Values ascending, vectors[i] is the unit eigenvector of values[i]. */
export function symmetricEigen3(m: number[]): { values: [number, number, number]; vectors: [Vec3, Vec3, Vec3] } {
  const a = m.slice();
  const v = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = a[1] * a[1] + a[2] * a[2] + a[5] * a[5];
    if (off < 1e-30) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]] as const) {
      const apq = a[p * 3 + q];
      if (Math.abs(apq) < 1e-300) continue;
      const theta = (a[q * 3 + q] - a[p * 3 + p]) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const cs = 1 / Math.sqrt(t * t + 1), sn = t * cs;
      for (let k = 0; k < 3; k++) {
        const akp = a[k * 3 + p], akq = a[k * 3 + q];
        a[k * 3 + p] = cs * akp - sn * akq;
        a[k * 3 + q] = sn * akp + cs * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p * 3 + k], aqk = a[q * 3 + k];
        a[p * 3 + k] = cs * apk - sn * aqk;
        a[q * 3 + k] = sn * apk + cs * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k * 3 + p], vkq = v[k * 3 + q];
        v[k * 3 + p] = cs * vkp - sn * vkq;
        v[k * 3 + q] = sn * vkp + cs * vkq;
      }
    }
  }
  const pairs = [0, 1, 2].map(i => ({ val: a[i * 4], vec: [v[i], v[3 + i], v[6 + i]] as Vec3 }));
  pairs.sort((x, y) => x.val - y.val);
  return {
    values: [pairs[0].val, pairs[1].val, pairs[2].val],
    vectors: [pairs[0].vec, pairs[1].vec, pairs[2].vec],
  };
}

/** Right-handed orthonormal frame [u, v, axis] around a unit axis — column-
 *  major Mat4 mapping local (x, y, z) to origin + x·u + y·v + z·axis. */
export function frameMatrix(axis: Vec3, origin: Vec3): { u: Vec3; v: Vec3; mat: number[] } {
  const a = normalize(axis);
  const helper: Vec3 = Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = normalize(cross(helper, a));
  const v = cross(a, u);
  return {
    u, v,
    mat: [u[0], u[1], u[2], 0, v[0], v[1], v[2], 0, a[0], a[1], a[2], 0, origin[0], origin[1], origin[2], 1],
  };
}

export function normalize(p: Vec3): Vec3 {
  const l = Math.hypot(p[0], p[1], p[2]) || 1;
  return [p[0] / l, p[1] / l, p[2] / l];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** The masked triangles projected onto the plane ⟂ axis (local u/v coords),
 *  each wound counter-clockwise so a 'Positive' fill unions them, plus the
 *  masked vertices' extent along the axis. */
export function projectMask(mesh: SplitMesh, mask: Uint8Array, u: Vec3, v: Vec3, axis: Vec3): { polys: [number, number][][]; minA: number; maxA: number } {
  const tv = mesh.triVerts, vp = mesh.vertProperties, np = mesh.numProp;
  const numTri = Math.floor(tv.length / 3);
  const polys: [number, number][][] = [];
  let minA = Infinity, maxA = -Infinity;
  for (let t = 0; t < numTri; t++) {
    if (!mask[t]) continue;
    const pts: [number, number][] = [];
    for (let k = 0; k < 3; k++) {
      const o = tv[t * 3 + k] * np;
      const x = vp[o], y = vp[o + 1], z = vp[o + 2];
      pts.push([x * u[0] + y * u[1] + z * u[2], x * v[0] + y * v[1] + z * v[2]]);
      const s = x * axis[0] + y * axis[1] + z * axis[2];
      if (s < minA) minA = s;
      if (s > maxA) maxA = s;
    }
    const area2 = (pts[1][0] - pts[0][0]) * (pts[2][1] - pts[0][1]) - (pts[2][0] - pts[0][0]) * (pts[1][1] - pts[0][1]);
    if (Math.abs(area2) < 1e-12) continue;
    polys.push(area2 > 0 ? pts : [pts[0], pts[2], pts[1]]);
  }
  return { polys, minA, maxA };
}
