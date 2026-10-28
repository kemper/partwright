// Pure helpers for zoomed ("focused") offscreen renders: the world box a
// renderView/renderViews/probePixel call frames, and the clip test that hides
// geometry outside it. No three.js here so the unit tier can cover it.

export type Vec3 = [number, number, number];

/** An axis-aligned world box a view frames instead of the whole mesh. */
export interface ViewBox {
  min: Vec3;
  max: Vec3;
}

/** Grow `box` by `padding` × its largest side on every face. A degenerate
 *  (flat or single-point) box still gets a margin: its largest side falls back
 *  to `minExtent` so a flat decal or a single vertex doesn't frame to nothing. */
export function padViewBox(box: ViewBox, padding: number, minExtent = 1): ViewBox {
  const ext = Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
  const side = ext > 0 ? ext : minExtent;
  const pad = side * Math.max(0, padding) + (ext > 0 ? 0 : side / 2);
  return {
    min: [box.min[0] - pad, box.min[1] - pad, box.min[2] - pad],
    max: [box.max[0] + pad, box.max[1] + pad, box.max[2] + pad],
  };
}

/** True when `p` lies inside `box` (inclusive, with a tiny tolerance so a hit
 *  exactly on a clip face isn't rejected by rounding). */
export function pointInViewBox(p: ArrayLike<number>, box: ViewBox, eps = 1e-6): boolean {
  for (let a = 0; a < 3; a++) {
    if (p[a] < box.min[a] - eps || p[a] > box.max[a] + eps) return false;
  }
  return true;
}

/** The six half-spaces `n·p + d >= 0` whose intersection is `box` — the
 *  form three.js clipping planes take (a fragment with a negative distance to
 *  any plane is discarded). */
export function viewBoxHalfSpaces(box: ViewBox): { normal: Vec3; constant: number }[] {
  return [
    { normal: [1, 0, 0], constant: -box.min[0] },
    { normal: [-1, 0, 0], constant: box.max[0] },
    { normal: [0, 1, 0], constant: -box.min[1] },
    { normal: [0, -1, 0], constant: box.max[1] },
    { normal: [0, 0, 1], constant: -box.min[2] },
    { normal: [0, 0, -1], constant: box.max[2] },
  ];
}
