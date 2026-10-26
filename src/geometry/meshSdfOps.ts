// `api.round` + `api.offset`/`api.shell` + `api.smoothWeld` — mesh-side
// morphological rounding, uniform offsetting/hollowing, and smooth-min welding
// for ARBITRARY Manifolds (any boolean result, import, or
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
  edt3dSquared,
  isoCrossings,
  makeTrilinearSampler,
  markTriangleSamples,
  nearestPointDistances,
  openField,
  rasterizeOccupancy,
  selectionWeightField,
  signedFieldFromOccupancy,
  smin,
  type GridSpec,
} from './meshSdf';
import { carryRunsByNearest } from './labelCarry';
import { nearestSurfaceTriangleMap } from '../surface/colorTransfer';
import { activeLabelIds, parseSelectOpts, parseSelector, selectTrianglesActive, type Selector, type Vec3 } from './selector';

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
  box?: { min: number[]; max: number[] },
): any {
  const sample = makeTrilinearSampler(field, spec);
  // levelSet's convention is inverted (positive inside), hence the negation.
  const fn = (p: [number, number, number] | { x: number; y: number; z: number }): number => {
    // manifold-3d hands the sample point as an array [x, y, z].
    const arr = p as [number, number, number];
    return -sample(arr[0], arr[1], arr[2]);
  };
  const bounds = box ?? {
    min: spec.origin,
    max: [
      spec.origin[0] + (spec.nx - 1) * spec.voxel,
      spec.origin[1] + (spec.ny - 1) * spec.voxel,
      spec.origin[2] + (spec.nz - 1) * spec.voxel,
    ],
  };
  return Manifold.levelSet(fn, bounds, spec.voxel, 0);
}

/** Samples reachable from a `seed` sample through `pass` samples (6-connected). */
function floodFill(spec: GridSpec, pass: (i: number) => boolean, seed: (i: number) => boolean): Uint8Array {
  const { nx, ny, nz } = spec;
  const n = nx * ny * nz;
  const seen = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0, tail = 0;
  for (let i = 0; i < n; i++) if (seed(i) && pass(i)) { seen[i] = 1; queue[tail++] = i; }
  while (head < tail) {
    const i = queue[head++];
    const ix = i % nx, iy = Math.floor(i / nx) % ny, iz = Math.floor(i / (nx * ny));
    const nb = [
      ix > 0 ? i - 1 : -1, ix < nx - 1 ? i + 1 : -1,
      iy > 0 ? i - nx : -1, iy < ny - 1 ? i + nx : -1,
      iz > 0 ? i - nx * ny : -1, iz < nz - 1 ? i + nx * ny : -1,
    ];
    for (const j of nb) if (j >= 0 && !seen[j] && pass(j)) { seen[j] = 1; queue[tail++] = j; }
  }
  return seen;
}

/** Lattice weights for a scoped op: 1 within `reach` of the selected faces,
 *  fading to 0 over `blend`. */
function scopeWeightField(meshes: any[], masks: Uint8Array[], spec: GridSpec, reach: number, blend: number): Float32Array {
  const mark = new Uint8Array(spec.nx * spec.ny * spec.nz);
  meshes.forEach((mesh, i) => markTriangleSamples(mesh, masks[i], spec, mark));
  return selectionWeightField(mark, spec, reach, blend);
}

/** Samples within `dist` of where the edit applies (w > 0): the only place
 *  the scoped op needs exact distances, since everything farther keeps the
 *  input. */
function nearScope(w: Float32Array, spec: GridSpec, dist: number): Uint8Array {
  const d2 = edt3dSquared(i => w[i] > 0, spec.nx, spec.ny, spec.nz);
  const lim = (dist / spec.voxel) ** 2;
  const out = new Uint8Array(w.length);
  for (let i = 0; i < w.length; i++) if (d2[i] <= lim) out[i] = 1;
  return out;
}

/** A `select`-scoped op's selection: per-mesh triangle masks and the box
 *  around the selected faces. Throws when nothing matches, so a typo'd part
 *  name is loud instead of a no-op. */
function resolveScope(meshes: any[], sel: Selector, name: string): { masks: Uint8Array[]; min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const masks = meshes.map((mesh) => {
    const tri = selectTrianglesActive(mesh, sel, `${name}.select`);
    const vp = mesh.vertProperties, np = mesh.numProp, tv = mesh.triVerts;
    for (let t = 0; t < tri.length; t++) {
      if (!tri[t]) continue;
      for (let c = 0; c < 3; c++) {
        const o = tv[t * 3 + c] * np;
        for (let k = 0; k < 3; k++) {
          if (vp[o + k] < min[k]) min[k] = vp[o + k];
          if (vp[o + k] > max[k]) max[k] = vp[o + k];
        }
      }
    }
    return tri;
  });
  need(min[0] <= max[0], `${name}.select matched no faces — check the part name, region or where bounds`);
  return { masks, min, max };
}

/** A fine lattice over just the scoped area: the selection's box grown by the
 *  edit's reach + fade + a 2·radius margin (so lattice-edge effects stay out of
 *  the zone), clipped to the model. Local, so it can afford ~4 voxels per
 *  radius where the whole-model ops use 2.5. */
function scopedGrid(
  scope: { min: [number, number, number]; max: [number, number, number] },
  model: { min: [number, number, number]; max: [number, number, number] },
  radius: number,
  grow: number,
  resolution: number | undefined,
  where: string,
): GridSpec {
  const maxRes = resolution === undefined ? DEFAULT_MAX_RES : resolution;
  need(Number.isInteger(maxRes) && maxRes >= 32 && maxRes <= 320, `${where}.resolution must be an integer in 32..320`);
  const pad = 2 * radius;
  const min: [number, number, number] = [0, 0, 0];
  const max: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    min[k] = Math.max(scope.min[k] - grow - pad, model.min[k] - pad);
    max[k] = Math.min(scope.max[k] + grow + pad, model.max[k] + pad);
  }
  const spec = chooseGridForRadius(min, max, radius, 0, maxRes, 4);
  need(spec, `${where}: radius ${radius} is too small to resolve over the selected area at resolution ${maxRes} — use a larger radius, a smaller selection, or raise { resolution } (max 320)`);
  return spec!;
}

