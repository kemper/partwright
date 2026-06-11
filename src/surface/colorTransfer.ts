// Nearest-triangle color transfer — carry paint from an OLD mesh onto a NEW
// mesh whose topology has changed (denser, displaced, or re-tessellated by a
// surface modifier). Region descriptors (coplanar/slab/…) re-resolve by
// geometry and so collapse to nothing once fuzzy/smooth perturb the surface;
// this maps purely by spatial proximity of triangle centroids, which is
// topology-independent and survives displacement.
//
// Pure logic (no DOM/engine), so it lives here and is unit-tested in the vitest
// tier. The caller turns the resulting per-new-triangle assignment into
// `{ kind: 'triangles' }` color regions, which persist because the
// import→ofMesh→getMesh pipeline is deterministic (same input ⇒ same output
// mesh every run), so the raw triangle ids stay valid across reloads.

import type { MeshData } from '../geometry/types';

function centroids(mesh: MeshData): Float32Array {
  const { vertProperties: vp, triVerts: tv, numProp, numTri } = mesh;
  const out = new Float32Array(numTri * 3);
  for (let t = 0; t < numTri; t++) {
    const a = tv[t * 3] * numProp, b = tv[t * 3 + 1] * numProp, c = tv[t * 3 + 2] * numProp;
    out[t * 3] = (vp[a] + vp[b] + vp[c]) / 3;
    out[t * 3 + 1] = (vp[a + 1] + vp[b + 1] + vp[c + 1]) / 3;
    out[t * 3 + 2] = (vp[a + 2] + vp[b + 2] + vp[c + 2]) / 3;
  }
  return out;
}

/** For each triangle of `newMesh`, the index of the nearest (by centroid)
 *  triangle of `oldMesh`. Returns an `Int32Array` of length `newMesh.numTri`
 *  (entries are `-1` only when `oldMesh` has no triangles). Uses a uniform
 *  spatial hash over old centroids with ring-expanding search, so it stays
 *  near-linear instead of the naive O(new·old). */
export function nearestTriangleMap(oldMesh: MeshData, newMesh: MeshData): Int32Array {
  const result = new Int32Array(newMesh.numTri).fill(-1);
  if (oldMesh.numTri === 0 || newMesh.numTri === 0) return result;

  const oc = centroids(oldMesh);
  // Bounds of the old centroids.
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < oldMesh.numTri; i++) {
    const x = oc[i * 3], y = oc[i * 3 + 1], z = oc[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-6);
  // Aim for ~1 triangle per cell on average: n cells per axis ≈ cbrt(numTri).
  const n = Math.max(1, Math.round(Math.cbrt(oldMesh.numTri)));
  const cell = span / n || 1;
  const cx = (x: number) => Math.floor((x - minX) / cell);
  const cy = (y: number) => Math.floor((y - minY) / cell);
  const cz = (z: number) => Math.floor((z - minZ) / cell);
  const key = (ix: number, iy: number, iz: number) => `${ix},${iy},${iz}`;

  const buckets = new Map<string, number[]>();
  for (let i = 0; i < oldMesh.numTri; i++) {
    const k = key(cx(oc[i * 3]), cy(oc[i * 3 + 1]), cz(oc[i * 3 + 2]));
    let arr = buckets.get(k);
    if (!arr) { arr = []; buckets.set(k, arr); }
    arr.push(i);
  }

  const nc = centroids(newMesh);
  // Old and new meshes are spatially coincident (a modifier displaces the
  // surface only slightly), so the nearest is almost always in ring 0–1. The
  // cap bounds the search for any stray centroid outside the old bounds.
  const maxR = n * 2 + 4;
  for (let t = 0; t < newMesh.numTri; t++) {
    const px = nc[t * 3], py = nc[t * 3 + 1], pz = nc[t * 3 + 2];
    const bx = cx(px), by = cy(py), bz = cz(pz);
    let best = -1, bestD = Infinity;
    for (let r = 0; r <= maxR; r++) {
      // Stop once no candidate in this ring or beyond can beat the best found:
      // the closest a point in Chebyshev ring r can be is (r-1)·cell.
      if (best >= 0 && Math.sqrt(bestD) <= (r - 1) * cell) break;
      for (let ix = bx - r; ix <= bx + r; ix++) {
        for (let iy = by - r; iy <= by + r; iy++) {
          for (let iz = bz - r; iz <= bz + r; iz++) {
            // Only the shell at Chebyshev distance r (inner cells done already).
            if (Math.max(Math.abs(ix - bx), Math.abs(iy - by), Math.abs(iz - bz)) !== r) continue;
            const arr = buckets.get(key(ix, iy, iz));
            if (!arr) continue;
            for (const i of arr) {
              const dx = oc[i * 3] - px, dy = oc[i * 3 + 1] - py, dz = oc[i * 3 + 2] - pz;
              const d = dx * dx + dy * dy + dz * dz;
              if (d < bestD) { bestD = d; best = i; }
            }
          }
        }
      }
    }
    result[t] = best;
  }
  return result;
}

