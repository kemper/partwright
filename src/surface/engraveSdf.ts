// Engrave / cut-through / emboss — smooth (SDF) mesh path.
//
// Cuts a projected 2D stamp (text or image, as a `StampMask`) into a solid as
// recessed channels (engrave) or holes through the wall (cut-through) — or,
// with `raised`, adds it as an embossed relief above the face. It's the
// iso-0 surface of the field built by `engraveCombine` — so the channel walls
// follow the true distance to the smooth source surface sub-voxel, with no
// voxel "corduroy". All the heavy lifting (distance field, meshing,
// connectivity) lives in the shared `sdfModifier` scaffolding; this module just
// computes the bbox and hands over the engrave field.
//
// Pure logic → unit-tested in the vitest tier (the mask itself is pre-built by
// the host from the app's text path or a decoded image).

import type { MeshData } from '../geometry/types';
import { sdfModifierMesh, MAX_FIELD_RESOLUTION, type SdfRunControl } from './sdfModifier';
import { extractPositions, bboxOf } from './meshSubdivide';
import { engraveCombine, type EngraveFieldOptions } from './engraveStamp';

export interface EngraveSdfOptions extends EngraveFieldOptions {
  /** Field resolution along the longest axis (clamped [16, 256]). Default 180 —
   *  text strokes need a fairly dense field to stay crisp. */
  resolution?: number;
  /** Keep only the largest connected piece (default true). */
  watertight?: boolean;
}

/** The engrave field resolution after clamping. Exported so the stamp-region
 *  colorizer derives the same voxel-size tolerance the carve actually used. */
export function engraveFieldResolution(resolution?: number): number {
  return Math.min(MAX_FIELD_RESOLUTION, Math.max(48, Math.round(resolution ?? 180)));
}

/** Build a smooth engraved/cut-through/embossed mesh from a solid model.
 *  Returns an empty mesh for an empty input or a degenerate (empty) mask.
 *  Async: the field sweep yields so the UI can show progress and cancel (see
 *  {@link sdfModifierMesh}). */
export async function engraveMesh(mesh: MeshData, opts: EngraveSdfOptions, ctl?: SdfRunControl): Promise<MeshData> {
  const empty: MeshData = { vertProperties: new Float32Array(), triVerts: new Uint32Array(), numVert: 0, numTri: 0, numProp: 3 };
  if (mesh.numTri === 0) return empty;

  const bbox = bboxOf(extractPositions(mesh));
  const resolution = engraveFieldResolution(opts.resolution);
  // The band must cover everywhere the field reads |d| near the carved surface:
  // the engrave depth (or the wall for a through-cut). Floor it so a tiny depth
  // still meshes a smooth surface.
  // Engrave reads |d| out to the carve floor (≈ depth from the face), so the
  // band must reach the depth. A through-cut only needs the band to mesh the
  // original skin smoothly — the cut walls are placed by the stamp at every
  // sample regardless of band — so a few-percent band suffices there.
  const diag = Math.hypot(...bbox.size) || 10;
  // Emboss reads |d| out to the relief top (its over-the-edge closure term is
  // d + depthInto, which crosses zero at d up to ~depth above the face), so its
  // band must reach `depth` plus a small closure margin. A through-cut only
  // needs the slim band that meshes the original skin smoothly.
  const voxel = Math.max(...bbox.size, 1e-6) / resolution;
  const band = opts.through ? diag * 0.04
    : opts.raised ? Math.max(opts.depth + 3 * voxel, diag * 0.02)
    : Math.max(opts.depth, diag * 0.02);

  return sdfModifierMesh(
    mesh,
    {
      resolution,
      bandWorld: band,
      watertight: opts.watertight,
      // The raised relief lives OUTSIDE the original bounds — pad the lattice
      // so the prism top isn't clipped at the field edge.
      padWorld: opts.raised ? opts.depth : 0,
    },
    engraveCombine(bbox, opts),
    ctl,
  );
}
