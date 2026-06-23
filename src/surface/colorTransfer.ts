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

interface NearestTriHash {
  /** Nearest ref triangle to a point, *by centroid* (`-1` if the ref is empty).
   *  Cheap; used for the color transfer, where centroid proximity is enough. */
  nearestIndex(px: number, py: number, pz: number): number;
  /** Minimum *squared point-to-triangle* distance from a point to the ref
   *  surface (`Infinity` if the ref is empty). Searches over all nearby
   *  candidate triangles (not just the nearest centroid) and takes the closest
   *  surface, so a point lying on a flat, finely-triangulated region reads ~0
   *  instead of the lateral gap to whichever single triangle's centroid happened
   *  to be nearest — the spurious displacement that speckled flat faces. */
  surfaceDist2(px: number, py: number, pz: number): number;
}

/** Build a spatial hash over `refMesh`'s triangle centroids. Uniform grid with
 *  ring-expanding search, so each query is near-O(1) for spatially-coincident
 *  meshes. Shared by every consumer below so there's one hashing implementation. */
function buildNearestTriHash(refMesh: MeshData): NearestTriHash {
  if (refMesh.numTri === 0) return { nearestIndex: () => -1, surfaceDist2: () => Infinity };
  const oc = centroids(refMesh);
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < refMesh.numTri; i++) {
    const x = oc[i * 3], y = oc[i * 3 + 1], z = oc[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-6);
  // Aim for ~1 triangle per cell on average: n cells per axis ≈ cbrt(numTri).
  const n = Math.max(1, Math.round(Math.cbrt(refMesh.numTri)));
  const cell = span / n || 1;
  const cx = (x: number) => Math.floor((x - minX) / cell);
  const cy = (y: number) => Math.floor((y - minY) / cell);
  const cz = (z: number) => Math.floor((z - minZ) / cell);
  const key = (ix: number, iy: number, iz: number) => `${ix},${iy},${iz}`;

  const buckets = new Map<string, number[]>();
  for (let i = 0; i < refMesh.numTri; i++) {
    const k = key(cx(oc[i * 3]), cy(oc[i * 3 + 1]), cz(oc[i * 3 + 2]));
    let arr = buckets.get(k);
    if (!arr) { arr = []; buckets.set(k, arr); }
    arr.push(i);
  }
  // Ref and query meshes are spatially coincident (a modifier displaces the
  // surface only slightly), so the nearest is almost always in ring 0–1. The
  // cap bounds the search for any stray point outside the ref bounds.
  const maxR = n * 2 + 4;
  const { vertProperties: rvp, triVerts: rtv, numProp: rnp } = refMesh;
  const triDist2 = (i: number, px: number, py: number, pz: number): number => {
    const a = rtv[i * 3] * rnp, b = rtv[i * 3 + 1] * rnp, c = rtv[i * 3 + 2] * rnp;
    return pointTriDist2(px, py, pz, rvp[a], rvp[a + 1], rvp[a + 2], rvp[b], rvp[b + 1], rvp[b + 2], rvp[c], rvp[c + 1], rvp[c + 2]);
  };
  return {
    nearestIndex(px, py, pz) {
      const bx = cx(px), by = cy(py), bz = cz(pz);
      let best = -1, bestD = Infinity;
      for (let r = 0; r <= maxR; r++) {
        // Stop once no candidate in this ring or beyond can beat the best found:
        // the closest a point in Chebyshev ring r can be is (r-1)·cell.
        if (best >= 0 && Math.sqrt(bestD) <= (r - 1) * cell) break;
        for (let ix = bx - r; ix <= bx + r; ix++) {
          for (let iy = by - r; iy <= by + r; iy++) {
            for (let iz = bz - r; iz <= bz + r; iz++) {
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
      return best;
    },
    surfaceDist2(px, py, pz) {
      const bx = cx(px), by = cy(py), bz = cz(pz);
      let best2 = Infinity;
      for (let r = 0; r <= maxR; r++) {
        // A triangle whose centroid is in ring ≥ r is at least (r-1)·cell from
        // the point, so its surface is at least (r-1)·cell − (max centroid→vertex
        // ≈ cell) away. Stop once that lower bound exceeds the best surface
        // distance found — one extra ring of slack over the centroid bound.
        if (best2 < Infinity && (r - 2) * cell > Math.sqrt(best2)) break;
        for (let ix = bx - r; ix <= bx + r; ix++) {
          for (let iy = by - r; iy <= by + r; iy++) {
            for (let iz = bz - r; iz <= bz + r; iz++) {
              if (Math.max(Math.abs(ix - bx), Math.abs(iy - by), Math.abs(iz - bz)) !== r) continue;
              const arr = buckets.get(key(ix, iy, iz));
              if (!arr) continue;
              for (const i of arr) {
                const d2 = triDist2(i, px, py, pz);
                if (d2 < best2) best2 = d2;
              }
            }
          }
        }
      }
      return best2;
    },
  };
}

/** For each triangle of `newMesh`, the index of the nearest (by centroid)
 *  triangle of `oldMesh`. Returns an `Int32Array` of length `newMesh.numTri`
 *  (entries are `-1` only when `oldMesh` has no triangles). */
export function nearestTriangleMap(oldMesh: MeshData, newMesh: MeshData): Int32Array {
  const result = new Int32Array(newMesh.numTri).fill(-1);
  if (oldMesh.numTri === 0 || newMesh.numTri === 0) return result;
  const hash = buildNearestTriHash(oldMesh);
  const nc = centroids(newMesh);
  for (let t = 0; t < newMesh.numTri; t++) {
    result[t] = hash.nearestIndex(nc[t * 3], nc[t * 3 + 1], nc[t * 3 + 2]);
  }
  return result;
}

/** Squared distance from point `p` to triangle `(a,b,c)` — the standard
 *  closest-point-on-triangle (Ericson, Real-Time Collision Detection). Pure. */
function pointTriDist2(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): number {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return apx * apx + apy * apy + apz * apz; // vertex A
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return bpx * bpx + bpy * bpy + bpz * bpz; // vertex B
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { // edge AB
    const w = d1 / (d1 - d3);
    const qx = ax + w * abx, qy = ay + w * aby, qz = az + w * abz;
    return (px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2;
  }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return cpx * cpx + cpy * cpy + cpz * cpz; // vertex C
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { // edge AC
    const w = d2 / (d2 - d6);
    const qx = ax + w * acx, qy = ay + w * acy, qz = az + w * acz;
    return (px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { // edge BC
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    const qx = bx + w * (cx - bx), qy = by + w * (cy - by), qz = bz + w * (cz - bz);
    return (px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2;
  }
  // Interior — project onto the triangle plane via barycentric coords.
  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  const qx = ax + abx * v + acx * w, qy = ay + aby * v + acy * w, qz = az + abz * v + acz * w;
  return (px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2;
}

/** For each *vertex* of `queryMesh`, the true distance to the nearest *surface*
 *  of `refMesh` (point-to-triangle, not centroid-to-centroid, so it has no
 *  tessellation-density floor — a vertex lying on the reference surface reads
 *  ~0 regardless of how coarse the reference is). Length is `queryMesh.numVert`;
 *  entries are `Infinity` only when `refMesh` has no triangles.
 *
 *  The engrave/emboss colorizer uses per-vertex (rather than per-centroid)
 *  distance so it can color a triangle when its *most-displaced vertex* clears
 *  the threshold: a wall-base triangle whose centroid sits below the surface
 *  cut-off still has its upper vertices well up the wall, so the color reaches
 *  the rim cleanly instead of leaving a sawtooth of base triangles. The distance
 *  is the minimum over all nearby ref triangles (not just the nearest centroid),
 *  so a vertex on a flat, finely-triangulated region reads ~0 rather than the
 *  lateral gap to whichever single centroid was closest — which otherwise
 *  speckled flat faces with spurious "displaced" triangles. */
export function nearestSurfaceVertexDistance(refMesh: MeshData, queryMesh: MeshData): Float32Array {
  const out = new Float32Array(queryMesh.numVert).fill(Infinity);
  if (refMesh.numTri === 0 || queryMesh.numVert === 0) return out;
  const hash = buildNearestTriHash(refMesh);
  const { vertProperties: qvp, numProp: qnp, numVert } = queryMesh;
  for (let v = 0; v < numVert; v++) {
    out[v] = Math.sqrt(hash.surfaceDist2(qvp[v * qnp], qvp[v * qnp + 1], qvp[v * qnp + 2]));
  }
  return out;
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
