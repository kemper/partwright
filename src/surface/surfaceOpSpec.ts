// Shared, dependency-free spec for `api.surface.*` operations declared in model
// code. This is the single source of truth for which surface modifiers can be
// expressed as code and which option keys each one accepts.
//
// It is intentionally a leaf module (no imports): the Worker sandbox
// (`engines/manifoldJs.ts`) imports it to *validate* `api.surface.*` calls, and
// the main thread (`surfaceOps.ts`) imports it to *apply* them. Keeping the spec
// here avoids pulling the heavy modifier math (which is main-thread + WebGPU)
// into the Worker bundle, and avoids a module cycle.

/** Surface modifiers that can be recorded in code as `api.surface.<id>(...)`.
 *  A subset of `SurfaceModifierId` (`src/surface/modifiers.ts`): the ones that
 *  produce a manifold-js mesh by displacing/smoothing the existing geometry.
 *  `voxelize` / `voronoiLamp(voxel)` change the engine, so they stay
 *  destructive bakes only. */
export type SurfaceOpId =
  | 'fuzzy'
  | 'knit'
  | 'cable'
  | 'waffle'
  | 'fur'
  | 'woven'
  | 'knurl'
  | 'voronoi'
  | 'smooth';

/** Optional scope limiting a surface op to part of the model instead of the
 *  whole skin. Declarative (resolved against the actual mesh at apply time):
 *   - `label` — the triangles of an `api.label(shape, name, …)` region, so one
 *     shape of a unioned model can be textured (e.g. a knurled grip on a
 *     smooth body).
 *   - `point` — every triangle whose surface sits within `radius` of a
 *     world-space point, e.g. captured from a viewport click. */
export type SurfaceScope =
  | { kind: 'label'; label: string }
  | { kind: 'point'; point: [number, number, number]; radius: number };

/** A scope resolved to seed points + a catch radius (computed main-side from
 *  the base mesh, then handed to the surface Worker). The Worker selects every
 *  triangle whose centroid lies within `radius` of any seed and textures only
 *  those (the existing patch path). Not part of the memo key — it's derived
 *  deterministically from {@link SurfaceScope} + the base mesh, both already
 *  keyed. */
export interface ResolvedScope {
  seeds: Float32Array;
  radius: number;
}

/** One recorded surface operation. Ops form an ordered chain applied to the
 *  final returned mesh (a terminal skin, like the current Surface-panel bake).
 *  `params` carries only the user-supplied overrides — size-relative defaults
 *  are filled in main-side from the actual mesh at apply time. `scope`, when
 *  present, limits the op to part of the model (see {@link SurfaceScope}). */
export interface SurfaceOp {
  id: SurfaceOpId;
  params: Record<string, number | boolean | string>;
  scope?: SurfaceScope;
}

/** Accepted option keys per modifier — mirrors the `Required<…Options>` field
 *  sets in `src/surface/modifiers.ts` (the `default*Options` factories). Used to
 *  reject unknown keys at record time so a typo surfaces as a clear sandbox
 *  error instead of being silently dropped. */
export const SURFACE_OP_FIELDS: Record<SurfaceOpId, readonly string[]> = {
  fuzzy: ['amplitude', 'scale', 'octaves', 'seed', 'quality', 'subdivide'],
  knit: ['amplitude', 'stitchWidth', 'stitchHeight', 'rowOffset', 'roundness', 'grainAngleDeg', 'variation', 'seed', 'quality', 'subdivide', 'algorithm'],
  cable: ['amplitude', 'cableWidth', 'cablePitch', 'plyWidth', 'grainAngleDeg', 'variation', 'seed', 'quality', 'subdivide'],
  waffle: ['amplitude', 'cellWidth', 'cellHeight', 'sharpness', 'rowOffset', 'grainAngleDeg', 'seed', 'quality', 'subdivide'],
  fur: ['amplitude', 'fiberSpacing', 'fiberLength', 'octaves', 'grainAngleDeg', 'seed', 'quality', 'subdivide'],
  woven: ['amplitude', 'threadSpacing', 'threadWidth', 'underDepth', 'grainAngleDeg', 'seed', 'quality', 'subdivide'],
  knurl: ['amplitude', 'pitch', 'aspect', 'pattern', 'grainAngleDeg', 'seed', 'quality', 'subdivide'],
  voronoi: ['amplitude', 'cellSize', 'wallWidth', 'raised', 'jitter', 'grainAngleDeg', 'seed', 'quality', 'subdivide'],
  smooth: ['iterations', 'subdivide'],
};

