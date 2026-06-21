// Hollow / vase — smooth (SDF) mesh path.
//
// Turns a solid model into a thin hollow shell — the classic 3D-print "vase
// mode". It's the iso-0 surface of
//
//   hollow(p) = max( shell(p), -openCut(p), drains(p) )     (< 0 = inside)
//     shell(p)   = max(d, -(d + wall))         material within the wall band
//     openCut    = z − openZ  (open top)       lops the cap off above the rim
//     drains      subtract N vertical cylinders near the base (drain holes)
//
// where `d` is the TRUE signed distance to the smooth source surface — so the
// curved wall follows that surface sub-voxel and there's no voxel "corduroy".
// All the heavy lifting (distance field, meshing, connectivity) lives in the
// shared `sdfModifier` scaffolding; this module is just the hollow field.
//
// Open top: above z = (modelTopZ − rim) the cavity is treated as open, i.e. the
// shell is cut flat at openZ so the top surface isn't capped — `max(shell,
// z − openZ)`, the same as unioning the inner cavity with the upward half-space.
// Drain holes: optional small vertical cylinders subtracted near the base, so a
// planter can drain. Restricted to a short z-band above the floor so a *closed*
// top is never accidentally pierced.
//
// Pure logic → unit-tested in the vitest tier.

import type { MeshData } from '../geometry/types';
import { sdfModifierMesh, MAX_FIELD_RESOLUTION, type SdfRunControl } from './sdfModifier';
import { extractPositions, bboxOf } from './meshSubdivide';

export interface HollowShellOptions {
  /** Shell wall thickness in world units. */
  wallThickness: number;
  /** Remove the top cap so the cavity is open (vase mode). Default false. */
  openTop?: boolean;
  /** Open-top only: how far below the model's top the rim is cut (world units).
   *  The vase opens at `modelTopZ − rimHeight`. Should be ≥ wallThickness so the
   *  cut clears the cap and exposes the wall ring. Default 2·wallThickness. */
  rimHeight?: number;
  /** Number of vertical drain holes bored through the base. Default 0 (none). */
  drainHoles?: number;
  /** Radius of each drain hole in world units. Default ~3% of the base width. */
  drainRadius?: number;
  /** Desired field resolution along the longest axis (auto-raised so the wall
   *  resolves to a few cells). Default 128, up to MAX_FIELD_RESOLUTION. */
  resolution?: number;
  /** Keep only the largest connected piece (one printable shell). Default true. */
  watertight?: boolean;
}

/** The wall should resolve to at least this many field cells across, so the
 *  Surface-Nets reconstruction has room to keep both faces of the shell distinct
 *  (a sub-~5-voxel wall pinches into non-manifold edges that `Manifold.ofMesh`
 *  rejects). The resolution auto-raises to honour it. */
const MIN_WALL_VOXELS = 5;

/** Build a smooth hollow-shell mesh from a solid model. Returns an empty mesh
 *  for an empty input. Async: the underlying field sweep yields to the event
 *  loop (progress + cancel) via `ctl`. */
export async function hollowShellMesh(mesh: MeshData, opts: HollowShellOptions, ctl?: SdfRunControl): Promise<MeshData> {
  if (mesh.numTri === 0) return { vertProperties: new Float32Array(), triVerts: new Uint32Array(), numVert: 0, numTri: 0, numProp: 3 };

  const wall = Math.max(1e-4, opts.wallThickness);
  const { min, max, size } = bboxOf(extractPositions(mesh));
  const topZ = max[2];
  const baseZ = min[2];
  const cx = (min[0] + max[0]) / 2;
  const cy = (min[1] + max[1]) / 2;
  const baseWidth = Math.max(size[0], size[1], 1e-6);

  const openTop = opts.openTop === true;
  const rim = Math.max(0, opts.rimHeight ?? wall * 2);
  const openZ = topZ - rim;

  // Drain holes: N small vertical cylinders bored through the floor. Bounded to a
  // short z-band above the base (so a closed top is never accidentally pierced),
  // and arranged on a ring inside the cavity (a single hole sits at the centre).
  const drainHoles = Math.max(0, Math.floor(opts.drainHoles ?? 0));
  const drainR = Math.max(1e-4, opts.drainRadius ?? baseWidth * 0.03);
  const drainTopZ = baseZ + wall * 3; // clears the floor cap, then into the cavity
  const ringR = Math.max(0, baseWidth * 0.5 - wall - drainR * 1.5);
  const drains: { px: number; py: number }[] = [];
  for (let i = 0; i < drainHoles; i++) {
    if (drainHoles === 1) { drains.push({ px: cx, py: cy }); break; }
    const a = (i / drainHoles) * Math.PI * 2;
    drains.push({ px: cx + Math.cos(a) * ringR, py: cy + Math.sin(a) * ringR });
  }

  // Auto-raise resolution so the wall spans ≥ MIN_WALL_VOXELS cells.
  const maxDim = Math.max(...size, 1e-6);
  const resFloor = Math.ceil((maxDim / wall) * MIN_WALL_VOXELS);
  const resolution = Math.min(MAX_FIELD_RESOLUTION, Math.max(Math.round(opts.resolution ?? 128), resFloor));

  // The shell's inner and outer walls are two disconnected closed surfaces (when
  // the top is sealed), so the mesh-component reduction must stay off — otherwise
  // the inner wall is dropped and the shell collapses to a solid. The field-level
  // fragment cull (`watertight`) still drops stray bits.
  return sdfModifierMesh(mesh, { resolution, bandWorld: wall, watertight: opts.watertight, keepLargestMeshComponent: false }, ({ d, x, y, z }) => {
    // Shell band: material within `wall` of the surface, on the inside.
    let v = Math.max(d, -(d + wall));
    // Open top: cut the shell flat at openZ (removes the cap + rim above it).
    if (openTop) v = Math.max(v, z - openZ);
    // Drain holes: subtract each finite vertical cylinder (max(v, -cyl)).
    for (const { px, py } of drains) {
      const radial = Math.hypot(x - px, y - py) - drainR;
      const band = Math.max(baseZ - z, z - drainTopZ); // < 0 within the z-band
      const cyl = Math.max(radial, band);               // < 0 inside the cylinder
      v = Math.max(v, -cyl);
    }
    return v;
  }, ctl);
}
