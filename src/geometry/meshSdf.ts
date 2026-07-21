// Pure voxel-grid signed-distance math for arbitrary meshes — the substrate
// under `api.round(m, {radius})` (morphological edge rounding) and
// `api.smoothWeld(a, b, {radius})` (smooth-min union of plain Manifolds).
//
// Unlike `src/geometry/sdf.ts` (analytic SDF *expressions* the user authors),
// this module derives a discrete signed field FROM an existing tessellated
// mesh: scanline-rasterize the solid onto a lattice for a robust inside/outside
// sign, then run a separable exact Euclidean distance transform (Felzenszwalb–
// Huttenlocher) in both directions to get a signed distance in voxel units.
// Morphological opening/closing (which is what "round every edge with radius r"
// *is*) then reduces to threshold + re-transform passes on the same lattice,
// and smooth-min welding is a per-sample polynomial mix of two fields. The
// caller lowers the final field back to a Manifold via `Manifold.levelSet` over
// a trilinear sampler (see meshSdfOps.ts).
//
// Deliberately dependency-free (no three / three-mesh-bvh): it runs inside the
// geometry Worker alongside the manifold-js sandbox, and pure functions here
// are unit-tested without WASM. Accuracy is O(voxel) — callers pick the lattice
// so the voxel is small relative to the radius (see chooseGridForRadius).

export interface MeshLike {
  vertProperties: Float32Array;
  triVerts: Uint32Array;
  numProp: number;
  numTri: number;
}

export interface GridSpec {
  nx: number; ny: number; nz: number;
  origin: [number, number, number];
  voxel: number;
}

/** Pick a lattice covering `bounds` (expanded by `padWorld` on every side) whose
 *  voxel is small enough for the requested feature radius: voxel ≤ radius/2.5,
 *  clamped so the longest axis stays within `maxRes` samples. Returns null when
 *  the radius is unresolvable at maxRes (radius < 1.5 voxels even at the cap) —
 *  callers turn that into an actionable "radius too small for this model" error. */
export function chooseGridForRadius(
  min: [number, number, number],
  max: [number, number, number],
  radius: number,
  padWorld: number,
  maxRes: number,
): GridSpec | null {
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const longest = Math.max(size[0], size[1], size[2], 1e-6) + 2 * padWorld;
  // Want voxel ≤ radius/2.5 for a well-resolved fillet; never finer than needed.
  let voxel = radius / 2.5;
  if (longest / voxel > maxRes) voxel = longest / maxRes;
  if (radius < 1.5 * voxel) return null;
  const origin: [number, number, number] = [min[0] - padWorld, min[1] - padWorld, min[2] - padWorld];
  const nx = Math.max(4, Math.ceil((size[0] + 2 * padWorld) / voxel) + 1);
  const ny = Math.max(4, Math.ceil((size[1] + 2 * padWorld) / voxel) + 1);
  const nz = Math.max(4, Math.ceil((size[2] + 2 * padWorld) / voxel) + 1);
  return { nx, ny, nz, origin, voxel };
}

/** Extract xyz positions from an interleaved vertProperties buffer. */
function positionsOf(mesh: MeshLike): Float32Array {
  const { vertProperties, numProp } = mesh;
  if (numProp === 3) return vertProperties;
  const n = vertProperties.length / numProp;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    out[i * 3] = vertProperties[i * numProp];
    out[i * 3 + 1] = vertProperties[i * numProp + 1];
    out[i * 3 + 2] = vertProperties[i * numProp + 2];
  }
  return out;
}

/** Scanline-rasterize a watertight mesh into a boolean occupancy grid over
 *  `spec` (1 = inside the solid). For every lattice row (j,k) a ray along +X
 *  through the sample centres collects triangle crossings; parity fills between
 *  pairs. Sample centres are jittered half a cell off the lattice planes so
 *  rays never graze triangle edges exactly (watertight input ⇒ even crossing
 *  counts). */
