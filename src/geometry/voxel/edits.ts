// Multi-voxel edit operations for Voxel Studio — pure grid logic, no DOM/WASM.
//
// These are the bulk operations the Studio's bucket/box tools compose on top
// of the single-voxel `VoxelGrid` primitives (set/remove/get/has). Kept here
// (not on the grid class) because they're editing-tool concerns rather than
// part of the modeling-language surface, and so they can be unit-tested in the
// vitest tier without pulling in the viewport/raycast glue that lives in
// src/color/voxelPaint.ts.

import type { Vec3 } from './grid';
import { VoxelGrid, normalizeColor, type ColorInput, COORD_MIN, COORD_MAX } from './grid';

/** The 6 face-neighbor offsets (shared by flood fill and the "add" tool). */
export const FACE_NEIGHBORS: Vec3[] = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

function inRange(x: number, y: number, z: number): boolean {
  return x >= COORD_MIN && x <= COORD_MAX
    && y >= COORD_MIN && y <= COORD_MAX
    && z >= COORD_MIN && z <= COORD_MAX;
}

/** Paint-bucket: recolor the face-connected region of voxels that share the
 *  clicked voxel's color, flooding outward across shared faces. Returns the
 *  number of voxels recolored (0 if the start cell is empty or already the
 *  target color). Mutates `grid` in place.
 *
 *  `limit` caps the number of cells visited so a pathological grid can't hang
 *  the main thread; the voxel-paint cap (200k) keeps real grids well under it. */
export function bucketRecolor(
  grid: VoxelGrid,
  start: Vec3,
  color: ColorInput,
  limit = 1_000_000,
): number {
  const [sx, sy, sz] = start;
  const fromColor = grid.get(sx, sy, sz);
  if (fromColor === null) return 0; // started on an empty cell — nothing to fill
  const toColor = normalizeColor(color, 'bucketRecolor(color)');
  if (fromColor === toColor) return 0; // no-op fill

  let changed = 0;
  const seen = new Set<number>();
  const queue: Vec3[] = [[sx, sy, sz]];
  seen.add(VoxelGrid.keyOf(sx, sy, sz));
  while (queue.length > 0 && changed < limit) {
    const [x, y, z] = queue.pop()!;
    if (grid.get(x, y, z) !== fromColor) continue;
    grid.set(x, y, z, toColor);
    changed++;
    for (const [dx, dy, dz] of FACE_NEIGHBORS) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (!inRange(nx, ny, nz)) continue;
      const k = VoxelGrid.keyOf(nx, ny, nz);
      if (seen.has(k)) continue;
      seen.add(k);
      if (grid.get(nx, ny, nz) === fromColor) queue.push([nx, ny, nz]);
    }
  }
  return changed;
}

/** Fill the inclusive box spanned by two corners (given in any order) with
 *  `color`, returning how many cells actually changed (newly created or
 *  recolored). Like `grid.fillBox`, but reports the change count so the Studio
 *  can tell a no-op box (already this color) from a real edit for undo. */
export function fillBoxRecolor(grid: VoxelGrid, a: Vec3, b: Vec3, color: ColorInput): number {
  const rgb = normalizeColor(color, 'fillBoxRecolor(color)');
  const x0 = Math.min(a[0], b[0]) | 0, x1 = Math.max(a[0], b[0]) | 0;
  const y0 = Math.min(a[1], b[1]) | 0, y1 = Math.max(a[1], b[1]) | 0;
  const z0 = Math.min(a[2], b[2]) | 0, z1 = Math.max(a[2], b[2]) | 0;
  let changed = 0;
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) {
        if (!inRange(x, y, z)) continue;
        if (grid.get(x, y, z) !== rgb) { grid.set(x, y, z, rgb); changed++; }
      }
  return changed;
}

/** Remove every voxel inside the inclusive box spanned by two corners (given
 *  in any order). Returns how many voxels were actually removed. The mirror of
 *  `fillBoxRecolor` — the Studio's box tool uses one to add a region and this
 *  to subtract one (e.g. carving holes into an imported image-voxel). */
export function clearBox(grid: VoxelGrid, a: Vec3, b: Vec3): number {
  const x0 = Math.min(a[0], b[0]) | 0, x1 = Math.max(a[0], b[0]) | 0;
  const y0 = Math.min(a[1], b[1]) | 0, y1 = Math.max(a[1], b[1]) | 0;
  const z0 = Math.min(a[2], b[2]) | 0, z1 = Math.max(a[2], b[2]) | 0;
  let removed = 0;
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        if (grid.has(x, y, z)) { grid.remove(x, y, z); removed++; }
  return removed;
}

/** The cell a face-click "adds" into: the clicked voxel offset by the face's
 *  outward normal. Returns null if that cell is out of the coordinate range. */
export function addTarget(voxel: Vec3, normal: Vec3): Vec3 | null {
  const nx = voxel[0] + normal[0], ny = voxel[1] + normal[1], nz = voxel[2] + normal[2];
  return inRange(nx, ny, nz) ? [nx, ny, nz] : null;
}
