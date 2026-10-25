// Shared per-mesh features for part detection: edge-pair adjacency, smoothed
// normals, concave-crease strength, areas, connected pieces.
//
// Computed once per (mesh, resolved FeatureOptions) and reused by every
// detector and by draft scoring. Pure + Worker-safe.
//
// Normal smoothing is opt-in (FeatureOptions.normalSmoothRadius). Scan /
// sculpt meshes carry high-frequency normal noise (the 460k-tri test figurine:
// raw per-edge bend median 2.4°, p95 14.6°), and diffusing face normals over a
// small world radius turns its grooves into clean loops. But segment:bench
// showed smoothing HURTS on clean meshes (it blurs crisp creases: mean IoU
// 0.77 raw vs 0.54 smoothed) while barely changing the scan, because hybrid
// growth's crease buckets already act as a noise floor. So the default is raw.

import type { FeatureOptions, MeshFeatures, ResolvedFeatureOptions, SegMesh } from './types';

/** Upper bound on diffusion iterations (cost guard for huge radii). */
const MAX_SMOOTH_ITERATIONS = 64;

/** Build a SegMesh from an `ImportedMesh`/`MeshData`-shaped interleaved vertex
 *  buffer (xyz are the first three properties). Vertices are assumed already
 *  position-welded — the STL parser and manifold's MeshGL both weld. */
export function toSegMesh(vertProperties: Float32Array, triVerts: Uint32Array, numProp: number): SegMesh {
  if (numProp === 3) return { positions: vertProperties, triVerts };
  const nv = Math.floor(vertProperties.length / numProp);
  const positions = new Float32Array(nv * 3);
  for (let v = 0; v < nv; v++) {
    positions[v * 3] = vertProperties[v * numProp];
    positions[v * 3 + 1] = vertProperties[v * numProp + 1];
    positions[v * 3 + 2] = vertProperties[v * numProp + 2];
  }
  return { positions, triVerts };
}

/** Median edge length (sampled for large meshes). */
export function medianEdgeLength(mesh: SegMesh): number {
  const { positions: p, triVerts: tv } = mesh;
  const nTri = tv.length / 3;
  if (nTri === 0) return 0;
  const stride = Math.max(1, Math.floor(nTri / 20000));
  const lens: number[] = [];
  for (let t = 0; t < nTri; t += stride) {
    const a = tv[t * 3] * 3, b = tv[t * 3 + 1] * 3;
    lens.push(Math.hypot(p[a] - p[b], p[a + 1] - p[b + 1], p[a + 2] - p[b + 2]));
  }
  lens.sort((x, y) => x - y);
  return lens[lens.length >> 1];
}

export function resolveFeatureOptions(opts: FeatureOptions = {}, medianEdge = 0): ResolvedFeatureOptions {
  const r = opts.normalSmoothRadius;
  if (typeof r === 'number' && Number.isFinite(r) && r > 0) return { normalSmoothRadius: r };
  const k = opts.normalSmoothEdgeLengths;
  if (typeof k === 'number' && Number.isFinite(k) && k > 0 && medianEdge > 0) return { normalSmoothRadius: k * medianEdge };
  return { normalSmoothRadius: 0 };
}

/** Stable cache key for resolved options. */
export function featureOptionsKey(o: ResolvedFeatureOptions): string {
  return `r=${o.normalSmoothRadius.toPrecision(6)}`;
}

/** Cheap content hash of an allow mask (so the cache can't serve a patch
 *  layout computed for a different focus/lock area). */
export function maskKey(allow: Uint8Array | undefined): string {
  if (!allow) return 'all';
  let h = 2166136261, n = 0;
  for (let t = 0; t < allow.length; t++) {
    if (!allow[t]) continue;
    n++;
    h = Math.imul(h ^ t, 16777619);
  }
  return `${n}:${(h >>> 0).toString(36)}`;
}

