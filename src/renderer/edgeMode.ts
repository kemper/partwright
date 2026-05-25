/** Edge-overlay style for offscreen renders shared by the API surface
 *  (main.ts), the AI tool schemas (src/ai/tools.ts), and the renderers
 *  (multiview.ts). Single source of truth so the three can't drift.
 *
 *  - `none`      — plain shaded surface, no edge overlay.
 *  - `crease`    — only feature/crease edges (corners sharper than
 *                  CREASE_ANGLE_DEG). Sharpens silhouettes and real
 *                  corners to help read form, with no facet noise on
 *                  tessellated curves.
 *  - `wireframe` — every triangle edge (full topology). For inspecting
 *                  tessellation / debugging a failed boolean. */
export const EDGE_MODES = ['none', 'crease', 'wireframe'] as const;
export type EdgeMode = typeof EDGE_MODES[number];

/** Dihedral angle (degrees) above which a shared edge between two faces
 *  counts as a feature/crease edge. Below this, adjacent facets read as
 *  one smooth surface and their shared edge is hidden — so a tessellated
 *  cylinder stays clean while its rim (≈90°) and any true corner show. */
export const CREASE_ANGLE_DEG = 30;

/** Resolve the effective edge overlay for a render. An explicit mode
 *  always wins. With no mode, uncolored meshes default to crease edges
 *  (form-defining corners without facet noise) and painted meshes to
 *  none — a wireframe over paint compounds into a dark mass that washes
 *  out the colors the paint workflow exists to verify. */
export function resolveEdgeMode(mode: EdgeMode | undefined, hasColors: boolean): EdgeMode {
  if (mode) return mode;
  return hasColors ? 'none' : 'crease';
}
