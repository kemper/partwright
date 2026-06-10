// Pure AABB-overlap helper for the model:preview clearance heuristic. Kept apart
// from previewModel.ts (which pulls the WASM engines) so it's unit-testable in
// the fast vitest tier.

interface HasBbox {
  bbox: { min: number[]; max: number[] };
}

/** True when any two of the given components have overlapping axis-aligned
 *  bounding boxes — a cheap interpenetration / clearance signal. Note that
 *  overlapping AABBs do NOT prove the meshes intersect (nested or L-shaped
 *  parts can share an AABB region without touching); it's an advisory cue, not
 *  a proof. Components without a 3-D bbox are skipped. */
export function componentsOverlap(components: HasBbox[]): boolean {
  const boxes = components.map((c) => c.bbox).filter((b) => b && b.min.length === 3 && b.max.length === 3);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.min[0] <= b.max[0] && b.min[0] <= a.max[0] &&
          a.min[1] <= b.max[1] && b.min[1] <= a.max[1] &&
          a.min[2] <= b.max[2] && b.min[2] <= a.max[2]) return true;
    }
  }
  return false;
}