export function rasterizeOccupancy(mesh: MeshLike, spec: GridSpec): Uint8Array {
  const { nx, ny, nz, origin, voxel } = spec;
  const occ = new Uint8Array(nx * ny * nz);
  if (mesh.numTri === 0) return occ;
  const pos = positionsOf(mesh);
  const tv = mesh.triVerts;

  // Per-row crossing lists, keyed j + k*ny. Stored flat-ish: a Map of arrays is
  // fine at these sizes (rows with no triangles never allocate).
  const rows = new Map<number, number[]>();
  // Tiny fixed jitter keeps ray targets off shared edges/vertices without
  // breaking determinism.
  const jy = 0.5000731, jz = 0.5001177;

  for (let t = 0; t < mesh.numTri; t++) {
    const a = tv[t * 3], b = tv[t * 3 + 1], c = tv[t * 3 + 2];
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2];
    const cx = pos[c * 3], cy = pos[c * 3 + 1], cz = pos[c * 3 + 2];
    const minY = Math.min(ay, by, cy), maxY = Math.max(ay, by, cy);
    const minZ = Math.min(az, bz, cz), maxZ = Math.max(az, bz, cz);
    const j0 = Math.max(0, Math.ceil((minY - origin[1]) / voxel - jy));
    const j1 = Math.min(ny - 1, Math.floor((maxY - origin[1]) / voxel - jy + 1));
    const k0 = Math.max(0, Math.ceil((minZ - origin[2]) / voxel - jz));
    const k1 = Math.min(nz - 1, Math.floor((maxZ - origin[2]) / voxel - jz + 1));
    for (let k = k0; k <= k1; k++) {
      const rayZ = origin[2] + k * voxel + (jz - 0.5) * voxel;
      for (let j = j0; j <= j1; j++) {
        const rayY = origin[1] + j * voxel + (jy - 0.5) * voxel;
        // 2D point-in-triangle in the YZ projection (signed areas).
        const d1 = (by - ay) * (rayZ - az) - (bz - az) * (rayY - ay);
        const d2 = (cy - by) * (rayZ - bz) - (cz - bz) * (rayY - by);
        const d3 = (ay - cy) * (rayZ - cz) - (az - cz) * (rayY - cy);
        const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
        const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
        if (hasNeg && hasPos) continue; // outside projected triangle
        const area = d1 + d2 + d3;
        if (Math.abs(area) < 1e-12) continue; // degenerate in YZ (edge-on) — neighbours carry the parity
        // Barycentric interpolation of the crossing X.
        const w1 = d2 / area, w2 = d3 / area, w3 = d1 / area;
        const x = w1 * ax + w2 * bx + w3 * cx;
        const key = j + k * ny;
        let list = rows.get(key);
        if (!list) { list = []; rows.set(key, list); }
        list.push(x);
      }
    }
  }

  for (const [key, xs] of rows) {
    if (xs.length < 2) continue;
    xs.sort((p, q) => p - q);
    const j = key % ny;
    const k = (key - j) / ny;
    const rowBase = j * nx + k * nx * ny;
    // Fill between successive pairs (parity rule). An odd count means a grazing
    // numerical miss — drop the last unpaired crossing rather than flood-fill.
    const pairs = xs.length - (xs.length % 2);
    for (let p = 0; p + 1 < pairs; p += 2) {
      const x0 = xs[p], x1 = xs[p + 1];
      let i0 = Math.ceil((x0 - origin[0]) / voxel);
      let i1 = Math.floor((x1 - origin[0]) / voxel);
      if (i0 < 0) i0 = 0;
      if (i1 > nx - 1) i1 = nx - 1;
      for (let i = i0; i <= i1; i++) occ[rowBase + i] = 1;
    }
  }
  return occ;
}

// --- Exact Euclidean distance transform (squared), separable 1D passes. ---
// Felzenszwalb & Huttenlocher, "Distance Transforms of Sampled Functions".