export function computeMeshFeatures(mesh: SegMesh, options: FeatureOptions = {}): MeshFeatures {
  const resolved = resolveFeatureOptions(options, medianEdgeLength(mesh));
  const { positions: p, triVerts: tv } = mesh;
  const triCount = tv.length / 3;
  const nVert = p.length / 3;

  // --- Per-triangle geometry -------------------------------------------------
  const triArea = new Float32Array(triCount);
  const triNormal = new Float32Array(triCount * 3);
  const triCentroid = new Float32Array(triCount * 3);
  let totalArea = 0;
  for (let t = 0; t < triCount; t++) {
    const a = tv[t * 3] * 3, b = tv[t * 3 + 1] * 3, c = tv[t * 3 + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    triArea[t] = len / 2;
    totalArea += len / 2;
    if (len > 0) {
      triNormal[t * 3] = nx / len; triNormal[t * 3 + 1] = ny / len; triNormal[t * 3 + 2] = nz / len;
    }
    triCentroid[t * 3] = (p[a] + p[b] + p[c]) / 3;
    triCentroid[t * 3 + 1] = (p[a + 1] + p[b + 1] + p[c + 1]) / 3;
    triCentroid[t * 3 + 2] = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
  }

  // --- Edge pairs: triangles sharing a mesh edge ----------------------------
  // Key each undirected edge by its vertex pair. The first triangle to claim
  // an edge waits in the map; the second pairs with it and clears the slot
  // (so a non-manifold fan pairs off two at a time rather than all-to-all).
  const pending = new Map<number, number>();
  const pairA: number[] = [];
  const pairB: number[] = [];
  const pairLen: number[] = [];
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const v0 = tv[t * 3 + k], v1 = tv[t * 3 + ((k + 1) % 3)];
      const lo = v0 < v1 ? v0 : v1, hi = v0 < v1 ? v1 : v0;
      const key = lo * nVert + hi;
      const other = pending.get(key);
      if (other === undefined) {
        pending.set(key, t);
      } else {
        pending.delete(key);
        if (other === t) continue;
        pairA.push(other);
        pairB.push(t);
        pairLen.push(Math.hypot(p[lo * 3] - p[hi * 3], p[lo * 3 + 1] - p[hi * 3 + 1], p[lo * 3 + 2] - p[hi * 3 + 2]));
      }
    }
  }
  const nPair = pairA.length;
  const edgeA = Int32Array.from(pairA);
  const edgeB = Int32Array.from(pairB);
  const edgeLen = Float32Array.from(pairLen);

  // CSR: triangle → incident pairs.
  const adjStart = new Int32Array(triCount + 1);
  for (let e = 0; e < nPair; e++) { adjStart[edgeA[e] + 1]++; adjStart[edgeB[e] + 1]++; }
  for (let t = 0; t < triCount; t++) adjStart[t + 1] += adjStart[t];
  const adjPair = new Int32Array(adjStart[triCount]);
  const fill = adjStart.slice(0, triCount);
  for (let e = 0; e < nPair; e++) { adjPair[fill[edgeA[e]]++] = e; adjPair[fill[edgeB[e]]++] = e; }

  // --- Smoothed normals (uniform diffusion over edge neighbours) ------------
  const medEdge = medianEdgeLength(mesh);
  const iterations = resolved.normalSmoothRadius > 0 && medEdge > 0
    ? Math.min(MAX_SMOOTH_ITERATIONS, Math.ceil((resolved.normalSmoothRadius / medEdge) ** 2))
    : 0;
  let smooth = Float32Array.from(triNormal);
  if (iterations > 0) {
    let next = new Float32Array(triCount * 3);
    for (let it = 0; it < iterations; it++) {
      for (let t = 0; t < triCount; t++) {
        let x = smooth[t * 3], y = smooth[t * 3 + 1], z = smooth[t * 3 + 2];
        for (let j = adjStart[t]; j < adjStart[t + 1]; j++) {
          const e = adjPair[j];
          const o = edgeA[e] === t ? edgeB[e] : edgeA[e];
          x += smooth[o * 3]; y += smooth[o * 3 + 1]; z += smooth[o * 3 + 2];
        }
        const len = Math.hypot(x, y, z);
        if (len > 1e-12) { next[t * 3] = x / len; next[t * 3 + 1] = y / len; next[t * 3 + 2] = z / len; }
        else { next[t * 3] = 0; next[t * 3 + 1] = 0; next[t * 3 + 2] = 0; }
      }
      const tmp = smooth; smooth = next; next = tmp;
    }
  }

  // --- Folds: dihedral, concavity, crease cost ------------------------------
  const dihedralDeg = new Float32Array(nPair);
  const concave = new Uint8Array(nPair);
  const creaseCost = new Float32Array(nPair);
  const centroidDist = new Float32Array(nPair);
  const RAD = 180 / Math.PI;
  for (let e = 0; e < nPair; e++) {
    const a = edgeA[e] * 3, b = edgeB[e] * 3;
    const dot = smooth[a] * smooth[b] + smooth[a + 1] * smooth[b + 1] + smooth[a + 2] * smooth[b + 2];
    const ang = Math.acos(Math.max(-1, Math.min(1, dot))) * RAD;
    dihedralDeg[e] = ang;
    const dx = triCentroid[b] - triCentroid[a], dy = triCentroid[b + 1] - triCentroid[a + 1], dz = triCentroid[b + 2] - triCentroid[a + 2];
    centroidDist[e] = Math.hypot(dx, dy, dz);
    // Normals converge across a valley (concave) and diverge across a ridge:
    // (n_b − n_a) · (c_b − c_a) < 0 ⇔ concave.
    const s = (smooth[b] - smooth[a]) * dx + (smooth[b + 1] - smooth[a + 1]) * dy + (smooth[b + 2] - smooth[a + 2]) * dz;
    if (s < 0) { concave[e] = 1; creaseCost[e] = ang; }
  }

  // --- Pieces (edge-connected components) -----------------------------------
  const parent = new Int32Array(triCount);
  for (let t = 0; t < triCount; t++) parent[t] = t;
  const find = (x: number): number => {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  };
  for (let e = 0; e < nPair; e++) {
    const ra = find(edgeA[e]), rb = find(edgeB[e]);
    if (ra !== rb) parent[ra < rb ? rb : ra] = ra < rb ? ra : rb;
  }
  // Number pieces by descending area so piece 0 is the main body.
  const rootArea = new Map<number, number>();
  for (let t = 0; t < triCount; t++) {
    const r = find(t);
    rootArea.set(r, (rootArea.get(r) ?? 0) + triArea[t]);
  }
  const roots = [...rootArea.keys()].sort((x, y) => (rootArea.get(y)! - rootArea.get(x)!) || x - y);
  const rootId = new Map<number, number>();
  roots.forEach((r, i) => rootId.set(r, i));
  const pieceOfTri = new Int32Array(triCount);
  for (let t = 0; t < triCount; t++) pieceOfTri[t] = rootId.get(find(t))!;

  return {
    options: resolved,
    triCount,
    edgeA, edgeB, edgeLen, centroidDist, dihedralDeg, concave, creaseCost,
    adjStart, adjPair,
    triArea, triNormal, smoothNormal: smooth, triCentroid,
    pieceOfTri, pieceCount: roots.length,
    totalArea,
    medianEdgeLen: medEdge,
  };
}

/** Index of the triangle whose centroid is nearest `point` (optionally
 *  restricted by a predicate). Linear scan — called once per seed. */
export function nearestTriangle(
  f: MeshFeatures,
  point: readonly [number, number, number],
  allow?: (t: number) => boolean,
): number {
  let best = -1, bestD = Infinity;
  const c = f.triCentroid;
  for (let t = 0; t < f.triCount; t++) {
    if (allow && !allow(t)) continue;
    const dx = c[t * 3] - point[0], dy = c[t * 3 + 1] - point[1], dz = c[t * 3 + 2] - point[2];
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestD) { bestD = d; best = t; }
  }
  return best;
}
