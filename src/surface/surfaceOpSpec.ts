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
