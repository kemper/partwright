// Regular (periodic) lattice patterns — the deterministic counterpart of the
// Voronoi lamp's random Worley field (`cellEdgeDist3D` in `voronoiLattice.ts`).
//
// Each function returns the perpendicular distance, in CELL UNITS, from a 2D
// query point to the nearest cell-edge line of a periodic tiling: `0` exactly on
// an edge, growing toward the cell interior. The perforated-lattice modifier
// keeps material wherever this distance is below a strut half-width, so the edge
// network becomes a strut web and the cell interiors become windows.
//
// The pattern is evaluated in a single plane (the XY plane, optionally grain-
// rotated) and held constant along the third axis. The edge network of every
// pattern is connected, so its extrusion intersected with a thin shell stays a
// single connected cage — the property that makes the result robustly watertight
// and printable, regardless of the surface's shape. (A genuinely 3D strut
// lattice would open windows on every face but can fragment a thin shell into
// disconnected rings; see the v1 limitation note in `perforatedLatticeSdf.ts`.)
//
// All distances share the lamp's convention (work in cell units = world ÷
// cellSize). Pure math → unit-tested in the vitest tier.

export type LatticePattern = 'square' | 'hex' | 'triangle';

const SQRT3 = Math.sqrt(3);

/** Distance from `t` to the nearest integer — i.e. to the nearest of a family of
 *  unit-spaced parallel lines, measured along the line's normal. Range [0, 0.5]. */
function fracDist(t: number): number {
  return Math.abs(t - Math.round(t));
}

/** Perpendicular distance (cell units) from `(u, v)` to the nearest cell-edge
 *  line of the chosen periodic pattern. `0` on an edge, growing inward. */
export function latticeEdgeDist2D(u: number, v: number, pattern: LatticePattern): number {
  if (pattern === 'hex') return hexEdgeDist2D(u, v);
  if (pattern === 'triangle') return triangleEdgeDist2D(u, v);
  return squareEdgeDist2D(u, v);
}

/** Square grid of pitch 1: two orthogonal line families. Distance to the nearest
 *  line is the smaller of the two axis frac-distances. */
function squareEdgeDist2D(u: number, v: number): number {
  return Math.min(fracDist(u), fracDist(v));
}

/** Triangular truss: three line families at 0°, 60°, 120°, each spaced √3/2 cell
 *  units apart (so the tiling is equilateral triangles of side 1). Distance is
 *  the nearest of the three perpendicular distances. */
function triangleEdgeDist2D(u: number, v: number): number {
  const s = SQRT3 / 2; // perpendicular spacing of each family, in cell units
  // Coordinate of the query point along each family's normal (90°, 30°, 150°).
  const c1 = v;                          // normal (0, 1)
  const c2 = u * (SQRT3 / 2) + v * 0.5;  // normal (√3/2, 1/2)
  const c3 = -u * (SQRT3 / 2) + v * 0.5; // normal (-√3/2, 1/2)
  const d1 = fracDist(c1 / s) * s;
  const d2 = fracDist(c2 / s) * s;
  const d3 = fracDist(c3 / s) * s;
  return Math.min(d1, d2, d3);
}

/** Hexagonal honeycomb: the Voronoi diagram of a triangular lattice of cell
 *  centres is a regular hexagonal tiling, so the edge distance is the bisector
 *  distance to the nearest centre — the deterministic, regular analogue of the
 *  lamp's jittered `cellEdgeDist3D`. Centres sit 1 cell unit apart along a row,
 *  rows are √3/2 apart and offset by half a cell (a close-packed lattice). */
function hexEdgeDist2D(u: number, v: number): number {
  const rowH = SQRT3 / 2;
  const r0 = Math.round(v / rowH);
  const cxs: number[] = [];
  const cys: number[] = [];
  let bestD2 = Infinity, bax = 0, bay = 0;
  for (let dr = -1; dr <= 1; dr++) {
    const r = r0 + dr;
    const xoff = (r & 1) ? 0.5 : 0; // alternate rows shift by half a cell
    const cy = r * rowH;
    const c0 = Math.round(u - xoff);
    for (let dc = -1; dc <= 1; dc++) {
      const cx = c0 + dc + xoff;
      cxs.push(cx); cys.push(cy);
      const ddx = cx - u, ddy = cy - v;
      const d2 = ddx * ddx + ddy * ddy;
      if (d2 < bestD2) { bestD2 = d2; bax = cx; bay = cy; }
    }
  }
  // Min distance from the query to the bisector with every other centre.
  let edge = Infinity;
  for (let i = 0; i < cxs.length; i++) {
    let dx = cxs[i] - bax, dy = cys[i] - bay;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue; // the nearest centre itself
    dx /= len; dy /= len;
    const mx = (bax + cxs[i]) * 0.5, my = (bay + cys[i]) * 0.5;
    const dd = (mx - u) * dx + (my - v) * dy;
    if (dd < edge) edge = dd;
  }
  return edge;
}