// --- Scoped ops: exact distance fields on a local lattice ---------------------
//
// The whole-model ops threshold and re-transform a raster field, which shifts
// a face by up to a voxel depending on where it falls on the lattice. That is
// invisible on a fully remeshed result, but a scoped op splices its remesh into
// the untouched input, so the two must meet without a step. Here every field is
// an EXACT distance (point-to-triangle, via the BVH) near the surface, and each
// morphological step measures distance to a dense sampling of the previous
// step's iso-surface, so a face the op doesn't change stays where it was.

/** Indices + world positions of the lattice samples within `band` of the
 *  surface (by the raster estimate) and inside `within`. Only these carry
 *  exact distances. */
function bandSamples(raster: Float32Array, spec: GridSpec, band: number, within: Uint8Array): { idx: Int32Array; pts: Float64Array } {
  const { nx, ny, voxel, origin } = spec;
  let n = 0;
  for (let i = 0; i < raster.length; i++) if (within[i] && Math.abs(raster[i]) < band) n++;
  const idx = new Int32Array(n);
  const pts = new Float64Array(n * 3);
  let q = 0;
  for (let i = 0; i < raster.length; i++) {
    if (!within[i] || !(Math.abs(raster[i]) < band)) continue;
    idx[q] = i;
    pts[q * 3] = origin[0] + (i % nx) * voxel;
    pts[q * 3 + 1] = origin[1] + (Math.floor(i / nx) % ny) * voxel;
    pts[q * 3 + 2] = origin[2] + Math.floor(i / (nx * ny)) * voxel;
    q++;
  }
  return { idx, pts };
}

/** Distance from each point to the nearest triangle of `mesh` (Infinity for
 *  an empty mesh). */
function distancesTo(mesh: any, pts: Float64Array): Float64Array {
  const numTri = mesh.triVerts.length / 3;
  const d = new Float64Array(pts.length / 3).fill(Infinity);
  if (numTri === 0) return d;
  // manifold-3d's Mesh exposes numTri as a getter, so pass the plain shape.
  nearestSurfaceTriangleMap({
    vertProperties: mesh.vertProperties, triVerts: mesh.triVerts, numProp: mesh.numProp,
    numTri, numVert: mesh.vertProperties.length / mesh.numProp,
  }, pts, d);
  for (let i = 0; i < d.length; i++) d[i] = Math.sqrt(d[i]);
  return d;
}

/** `raster + offset`, with each band sample replaced by `sign · distance +
 *  offset`, where the sign is negative where `inside(i)`. */
function signedFromDistances(raster: Float32Array, band: { idx: Int32Array }, d: Float64Array, inside: (i: number) => boolean, offset = 0): Float32Array {
  const out = offset === 0 ? raster.slice() : raster.map(v => v + offset);
  for (let q = 0; q < band.idx.length; q++) {
    const i = band.idx[q];
    out[i] = (inside(i) ? -d[q] : d[q]) + offset;
  }
  return out;
}

/** Exact signed distance to `mesh` on the band; `occ` (an exact per-sample
 *  inside test) gives the sign. */
function exactField(mesh: any, occ: Uint8Array, raster: Float32Array, band: { idx: Int32Array; pts: Float64Array }): Float32Array {
  return signedFromDistances(raster, band, distancesTo(mesh, band.pts), i => occ[i] !== 0);
}

/** Morphological OPENING of exact field `f` by r: the opened field is the
 *  distance to the eroded set {f ≤ −r} minus r, measured to a dense sampling
 *  of that set's surface (its lattice iso-crossings). */
function openExact(f: Float32Array, spec: GridSpec, r: number, band: { idx: Int32Array; pts: Float64Array }): Float32Array {
  const shifted = f.map(v => v + r);
  const crossings = isoCrossings(shifted, spec, 0, band.idx);
  need(crossings.length > 0, `round: radius ${r} rounds the selected area away entirely — it is thinner than ${(2 * r).toFixed(2)} units there. Use a smaller radius.`);
  const d = nearestPointDistances(crossings, band.pts);
  return signedFromDistances(shifted, band, d, i => shifted[i] < 0, -r);
}

/** Morphological CLOSING of exact field `f` by r: r minus the distance to the
 *  boundary of the dilated set {f ≤ r} (sampled the same way). */
function closeExact(f: Float32Array, spec: GridSpec, r: number, band: { idx: Int32Array; pts: Float64Array }): Float32Array {
  const shifted = f.map(v => v - r);
  const d = nearestPointDistances(isoCrossings(shifted, spec, 0, band.idx), band.pts);
  return signedFromDistances(shifted, band, d, i => shifted[i] < 0, r);
}

/** Splice a scoped edit into the exact input: `base + w·(edited − base)` is
 *  remeshed over the zone where that actually moves the surface (by more than
 *  about a tenth of a voxel), to be unioned into `exact` with the zone cut
 *  away (finishScoped). So a face or edge the op leaves alone — anywhere,
 *  inside the selection or out — stays the input's own geometry (sharp edges,
 *  tessellation, labels), and the seam is at most that tenth of a voxel.
 *  Returns null when the edit moves nothing. */
