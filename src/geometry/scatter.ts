// `api.scatter` — distribute instance copies across a target's surface, the
// meshOps analogue of Blender Geometry Nodes' "distribute points on faces +
// instance on points". Deterministic (seeded), so the same code always builds
// the same model; instances align to the local surface normal so spikes point
// out, rivets sit flush, and studs follow curvature.
//
// Pure sampling math is exported for unit tests; the Manifold-touching factory
// wires it into the sandbox (meshOps.ts spreads it into `api.*`).

/* eslint-disable @typescript-eslint/no-explicit-any */

import { mulberry32 } from './noise';

export type Vec3 = [number, number, number];

export interface SurfaceSample {
  /** World position on the surface. */
  p: Vec3;
  /** Unit outward face normal at the sample. */
  n: Vec3;
}

export interface MeshLike {
  vertProperties: Float32Array;
  triVerts: Uint32Array;
  numProp: number;
  numTri: number;
}

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

export interface SampleOpts {
  count: number;
  seed: number;
  /** Poisson-ish minimum distance between accepted samples (world units). */
  minSpacing?: number;
  /** Predicate filter — only samples where `where(p, n)` is truthy are kept. */
  where?: (p: Vec3, n: Vec3) => boolean;
}

/** Area-weighted random samples on a triangle mesh's surface, with optional
 *  minimum spacing (dart throwing over a spatial hash) and a predicate filter.
 *  Deterministic for a given (mesh, opts). May return fewer than `count`
 *  samples when spacing/predicate constraints run out of room. */
export function sampleMeshSurface(mesh: MeshLike, opts: SampleOpts): SurfaceSample[] {
  const out: SurfaceSample[] = [];
  if (mesh.numTri === 0 || opts.count <= 0) return out;
  const pos = positionsOf(mesh);
  const tv = mesh.triVerts;

  // Cumulative area table for area-weighted triangle picking + face normals.
  const cdf = new Float64Array(mesh.numTri);
  const normals = new Float32Array(mesh.numTri * 3);
  let total = 0;
  for (let t = 0; t < mesh.numTri; t++) {
    const a = tv[t * 3], b = tv[t * 3 + 1], c = tv[t * 3 + 2];
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    total += len / 2;
    cdf[t] = total;
    const inv = len > 1e-30 ? 1 / len : 0;
    normals[t * 3] = nx * inv; normals[t * 3 + 1] = ny * inv; normals[t * 3 + 2] = nz * inv;
  }
  if (total <= 0) return out;

  const rng = mulberry32(opts.seed || 1);
  const spacing = opts.minSpacing !== undefined && opts.minSpacing > 0 ? opts.minSpacing : 0;
  // Spatial hash for the spacing check — cell edge = spacing, check 27 cells.
  const cells = new Map<string, Vec3[]>();
  const cellKey = (p: Vec3): string =>
    `${Math.floor(p[0] / spacing)},${Math.floor(p[1] / spacing)},${Math.floor(p[2] / spacing)}`;
  const farEnough = (p: Vec3): boolean => {
    if (!spacing) return true;
    const ci = Math.floor(p[0] / spacing), cj = Math.floor(p[1] / spacing), ck = Math.floor(p[2] / spacing);
    for (let dk = -1; dk <= 1; dk++) {
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const bucket = cells.get(`${ci + di},${cj + dj},${ck + dk}`);
          if (!bucket) continue;
          for (const q of bucket) {
            const dx = p[0] - q[0], dy = p[1] - q[1], dz = p[2] - q[2];
            if (dx * dx + dy * dy + dz * dz < spacing * spacing) return false;
          }
        }
      }
    }
    return true;
  };

  // Dart throwing: overshoot attempts so spacing/predicate rejections still
  // reach `count` on reasonable inputs, but always terminate.
  const maxAttempts = Math.max(opts.count * 12, 256);
  for (let attempt = 0; attempt < maxAttempts && out.length < opts.count; attempt++) {
    // Binary-search the CDF for an area-weighted triangle pick.
    const target = rng() * total;
    let lo = 0, hi = mesh.numTri - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    const t = lo;
    // Uniform point in the triangle (sqrt trick).
    const r1 = Math.sqrt(rng());
    const r2 = rng();
    const wa = 1 - r1, wb = r1 * (1 - r2), wc = r1 * r2;
    const a = tv[t * 3], b = tv[t * 3 + 1], c = tv[t * 3 + 2];
    const p: Vec3 = [
      wa * pos[a * 3] + wb * pos[b * 3] + wc * pos[c * 3],
      wa * pos[a * 3 + 1] + wb * pos[b * 3 + 1] + wc * pos[c * 3 + 1],
      wa * pos[a * 3 + 2] + wb * pos[b * 3 + 2] + wc * pos[c * 3 + 2],
    ];
    const n: Vec3 = [normals[t * 3], normals[t * 3 + 1], normals[t * 3 + 2]];
    if (opts.where && !opts.where(p, n)) continue;
    if (!farEnough(p)) continue;
    if (spacing) {
      const key = cellKey(p);
      let bucket = cells.get(key);
      if (!bucket) { bucket = []; cells.set(key, bucket); }
      bucket.push(p);
    }
    out.push({ p, n });
  }
  return out;
}

