// `api.round` + `api.smoothWeld` — mesh-side morphological rounding and
// smooth-min welding for ARBITRARY Manifolds (any boolean result, import, or
// helper output), no `api.sdf` authoring required.
//
// Both ops share one pipeline: rasterize the input solid(s) onto a lattice
// (meshSdf.ts), derive a signed distance field, transform it (open/close for
// rounding, polynomial smooth-min for welding), then lower the result back to a
// Manifold with `Manifold.levelSet` over a trilinear sampler. Accuracy is
// O(voxel); `chooseGridForRadius` sizes the lattice so the voxel is well under
// the blend radius, which also bounds cost (the lattice caps at `maxRes`³).
//
// Sign conventions: meshSdf fields are `< 0` inside (standard); levelSet wants
// the opposite, so the sampler is negated at the call — same trick as sdf.ts.

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  blurField,
  chooseGridForRadius,
  closeField,
  makeTrilinearSampler,
  openField,
  rasterizeOccupancy,
  signedFieldFromOccupancy,
  smin,
  type GridSpec,
} from './meshSdf';

const DEFAULT_MAX_RES = 192;

function need(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`meshOps: ${msg}`);
}

function isManifold(v: any): boolean {
  return !!v && typeof v.boundingBox === 'function' && typeof v.translate === 'function' && typeof v.getMesh === 'function';
}

function isFiniteNum(v: any): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function bboxOf(m: any): { min: [number, number, number]; max: [number, number, number] } {
  const bb = m.boundingBox();
  return { min: [bb.min[0], bb.min[1], bb.min[2]], max: [bb.max[0], bb.max[1], bb.max[2]] };
}

function unionBounds(
  a: { min: [number, number, number]; max: [number, number, number] },
  b: { min: [number, number, number]; max: [number, number, number] },
): { min: [number, number, number]; max: [number, number, number] } {
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  };
}

function resolveGrid(
  bounds: { min: [number, number, number]; max: [number, number, number] },
  radius: number,
  resolution: number | undefined,
  where: string,
): GridSpec {
  const maxRes = resolution === undefined ? DEFAULT_MAX_RES : resolution;
  need(Number.isInteger(maxRes) && maxRes >= 32 && maxRes <= 320, `${where}.resolution must be an integer in 32..320`);
  // Pad by the radius plus a closing ring so dilation never clips at the lattice edge.
  const pad = radius * 2;
  const spec = chooseGridForRadius(bounds.min, bounds.max, radius, pad, maxRes);
  if (!spec) {
    const size = [bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]];
    const longest = Math.max(...size);
    throw new Error(
      `meshOps: ${where}: radius ${radius} is too small to resolve on this model ` +
      `(model spans ~${longest.toFixed(1)} units; at resolution ${maxRes} the lattice voxel is ` +
      `~${(longest / maxRes).toFixed(2)} units and the radius must be at least ~1.5 voxels). ` +
      `Use a larger radius, or raise { resolution } (max 320).`,
    );
  }
  return spec;
}

function levelSetFromField(
  Manifold: any,
  field: Float32Array,
  spec: GridSpec,
): any {
  const sample = makeTrilinearSampler(field, spec);
  // levelSet's convention is inverted (positive inside), hence the negation.
  const fn = (p: [number, number, number] | { x: number; y: number; z: number }): number => {
    // manifold-3d hands the sample point as an array [x, y, z].
    const arr = p as [number, number, number];
    return -sample(arr[0], arr[1], arr[2]);
  };
  const bounds = {
    min: spec.origin,
    max: [
      spec.origin[0] + (spec.nx - 1) * spec.voxel,
      spec.origin[1] + (spec.ny - 1) * spec.voxel,
      spec.origin[2] + (spec.nz - 1) * spec.voxel,
    ],
  };
  return Manifold.levelSet(fn, bounds, spec.voxel, 0);
}