/** Triangles of `mesh` whose centroid lies within `radius` of any seed point
 *  in `seeds` (a flat `[x,y,z, …]` array). Used to scope a surface op to part
 *  of the model: a `label` scope passes the centroids of the labeled base
 *  triangles (so subdivided children, which sit within the parent face, are
 *  caught); a `point` scope passes one click point. A uniform spatial hash over
 *  the seeds (cell = radius) keeps it near-linear in the triangle count. */
export function selectTrianglesNearSeeds(mesh: MeshData, seeds: Float32Array, radius: number): Set<number> {
  const out = new Set<number>();
  const seedCount = (seeds.length / 3) | 0;
  if (seedCount === 0 || mesh.numTri === 0 || !(radius > 0)) return out;
  const r2 = radius * radius;
  const cell = radius;
  const ck = (ix: number, iy: number, iz: number) => `${ix},${iy},${iz}`;
  const buckets = new Map<string, number[]>();
  for (let s = 0; s < seedCount; s++) {
    const x = seeds[s * 3], y = seeds[s * 3 + 1], z = seeds[s * 3 + 2];
    const k = ck(Math.floor(x / cell), Math.floor(y / cell), Math.floor(z / cell));
    let arr = buckets.get(k);
    if (!arr) { arr = []; buckets.set(k, arr); }
    arr.push(s);
  }
  const c = centroids(mesh);
  for (let t = 0; t < mesh.numTri; t++) {
    const px = c[t * 3], py = c[t * 3 + 1], pz = c[t * 3 + 2];
    const bx = Math.floor(px / cell), by = Math.floor(py / cell), bz = Math.floor(pz / cell);
    let hit = false;
    for (let ix = bx - 1; ix <= bx + 1 && !hit; ix++) {
      for (let iy = by - 1; iy <= by + 1 && !hit; iy++) {
        for (let iz = bz - 1; iz <= bz + 1 && !hit; iz++) {
          const arr = buckets.get(ck(ix, iy, iz));
          if (!arr) continue;
          for (const s of arr) {
            const dx = seeds[s * 3] - px, dy = seeds[s * 3 + 1] - py, dz = seeds[s * 3 + 2] - pz;
            if (dx * dx + dy * dy + dz * dz <= r2) { hit = true; break; }
          }
        }
      }
    }
    if (hit) out.add(t);
  }
  return out;
}

/** Remap named triangle sets defined on `oldMesh` onto `newMesh` after a surface
 *  modifier changed the tessellation. Each old triangle's children in `newMesh`
 *  are found by inverting {@link nearestTriangleMap}: a new triangle joins set
 *  `name` when its nearest old triangle belonged to `name`. Used to carry
 *  `api.label` / `byLabel` colors through the in-code texture chain (whose
 *  output mesh is denser/displaced, so the old per-label indices no longer point
 *  at the right triangles). Geometric paint descriptors re-resolve by shape and
 *  don't need this; index-based label sets do. */
export function remapTriangleSets(
  sets: Map<string, Set<number>>,
  oldMesh: MeshData,
  newMesh: MeshData,
): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  if (sets.size === 0) return out;
  for (const name of sets.keys()) out.set(name, new Set<number>());

  // Invert: old triangle index → the label names that own it (labels may overlap).
  const ownerNames = new Map<number, string[]>();
  for (const [name, tris] of sets) {
    for (const t of tris) {
      let arr = ownerNames.get(t);
      if (!arr) { arr = []; ownerNames.set(t, arr); }
      arr.push(name);
    }
  }

  const map = nearestTriangleMap(oldMesh, newMesh);
  for (let t = 0; t < newMesh.numTri; t++) {
    const owners = ownerNames.get(map[t]);
    if (!owners) continue;
    for (const name of owners) out.get(name)!.add(t);
  }
  return out;
}