export const SURFACE_OP_IDS = Object.keys(SURFACE_OP_FIELDS) as SurfaceOpId[];

/** Reserved option keys that scope an op to part of the model rather than name
 *  a per-modifier parameter (see {@link SurfaceScope}). Handled separately from
 *  `SURFACE_OP_FIELDS`. */
export const SURFACE_SCOPE_KEYS = ['label', 'region'] as const;

/** Validate and split a raw `api.surface.<id>(opts)` options object into the
 *  per-modifier scalar `params` and an optional `scope` (from the reserved
 *  `label` / `region` keys). Throws an `Error` with an actionable message on
 *  anything invalid. Pure + dependency-free, so the Worker sandbox recorder
 *  (`engines/manifoldJs.ts`) and the console twin (`applySurfaceTextureAsCode`
 *  in `main.ts`) share ONE source of truth and can't drift. */
export function parseSurfaceOpts(
  id: SurfaceOpId,
  opts: Record<string, unknown>,
): { params: Record<string, number | boolean | string>; scope?: SurfaceScope } {
  if ('label' in opts && 'region' in opts) {
    throw new Error(`api.surface.${id}: pass either label or region to scope the op, not both.`);
  }
  const allowed = SURFACE_OP_FIELDS[id];
  const params: Record<string, number | boolean | string> = {};
  let scope: SurfaceScope | undefined;
  for (const [k, v] of Object.entries(opts)) {
    if (k === 'label') {
      if (typeof v !== 'string' || v.length === 0) {
        throw new Error(`api.surface.${id}.label: must be a non-empty string naming an api.label(...) region.`);
      }
      scope = { kind: 'label', label: v };
      continue;
    }
    if (k === 'region') {
      scope = parseRegionScope(id, v);
      continue;
    }
    if (!allowed.includes(k)) {
      throw new Error(`api.surface.${id}: unknown option "${k}". Accepted: ${allowed.join(', ')} (or scope keys: label, region).`);
    }
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw new Error(`api.surface.${id}.${k}: must be a finite number.`);
    } else if (typeof v !== 'boolean' && typeof v !== 'string') {
      throw new Error(`api.surface.${id}.${k}: must be a number, boolean, or string.`);
    }
    params[k] = v;
  }
  return scope ? { params, scope } : { params };
}

function parseRegionScope(id: SurfaceOpId, v: unknown): SurfaceScope {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new Error(`api.surface.${id}.region: must be an object, e.g. { point: [x, y, z], radius: 8 }.`);
  }
  const r = v as Record<string, unknown>;
  for (const k of Object.keys(r)) {
    if (k !== 'point' && k !== 'radius') throw new Error(`api.surface.${id}.region: unknown key "${k}". Accepted: point, radius.`);
  }
  const point = r.point;
  if (!Array.isArray(point) || point.length !== 3 || !point.every(n => typeof n === 'number' && Number.isFinite(n))) {
    throw new Error(`api.surface.${id}.region.point: must be [x, y, z] finite numbers.`);
  }
  const radius = r.radius;
  if (typeof radius !== 'number' || !Number.isFinite(radius) || radius <= 0) {
    throw new Error(`api.surface.${id}.region.radius: must be a positive number.`);
  }
  return { kind: 'point', point: [point[0] as number, point[1] as number, point[2] as number], radius };
}

export function isSurfaceOpId(v: unknown): v is SurfaceOpId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(SURFACE_OP_FIELDS, v);
}

/** A computed `api.surface.*` result persisted with a saved version, so that
 *  reopening the session renders the textured mesh instantly instead of
 *  recomputing the chain (and so the texture's appearance is pinned at save
 *  time, even as the modifier math evolves between releases).
 *
 *  `key` is the full-chain memo key (a hash of code + customizer params +
 *  import identity + the serialized op chain — see `surfaceChainKey` in
 *  `surfaceOps.ts`). On version load the mesh is seeded into the memo cache
 *  under this key; if the freshly recomputed key no longer matches (different
 *  code, params, imports, or hash algorithm), the seed simply never hits and
 *  the chain recomputes — the field is self-validating and can never render a
 *  texture that doesn't belong to the version.
 *
 *  `mesh` structurally mirrors `MeshData` (`src/geometry/types.ts`); it is
 *  declared inline here to keep this spec module dependency-free. */
export interface PersistedSurfaceTexture {
  key: string;
  mesh: {
    vertProperties: Float32Array;
    triVerts: Uint32Array;
    numVert: number;
    numTri: number;
    numProp: number;
    triColors?: Uint8Array;
  };
}
