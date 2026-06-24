// Hollow / vase — robust levelSet path.
//
// Turns a solid model into a thin hollow shell, optionally opened along a plane
// (vase mode = a horizontal plane near the top; mask = any plane through the
// model, keep one side) and bored with drain holes.
//
// The shell is the iso-0 surface of a signed-distance field:
//
//   hollow(p) = max( shell(p), cut(p), drains(p) )           (< 0 = inside)
//     shell(p) = max(d, -(d + wall))      material within the wall band
//     cut(p)    = ±(coord − offset)        open along an axis-aligned plane
//     drains     subtract N short vertical cylinders near the base
//
// where `d` is the TRUE signed distance to the source surface (a BVH sweep,
// `buildSignedDistanceField`). Crucially it is meshed with **`Manifold.levelSet`**
// (marching tetrahedra — watertight/manifold *by construction*), NOT the
// surface-nets dual mesher, which emits non-manifold edges on slanted thin walls
// (a tapered vase) and so produced un-printable output. levelSet samples the
// field through a trilinear interpolation, so a vase comes out a single clean
// manifold piece regardless of taper.
//
// Needs a `Manifold` class (levelSet) — passed in by the caller (the main thread
// has it via the engine module), so this module stays engine-import-free.

import type { MeshData } from '../geometry/types';
import { buildSignedDistanceField, keepLargestFaceConnected, MAX_FIELD_RESOLUTION, type SdfRunControl } from './sdfModifier';
import { dropTinyMeshComponents } from './meshComponents';
import { smoothSurface } from './smoothSurface';
import { extractPositions, bboxOf } from './meshSubdivide';

/** Manifold-3d's class is loosely typed in this codebase. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ManifoldClass = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ManifoldInstance = any;

export interface HollowShellOptions {
  /** Shell wall thickness in world units. */
  wallThickness: number;
  /** Open the shell along an axis-aligned plane (generalizes the old `openTop`).
   *  Removes the half-space on `side` of `offset` along `axis`, exposing the wall
   *  as an open rim. Vase = `{axis:'z', side:'max'}` near the top; mask = a mid
   *  plane on any axis (keeps one side as an open shell). */
  open?: { axis: 'x' | 'y' | 'z'; offset: number; side: 'min' | 'max' };
  /** Convenience for the common vase: open the top. Derives `open` =
   *  `{axis:'z', side:'max', offset: modelTopZ − rimHeight}`. Ignored if `open`
   *  is given explicitly. Default false (a sealed hollow shell). */
  openTop?: boolean;
  /** Open-top only: how far below the model's top the rim is cut. Default 2·wall. */
  rimHeight?: number;
  /** Number of vertical drain holes bored through the base. Default 0. */
  drainHoles?: number;
  /** Radius of each drain hole in world units. Default ~3% of the base width. */
  drainRadius?: number;
  /** Desired field resolution along the longest axis (auto-raised so the wall
   *  resolves to a few cells). Default 128, up to MAX_FIELD_RESOLUTION. */
  resolution?: number;
  /** Reserved for API symmetry; levelSet output is already one watertight piece. */
  watertight?: boolean;
}

/** The wall must resolve to at least this many field cells so the trilinear
 *  sample represents it (levelSet itself is manifold at any resolution — this is
 *  only about not aliasing the wall away). */
const MIN_WALL_VOXELS = 3;

const EMPTY: MeshData = { vertProperties: new Float32Array(), triVerts: new Uint32Array(), numVert: 0, numTri: 0, numProp: 3 };

/** Build a smooth, watertight hollow-shell **mesh** from a solid model. Returns
 *  an empty mesh for an empty input. The levelSet Manifold is created and freed
 *  internally; only position data is returned. */
