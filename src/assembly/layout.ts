// Grid layout math for the multi-part Assembly view. Pure and dependency-free
// (node-testable): given each part's XY footprint, it assigns every part a cell
// centre on a near-square grid so the parts sit side by side without
// overlapping. The Assembly view then translates each part's mesh so its own
// bounding-box centre lands on the returned cell centre.
//
// The grid uses a UNIFORM pitch (the largest footprint across all parts, plus a
// gutter) so cells never collide regardless of how the parts differ in size.
// Because the pitch is derived from the current footprints, the whole grid can
// be re-laid cheaply as parts finish building (progressive fill) — a bigger part
// arriving just grows the pitch and reflows everything by O(n) repositions.

/** One part's XY footprint (width along X, depth along Y) in world units. */
export interface PartFootprint {
  id: string;
  width: number;
  depth: number;
}

/** Where a part's centre should sit on the ground plane. */
export interface CellCenter {
  x: number;
  y: number;
}

export interface GridLayout {
  /** Part id → the world-space XY centre of its cell. */
  cells: Map<string, CellCenter>;
  cols: number;
  rows: number;
  /** Centre-to-centre spacing between adjacent cells. */
  pitchX: number;
  pitchY: number;
}

/** Number of columns for `n` cells — a near-square grid (ceil(sqrt(n))). */
export function gridColumns(n: number): number {
  if (n <= 0) return 0;
  return Math.ceil(Math.sqrt(n));
}

/**
 * Lay `footprints` (in the given order) onto a centred, uniform-pitch grid.
 *
 * @param footprints ordered parts; index drives row-major cell assignment.
 * @param gutterFraction extra spacing between cells as a fraction of the largest
 *        footprint dimension (0.25 ⇒ a quarter-cell gap). Clamped to ≥ 0.
 * @param minPitch a floor for the pitch so zero-size (not-yet-built) parts still
 *        get distinct, non-overlapping cells while their meshes are pending.
 */
export function computeAssemblyGrid(
  footprints: PartFootprint[],
  gutterFraction = 0.25,
  minPitch = 1,
): GridLayout {
  const cells = new Map<string, CellCenter>();
  const n = footprints.length;
  if (n === 0) return { cells, cols: 0, rows: 0, pitchX: 0, pitchY: 0 };

  const gutter = Math.max(0, gutterFraction);
  const cols = gridColumns(n);
  const rows = Math.ceil(n / cols);

  // Uniform square pitch keyed off the largest footprint in EITHER axis, so a
  // wide part and a deep part can't overlap after a 90° mental rotation and the
  // grid reads as an even matrix rather than a ragged one.
  let maxDim = minPitch;
  for (const f of footprints) {
    maxDim = Math.max(maxDim, f.width, f.depth);
  }
  const pitch = maxDim * (1 + gutter);
  const pitchX = pitch;
  const pitchY = pitch;

  // Centre the whole grid on the origin. Row 0 sits at the back (+Y) so reading
  // order (first part top-left) matches the default iso camera looking down -Y.
  const xOffset = (cols - 1) * pitchX / 2;
  const yOffset = (rows - 1) * pitchY / 2;

  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    cells.set(footprints[i].id, {
      x: col * pitchX - xOffset,
      y: yOffset - row * pitchY,
    });
  }

  return { cells, cols, rows, pitchX, pitchY };
}
