import type { ParamSpec } from './params';
import type { SurfaceOp } from '../surface/surfaceOpSpec';

export interface MeshData {
  vertProperties: Float32Array;
  triVerts: Uint32Array;
  numVert: number;
  numTri: number;
  numProp: number;
  triColors?: Uint8Array; // numTri * 3 (RGB per triangle), optional
  /** Render hint: draw this mesh flat-faceted (per-face normals, hard facet
   *  edges) instead of smooth-shaded — the low-poly look. Set by the
   *  manifold-js sandbox when model code calls `api.lowPoly(shape, { flatShade })`.
   *  A render-only flag, re-derived from the code on every run (never persisted
   *  in the session schema — like `renderOnly`). The viewport already flat-
   *  shades any coloured mesh (it unindexes per triangle); this extends that to
   *  an unpainted low-poly mesh. */
  flatShade?: boolean;
  mergeFromVert?: Uint32Array; // vertex merge pairs from manifold-3d (for export dedup)
  mergeToVert?: Uint32Array;
  /** Per-triangle-run provenance from manifold-3d, used to resolve
   *  `api.label(shape, name)` calls back to triangle sets after boolean
   *  ops. `runIndex` has length `numRun + 1`; run `i` covers triangles
   *  in `[runIndex[i]/3, runIndex[i+1]/3)`. `runOriginalID` has length
   *  `numRun` and gives the `originalID()` of the input that produced
   *  each run. Optional because not every engine populates it. */
  runIndex?: Uint32Array;
  runOriginalID?: Uint32Array;
}

export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint';

export interface SourceDiagnostic {
  message: string;
  severity: DiagnosticSeverity;
  source?: string;
  hint?: string;
  from?: number;
  to?: number;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
}

export interface MeshResult {
  mesh: MeshData | null;
  manifold: unknown | null;
  error: string | null;
  diagnostics?: SourceDiagnostic[];
  /** Map from `api.label(shape, name)` calls in the user's code to the
   *  triangle ids in the result mesh that came from that labelled input.
   *  Resolved by walking `mesh.runOriginalID` + `runIndex`. Empty / absent
   *  when no labels were registered. */
  labelMap?: Map<string, Set<number>>;
  /** Colors declared in code via `api.label(shape, name, { color })`, keyed by
   *  label name (RGB 0..1). The main thread resolves each name's triangles from
   *  `labelMap` and renders/exports them as a derived "model color" underlay —
   *  no manual painting needed. Manual paint regions composite on top. Absent
   *  when no labelled color was declared this run. */
  labelColors?: Map<string, [number, number, number]>;
  /** Paint operations declared in code via `api.paint.*` (box / slab / cylinder /
   *  label). Each carries a region descriptor plus its resolved RGB (0..1). The
   *  main thread resolves every descriptor's triangles against the freshly-run
   *  mesh and renders them as part of the derived "model color" underlay — so
   *  paint declared in code is durable WITH the code and never serialized to the
   *  paint sidecar (the code is the source of truth). `descriptor` is a
   *  `RegionDescriptor` but kept `unknown` here so this low-level geometry type
   *  doesn't import the `color/` layer (that would close a module cycle); the
   *  main thread casts it back. Absent when no `api.paint.*` ran this turn. */
  paintOps?: { name: string; color: [number, number, number]; descriptor: unknown }[];
  /** Surface texture ops declared in code via `api.surface.*` (fuzzy / knit /
   *  cable / waffle / fur / woven / voronoi / smooth). An ordered chain applied
   *  by the MAIN thread to the final returned mesh after the run (reusing the
   *  existing modifier math) and memoized, so the parametric texture lives WITH
   *  the code instead of being baked into `api.imports[0]`. Plain serializable.
   *  Absent when no `api.surface.*` ran this turn. */
  surfaceOps?: SurfaceOp[];
  /** Viewport material declared in code via `api.material(...)` — a shading
   *  preset/override the main thread's viewport applies after the run. Plain
   *  serializable (`MaterialSpec` from renderer/materialSpec, kept `unknown`
   *  here so the geometry layer doesn't depend on the renderer's types).
   *  Geometry and exports are untouched. Absent when no `api.material` ran. */
  materialSpec?: unknown;
  /** True when the user code returned an `api.renderMesh(...)` proxy — the
   *  mesh isn't manifold (or wasn't validated as one) and the main thread
   *  must skip its Manifold.ofMesh fallback to avoid a "Not manifold" throw. */
  renderOnly?: boolean;
  /** Names that the user wrote `label("X")` for but didn't survive into
   *  `labelMap`. Typical causes (SCAD): the label sat inside a `{ ... }`
   *  block, so CGAL stripped provenance; a for-loop expanded one source
   *  label into N anonymous AMF objects; the labelled component was rejected
   *  as non-manifold. Surfaced so tools can show a "expected X but
   *  paintByLabel("X") would fail" warning without forcing the caller to
   *  diff the labelMap themselves. Absent / undefined when nothing was lost. */
  lostLabels?: string[];
  /** Customizer parameter schema captured from `api.params({...})` calls in the
   *  model code this run. Plain serializable data — drives the Parameters panel
   *  and tells callers which knobs (and value ranges) the model exposes. Absent
   *  when the model declared no parameters. */
  paramsSchema?: ParamSpec[];
  /** Size (bytes) of the manifold-3d WASM heap after this run — its grown
   *  high-water mark (WASM memory never shrinks). Surfaced in the diagnostics so
   *  users can see how close a run came to the ~4 GB ceiling, and on an OOM
   *  whether it truly hit it or failed far below. Only set for manifold-js runs;
   *  absent for the other engines (which own separate heaps). */
  engineHeapBytes?: number;
  /** Number of occupied voxels in the grid this run produced. Only set by the
   *  voxel engine; absent for the mesh/CSG/BREP engines. Surfaced in the
   *  geometry-data stats so agents can confirm a voxel model's size without
   *  re-decoding the grid themselves. */
  voxelCount?: number;
  /** Count of face-connected (6-neighbour) voxel pieces — the trustworthy
   *  "separate printable pieces?" measure for voxel models, which the mesh
   *  `componentCount` over-reports (enclosed cavities + edge/corner touches).
   *  Only set by the voxel engine. */
  voxelPieceCount?: number;
  /** The single world-units-per-voxel `res` shared by every `v.sdf()` call this
   *  run, so stats can echo a res-aware world size (worldBBox = bbox × res).
   *  Only set by the voxel engine, and only when at least one `v.sdf()` ran AND
   *  all calls agreed on one res (mixed res values leave it absent — see
   *  `voxelResMixed`). */
  voxelRes?: number;
  /** True when `v.sdf()` calls mixed different `res` values — the world scale
   *  is ambiguous, so no worldBBox can be derived. Only set by the voxel engine. */
  voxelResMixed?: boolean;
  /** Voxel fill count per label requested via `v.sdf({ colors })`, including
   *  ZERO-count entries (the silent-label trap: a smoothUnion-blended sub-body
   *  is never the deepest region, so its label colors nothing — surfacing the 0
   *  makes that visible). Only set by the voxel engine, when a labelled sdf
   *  fill ran. */
  sdfLabelCounts?: Record<string, number>;
}

export interface CrossSectionResult {
  polygons: number[][][];
  svg: string;
  boundingBox: { minX: number; minY: number; maxX: number; maxY: number };
  area: number;
}