export async function hollowShellMesh(
  mesh: MeshData,
  opts: HollowShellOptions,
  Manifold: ManifoldClass,
  ctl?: SdfRunControl,
): Promise<MeshData> {
  if (mesh.numTri === 0) return EMPTY;

  const wall = Math.max(1e-4, opts.wallThickness);
  const { min, max, size } = bboxOf(extractPositions(mesh));
  const baseZ = min[2];
  const cx = (min[0] + max[0]) / 2;
  const cy = (min[1] + max[1]) / 2;
  const baseWidth = Math.max(size[0], size[1], 1e-6);

  // Resolve the open plane: explicit `open` wins; else `openTop` derives a +Z cut.
  const open: HollowShellOptions['open'] | undefined = opts.open
    ?? (opts.openTop ? { axis: 'z', side: 'max', offset: max[2] - Math.max(0, opts.rimHeight ?? wall * 2) } : undefined);

  // Drain holes: short vertical cylinders bored through the floor, bounded to a
  // z-band above the base so a closed top is never accidentally pierced. One hole
  // centred; several on a ring inside the cavity.
  const drainHoles = Math.max(0, Math.floor(opts.drainHoles ?? 0));
  const drainR = Math.max(1e-4, opts.drainRadius ?? baseWidth * 0.03);
  const drainTopZ = baseZ + wall * 3;
  const ringR = Math.max(0, baseWidth * 0.5 - wall - drainR * 1.5);
  const drains: { px: number; py: number }[] = [];
  for (let i = 0; i < drainHoles; i++) {
    if (drainHoles === 1) { drains.push({ px: cx, py: cy }); break; }
    const a = (i / drainHoles) * Math.PI * 2;
    drains.push({ px: cx + Math.cos(a) * ringR, py: cy + Math.sin(a) * ringR });
  }

  // Auto-raise resolution so the wall spans ≥ MIN_WALL_VOXELS field cells.
  const maxDim = Math.max(...size, 1e-6);
  const resFloor = Math.ceil((maxDim / wall) * MIN_WALL_VOXELS);
  const resolution = Math.min(MAX_FIELD_RESOLUTION, Math.max(Math.round(opts.resolution ?? 128), resFloor));

  const fld = await buildSignedDistanceField(mesh, { resolution, bandWorld: wall }, ctl);
  if (!fld) return EMPTY;
  const { d, fnx, fny, fnz, origin, voxelSize } = fld;
  const inv = 1 / voxelSize;
  const BIG = (Math.max(fnx, fny, fnz) + 2) * voxelSize;

  // Materialize the hollow SDF on the grid (one cheap pass over the raw distance
  // field): wall band, opened along a plane, minus the drain cylinders.
  const axisCoord = (a: 'x' | 'y' | 'z', x: number, y: number, z: number) => (a === 'x' ? x : a === 'y' ? y : z);
  const shell = new Float32Array(d.length);
  for (let k = 0; k < fnz; k++) {
    const z = origin[2] + k * voxelSize;
    for (let j = 0; j < fny; j++) {
      const y = origin[1] + j * voxelSize;
      for (let i = 0; i < fnx; i++) {
        const x = origin[0] + i * voxelSize;
        const fi = (k * fny + j) * fnx + i;
        const dv = d[fi];
        let v = Math.max(dv, -(dv + wall));      // wall band (< 0 inside)
        if (open) {
          const c = axisCoord(open.axis, x, y, z);
          v = Math.max(v, open.side === 'max' ? c - open.offset : open.offset - c);
        }
        for (let n = 0; n < drains.length; n++) {
          const radial = Math.hypot(x - drains[n].px, y - drains[n].py) - drainR;
          const zband = Math.max(baseZ - z, z - drainTopZ);
          v = Math.max(v, -Math.max(radial, zband));
        }
        shell[fi] = v;
      }
    }
  }
  // Drop detached fragments (levelSet would otherwise mesh field noise into dozens
  // of shards) — keep the single largest connected wall region.
  keepLargestFaceConnected(shell, fnx, fny, fnz, 0);

  // Trilinear sample of the cleaned shell field (BIG outside the lattice).
  const sampleShell = (x: number, y: number, z: number): number => {
    const gx = (x - origin[0]) * inv, gy = (y - origin[1]) * inv, gz = (z - origin[2]) * inv;
    if (gx < 0 || gy < 0 || gz < 0 || gx > fnx - 1 || gy > fny - 1 || gz > fnz - 1) return BIG;
    const i0 = Math.floor(gx), j0 = Math.floor(gy), k0 = Math.floor(gz);
    const i1 = Math.min(i0 + 1, fnx - 1), j1 = Math.min(j0 + 1, fny - 1), k1 = Math.min(k0 + 1, fnz - 1);
    const fx = gx - i0, fy = gy - j0, fz = gz - k0;
    const g = (i: number, j: number, k: number) => shell[(k * fny + j) * fnx + i];
    const c00 = g(i0, j0, k0) * (1 - fx) + g(i1, j0, k0) * fx;
    const c10 = g(i0, j1, k0) * (1 - fx) + g(i1, j1, k0) * fx;
    const c01 = g(i0, j0, k1) * (1 - fx) + g(i1, j0, k1) * fx;
    const c11 = g(i0, j1, k1) * (1 - fx) + g(i1, j1, k1) * fx;
    const c0 = c00 * (1 - fy) + c10 * fy;
    const c1 = c01 * (1 - fy) + c11 * fy;
    return c0 * (1 - fz) + c1 * fz;
  };

  // Manifold.levelSet uses the opposite sign convention (positive = inside).
  const sdf = (p: [number, number, number]): number => -sampleShell(p[0], p[1], p[2]);
  const bounds = {
    min: origin,
    max: [origin[0] + (fnx - 1) * voxelSize, origin[1] + (fny - 1) * voxelSize, origin[2] + (fnz - 1) * voxelSize],
  };

  let m: ManifoldInstance | null = null;
  try {
    m = Manifold.levelSet(sdf, bounds, voxelSize);
    m = dropTinyManifoldComponents(m, Manifold);
    const mesh3 = m.getMesh();
    const raw: MeshData = {
      vertProperties: mesh3.vertProperties,
      triVerts: mesh3.triVerts,
      numVert: mesh3.numVert ?? mesh3.vertProperties.length / (mesh3.numProp ?? 3),
      numTri: mesh3.numTri ?? mesh3.triVerts.length / 3,
      numProp: mesh3.numProp ?? 3,
    };
    // Belt-and-suspenders: also drop any mesh-level shards the manifold pass left.
    const cleaned = dropTinyMeshComponents(raw);
    // A few light Taubin passes relax the sliver fringe the marcher beads onto
    // sharp edges (a cylinder's bottom rim) — the same rim-relax the surface-nets
    // path ran. `subdivide:false` keeps the triangle budget flat; it barely rounds
    // the walls (already smooth from the continuous field) but cleans the rim.
    return smoothSurface(cleaned, { iterations: 3, subdivide: false });
  } finally {
    m?.delete?.();
  }
}

/** Drop near-zero-volume debris solids the marcher beads off a thin wall, keeping
 *  every piece with |volume| ≥ 2% of the largest. Decomposes in Manifold-space
 *  (matching how componentCount is computed) and re-composes the survivors.
 *  Returns the input untouched when there's nothing substantial to drop. The
 *  passed-in `m` is deleted when replaced. */
function dropTinyManifoldComponents(m: ManifoldInstance, Manifold: ManifoldClass): ManifoldInstance {
  let parts: ManifoldInstance[] = [];
  try {
    parts = m.decompose();
  } catch {
    return m;
  }
  if (parts.length <= 1) { for (const p of parts) p.delete?.(); return m; }
  const vols = parts.map((p) => Math.abs(p.volume()));
  const maxVol = Math.max(...vols);
  const keep = parts.filter((_p, i) => vols[i] >= maxVol * 0.02);
  if (keep.length === parts.length) { for (const p of parts) p.delete?.(); return m; }
  const composed = Manifold.compose(keep);
  for (const p of parts) p.delete?.();
  m.delete?.();
  return composed;
}
