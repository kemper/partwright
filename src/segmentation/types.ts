// Part-detection contracts — pure, Worker-safe, no DOM.
//
// A *detector* turns a welded triangle mesh (plus optional named seeds) into a
// per-triangle partition (`triPart`). Detectors plug into a registry
// (`registry.ts`); the foundation owns everything around them — the shared
// per-mesh feature cache, the editable draft, quality scoring, persistence as
// import labels, and the UI / console / AI surfaces — so every algorithm is
// driven and scored the same way. Design + review log: GitHub issue #1025.

/** Position-welded triangle mesh. `positions` is xyz per vertex; `triVerts`
 *  holds three vertex indices per triangle. */
export interface SegMesh {
  positions: Float32Array;
  triVerts: Uint32Array;
}

/** Knobs that change the shared feature computation. Part of the
 *  feature-cache key, so two detectors asking for the same options share one
 *  computation. */
export interface FeatureOptions {
  /** Denoise face normals over this world-unit radius before measuring
   *  creases. Omitted / 0 = raw per-edge dihedral (the default — measured
   *  best on segment:bench, including its noisy-mesh variants). Try ~3× the
   *  median edge length on very noisy scans whose grooves come out broken. */
  normalSmoothRadius?: number;
  /** The same denoising radius given in median edge lengths instead of world
   *  units (scale-independent — what presets use). Ignored when
   *  `normalSmoothRadius` is set. */
  normalSmoothEdgeLengths?: number;
}

/** `FeatureOptions` with every default resolved — what the cache keys on. */
export interface ResolvedFeatureOptions {
  normalSmoothRadius: number;
}

/** Shared derived data, computed ONCE per (mesh, resolved options) and
 *  cached so detectors don't each recompute adjacency and creases.
 *
 *  Triangle adjacency is expressed as *edge pairs*: pair `e` joins triangles
 *  `edgeA[e]` and `edgeB[e]`, which share a mesh edge. `adjStart`/`adjPair`
 *  is the CSR index from a triangle to its incident pairs. */
export interface MeshFeatures {
  options: ResolvedFeatureOptions;
  triCount: number;
  edgeA: Int32Array;
  edgeB: Int32Array;
  /** Length of the shared mesh edge (boundary-length metrics). */
  edgeLen: Float32Array;
  /** Distance between the two triangles' centroids (path-length metrics). */
  centroidDist: Float32Array;
  /** Dihedral angle between the two triangles' (smoothed) normals, degrees. */
  dihedralDeg: Float32Array;
  /** 1 when the fold between the pair is concave (a valley / groove). */
  concave: Uint8Array;
  /** Concave-crease strength in degrees (0 on convex or flat folds). The
   *  primary boundary signal for seeded growth and patch merging. */
  creaseCost: Float32Array;
  adjStart: Int32Array;
  adjPair: Int32Array;
  triArea: Float32Array;
  /** Raw (unsmoothed) unit face normals, xyz per triangle. */
  triNormal: Float32Array;
  /** Smoothed unit face normals actually used for creases. */
  smoothNormal: Float32Array;
  triCentroid: Float32Array;
  /** Edge-connected component id per triangle (physically separate pieces). */
  pieceOfTri: Int32Array;
  pieceCount: number;
  totalArea: number;
  medianEdgeLen: number;
}

/** A named seed point: "this spot belongs to the part called `label`". */
export interface SegSeed {
  label: string;
  point: [number, number, number];
  /** Pre-resolved triangle index (skips the nearest-triangle lookup). */
  triangle?: number;
  /** A pin the draft placed itself (one per part region, so every part has
   *  one) rather than one the user or AI placed. Auto pins are dropped when
   *  their part no longer covers them; user pins always stay. */
  auto?: boolean;
}

/** One declared detector parameter. The panel controls, the
 *  `window.partwright` argument validation, the AI tool schema, and the CLI
 *  `-p` flags are all derived from these, so adding a detector updates every
 *  surface at once. */
export interface ParamSpec {
  key: string;
  label: string;
  hint: string;
  type: 'number' | 'integer' | 'boolean' | 'enum';
  default: number | boolean | string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
}

export type ParamValues = Record<string, number | boolean | string>;

export interface DetectorContext {
  params: ParamValues;
  seeds: SegSeed[];
  /** Only triangles with allow[t] = 1 may be labelled (locked parts and the
   *  area outside a focused part are excluded). Detectors leave the rest −1;
   *  the draft merges the result into the existing partition. Seeds whose
   *  nearest triangle is not allowed are ignored. */
  allow?: Uint8Array;
  /** Per-mesh scratch cache that survives between runs (same mesh, any
   *  params). Detectors memoize expensive stages here so a slider change
   *  re-runs only the cheap part — keys must include everything the cached
   *  value depends on. */
  cache?: Map<string, unknown>;
  signal?: AbortSignal;
  progress?: (frac: number, msg?: string) => void;
}

/** A named parameter set shown in the preset filmstrip. */
export interface DetectorPreset {
  name: string;
  params: ParamValues;
  featureOptions?: FeatureOptions;
}

/** Per-vertex top-two growth costs, for clipping smooth sub-triangle part
 *  edges at paint time (the scoped-paint deliverable consumes this; the
 *  foundation does not yet). The clip field for part P at vertex v is
 *  `cost(v, P) - min over Q≠P of cost(v, Q)` — derivable for any P that is a
 *  vertex's best or second-best label. Kept per (vertex, best-two) rather
 *  than one "own vs other" scalar because a boundary vertex has no single
 *  own part. Not persisted: recompute from the stored seeds + params. */
export interface VertexCostField {
  label1: Int32Array;
  cost1: Float32Array;
  label2: Int32Array;
  cost2: Float32Array;
}

export interface DetectorResult {
  /** Part index per triangle, `-1` = unassigned. */
  triPart: Int32Array;
  /** Optional name per part index. */
  partNames?: (string | null)[];
  /** The names are placeholders ("patch 3", "piece 2"), not user labels:
   *  when merged into an existing draft they never join a same-named part —
   *  they are renumbered to free names instead. */
  genericNames?: boolean;
  vertexCosts?: VertexCostField;
  diagnostics?: Record<string, unknown>;
}

export interface PartDetector {
  /** Stable id: 'pieces' | 'crease-watershed' | … */
  id: string;
  name: string;
  description: string;
  /** Shown to users AND the AI when choosing a detector. */
  bestFor: string;
  seeds: 'required' | 'optional' | 'none';
  params: ParamSpec[];
  /** Feature options this detector wants (user overrides win). */
  featureOptions?: FeatureOptions;
  /** Curated variations for the preset filmstrip (params are partial —
   *  unspecified keys take their defaults). */
  presets?: DetectorPreset[];
  run(mesh: SegMesh, f: MeshFeatures, ctx: DetectorContext): DetectorResult;
}

/** Parts saved on an import, re-opened as the draft. */
export interface SavedPartsPayload {
  triPart: Int32Array;
  names: string[];
  colors: (string | null)[];
  detectorId?: string;
  params?: Record<string, unknown>;
  featureOptions?: FeatureOptions;
  seeds?: SegSeed[];
  edgeSmoothing?: number;
}
