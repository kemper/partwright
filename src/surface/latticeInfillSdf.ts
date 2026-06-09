// Lattice infill — keep a thin solid skin of the model and fill the interior
// with a TPMS (triply-periodic minimal surface) lattice, for lightweight prints
// and exposed-lattice designs. It's the iso-0 surface of
//
//   infill(p) = min( skin(d),  d < 0 ? wall(p) : +∞ )        (< 0 = inside)
//     skin(d)  = max(d, -(d + skinThickness))      a solid outer shell
//     wall(p)  = latticeWall(pattern, p)            < 0 on a lattice wall
//
// where `d` is the TRUE signed distance to the smooth source surface (so the
// skin follows that surface sub-voxel) and the lattice term is an analytic,
// full-grid field clipped to the interior (`d < 0`). The skin and the interior
// lattice are unioned (`min`), so a hollow shell with a wall web inside.
//
// Three lattice patterns:
//   • gyroid    — sin X cos Y + sin Y cos Z + sin Z cos X
//   • schwarzP  — cos X + cos Y + cos Z
//   • honeycomb — hex columns: distance to a 2D hex-cell-edge field, extruded Z
//
// For the two TPMS patterns the raw implicit value is divided by its analytic
// gradient magnitude (|g|/|∇g|) so it reads as an approximate *world* distance
// to the wall mid-surface — that makes `wallThickness` a real world thickness,
// independent of cell size. Honeycomb is already a true 2D distance field.
//
// All the heavy lifting (distance field, meshing, connectivity) lives in the
// shared `sdfModifier` scaffolding; this module is just the infill's field.
//
// Pure logic → unit-tested in the vitest tier.

import type { MeshData } from '../geometry/types';
import { sdfModifierMesh, MAX_FIELD_RESOLUTION } from './sdfModifier';
import { extractPositions, bboxOf } from './meshSubdivide';

export type InfillPattern = 'gyroid' | 'schwarzP' | 'honeycomb';

export interface LatticeInfillSdfOptions {
  /** Lattice pattern. Default 'gyroid'. */
  pattern?: InfillPattern;
  /** TPMS period / hex spacing in world units. */
  cellSize: number;
  /** Lattice wall thickness in world units. */
  wallThickness: number;
  /** Solid outer-shell thickness in world units. */
  skinThickness: number;
  /** Field-grid resolution along the longest axis (auto-raised, see below). */
  resolution?: number;
}

/** The wall must resolve to at least this many field cells across so the field
 *  has room to round it; the resolution auto-raises to honour it. */
const MIN_WALL_VOXELS = 5;
const TAU = Math.PI * 2;

/** Signed lattice-wall field: `< 0` inside a wall of the chosen pattern, in
 *  approximate world units. `cellSize` is the TPMS period (or hex spacing);
 *  `wallThickness` is the world wall thickness. Pure → unit-tested. */
export function latticeWall(
  pattern: InfillPattern,
  x: number, y: number, z: number,
  cellSize: number, wallThickness: number,
): number {
  const half = wallThickness * 0.5;
  if (pattern === 'honeycomb') {
    // Hex columns along Z: distance to the nearest hex cell edge (the Voronoi
    // diagram of a triangular lattice), so material hugs the hex edges.
    return hexEdgeDist(x, y, cellSize) - half;
  }
  const k = TAU / cellSize;
  const X = k * x, Y = k * y, Z = k * z;
  const sX = Math.sin(X), cX = Math.cos(X);
  const sY = Math.sin(Y), cY = Math.cos(Y);
  const sZ = Math.sin(Z), cZ = Math.cos(Z);

  let g: number, gx: number, gy: number, gz: number;
  if (pattern === 'schwarzP') {
    g = cX + cY + cZ;
    gx = -k * sX; gy = -k * sY; gz = -k * sZ;
  } else {
    // gyroid
    g = sX * cY + sY * cZ + sZ * cX;
    gx = k * (cX * cY - sZ * sX);
    gy = k * (-sX * sY + cY * cZ);
    gz = k * (-sY * sZ + cZ * cX);
  }
  // |g|/|∇g| ≈ world distance to the {g = 0} wall mid-surface.
  const grad = Math.hypot(gx, gy, gz) || k;
  return Math.abs(g) / grad - half;
}