/** Column-major 4×4 placing an instance at `sample`: uniform `scale`, optional
 *  spin about local Z, optional align of local +Z to the surface normal, then
 *  translate to `p + n·offset`. Matches the matrix layout `.transform()` expects
 *  (see meshOps.rotateAroundAxis). */
export function instanceMatrix(
  sample: SurfaceSample,
  scale: number,
  spinRad: number,
  alignToNormal: boolean,
  offset: number,
): number[] {
  const [nx, ny, nz] = sample.n;
  // Spin about local Z first.
  const cs = Math.cos(spinRad), sn = Math.sin(spinRad);
  // Base rotation: identity or +Z → n.
  let r00 = 1, r01 = 0, r02 = 0, r10 = 0, r11 = 1, r12 = 0, r20 = 0, r21 = 0, r22 = 1;
  if (alignToNormal) {
    // Rotation taking +Z to n via the shortest arc (Rodrigues). Degenerates
    // handled: n ≈ +Z → identity; n ≈ −Z → 180° about X.
    const d = nz; // dot(+Z, n)
    if (d > 0.99999) {
      // identity
    } else if (d < -0.99999) {
      r00 = 1; r11 = -1; r22 = -1;
    } else {
      // axis = normalize(cross(+Z, n)) = normalize([-ny, nx, 0])
      const alen = Math.hypot(nx, ny) || 1;
      const ax = -ny / alen, ay = nx / alen;
      const cA = d, sA = Math.sqrt(Math.max(0, 1 - d * d));
      const t = 1 - cA;
      r00 = t * ax * ax + cA; r01 = t * ax * ay; r02 = sA * ay;
      r10 = t * ax * ay; r11 = t * ay * ay + cA; r12 = -sA * ax;
      r20 = -sA * ay; r21 = sA * ax; r22 = cA;
    }
  }
  // M = R_align · R_spinZ · scale
  const m00 = (r00 * cs + r01 * sn) * scale, m01 = (-r00 * sn + r01 * cs) * scale, m02 = r02 * scale;
  const m10 = (r10 * cs + r11 * sn) * scale, m11 = (-r10 * sn + r11 * cs) * scale, m12 = r12 * scale;
  const m20 = (r20 * cs + r21 * sn) * scale, m21 = (-r20 * sn + r21 * cs) * scale, m22 = r22 * scale;
  const tx = sample.p[0] + nx * offset;
  const ty = sample.p[1] + ny * offset;
  const tz = sample.p[2] + nz * offset;
  return [
    m00, m10, m20, 0,
    m01, m11, m21, 0,
    m02, m12, m22, 0,
    tx, ty, tz, 1,
  ];
}

// ---------------------------------------------------------------------------
// Factory (Manifold-touching)
// ---------------------------------------------------------------------------

function need(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`meshOps: ${msg}`);
}

function isManifold(v: any): boolean {
  return !!v && typeof v.boundingBox === 'function' && typeof v.translate === 'function' && typeof v.getMesh === 'function';
}