function spliceScoped(Manifold: any, base: Float32Array, edited: Float32Array, w: Float32Array, spec: GridSpec, r: number): { cut: any; cover: any; result: any } | null {
  const v = spec.voxel;
  const field = new Float32Array(base.length);
  const moved = new Float32Array(base.length);
  // Near the zone boundary the remesh and the input are two meshes of (nearly)
  // the same surface, and a boolean between them shatters into slivers
  // wherever they interleave. Lifting the remesh out by a hair more than its
  // interpolation error keeps it on one side.
  const lift = 0.05 * v;
  for (let i = 0; i < field.length; i++) {
    // w = 0 must stay a no-op even where `edited` is infinite (no surface
    // left to measure to), or NaN would poison the blur and the zone.
    const d = w[i] ? w[i] * (edited[i] - base[i]) : 0;
    field[i] = base[i] + d - lift;
    moved[i] = Math.abs(d);
  }
  // A face the op leaves alone still reads a hair off (the iso-crossing
  // sampling is within ~v²/8r), so the cut threshold sits above that noise,
  // and a blur turns the zone into smooth blobs instead of speckle.
  blurField(moved, spec);
  const eps = 0.1 * v + (v * v) / (4 * r);
  // Two nested zones: the input is cut away inside `cut`, and the remesh
  // covers the slightly larger `cover`. In the shell between, both are
  // present and the union keeps whichever is proud, so no face of one lies
  // on a face of the other (coincident cut faces also shatter a boolean).
  const cutField = new Float32Array(moved.length);
  const coverField = new Float32Array(moved.length);
  const { nx, ny, origin } = spec;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < moved.length; i++) {
    cutField[i] = eps - moved[i];
    coverField[i] = 0.5 * eps - moved[i];
    if (coverField[i] >= 0) continue;
    const c = [i % nx, Math.floor(i / nx) % ny, Math.floor(i / (nx * ny))];
    for (let k = 0; k < 3; k++) { if (c[k] < lo[k]) lo[k] = c[k]; if (c[k] > hi[k]) hi[k] = c[k]; }
  }
  if (lo[0] > hi[0]) return null;
  // Everything is only needed over the zone, so remesh just its box.
  const lim = [spec.nx - 1, spec.ny - 1, spec.nz - 1];
  const box = {
    min: lo.map((c, k) => origin[k] + Math.max(0, c - 3) * v),
    max: hi.map((c, k) => origin[k] + Math.min(lim[k], c + 3) * v),
  };
  return {
    cut: levelSetFromField(Manifold, cutField, spec, box),
    cover: levelSetFromField(Manifold, coverField, spec, box),
    result: levelSetFromField(Manifold, field, spec, box),
  };
}