function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Squared distance (in voxel units) from every sample to the nearest sample
 *  where `on(idx)` is true. All-off grids return +Infinity everywhere. */
export function edt3dSquared(
  on: (idx: number) => boolean,
  nx: number, ny: number, nz: number,
): Float64Array {
  const total = nx * ny * nz;
  const INF = 1e20;
  const dist = new Float64Array(total);
  for (let i = 0; i < total; i++) dist[i] = on(i) ? 0 : INF;

  const nMax = Math.max(nx, ny, nz);
  const f = new Float64Array(nMax);
  const d = new Float64Array(nMax);
  const v = new Int32Array(nMax);
  const z = new Float64Array(nMax + 1);

  // Pass X
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      const base = j * nx + k * nx * ny;
      for (let i = 0; i < nx; i++) f[i] = dist[base + i];
      edt1d(f, nx, d, v, z);
      for (let i = 0; i < nx; i++) dist[base + i] = d[i];
    }
  }
  // Pass Y
  for (let k = 0; k < nz; k++) {
    for (let i = 0; i < nx; i++) {
      const base = i + k * nx * ny;
      for (let j = 0; j < ny; j++) f[j] = dist[base + j * nx];
      edt1d(f, ny, d, v, z);
      for (let j = 0; j < ny; j++) dist[base + j * nx] = d[j];
    }
  }
  // Pass Z
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const base = i + j * nx;
      for (let k = 0; k < nz; k++) f[k] = dist[base + k * nx * ny];
      edt1d(f, nz, d, v, z);
      for (let k = 0; k < nz; k++) dist[base + k * nx * ny] = d[k];
    }
  }
  return dist;
}

/** Signed distance field (world units) from a boolean occupancy grid:
 *  `sqrt(dist to solid) − sqrt(dist to empty)`, scaled by the voxel size.
 *  Negative inside. Accuracy is ± half a voxel at the boundary. */
export function signedFieldFromOccupancy(occ: Uint8Array, spec: GridSpec): Float32Array {
  const { nx, ny, nz, voxel } = spec;
  const dOut = edt3dSquared(i => occ[i] !== 0, nx, ny, nz);
  const dIn = edt3dSquared(i => occ[i] === 0, nx, ny, nz);
  const field = new Float32Array(nx * ny * nz);
  for (let i = 0; i < field.length; i++) {
    field[i] = (Math.sqrt(dOut[i]) - Math.sqrt(dIn[i])) * voxel;
  }
  return field;
}

/** Threshold a signed field back to occupancy: inside = `field <= iso`. */
export function thresholdField(field: Float32Array, iso: number): Uint8Array {
  const occ = new Uint8Array(field.length);
  for (let i = 0; i < field.length; i++) if (field[i] <= iso) occ[i] = 1;
  return occ;
}

/** Morphological OPENING of a signed field by radius r (world units): erode
 *  then dilate. Rounds CONVEX edges/corners with radius ≈ r; removes features
 *  thinner than 2r. Returns a fresh signed field on the same lattice. */
export function openField(field: Float32Array, spec: GridSpec, r: number): Float32Array {
  const eroded = thresholdField(field, -r);
  const sd = signedFieldFromOccupancy(eroded, spec);
  for (let i = 0; i < sd.length; i++) sd[i] -= r; // dilate the eroded set by r
  return sd;
}

/** Morphological CLOSING of a signed field by radius r (world units): dilate
 *  then erode. Rounds CONCAVE creases with radius ≈ r; fills gaps thinner
 *  than 2r. Returns a fresh signed field on the same lattice. */
export function closeField(field: Float32Array, spec: GridSpec, r: number): Float32Array {
  const dilated = thresholdField(field, r);
  const sd = signedFieldFromOccupancy(dilated, spec);
  for (let i = 0; i < sd.length; i++) sd[i] += r; // erode the dilated set by r
  return sd;
}

