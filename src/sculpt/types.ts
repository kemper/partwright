// Sculpt mode (prototype 1: deformers) — serializable descriptors for
// procedural mesh deformations applied to a region of triangles.
//
// Deformers mirror the paint pattern: each one stores a region descriptor
// (currently always a coplanar seed, same shape as ColorRegion's 'coplanar'
// descriptor) plus a kind + params. The region is re-resolved against the
// freshly-executed mesh on load, then the deformer is replayed.

export type DeformerKind = 'inflate' | 'smooth';

/** Region descriptor for a deformer. Mirrors the 'coplanar' shape from
 *  color/regions.ts so the same seed-point + seed-normal + normalTolerance
 *  raycast resolves it on reload. We deliberately use only this shape for
 *  the v1 prototype — triangle-id sets would not survive code edits, and
 *  we don't yet need slab/label support. */
export interface DeformerCoplanarRegion {
  kind: 'coplanar';
  seedPoint: [number, number, number];
  seedNormal: [number, number, number];
  normalTolerance: number;
}

export type DeformerRegionDescriptor = DeformerCoplanarRegion;

/** Params for each deformer kind. Kept inline (not generic) so the JSON
 *  shape is obvious to anyone inspecting a saved version. */
export interface InflateParams {
  /** Signed distance to offset each touched vertex along its averaged
   *  vertex normal. Positive = outward; negative = inward (deflate). */
  distance: number;
}

export interface SmoothParams {
  /** Number of Laplacian smoothing iterations to run. */
  iterations: number;
}

export type DeformerParams = InflateParams | SmoothParams;

export interface SerializedDeformer {
  id: number;
  kind: DeformerKind;
  regionDescriptor: DeformerRegionDescriptor;
  params: DeformerParams;
  /** Ordering — deformers apply in increasing `order` (later ones operate
   *  on the output of earlier ones, so the stack is replayable). */
  order: number;
}