export function createMeshSdfOps(module: any) {
  const { Manifold } = module;

  /** `keepLabels`: re-attach the inputs' part provenance to the remeshed
   *  output (each triangle takes its nearest input triangle's originalID), so
   *  api.label parts survive the levelSet rebuild like they survive a boolean.
   *  The intermediate `out` is freed by the sandbox's allocation tracking. */
  function withCarriedLabels(out: any, inputs: any[]): any {
    // Only labelled ids are worth the nearest-surface pass; an unlabelled
    // input returns the remesh untouched.
    const labelIds = activeLabelIds();
    if (!labelIds || labelIds.size === 0) return out;
    const sources = inputs.map(m => m.getMesh());
    if (!sources.some(s => s.runOriginalID && Array.from(s.runOriginalID as Uint32Array).some(id => labelIds.has(id)))) return out;
    const mesh = out.getMesh();
    const fallback = mesh.runOriginalID && mesh.runOriginalID.length > 0 ? mesh.runOriginalID[0] : 0;
    const carried = carryRunsByNearest(sources, mesh, fallback, id => labelIds.has(id));
    if (!carried) return out;
    return Manifold.ofMesh({
      numProp: mesh.numProp,
      vertProperties: mesh.vertProperties,
      triVerts: carried.triVerts,
      runIndex: carried.runIndex,
      runOriginalID: carried.runOriginalID,
    });
  }

  /** `exact` outside the zone, the edited surface inside it (see
   *  spliceScoped). A scoped op keeps labels by default: outside the zone they
   *  never left. */
  function finishScoped(exact: any, splice: { cut: any; cover: any; result: any } | null, inputs: any[], keepLabels: boolean, voxel: number): any {
    if (!splice) return exact; // the selection's edit moved nothing
    let inside = splice.result.intersect(splice.cover);
    if (keepLabels) inside = withCarriedLabels(inside, inputs);
    return dropSlivers(exact.subtract(splice.cut).add(inside), voxel, 1e-3, [exact]);
  }

  /** Re-merge `m` (as the app does on display) and drop the zero-size shells
   *  a cut can leave where it grazes a surface — loose pieces under `scale`
   *  voxels of volume (default a thousandth, which no real component is), and
   *  inside-out pockets under a voxel (a real cavity is bigger than that).
   *  A small piece that `sources` already had (same volume — a tiny separate
   *  component of the model, moved or not) is kept: only the cut's own debris
   *  goes. */
  function dropSlivers(m: any, voxel: number, scale = 1e-3, sources: any[] = []): any {
    const merged = Manifold.ofMesh(m.getMesh());
    const pieces = merged.decompose();
    if (pieces.length < 2) return merged;
    const v3 = voxel * voxel * voxel;
    const min = scale * v3, minCavity = Math.max(min, v3);
    const had = pieceVolumes(sources);
    const real = pieces.filter((p: any) => {
      const vol = p.volume();
      return vol > min || vol < -minCavity || takeMatch(had, vol);
    });
    return real.length === pieces.length ? merged : Manifold.compose(real);
  }

  /** Volumes of every connected piece (cavities negative) of `ms`. */
  function pieceVolumes(ms: any[]): number[] {
    const out: number[] = [];
    for (const m of ms) for (const p of m.decompose()) out.push(p.volume());
    return out;
  }

  /** Remove and report a volume in `list` equal to `v` (to float noise). */
  function takeMatch(list: number[], v: number): boolean {
    const i = list.findIndex(b => Math.abs(b - v) <= 1e-9 + 1e-4 * Math.abs(b));
    if (i < 0) return false;
    list.splice(i, 1);
    return true;
  }

  interface RoundOpts {
    /** Fillet radius in world units (applies to convex edges and concave creases). */
    radius: number;
    /** Which edges to round: 'both' (default) | 'convex' | 'concave'. */
    mode?: 'both' | 'convex' | 'concave';
    /** Lattice resolution cap along the longest axis (default 192, max 320).
     *  Higher = finer surface, slower. */
    resolution?: number;
    /** Keep the input's api.label parts on the rounded surface (default false). */
    keepLabels?: boolean;
    /** Round only near these faces (a selector — see selector.ts). */
    select?: unknown;
    /** World units the rounding fades over past the selection (default = radius). */
    blend?: number;
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
    const allowed = ['radius', 'mode', 'resolution', 'keepLabels', 'select', 'blend'];
    for (const k of Object.keys(opts)) {
      if (!allowed.includes(k)) throw new Error(`meshOps: round: unknown option "${k}" (allowed: ${allowed.join(', ')})`);
    }
    need(isFiniteNum(opts.radius) && opts.radius > 0, 'round.radius must be a positive number');
    const mode = opts.mode ?? 'both';
    need(mode === 'both' || mode === 'convex' || mode === 'concave', "round.mode must be 'both', 'convex' or 'concave'");
    need(!m.isEmpty(), 'round(m): input manifold is empty');
    need(opts.keepLabels === undefined || typeof opts.keepLabels === 'boolean', 'round.keepLabels must be true or false');
    const scope = parseSelectOpts(opts, 'round');

    const r = opts.radius;
    const mesh = m.getMesh();
    // Scoped: round only edges within the radius of a selected face, fading
    // out over `blend`; everything else is the input, untouched.
    let scoped: { masks: Uint8Array[]; min: [number, number, number]; max: [number, number, number] } | null = null;
    const blend = opts.blend === undefined ? r : scope.blend;
    if (scope.select) scoped = resolveScope([mesh], scope.select, 'round');
    const spec = scoped
      ? scopedGrid(scoped, bboxOf(m), r, r + blend, opts.resolution, 'round')
      : resolveGrid(bboxOf(m), r, opts.resolution, 'round');
    const occ = rasterizeOccupancy(mesh, spec);
    const base = signedFieldFromOccupancy(occ, spec);
    if (scoped) {
      // Opening first, as below; every step on exact distances (see above),
      // computed only near the selection.
      const w = scopeWeightField([mesh], scoped.masks, spec, r, blend);
      const band = bandSamples(base, spec, r + 3 * spec.voxel, nearScope(w, spec, r + 3 * spec.voxel));
      const f = exactField(mesh, occ, base, band);
      let edited = f;
      if (mode === 'both' || mode === 'convex') edited = openExact(edited, spec, r, band);
      if (mode === 'both' || mode === 'concave') edited = closeExact(edited, spec, r, band);
      const splice = spliceScoped(Manifold, f, edited, w, spec, r);
      return finishScoped(m, splice, [m], opts.keepLabels !== false, spec.voxel);
    }
    let field = base;
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
    return opts.keepLabels ? withCarriedLabels(out, [m]) : out;
  }

  /** The surface `distance` units out from (> 0) or into (< 0) `m`, as a
   *  levelSet of the exact signed distance, computed on a band of lattice
   *  samples on that side of the surface only. `null` when nothing is left
   *  (an inward offset deeper than the model is thick everywhere). */
  function offsetSurface(m: any, distance: number, resolution: number | undefined, where: string): { out: any | null; voxel: number } {
    const mesh = m.getMesh();
    const d = Math.abs(distance);
    const spec = resolveGrid(bboxOf(m), d, resolution, where);
    const occ = rasterizeOccupancy(mesh, spec);
    const raster = signedFieldFromOccupancy(occ, spec);
    // Exact distances only where the new surface can be: from just across the
    // input surface out to a few voxels past `distance` on its side.
    const margin = 2 * spec.voxel;
    const side = new Uint8Array(raster.length);
    for (let i = 0; i < raster.length; i++) side[i] = (distance > 0 ? raster[i] > -margin : raster[i] < margin) ? 1 : 0;
    const band = bandSamples(raster, spec, d + 3 * spec.voxel, side);
    const field = exactField(mesh, occ, raster, band);
    for (let i = 0; i < field.length; i++) field[i] -= distance;
    const out = levelSetFromField(Manifold, field, spec);
    if (out.isEmpty()) return { out: null, voxel: spec.voxel };
    // An inward offset of a noisy surface can leave voxel-sized crumbs.
    return { out: dropSlivers(out, spec.voxel), voxel: spec.voxel };
  }

  function checkOpts(opts: any, allowed: string[], where: string, required: string): void {
    need(opts && typeof opts === 'object', `${where}(m, opts): opts object with { ${required} } is required`);
    for (const k of Object.keys(opts)) {
      if (!allowed.includes(k)) throw new Error(`meshOps: ${where}: unknown option "${k}" (allowed: ${allowed.join(', ')})`);
    }
    need(opts.keepLabels === undefined || typeof opts.keepLabels === 'boolean', `${where}.keepLabels must be true or false`);
  }

  interface OffsetOpts {
    /** World units to grow (> 0) or shrink (< 0) the solid by, along the
     *  surface normal everywhere. */
    distance: number;
    /** Lattice resolution cap along the longest axis (default 192, max 320). */
    resolution?: number;
    /** Keep the input's api.label parts on the offset surface (default false). */
    keepLabels?: boolean;
  }

  /** Grow or shrink ANY solid by a uniform distance — a true 3D offset
   *  (Minkowski with a ball), the mesh-side analogue of Blender's Solidify
   *  "offset" or a CAD "offset surface". Positive grows (convex edges come out
   *  rounded), negative shrinks (thin features thinner than 2·|distance|
   *  vanish). The result is a remeshed levelSet surface, accurate to a
   *  fraction of the lattice voxel. */
  function offset(m: any, opts: OffsetOpts): any {
    need(isManifold(m), 'offset(m, {distance}): m must be a Manifold');
    checkOpts(opts, ['distance', 'resolution', 'keepLabels'], 'offset', 'distance');
    need(isFiniteNum(opts.distance) && opts.distance !== 0, 'offset.distance must be a non-zero number (> 0 grows, < 0 shrinks)');
    need(!m.isEmpty(), 'offset(m): input manifold is empty');
    const { out } = offsetSurface(m, opts.distance, opts.resolution, 'offset');
    if (!out) {
      throw new Error(
        `meshOps: offset: shrinking by ${-opts.distance} removed the whole model — it is nowhere thicker than ` +
        `${(-2 * opts.distance).toFixed(2)} units. Use a smaller distance.`,
      );
    }
    return opts.keepLabels ? withCarriedLabels(out, [m]) : out;
  }

  interface ShellOpts {
    /** Wall thickness in world units. */
    thickness: number;
    /** Where the wall goes relative to the input surface: 'inside' (default —
     *  hollow the solid, outer surface unchanged) or 'outside' (a skin around
     *  it, inner surface = the input's surface, e.g. a mould or a sleeve). */
    side?: 'inside' | 'outside';
    /** Lattice resolution cap along the longest axis (default 192, max 320). */
    resolution?: number;
    /** Carry the input's api.label parts onto the NEW wall surface too
     *  (default false; the input's own surface keeps its labels regardless). */
    keepLabels?: boolean;
  }

  /** Hollow ANY solid to a uniform wall thickness — the mesh-side analogue of
   *  Blender's Solidify / CAD "shell". The input's own surface is kept EXACTLY
   *  (tessellation, sculpt detail, labels); only the new wall surface is
   *  remeshed. Regions thinner than 2·thickness stay solid. The result is a
   *  closed hollow solid: cut an opening with a boolean (e.g. subtract a box
   *  behind a face to make a mask). */
  function shell(m: any, opts: ShellOpts): any {
    need(isManifold(m), 'shell(m, {thickness}): m must be a Manifold');
    checkOpts(opts, ['thickness', 'side', 'resolution', 'keepLabels'], 'shell', 'thickness');
    need(isFiniteNum(opts.thickness) && opts.thickness > 0, 'shell.thickness must be a positive number');
    const side = opts.side ?? 'inside';
    need(side === 'inside' || side === 'outside', "shell.side must be 'inside' or 'outside'");
    need(!m.isEmpty(), 'shell(m): input manifold is empty');
    const t = opts.thickness;
    const { out: wall } = offsetSurface(m, side === 'inside' ? -t : t, opts.resolution, 'shell');
    if (!wall) {
      throw new Error(
        `meshOps: shell: the model is nowhere thicker than ${(2 * t).toFixed(2)} units, so a ${t}-unit wall ` +
        `leaves nothing to hollow. Use a smaller thickness, or side: 'outside'.`,
      );
    }
    const surface = opts.keepLabels ? withCarriedLabels(wall, [m]) : wall;
    return side === 'inside' ? m.subtract(surface) : surface.subtract(m);
  }

  interface SmoothWeldOpts {
    /** Blend radius in world units — how far the smooth fillet reaches from the seam. */
    radius: number;
    /** Lattice resolution cap along the longest axis (default 192, max 320). */
    resolution?: number;
    /** Keep the inputs' api.label parts on the welded surface (default false). */
    keepLabels?: boolean;
    /** Blend only near these faces; elsewhere the parts meet with a plain union. */
    select?: unknown;
    /** World units the blend fades over past the selection (default = radius). */
    blend?: number;
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
    const allowed = ['radius', 'resolution', 'keepLabels', 'select', 'blend'];
    for (const k of Object.keys(opts)) {
      if (!allowed.includes(k)) throw new Error(`meshOps: smoothWeld: unknown option "${k}" (allowed: ${allowed.join(', ')})`);
    }
    need(isFiniteNum(opts.radius) && opts.radius > 0, 'smoothWeld.radius must be a positive number');
    need(opts.keepLabels === undefined || typeof opts.keepLabels === 'boolean', 'smoothWeld.keepLabels must be true or false');
    const scope = parseSelectOpts(opts, 'smoothWeld');

    const r = opts.radius;
    let bounds = bboxOf(parts[0]);
    for (let i = 1; i < parts.length; i++) bounds = unionBounds(bounds, bboxOf(parts[i]));
    const meshes = parts.map(p => p.getMesh());
    // Scoped: blend only near the selected faces; elsewhere the parts meet with
    // a plain (exact) union.
    const blend = opts.blend === undefined ? r : scope.blend;
    const scoped = scope.select ? resolveScope(meshes, scope.select, 'smoothWeld') : null;
    if (scoped) return scopedWeld(parts, meshes, scoped, bounds, r, blend, opts.resolution, opts.keepLabels !== false, 'smoothWeld');
    const spec = resolveGrid(bounds, r, opts.resolution, 'smoothWeld');
    // Fold the parts together with smooth-min on the shared lattice.
    let acc: Float32Array | null = null;
    for (const mesh of meshes) {
      const occ = rasterizeOccupancy(mesh, spec);
      const field = signedFieldFromOccupancy(occ, spec);
      if (acc === null) {
        acc = field;
      } else {
        for (let i = 0; i < acc.length; i++) acc[i] = smin(acc[i], field[i], r);
      }
    }
    blurField(acc!, spec); // smooth the raster's half-voxel corduroy
    const out = levelSetFromField(Manifold, acc!, spec);
    return opts.keepLabels ? withCarriedLabels(out, parts) : out;
  }

  /** smoothWeld restricted to faces near the selection (`scoped`): exact
   *  per-part distances, so the plain union around the blend is the parts'
   *  own surface (see the scoped-ops note above). */
  function scopedWeld(
    parts: any[],
    meshes: any[],
    scoped: { masks: Uint8Array[]; min: [number, number, number]; max: [number, number, number] },
    bounds: { min: [number, number, number]; max: [number, number, number] },
    r: number,
    blend: number,
    resolution: number | undefined,
    keepLabels: boolean,
    name: string,
  ): any {
    const spec = scopedGrid(scoped, bounds, r, r + blend, resolution, name);
    const w = scopeWeightField(meshes, scoped.masks, spec, r, blend);
    const near = nearScope(w, spec, 2 * r + 3 * spec.voxel);
    let hard: Float32Array | null = null;
    let soft: Float32Array | null = null;
    for (const mesh of meshes) {
      const occ = rasterizeOccupancy(mesh, spec);
      const raster = signedFieldFromOccupancy(occ, spec);
      const f = exactField(mesh, occ, raster, bandSamples(raster, spec, 2 * r + 3 * spec.voxel, near));
      if (!hard || !soft) { hard = f; soft = f.slice(); continue; }
      for (let i = 0; i < f.length; i++) {
        soft[i] = smin(soft[i], f[i], r);
        hard[i] = Math.min(hard[i], f[i]);
      }
    }
    const splice = spliceScoped(Manifold, hard!, soft!, w, spec, r);
    return finishScoped(Manifold.union(parts), splice, parts, keepLabels, spec.voxel);
  }

  /** Cut `m` into the selected part and the rest along the surface halfway
   *  between the selected faces and all the others (so a head comes off at the
   *  neck, an arm at the shoulder). The cut is a levelSet of the difference of
   *  the two exact distances on a lattice around the selection; booleans keep
   *  every input face exact. `seamId` is the cut faces' originalID. */
  function splitPart(m: any, mesh: any, mask: Uint8Array, sel: { min: Vec3; max: Vec3 }, resolution: number): { part: any; rest: any | null; seamId: number; voxel: number } {
    const numTri = mesh.triVerts.length / 3;
    const pick = (want: number) => {
      const tv: number[] = [];
      for (let t = 0; t < numTri; t++) if (mask[t] === want) tv.push(mesh.triVerts[t * 3], mesh.triVerts[t * 3 + 1], mesh.triVerts[t * 3 + 2]);
      return {
        vertProperties: mesh.vertProperties, triVerts: Uint32Array.from(tv), numProp: mesh.numProp,
        numTri: tv.length / 3, numVert: mesh.vertProperties.length / mesh.numProp,
      };
    };
    const selMesh = pick(1), otherMesh = pick(0);
    // The selection is the whole model: nothing to cut, the edit applies to all of it.
    if (otherMesh.numTri === 0) return { part: m, rest: null, seamId: -1, voxel: 1 };
    // The part's solid can reach past its faces' box (a patch on a flat face
    // owns material behind it), so grow the box by half its diagonal, clipped
    // to the model.
    const mb = bboxOf(m);
    const grow = 0.5 * Math.hypot(sel.max[0] - sel.min[0], sel.max[1] - sel.min[1], sel.max[2] - sel.min[2]);
    const lo: Vec3 = [0, 0, 0], hi: Vec3 = [0, 0, 0];
    let longest = 0;
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.max(sel.min[k] - grow, mb.min[k]);
      hi[k] = Math.min(sel.max[k] + grow, mb.max[k]);
      longest = Math.max(longest, hi[k] - lo[k]);
    }
    const voxel = Math.max(longest, 1e-6) / resolution;
    // Two voxels of air past the model, so the forced-outside outer layer
    // never shaves a sliver off a part that reaches the model's edge.
    for (let k = 0; k < 3; k++) {
      if (lo[k] <= mb.min[k]) lo[k] = mb.min[k] - 2 * voxel;
      if (hi[k] >= mb.max[k]) hi[k] = mb.max[k] + 2 * voxel;
    }
    const spec: GridSpec = {
      nx: Math.max(4, Math.ceil((hi[0] - lo[0]) / voxel) + 1),
      ny: Math.max(4, Math.ceil((hi[1] - lo[1]) / voxel) + 1),
      nz: Math.max(4, Math.ceil((hi[2] - lo[2]) / voxel) + 1),
      origin: lo,
      voxel,
    };
    const n = spec.nx * spec.ny * spec.nz;
    const pts = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) {
      pts[i * 3] = lo[0] + (i % spec.nx) * voxel;
      pts[i * 3 + 1] = lo[1] + (Math.floor(i / spec.nx) % spec.ny) * voxel;
      pts[i * 3 + 2] = lo[2] + Math.floor(i / (spec.nx * spec.ny)) * voxel;
    }
    const dSel = new Float64Array(n), dOther = new Float64Array(n);
    nearestSurfaceTriangleMap(selMesh, pts, dSel);
    nearestSurfaceTriangleMap(otherMesh, pts, dOther);
    // Negative (inside the cut region) where the selected faces are nearer.
    // The lattice's outer layer is forced outside so the region closes there.
    const field = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const ix = i % spec.nx, iy = Math.floor(i / spec.nx) % spec.ny, iz = Math.floor(i / (spec.nx * spec.ny));
      const edge = ix === 0 || iy === 0 || iz === 0 || ix === spec.nx - 1 || iy === spec.ny - 1 || iz === spec.nz - 1;
      // An exact tie (common on a symmetric model) would put the iso-surface
      // through the sample itself, which levelSet turns into zero-size shells.
      field[i] = edge ? voxel : (Math.sqrt(dSel[i]) - Math.sqrt(dOther[i])) || 1e-6 * voxel;
    }
    // Deep inside the solid the two distances nearly tie, which speckles the
    // region with islands and pockets (each would become a loose chip of the
    // part or a hole in it). Keep only what connects to the selected faces,
    // and fill what doesn't connect to the other faces.
    const near = voxel * voxel;
    const keepIn = floodFill(spec, i => field[i] < 0, i => field[i] < 0 && dSel[i] <= near);
    const keepOut = floodFill(spec, i => !(field[i] < 0) || !keepIn[i], i => !keepIn[i] && (!(field[i] < 0)) && dOther[i] <= near);
    for (let i = 0; i < n; i++) {
      const edge = field[i] === voxel;
      if (edge) continue;
      if (field[i] < 0 && !keepIn[i]) field[i] = voxel * 0.5;
      else if (!(field[i] < 0) && !keepOut[i]) field[i] = -voxel * 0.5;
    }
    // A jagged cut leaves sub-voxel bridges and tunnels where the edited part
    // meets the rest again; one blur pass makes the cut surface smooth. (The
    // outer layer stays forced outside.)
    blurField(field, spec);
    for (let i = 0; i < n; i++) {
      const ix = i % spec.nx, iy = Math.floor(i / spec.nx) % spec.ny, iz = Math.floor(i / (spec.nx * spec.ny));
      if (ix === 0 || iy === 0 || iz === 0 || ix === spec.nx - 1 || iy === spec.ny - 1 || iz === spec.nz - 1) field[i] = voxel;
    }
    // levelSet can still emit zero-size shells on lattice planes; drop them
    // before they seed slivers in the booleans.
    const raw = levelSetFromField(Manifold, field, spec);
    const seamId = raw.originalID();
    const region = dropSlivers(raw, voxel);
    // Where the two distances nearly tie the cut can also chip off loose
    // voxel-sized crumbs; they'd float once the part moves, so drop them.
    return { part: dropSlivers(m.intersect(region), voxel, 4, [m]), rest: dropSlivers(m.subtract(region), voxel, 4, [m]), seamId, voxel };
  }

  /** Per-triangle mask of the faces carrying originalID `id`. */
  function facesWithId(mesh: any, id: number): Uint8Array {
    const numTri = mesh.triVerts.length / 3;
    const mask = new Uint8Array(numTri);
    const ri = mesh.runIndex, rid = mesh.runOriginalID;
    if (!ri || !rid) return mask;
    for (let r = 0; r < rid.length; r++) {
      if (rid[r] !== id) continue;
      for (let t = Math.floor(ri[r] / 3); t < Math.min(numTri, Math.floor(ri[r + 1] / 3)); t++) mask[t] = 1;
    }
    return mask;
  }

  /** Area-weighted centroid + box of the masked faces (null when none). */
  function facesCentroid(mesh: any, mask: Uint8Array): { center: Vec3; min: Vec3; max: Vec3 } | null {
    const vp = mesh.vertProperties, np = mesh.numProp, tv = mesh.triVerts;
    let area = 0;
    const c: Vec3 = [0, 0, 0], min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (let t = 0; t < mask.length; t++) {
      if (!mask[t]) continue;
      const a = tv[t * 3] * np, b = tv[t * 3 + 1] * np, d = tv[t * 3 + 2] * np;
      const ux = vp[b] - vp[a], uy = vp[b + 1] - vp[a + 1], uz = vp[b + 2] - vp[a + 2];
      const vx = vp[d] - vp[a], vy = vp[d + 1] - vp[a + 1], vz = vp[d + 2] - vp[a + 2];
      const ar = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
      for (let k = 0; k < 3; k++) {
        c[k] += ar * (vp[a + k] + vp[b + k] + vp[d + k]) / 3;
        for (const o of [a, b, d]) { if (vp[o + k] < min[k]) min[k] = vp[o + k]; if (vp[o + k] > max[k]) max[k] = vp[o + k]; }
      }
      area += ar;
    }
    if (area <= 0) return null;
    return { center: [c[0] / area, c[1] / area, c[2] / area], min, max };
  }

  interface PartTransform {
    /** Uniform factor or per-axis [x, y, z] (all > 0). */
    scale?: number | Vec3;
    /** Euler degrees [x, y, z], applied after scaling. */
    rotate?: Vec3;
    /** World offset applied last. */
    translate?: Vec3;
    /** Point to scale / rotate about (default: the seam's centre). */
    pivot?: Vec3;
  }

  function transformPart(part: any, tr: PartTransform, pivotDefault: Vec3): any {
    const allowed = ['scale', 'rotate', 'translate', 'pivot'];
    for (const k of Object.keys(tr)) need(allowed.includes(k), `editPart: unknown transform key "${k}" (allowed: ${allowed.join(', ')})`);
    const vec = (v: unknown, name: string) => need(Array.isArray(v) && v.length === 3 && v.every(isFiniteNum), `editPart.${name} must be [x, y, z]`);
    if (tr.pivot !== undefined) vec(tr.pivot, 'pivot');
    if (tr.rotate !== undefined) vec(tr.rotate, 'rotate');
    if (tr.translate !== undefined) vec(tr.translate, 'translate');
    let s: Vec3 = [1, 1, 1];
    if (tr.scale !== undefined) {
      if (isFiniteNum(tr.scale)) s = [tr.scale, tr.scale, tr.scale];
      else { vec(tr.scale, 'scale'); s = tr.scale as Vec3; }
      need(s.every(x => x > 0), 'editPart.scale must be > 0 on every axis');
    }
    const p = tr.pivot ?? pivotDefault;
    let out = part.translate([-p[0], -p[1], -p[2]]);
    if (tr.scale !== undefined) out = out.scale(s);
    if (tr.rotate !== undefined) out = out.rotate(tr.rotate);
    const t = tr.translate ?? [0, 0, 0];
    return out.translate([p[0] + t[0], p[1] + t[1], p[2] + t[2]]);
  }

  interface EditPartOpts {
    /** Smooth the seam where the edited part meets the rest with a fillet of
     *  this radius (a scoped smoothWeld). Default: 1/32 of the cut box (two
     *  voxels at the default resolution); 0 for a plain union. */
    blend?: number;
    /** Cut lattice resolution along the selection box's longest side (default 64, 32..128). */
    resolution?: number;
  }

  /** Edit one part of a solid as a solid: cut it off along the seam between
   *  it and the rest, apply `edit` — a function `(part, info) => Manifold`
   *  (return null to delete the part) or a `{ scale, rotate, translate, pivot }`
   *  transform about the seam — and put it back. `part` is a part name or any
   *  selector. Works on api.label parts and detected import parts
   *  (api.importWithParts); labels carry through. */
  function editPart(m: any, select: unknown, edit: unknown, opts: EditPartOpts = {}): any {
    need(isManifold(m), 'editPart(m, part, edit): m must be a Manifold');
    need(!m.isEmpty(), 'editPart(m): input manifold is empty');
    const sel = parseSelector(typeof select === 'string' ? { label: select } : select, 'editPart.part');
    need(typeof edit === 'function' || (!!edit && typeof edit === 'object' && !Array.isArray(edit)),
      'editPart(m, part, edit): edit must be a function (part, info) => Manifold or a { scale, rotate, translate, pivot } object');
    need(!!opts && typeof opts === 'object', 'editPart: opts must be an object');
    for (const k of Object.keys(opts)) need(['blend', 'resolution'].includes(k), `editPart: unknown option "${k}" (allowed: blend, resolution)`);
    const blendOpt = opts.blend;
    need(blendOpt === undefined || (isFiniteNum(blendOpt) && blendOpt >= 0), 'editPart.blend must be a distance >= 0');
    const resolution = opts.resolution ?? 64;
    need(Number.isInteger(resolution) && resolution >= 32 && resolution <= 128, 'editPart.resolution must be an integer in 32..128');

    const mesh = m.getMesh();
    const scope = resolveScope([mesh], sel, 'editPart.part');
    const { part, rest, seamId, voxel } = splitPart(m, mesh, scope.masks[0], scope, resolution);
    need(!part.isEmpty(), 'editPart: the selected faces enclose no material to cut off — select a whole part (e.g. its label)');
    const partMesh = part.getMesh();
    const seam = seamId >= 0 ? facesCentroid(partMesh, facesWithId(partMesh, seamId)) : null;
    const box = bboxOf(part);
    const info = {
      center: [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2] as Vec3,
      min: box.min, max: box.max,
      seam: seam ? seam.center : null,
      seamBox: seam ? { min: seam.min, max: seam.max } : null,
    };
    let next: any;
    if (typeof edit === 'function') {
      next = edit(part, info);
      need(next === null || next === undefined || isManifold(next), 'editPart: the edit function must return a Manifold (or null to delete the part)');
    } else {
      next = transformPart(part, edit as PartTransform, info.seam ?? info.center);
    }
    if (!rest || rest.isEmpty()) {
      need(!!next && !next.isEmpty(), 'editPart: the selection is the whole model, so deleting it would leave nothing');
      return next;
    }
    if (!next || next.isEmpty()) return rest;
    // Crumbs and sealed pockets the join leaves at the seam go; anything
    // either side already had (a small separate piece, a hollow) stays.
    const finish = (out: any) => fillNewCavities(dropSlivers(out, voxel, 4, [rest, next]), [rest, next]);
    // Default: a small fillet (1/32 of the cut box, two voxels at the default
    // resolution), which also closes the sub-voxel tunnels a jagged cut can
    // leave where the edited part meets the rest. Tied to the box, not the
    // voxel, so a finer cut doesn't shrink it below what closes them.
    const blend = blendOpt ?? (voxel * resolution) / 32;
    if (blend === 0) return finish(rest.add(next));
    // Blend only around the seam: both sides' cut faces (when the edit kept
    // the part's), grown to cover the joint.
    const meshes = [rest.getMesh(), next.getMesh()];
    const masks = meshes.map(mm => facesWithId(mm, seamId));
    const pts = masks.map((mk, i) => facesCentroid(meshes[i], mk)).filter((x): x is NonNullable<typeof x> => !!x);
    if (pts.length === 0) {
      need(blendOpt === undefined, 'editPart.blend: no seam left to blend (the edit replaced the part entirely) — weld it yourself with api.smoothWeld');
      return finish(rest.add(next));
    }
    const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const q of pts) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], q.min[k]); max[k] = Math.max(max[k], q.max[k]); }
    const weld = () => finish(scopedWeld([rest, next], meshes, { masks, min, max }, unionBounds(bboxOf(rest), bboxOf(next)), blend, blend, undefined, true, 'editPart'));
    if (blendOpt !== undefined) return weld();
    // The default fillet is a nicety: if the seam is too big to resolve at
    // that radius, fall back to the plain union rather than fail the edit.
    try { return weld(); } catch { return finish(rest.add(next)); }
  }

  /** A part cut along a curved seam and then scaled or turned no longer
   *  matches the rest's side of the seam, and where the edited part's rim
   *  still overlaps the rest the gap between them is sealed into a hidden
   *  cavity. Fill every cavity (inside-out piece) of `out` that neither
   *  operand had: the rest's and the edited part's own cavities (a hollow
   *  head, scaled with it) are kept. */
  function fillNewCavities(out: any, operands: any[]): any {
    const pieces = out.decompose();
    if (pieces.length < 2) return out;
    const had = pieceVolumes(operands).filter(v => v < 0);
    const kept = pieces.filter((p: any) => { const v = p.volume(); return v >= 0 || takeMatch(had, v); });
    return kept.length === pieces.length ? out : Manifold.compose(kept);
  }

  return { round, offset, shell, smoothWeld, editPart };
}
