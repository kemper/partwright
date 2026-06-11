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
