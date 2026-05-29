// Partwright Scenes — pure type definitions.
//
// A "scene" is a deterministic scatter of one or more reusable assets across a
// layout. It is NOT a new engine, schema, or runtime concept: the scene
// modules generate ordinary manifold-js source code (one builder function per
// asset, plus a baked `Manifold.compose([...])` of the placed instances) that
// becomes a normal part/version through the existing runAndSave path.
//
// Everything under src/scene/ is intentionally dependency-free (no DOM, WASM,
// or browser imports) so it runs in the fast vitest unit tier.

import type { ParamSpec, ParamValue } from '../geometry/params';

export type Vec2 = [number, number];

/** How instances are scattered across the layout bounds. */
export type LayoutKind = 'grid' | 'jittered-grid' | 'poisson-disk' | 'clustered' | 'along-path';

/** A single reusable object placed many times across the scene. `body` is a
 *  fragment of manifold-js code; it runs inside a generated
 *  `function buildAsset_<id>(p) { <body> }` wrapper and must `return` a
 *  Manifold. `p` holds the per-instance sampled parameter values (one literal
 *  object per call). `footprintRadius` is the planar (XY) clearance radius used
 *  for overlap rejection; `baseHeight` (optional) is a vertical offset added to
 *  each instance's Z (scaled per instance, applied as `translate([…, …, baseHeight*scale])`)
 *  — positive lifts the asset above z=0 — used to seat assets on the ground and
 *  by critique guidance to fix floating/clipping. */
export interface AssetSpec {
  id: string;
  body: string;
  params: ParamSpec[];
  footprintRadius: number;
  baseHeight?: number;
}

/** An optional sub-region of the layout bounds that can bias which assets land
 *  there. `polygon` clips placement (instances outside every zone polygon are
 *  rejected when any zone declares a polygon); `assetWeights` overrides the
 *  global asset pick weights inside the zone. */
export interface Zone {
  polygon?: Vec2[];
  assetWeights?: Record<string, number>;
}

/** The knobs that drive instance positions, rotations, and scales. */
export interface LayoutControl {
  kind: LayoutKind;
  bounds: { min: Vec2; max: Vec2 };
  /** Target instances per unit area (grid/jittered/poisson) or per cluster /
   *  path density depending on kind. */
  density: number;
  spacing?: number;
  jitter?: number;
  clusters?: number;
  clusterSpread?: number;
  path?: Vec2[];
  pathSpacing?: number;
  rotationJitter?: number;
  scaleRange?: [number, number];
  minClearance?: number;
  zones?: Zone[];
}

/** One placed asset instance with its sampled params and transform. */
export interface SceneInstance {
  assetId: string;
  paramValues: Record<string, ParamValue>;
  position: Vec2;
  rotationZ: number;
  scale: number;
  /** The source asset's base (pre-scale) footprint radius, carried so critique
   *  can measure real footprint overlap/coverage (= footprintRadius * scale)
   *  without needing the original AssetSpec. */
  footprintRadius: number;
}

/** The deterministic result of laying out a scene — what codegen consumes. */
export interface SceneGraph {
  seed: number;
  instances: SceneInstance[];
  stats: {
    requested: number;
    placed: number;
    rejectedOverlap: number;
    bounds: { min: Vec2; max: Vec2 };
  };
}

/** Optional ground slab placed under the scatter. */
export interface GroundSpec {
  enabled: boolean;
  thickness?: number;
  margin?: number;
}

/** The full input to buildScene. */
export interface SceneSpec {
  seed: number;
  assets: AssetSpec[];
  layout: LayoutControl;
  ground?: GroundSpec;
  maxInstances?: number;
}
