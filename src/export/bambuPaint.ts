// Bambu Studio / OrcaSlicer per-triangle color is stored as a `paint_color`
// attribute holding an MMU-segmentation bitstream (NOT the standard 3MF
// `m:colorgroup`). The bitstream mirrors PrusaSlicer's
// `TriangleSelector::serialize`: a recursive quad-tree of triangle splits, each
// leaf carrying an extruder "state". We only ever emit *leaf* triangles (one
// uniform color per triangle — we never subdivide), which is the simplest case
// of the format:
//
//   bits per nibble are LSB-first: [split0, split1, state0, state1]
//   - leaf  → split bits = 00
//   - state 0/1 → first filament / unpainted   → 2 state-bits 00 / 01
//   - state 2   → 2 state-bits 10              → nibble 0x8 → "8"
//   - state ≥3  → 2 state-bits 11 = escape     → nibble 0xC → "C", followed by
//                 one nibble holding (state - 3)
//
// `state` is the 1-based extruder index (1 = first filament). A bare triangle
// (no `paint_color` attribute) prints with the object's default extruder (1),
// so state 1 needs no attribute at all.

/** The most filaments Bambu Studio supports (AMS slots). Color slots beyond
 *  this can't be represented, and the single-nibble escape below only holds
 *  (state-3) ≤ 15, so we cap here and fail loudly rather than silently wrap. */
export const BAMBU_MAX_FILAMENTS = 16;

/** Encode a single uniformly-painted (non-subdivided) triangle's extruder
 *  `state` into Bambu/Orca's `paint_color` hex string. Returns '' for state ≤ 1
 *  (the default extruder needs no attribute). Valid for the 1–16 filament range
 *  Bambu supports (state ≤ 16 ⇒ at most one trailing nibble); throws above that
 *  so an over-many-colors model fails loudly instead of mis-coloring. */
export function encodePaintColor(state: number): string {
  if (!Number.isInteger(state) || state <= 1) return '';
  if (state > BAMBU_MAX_FILAMENTS) {
    throw new Error(`Bambu 3MF export supports at most ${BAMBU_MAX_FILAMENTS} filaments (colors); got extruder ${state}. Reduce the number of distinct colors.`);
  }
  if (state === 2) return '8';
  // state ≥ 3: escape nibble 'C' (split 00 + state-bits 11), then (state-3).
  // For Bambu's ≤16 extruders, (state-3) ≤ 13 → a single hex nibble.
  return 'C' + (state - 3).toString(16).toUpperCase();
}

/** Map a material/colorgroup slot index (0 = the base/default color, 1+ =
 *  painted colors, in `materialColors` order) to its `paint_color` string.
 *  Slot 0 is the part's default extruder (1) and gets no attribute; painted
 *  slot m is extruder (m + 1). */
export function paintColorForMaterial(materialIndex: number): string {
  if (materialIndex <= 0) return '';
  return encodePaintColor(materialIndex + 1);
}