/** Distance from (x, y) to the nearest edge of a hexagonal tiling with center
 *  spacing `cellSize` — i.e. half the gap between the two nearest hex centers
 *  (the Voronoi-edge distance of the underlying triangular lattice). */
function hexEdgeDist(x: number, y: number, cellSize: number): number {
  const rowH = cellSize * Math.sqrt(3) / 2; // vertical spacing between rows
  const jc = Math.round(y / rowH);
  let d1 = Infinity, d2 = Infinity;
  // Scan a 3×3 neighbourhood of candidate centers; the two nearest bound the
  // containing cell and its closest wall.
  for (let dj = -1; dj <= 1; dj++) {
    const j = jc + dj;
    const cy = j * rowH;
    const xOff = (j & 1) ? cellSize * 0.5 : 0; // odd rows shift half a cell
    const ic = Math.round((x - xOff) / cellSize);
    for (let di = -1; di <= 1; di++) {
      const cx = (ic + di) * cellSize + xOff;
      const dd = Math.hypot(x - cx, y - cy);
      if (dd < d1) { d2 = d1; d1 = dd; }
      else if (dd < d2) { d2 = dd; }
    }
  }
  return (d2 - d1) * 0.5;
}

/** Build a lattice-infill mesh from a solid model: a thin solid skin with the
 *  interior filled by a TPMS / honeycomb lattice. Returns an empty mesh for an
 *  empty input. */
export function latticeInfillSdfMesh(mesh: MeshData, opts: LatticeInfillSdfOptions): MeshData {
  if (mesh.numTri === 0) return { vertProperties: new Float32Array(), triVerts: new Uint32Array(), numVert: 0, numTri: 0, numProp: 3 };

  const pattern = opts.pattern ?? 'gyroid';
  const cellSize = Math.max(1e-4, opts.cellSize);
  const wallThickness = Math.max(1e-4, opts.wallThickness);
  const skinThickness = Math.max(1e-4, opts.skinThickness);

  // Auto-raise resolution so a lattice wall spans ≥ MIN_WALL_VOXELS field cells.
  const maxDim = Math.max(...bboxOf(extractPositions(mesh)).size, 1e-6);
  const resFloor = Math.ceil((maxDim / wallThickness) * MIN_WALL_VOXELS);
  const resolution = Math.min(MAX_FIELD_RESOLUTION, Math.max(Math.round(opts.resolution ?? 120), resFloor));

  // bandWorld = skinThickness: exact distance is only read by the skin term,
  // which lives within skinThickness of the surface. The analytic lattice term
  // only needs the *sign* of `d` (d < 0 = interior), which holds full-grid.
  //
  // watertight: false — the closed outer skin already fuses everything into one
  // printable solid, so the largest-connected-component cull is unnecessary AND
  // harmful here: it can sever the thin skin layer from the interior lattice web
  // (they meet only at the band's inner edge), amputating the skin and leaving a
  // perforated shell. (Contrast the Voronoi lamp, an open strut web that has
  // genuine loose bits to drop.) Sealed gyroid pockets are intentional voids.
  return sdfModifierMesh(mesh, { resolution, bandWorld: skinThickness, watertight: false }, ({ d, x, y, z, voxelSize }) => {
    const skin = Math.max(d, -(d + skinThickness));
    // Outside the solid: the lattice contributes nothing → just the skin.
    if (d >= 0) return skin;
    // Safely inside the solid shell band: solid regardless of the lattice
    // (min only makes it more negative), so skip the lattice field.
    if (skin < -voxelSize) return skin;
    // Interior: union the solid skin with the lattice wall web.
    const wall = latticeWall(pattern, x, y, z, cellSize, wallThickness);
    return Math.min(skin, wall);
  });
}
