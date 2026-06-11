// Perforated lattice — smooth (SDF) mesh path.
//
// A thin shell with REGULAR windows cut clean through it: the same see-through
// shape as the Voronoi lamp, but the random Worley cell field is swapped for a
// deterministic periodic one (square grid, hex honeycomb, or triangular truss).
// It's the iso-0 surface of
//
//   perforate(p) = max( shell(p), strut(p) )            (< 0 = inside)
//     shell(p) = max(d, -(d + wall))                      material within the wall
//     strut(p) = latticeEdgeDist(p)·cell − halfStrut      material near a cell edge
//
// where `d` is the TRUE signed distance to the smooth source surface — so the
// curved wall follows that surface sub-voxel with no voxel "corduroy". All the
// heavy lifting (distance field, meshing, connectivity) lives in the shared
// `sdfModifier` scaffolding; this module just supplies the field, exactly like
// the lamp (`voronoiLampSdf.ts`).
//
// The 2D pattern is evaluated in the XY plane (grain-rotatable) and held constant
// along Z. The cell-edge network is connected, so its extrusion intersected with
// a thin shell stays one connected, watertight cage on any shape. (Limitation for
// v1: because the pattern is constant along Z, a surface that runs PARALLEL to Z
// — e.g. the side wall of an upright cylinder — sees the windows as axial slots
// rather than discrete cells; the pattern reads cleanly on faces that turn toward
// the Z axis, like a sphere's caps or a vase's curved shoulder. A genuinely 3D
// pattern would fix this but can fragment a thin shell into disconnected rings.)
//
// Pure logic → unit-tested in the vitest tier.

import type { MeshData } from '../geometry/types';
import { latticeEdgeDist2D, type LatticePattern } from './latticePattern';
import { sdfModifierMesh, MAX_FIELD_RESOLUTION } from './sdfModifier';
import { extractPositions, bboxOf } from './meshSubdivide';

export interface PerforatedLatticeOptions {
  /** Window pattern cut through the shell. Default 'square'. */
  pattern?: LatticePattern;
  /** Pitch of the lattice (spacing between windows), in world units. */
  cellSize: number;
  /** Shell wall thickness in world units (how thick the struts are). */
  wallThickness: number;
  /** Strut width as a fraction of cellSize [0.05, 0.8] — how wide the kept edge
   *  network is. Larger = chunkier struts / smaller windows. Default 0.3. */
  strutWidth?: number;
  /** Field-grid resolution along the longest axis. Auto-raised so struts resolve
   *  to ≥ ~6 cells (thin struts otherwise alias), clamped to MAX. Default 110. */
  resolution?: number;
  /** Rotate the pattern in the XY plane (degrees). Default 0. */
  grainAngleDeg?: number;
  /** Keep only the largest connected strut web (one printable piece). Default true. */
  watertight?: boolean;
}

/** Struts should resolve to at least this many field cells across (so the field
 *  has room to round them); the resolution auto-raises to honour it. */
const MIN_STRUT_VOXELS = 6;

/** When watertight, keep every connected piece this large relative to the biggest
 *  rather than only the single largest. On a tapered or multi-feature model the
 *  Z-projected pattern breaks the shell into rings; keeping only the largest then
 *  deletes most of the model. This keeps every substantial piece (the whole model
 *  stays) while still dropping sub-1% dust/specks. */
const KEEP_FRACTION = 0.01;

/** Build a smooth perforated-lattice mesh from a solid model. Returns an empty
 *  mesh for an empty input. */
export function perforatedLatticeSdfMesh(mesh: MeshData, opts: PerforatedLatticeOptions): MeshData {
  if (mesh.numTri === 0) return { vertProperties: new Float32Array(), triVerts: new Uint32Array(), numVert: 0, numTri: 0, numProp: 3 };

  const pattern: LatticePattern = opts.pattern ?? 'square';
  const cell = Math.max(1e-4, opts.cellSize);
  const wall = Math.max(1e-4, opts.wallThickness);
  const strutFrac = Math.min(0.8, Math.max(0.05, opts.strutWidth ?? 0.3));
  const halfStrutWorld = strutFrac * 0.5 * cell;
  const angleRad = ((opts.grainAngleDeg ?? 0) * Math.PI) / 180;
  const cosA = Math.cos(angleRad), sinA = Math.sin(angleRad);

  // Auto-raise resolution so a strut spans ≥ MIN_STRUT_VOXELS field cells.
  const strutWorld = strutFrac * cell;
  const maxDim = Math.max(...bboxOf(extractPositions(mesh)).size, 1e-6);
  const resFloor = Math.ceil((maxDim / Math.max(strutWorld, 1e-4)) * MIN_STRUT_VOXELS);
  const resolution = Math.min(MAX_FIELD_RESOLUTION, Math.max(Math.round(opts.resolution ?? 110), resFloor));

  return sdfModifierMesh(mesh, { resolution, bandWorld: wall, watertight: opts.watertight, keepFraction: KEEP_FRACTION }, ({ d, x, y, voxelSize }) => {
    // Shell band: inside the wall (between the surface and its inward offset).
    const shell = Math.max(d, -(d + wall));
    // Skip the pattern field where the shell already reads "outside"
    // (combined = max(shell, strut) ≥ shell, so those samples can't be solid).
    if (shell > voxelSize) return shell;
    // Grain-rotated lattice coordinates (cell units), matching the lamp. The
    // pattern lives in the XY plane and is held constant along Z (the chosen
    // axis), so the cell-edge network extrudes into a connected cage.
    const gx = (cosA * x + sinA * y) / cell;
    const gy = (-sinA * x + cosA * y) / cell;
    const edge = latticeEdgeDist2D(gx, gy, pattern);
    const strut = edge * cell - halfStrutWorld;
    return Math.max(shell, strut);
  });
}