export function createMeshSdfOps(module: any) {
  const { Manifold } = module;

  interface RoundOpts {
    /** Fillet radius in world units (applies to convex edges and concave creases). */
    radius: number;
    /** Which edges to round: 'both' (default) | 'convex' | 'concave'. */
    mode?: 'both' | 'convex' | 'concave';
    /** Lattice resolution cap along the longest axis (default 192, max 320).
     *  Higher = finer surface, slower. */
    resolution?: number;
  }

  /** Round EVERY edge of a solid with radius r — the mesh-side analogue of
   *  Blender's Bevel modifier (uniform, by morphological opening + closing).
   *  Works on any Manifold: boolean results, imports, helper output. The
   *  result is a remeshed levelSet surface, so crisp non-edge faces stay flat
   *  to within the lattice tolerance. Features thinner than 2·radius are
   *  smoothed away — that's inherent to rounding, not a bug. */
  function round(m: any, opts: RoundOpts): any {
    need(isManifold(m), 'round(m, {radius}): m must be a Manifold');
    need(opts && typeof opts === 'object', 'round(m, opts): opts object with { radius } is required');
    const allowed = ['radius', 'mode', 'resolution'];
    for (const k of Object.keys(opts)) {
      if (!allowed.includes(k)) throw new Error(`meshOps: round: unknown option "${k}" (allowed: ${allowed.join(', ')})`);
    }
    need(isFiniteNum(opts.radius) && opts.radius > 0, 'round.radius must be a positive number');
    const mode = opts.mode ?? 'both';
    need(mode === 'both' || mode === 'convex' || mode === 'concave', "round.mode must be 'both', 'convex' or 'concave'");
    need(!m.isEmpty(), 'round(m): input manifold is empty');

    const r = opts.radius;
    const spec = resolveGrid(bboxOf(m), r, opts.resolution, 'round');
    const occ = rasterizeOccupancy(m.getMesh(), spec);
    let field = signedFieldFromOccupancy(occ, spec);
    // Opening rounds convex edges; closing rounds concave creases. 'both' runs
    // opening first so a sliver removed by the opening can't be re-thickened.
    if (mode === 'both' || mode === 'convex') field = openField(field, spec, r);
    if (mode === 'both' || mode === 'concave') field = closeField(field, spec, r);
    blurField(field, spec); // smooth the raster's half-voxel corduroy
    const out = levelSetFromField(Manifold, field, spec);
    if (out.isEmpty()) {
      throw new Error(
        `meshOps: round: radius ${r} rounded the model away entirely — every feature is thinner than ` +
        `${(2 * r).toFixed(2)} units. Use a smaller radius.`,
      );
    }
    return out;
  }

  interface SmoothWeldOpts {
    /** Blend radius in world units — how far the smooth fillet reaches from the seam. */
    radius: number;
    /** Lattice resolution cap along the longest axis (default 192, max 320). */
    resolution?: number;
  }

  /** Union two (or more) Manifolds with a SMOOTH blended seam of radius r —
   *  `api.sdf`'s smoothUnion for plain mesh geometry. Accepts `smoothWeld(a, b,
   *  opts)` or `smoothWeld([a, b, c], opts)`. The inputs should overlap (or at
   *  least touch); disjoint parts further apart than ~2·radius stay separate
   *  components. Returns a remeshed levelSet surface. */
  function smoothWeld(aOrParts: any, bOrOpts?: any, maybeOpts?: SmoothWeldOpts): any {
    let parts: any[];
    let opts: SmoothWeldOpts;
    if (Array.isArray(aOrParts)) {
      parts = aOrParts;
      opts = bOrOpts;
    } else {
      parts = [aOrParts, bOrOpts];
      opts = maybeOpts as SmoothWeldOpts;
    }
    need(Array.isArray(parts) && parts.length >= 2, 'smoothWeld(a, b, {radius}) or smoothWeld([a, b, …], {radius}): need at least 2 shapes');
    for (let i = 0; i < parts.length; i++) {
      need(isManifold(parts[i]), `smoothWeld: shape ${i} must be a Manifold`);
      need(!parts[i].isEmpty(), `smoothWeld: shape ${i} is empty`);
    }
    need(opts && typeof opts === 'object', 'smoothWeld: opts object with { radius } is required');
    const allowed = ['radius', 'resolution'];
    for (const k of Object.keys(opts)) {
      if (!allowed.includes(k)) throw new Error(`meshOps: smoothWeld: unknown option "${k}" (allowed: ${allowed.join(', ')})`);
    }
    need(isFiniteNum(opts.radius) && opts.radius > 0, 'smoothWeld.radius must be a positive number');

    const r = opts.radius;
    let bounds = bboxOf(parts[0]);
    for (let i = 1; i < parts.length; i++) bounds = unionBounds(bounds, bboxOf(parts[i]));
    const spec = resolveGrid(bounds, r, opts.resolution, 'smoothWeld');

    // Fold the parts together with smooth-min on the shared lattice.
    let acc: Float32Array | null = null;
    for (const part of parts) {
      const occ = rasterizeOccupancy(part.getMesh(), spec);
      const field = signedFieldFromOccupancy(occ, spec);
      if (acc === null) {
        acc = field;
      } else {
        for (let i = 0; i < acc.length; i++) acc[i] = smin(acc[i], field[i], r);
      }
    }
    blurField(acc!, spec); // smooth the raster's half-voxel corduroy
    return levelSetFromField(Manifold, acc!, spec);
  }

  return { round, smoothWeld };
}
