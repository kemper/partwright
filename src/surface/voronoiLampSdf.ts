// Voronoi lamp — smooth (SDF) mesh path.
//
// A true see-through Voronoi shell: a thin wall with the cell interiors cut
// clean through, leaving an organic strut network. It's the iso-0 surface of
//
//   lamp(p) = max( shell(p), strut(p) )            (< 0 = inside)
//     shell(p) = max(d, -(d + wallThickness))        material within the wall
//     strut(p) = cellEdgeDist3D(p)·cellSize − halfStrut   material near a cell edge
//
// where `d` is the TRUE signed distance to the smooth source surface — so the
// curved wall follows that surface sub-voxel and there's no voxel "corduroy".
// All the heavy lifting (distance field, meshing, connectivity) lives in the
// shared `sdfModifier` scaffolding; this module is just the lamp's field.
//
// Pure logic → unit-tested in the vitest tier.

import type { MeshData } from '../geometry/types';
import { cellEdgeDist3D } from './voronoiLattice';
import { sdfModifierMesh, MAX_FIELD_RESOLUTION } from './sdfModifier';
import { extractPositions, bboxOf } from './meshSubdivide';

export interface VoronoiLampSdfOptions {
  cellSize: number;
  wallThickness: number;
  strutWidth?: number;
  resolution?: number;
  jitter?: number;
  grainAngleDeg?: number;
  seed?: number;
  /** Keep only the largest connected strut web (one printable piece). Default true. */
  watertight?: boolean;
}

/** Struts should resolve to at least this many field cells across (so the field
 *  has room to round them); the resolution auto-raises to honour it. */
const MIN_STRUT_VOXELS = 6;

/** Build a smooth Voronoi-lamp mesh from a solid model. Returns an empty mesh
 *  for an empty input. */
export function voronoiLampSdfMesh(mesh: MeshData, opts: VoronoiLampSdfOptions): MeshData {
  if (mesh.numTri === 0) return { vertProperties: new Float32Array(), triVerts: new Uint32Array(), numVert: 0, numTri: 0, numProp: 3 };

  const cellSize = Math.max(1e-4, opts.cellSize);
  const wallThickness = Math.max(1e-4, opts.wallThickness);
  const strutFrac = Math.min(0.6, Math.max(0.05, opts.strutWidth ?? 0.3));
  const halfStrutWorld = strutFrac * 0.5 * cellSize;
  const jitter = Math.min(1, Math.max(0, opts.jitter ?? 1));
  const seed = Math.floor(opts.seed ?? 1);
  const angleRad = ((opts.grainAngleDeg ?? 0) * Math.PI) / 180;
  const cosA = Math.cos(angleRad), sinA = Math.sin(angleRad);

  // Auto-raise resolution so a strut spans ≥ MIN_STRUT_VOXELS cells.
  const strutWorld = strutFrac * cellSize;
  const maxDim = Math.max(...bboxOf(extractPositions(mesh)).size, 1e-6);
  const resFloor = Math.ceil((maxDim / Math.max(strutWorld, 1e-4)) * MIN_STRUT_VOXELS);
  const resolution = Math.min(MAX_FIELD_RESOLUTION, Math.max(Math.round(opts.resolution ?? 140), resFloor));

  return sdfModifierMesh(mesh, { resolution, bandWorld: wallThickness, watertight: opts.watertight }, ({ d, x, y, z, voxelSize }) => {
    // Shell band: inside the wall (between the surface and its inward offset).
    const shell = Math.max(d, -(d + wallThickness));
    // Skip the expensive Worley field where the shell already reads "outside"
    // (combined = max(shell, strut) ≥ shell, so those samples can't be solid).
    if (shell > voxelSize) return shell;
    const gx = (cosA * x + sinA * y) / cellSize;
    const gy = (-sinA * x + cosA * y) / cellSize;
    const gz = z / cellSize;
    const strut = cellEdgeDist3D(gx, gy, gz, jitter, seed) * cellSize - halfStrutWorld;
    return Math.max(shell, strut);
  });
}