/** Polynomial smooth-minimum (Inigo Quilez's `smin`) of two signed distances
 *  with blend radius k — the classic SDF smooth-union kernel. */
export function smin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.min(Math.max(0.5 + 0.5 * (b - a) / k, 0), 1);
  return b * (1 - h) + a * h - k * h * (1 - h);
}

/** Light separable binomial blur (5-tap, σ ≈ 1 voxel) of a field grid, in
 *  place. Occupancy-derived signed fields carry half-voxel "corduroy" (the
 *  stair-stepped raster snaps iso crossings onto lattice steps); one blur pass
 *  smooths that out at the cost of sub-voxel feature rounding — negligible for
 *  ops whose blend radius is ≥ 2.5 voxels (chooseGridForRadius guarantees it). */
export function blurField(field: Float32Array, spec: GridSpec): Float32Array {
  const { nx, ny, nz } = spec;
  const w = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16];
  const tmp = new Float32Array(field.length);
  const clampIdx = (v: number, n: number) => (v < 0 ? 0 : v >= n ? n - 1 : v);
  // X pass
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      const base = j * nx + k * nx * ny;
      for (let i = 0; i < nx; i++) {
        let acc = 0;
        for (let d = -2; d <= 2; d++) acc += w[d + 2] * field[base + clampIdx(i + d, nx)];
        tmp[base + i] = acc;
      }
    }
  }
  // Y pass
  for (let k = 0; k < nz; k++) {
    for (let i = 0; i < nx; i++) {
      const base = i + k * nx * ny;
      for (let j = 0; j < ny; j++) {
        let acc = 0;
        for (let d = -2; d <= 2; d++) acc += w[d + 2] * tmp[base + clampIdx(j + d, ny) * nx];
        field[base + j * nx] = acc;
      }
    }
  }
  // Z pass
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const base = i + j * nx;
      for (let k = 0; k < nz; k++) {
        let acc = 0;
        for (let d = -2; d <= 2; d++) acc += w[d + 2] * field[base + clampIdx(k + d, nz) * nx * ny];
        tmp[base + k * nx * ny] = acc;
      }
    }
  }
  field.set(tmp);
  return field;
}

/** Trilinear sampler over a field grid. Points outside the lattice return a
 *  large positive value (definitely outside the solid). */
export function makeTrilinearSampler(field: Float32Array, spec: GridSpec): (x: number, y: number, z: number) => number {
  const { nx, ny, nz, origin, voxel } = spec;
  const OUTSIDE = 1e6;
  return (x: number, y: number, z: number): number => {
    const fx = (x - origin[0]) / voxel;
    const fy = (y - origin[1]) / voxel;
    const fz = (z - origin[2]) / voxel;
    if (fx < 0 || fy < 0 || fz < 0 || fx > nx - 1 || fy > ny - 1 || fz > nz - 1) return OUTSIDE;
    const i0 = Math.min(nx - 2, Math.floor(fx));
    const j0 = Math.min(ny - 2, Math.floor(fy));
    const k0 = Math.min(nz - 2, Math.floor(fz));
    const tx = fx - i0, ty = fy - j0, tz = fz - k0;
    const at = (i: number, j: number, k: number) => field[i + j * nx + k * nx * ny];
    const c00 = at(i0, j0, k0) * (1 - tx) + at(i0 + 1, j0, k0) * tx;
    const c10 = at(i0, j0 + 1, k0) * (1 - tx) + at(i0 + 1, j0 + 1, k0) * tx;
    const c01 = at(i0, j0, k0 + 1) * (1 - tx) + at(i0 + 1, j0, k0 + 1) * tx;
    const c11 = at(i0, j0 + 1, k0 + 1) * (1 - tx) + at(i0 + 1, j0 + 1, k0 + 1) * tx;
    const c0 = c00 * (1 - ty) + c10 * ty;
    const c1 = c01 * (1 - ty) + c11 * ty;
    return c0 * (1 - tz) + c1 * tz;
  };
}