function isFiniteNum(v: any): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function createScatter(module: any) {
  const { Manifold } = module;

  interface ScatterOpts {
    /** How many instances to place (1..5000). May place fewer when `minSpacing`
     *  or `where` reject too many candidates. */
    count: number;
    /** Random seed — same seed, same placement. Default 1. */
    seed?: number;
    /** Rotate each instance so its local +Z points along the surface normal
     *  (default true). `false` keeps world orientation (e.g. trees on terrain). */
    alignToNormal?: boolean;
    /** Random rotation about the (aligned) local Z axis (default true). */
    spin?: boolean;
    /** Uniform scale per instance: a number, or a [min, max] random range. Default 1. */
    scale?: number | [number, number];
    /** Push along the normal in world units. Negative values sink the instance
     *  into the target so a later union fuses without a coplanar seam. Default 0. */
    offset?: number;
    /** Poisson-ish minimum spacing between instance anchor points. */
    minSpacing?: number;
    /** Keep only samples where the predicate is truthy: `(p, n) => n[2] > 0.5`
     *  scatters on upward-facing surfaces only. */
    where?: (p: Vec3, n: Vec3) => boolean;
  }

  /** Scatter copies of `instance` across the surface of `target`. Returns the
   *  UNION OF THE INSTANCES ONLY (like linearPattern/circularPattern) — combine
   *  with the base yourself: `base.add(api.scatter(base, spike, {…}))`, or use
   *  `expectUnion` to also assert it fused. Author the instance with its base
   *  at the local origin and its "up" along +Z. */
  function scatter(target: any, instance: any, opts: ScatterOpts): any {
    need(isManifold(target), 'scatter(target, instance, opts): target must be a Manifold');
    need(isManifold(instance), 'scatter(target, instance, opts): instance must be a Manifold');
    need(opts && typeof opts === 'object', 'scatter: opts object with { count } is required');
    const allowed = ['count', 'seed', 'alignToNormal', 'spin', 'scale', 'offset', 'minSpacing', 'where'];
    for (const k of Object.keys(opts)) {
      if (!allowed.includes(k)) throw new Error(`meshOps: scatter: unknown option "${k}" (allowed: ${allowed.join(', ')})`);
    }
    need(Number.isInteger(opts.count) && opts.count >= 1 && opts.count <= 5000, 'scatter.count must be an integer in 1..5000');
    if (opts.seed !== undefined) need(isFiniteNum(opts.seed), 'scatter.seed must be a number');
    if (opts.offset !== undefined) need(isFiniteNum(opts.offset), 'scatter.offset must be a number');
    if (opts.minSpacing !== undefined) need(isFiniteNum(opts.minSpacing) && opts.minSpacing >= 0, 'scatter.minSpacing must be >= 0');
    if (opts.where !== undefined) need(typeof opts.where === 'function', 'scatter.where must be a function (p, n) => boolean');
    let sMin = 1, sMax = 1;
    if (opts.scale !== undefined) {
      if (isFiniteNum(opts.scale)) {
        need(opts.scale > 0, 'scatter.scale must be > 0');
        sMin = sMax = opts.scale;
      } else if (Array.isArray(opts.scale) && opts.scale.length === 2 && isFiniteNum(opts.scale[0]) && isFiniteNum(opts.scale[1])) {
        need(opts.scale[0] > 0 && opts.scale[1] >= opts.scale[0], 'scatter.scale range must satisfy 0 < min <= max');
        sMin = opts.scale[0]; sMax = opts.scale[1];
      } else {
        throw new Error('meshOps: scatter.scale must be a positive number or a [min, max] range');
      }
    }

    // Guard the total triangle budget before building anything — 500 instances
    // of a 10k-triangle instance is a mistake worth catching by name.
    const instTris = instance.numTri();
    const budget = 2_000_000;
    if (instTris * opts.count > budget) {
      throw new Error(
        `meshOps: scatter: ${opts.count} × ${instTris}-triangle instances ≈ ${Math.round(instTris * opts.count / 1000)}k triangles ` +
        `(budget ${budget / 1000}k). Simplify the instance or lower the count.`,
      );
    }

    const seed = opts.seed ?? 1;
    const samples = sampleMeshSurface(target.getMesh(), {
      count: opts.count,
      seed,
      minSpacing: opts.minSpacing,
      where: opts.where,
    });
    if (samples.length === 0) {
      throw new Error('meshOps: scatter: no placement samples survived the where/minSpacing constraints — nothing to place.');
    }

    // A separate RNG stream for per-instance variation, decorrelated from the
    // placement stream so tweaking `where` doesn't reshuffle every spin/scale.
    const vary = mulberry32((seed * 2654435761) >>> 0 || 7);
    const align = opts.alignToNormal !== false;
    const spin = opts.spin !== false;
    const offset = opts.offset ?? 0;
    const parts: any[] = [];
    for (const s of samples) {
      const sc = sMin === sMax ? sMin : sMin + (sMax - sMin) * vary();
      const spinRad = spin ? vary() * Math.PI * 2 : 0;
      parts.push(instance.transform(instanceMatrix(s, sc, spinRad, align, offset)));
    }
    return Manifold.union(parts);
  }

  return { scatter };
}
