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

/** Build a spatial hash over `refMesh`'s triangle centroids and return a query
 *  for the nearest ref-triangle index to an arbitrary point. Uniform grid with
 *  ring-expanding search, so each query is near-O(1) for spatially-coincident
 *  meshes. Returns a query that yields `-1` when `refMesh` has no triangles.
 *  Shared by every consumer below so there's one hashing implementation. */
function buildNearestTriHash(refMesh: MeshData): (px: number, py: number, pz: number) => number {
  if (refMesh.numTri === 0) return () => -1;
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
  return (px, py, pz) => {
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
    return best;
  };
}

/** For each triangle of `newMesh`, the index of the nearest (by centroid)
 *  triangle of `oldMesh`. Returns an `Int32Array` of length `newMesh.numTri`
 *  (entries are `-1` only when `oldMesh` has no triangles). */
export function nearestTriangleMap(oldMesh: MeshData, newMesh: MeshData): Int32Array {
  const result = new Int32Array(newMesh.numTri).fill(-1);
  if (oldMesh.numTri === 0 || newMesh.numTri === 0) return result;
  const nearest = buildNearestTriHash(oldMesh);
  const nc = centroids(newMesh);
  for (let t = 0; t < newMesh.numTri; t++) {
    result[t] = nearest(nc[t * 3], nc[t * 3 + 1], nc[t * 3 + 2]);
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
 *  the rim cleanly instead of leaving a sawtooth of base triangles. The nearest
 *  *triangle* is taken by centroid (cheap spatial hash); for the meshes here (a
 *  dense base vs its re-meshed carve) that triangle is the geometrically nearest
 *  too. */
export function nearestSurfaceVertexDistance(refMesh: MeshData, queryMesh: MeshData): Float32Array {
  const out = new Float32Array(queryMesh.numVert).fill(Infinity);
  if (refMesh.numTri === 0 || queryMesh.numVert === 0) return out;
  const nearest = buildNearestTriHash(refMesh);
  const { vertProperties: rvp, triVerts: rtv, numProp: rnp } = refMesh;
  const { vertProperties: qvp, numProp: qnp, numVert } = queryMesh;
  for (let v = 0; v < numVert; v++) {
    const px = qvp[v * qnp], py = qvp[v * qnp + 1], pz = qvp[v * qnp + 2];
    const ti = nearest(px, py, pz);
    if (ti < 0) continue;
    const a = rtv[ti * 3] * rnp, b = rtv[ti * 3 + 1] * rnp, c = rtv[ti * 3 + 2] * rnp;
    out[v] = Math.sqrt(pointTriDist2(
      px, py, pz,
      rvp[a], rvp[a + 1], rvp[a + 2],
      rvp[b], rvp[b + 1], rvp[b + 2],
      rvp[c], rvp[c + 1], rvp[c + 2],
    ));
  }
  return out;
}
