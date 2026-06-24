// Shared scaffolding for "volumetric" surface modifiers — the ones that change
// what's *solid* (hollow, perforate, infill, cage) rather than just displacing
// the existing skin. They are all the iso-0 surface of a continuous signed
// distance field, which is what gives smooth curved walls with no voxel
// "corduroy" (the principle behind Manifold.levelSet, done pure-JS on the main
// thread where surface modifiers run — there is no WASM here).
//
// This module owns everything generic: rasterize the model for a robust
// inside/outside sign, build a BVH for the TRUE signed distance to the smooth
// surface in a narrow band, sweep a padded lattice, keep the largest physically
// connected region, mesh it with interpolated Surface Nets, and relax the rims.
// A feature supplies only its `combine(sample)` function — the SDF value at a
// point given the signed distance `d` to the original surface — e.g.
//
//   • hollow/vase:  max(d, -(d + wall))                       (a thin shell)
//   • voronoi lamp: max(shell(d), strut(p))                   (shell ∩ cell web)
//   • gyroid infill: inside(d) ? min(skin(d), gyroidWall(p)) : +BIG
//
// `< 0` is inside the result solid. `d < 0` is inside the original; `d` is exact
// within `bandWorld` of the surface and a sign-correct ±large value beyond it
// (so `combine` can branch on `d < 0` anywhere, but should only rely on the
// magnitude of `d` within the band — pass a `bandWorld` that covers every place
// you read `|d|`).
//
// Pure logic (THREE + three-mesh-bvh are pure-JS, no DOM/WebGL) → unit-tested.

import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { MeshData } from '../geometry/types';
import { rasterizeSolid } from './voxelizeMesh';
import { surfaceNetsField } from './surfaceNetsField';
import { largestMeshComponent } from './meshComponents';
import { smoothSurface } from './smoothSurface';
import { extractPositions } from './meshSubdivide';

/** Field-grid resolution ceiling. A dense Float32 field of N³ samples is
 *  allocated, so this caps memory (256³ ≈ 67 MB). The continuous field is
 *  already smooth at modest resolution, so going higher mostly sharpens detail. */
export const MAX_FIELD_RESOLUTION = 256;

/** One lattice sample handed to a feature's `combine`. */
export interface SdfSample {
  /** Signed distance to the original surface: `< 0` inside. Exact within
   *  `bandWorld` of the surface; a sign-correct ±large value beyond it. */
  d: number;
  /** World position of the sample. */
  x: number; y: number; z: number;
  /** World units per lattice step — handy as an "outside, skip me" threshold. */
  voxelSize: number;
}

/** SDF value at a sample: `< 0` is inside the result solid. */
export type SdfCombine = (s: SdfSample) => number;

/** Cooperative-cancellation + progress hooks for the (otherwise main-thread,
 *  synchronous) field sweep. The sweep yields to the event loop periodically so
 *  the UI can paint a progress indicator and an abort can take effect between
 *  slices. */
export interface SdfRunControl {
  signal?: AbortSignal;
  /** Reports sweep progress in [0,1] as slices complete. */
  onProgress?: (fraction: number) => void;
}

/** Thrown when the caller aborts a carve via `SdfRunControl.signal`. */
export class SdfAbortError extends Error {
  constructor() { super('aborted'); this.name = 'AbortError'; }
}

const yieldToEventLoop = () => new Promise<void>(resolve => setTimeout(resolve, 0));

export interface SdfModifierOptions {
  /** Desired field resolution along the longest axis (clamped to
   *  [16, MAX_FIELD_RESOLUTION]). The caller folds in any feature-specific floor. */
  resolution: number;
  /** Exact signed distance is computed within this distance of the surface.
   *  Set it to cover the deepest place `combine` reads `|d|` (e.g. the wall
   *  thickness, or the skin depth for an infill). */
  bandWorld: number;
  /** Keep only the largest physically-connected piece (default true). Turn off
   *  to keep every fragment of the raw cut. */
  watertight?: boolean;
  /** After meshing, reduce the result to its single largest connected *surface*
   *  component (default = `watertight`). A sealed hollow shell — whose inner and
   *  outer walls are two disconnected closed surfaces — must set this `false`,
   *  otherwise the inner wall is discarded and the shell collapses back to a
   *  solid. Feature fields whose result is always one connected surface (a
   *  perforated lamp, a strut web) leave it at the default. The field-level
   *  fragment cull (`watertight`) still runs independently to drop stray bits. */
  keepLargestMeshComponent?: boolean;
  /** Extra world-space lattice padding beyond the model's bounds (on top of the
   *  standard closing ring). Needed when `combine` ADDS material outside the
   *  original surface (an embossed relief): without it the new solid is clipped
   *  at the lattice edge. Capped at 32 voxels per side to bound the field
   *  allocation (the Float32 field grows with the cube of the padded dims). */
  padWorld?: number;
  /** Light Taubin passes to relax the mesh rims (default 3, no subdivide). */
  smoothIterations?: number;
}

/** Build a smooth manifold mesh as the iso-0 surface of a feature-defined SDF.
 *  Returns a position-only `MeshData` (empty for an empty input mesh).
 *
 *  Async because the field sweep is the heavy step: it yields to the event loop
 *  every few slices (via `ctl`) so the main thread can paint a progress modal
 *  and honor a cancel between slices. Throws {@link SdfAbortError} if aborted. */
export async function sdfModifierMesh(mesh: MeshData, opts: SdfModifierOptions, combine: SdfCombine, ctl?: SdfRunControl): Promise<MeshData> {
  const empty: MeshData = { vertProperties: new Float32Array(), triVerts: new Uint32Array(), numVert: 0, numTri: 0, numProp: 3 };
  if (mesh.numTri === 0) return empty;

  const fld = await buildSignedDistanceField(mesh, opts, ctl);
  if (!fld) return empty;
  const { d, fnx, fny, fnz, origin, voxelSize } = fld;

  // Apply the feature's combine over the raw distance field (cheap pass, no
  // BVH) to get the result SDF, then mesh its iso-0 surface.
  const field = new Float32Array(d.length);
  for (let k = 0; k < fnz; k++) {
    for (let j = 0; j < fny; j++) {
      for (let i = 0; i < fnx; i++) {
        const fi = (k * fny + j) * fnx + i;
        field[fi] = combine({ d: d[fi], x: origin[0] + i * voxelSize, y: origin[1] + j * voxelSize, z: origin[2] + k * voxelSize, voxelSize });
      }
    }
  }

  // Keep the largest face-connected region of inside samples *before* meshing
  // (drops detached fragments without sealing windows the way growing the iso
  // level would). Face-connectivity is what fuses on an FDM plate.
  if (opts.watertight !== false) keepLargestFaceConnected(field, fnx, fny, fnz, 0);

  let m = surfaceNetsField({ field, dims: [fnx, fny, fnz], origin, spacing: voxelSize, iso: 0 });
  if (opts.keepLargestMeshComponent ?? (opts.watertight !== false)) m = largestMeshComponent(m);
  // A few light Taubin passes relax residual lattice ripple on the rims without
  // subdividing (walls are already smooth from the continuous field).
  m = smoothSurface(m, { iterations: opts.smoothIterations ?? 3, subdivide: false });
  return m;
}

/** The raw signed-distance field of a mesh on a padded lattice: `< 0` inside,
 *  exact within `bandWorld` of the surface, a sign-correct ±large value beyond.
 *  This is the heavy step (a BVH closest-point query per in-band sample) and is
 *  shared by every volumetric modifier — the surface-nets path (apply a combine
 *  then mesh) and the levelSet path (trilinearly sample it inside an SDF). */
export interface SignedDistanceField {
  /** Row-major (`i + fnx*(j + fny*k)`) signed distance grid. */
  d: Float32Array;
  fnx: number; fny: number; fnz: number;
  /** World position of sample (0,0,0). */
  origin: [number, number, number];
  /** World units per lattice step. */
  voxelSize: number;
}

/** Build the {@link SignedDistanceField} for a mesh. Returns null for an empty
 *  mesh. Async: yields to the event loop every few depth-slices (progress +
 *  cancel via `ctl`). Throws {@link SdfAbortError} if aborted. */
export async function buildSignedDistanceField(
  mesh: MeshData,
  opts: Pick<SdfModifierOptions, 'resolution' | 'bandWorld' | 'padWorld'>,
  ctl?: SdfRunControl,
): Promise<SignedDistanceField | null> {
  if (mesh.numTri === 0) return null;

  const bandWorld = Math.max(1e-4, opts.bandWorld);
  const resolution = Math.max(16, Math.min(MAX_FIELD_RESOLUTION, Math.round(opts.resolution)));

  // Occupancy gives a robust inside/outside sign + the world transform.
  const solid = rasterizeSolid(mesh, resolution, MAX_FIELD_RESOLUTION);
  const { nx, ny, nz, surface, exterior, at, min, voxelSize } = solid;
  const isSolid = (x: number, y: number, z: number): boolean => {
    if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) return false;
    const idx = at(x, y, z);
    return surface[idx] !== 0 || exterior[idx] === 0;
  };

  // BVH for exact distance-to-surface, signed by the closest face's normal —
  // mixing a true magnitude with the stair-stepped occupancy *sign* would snap
  // crossings back onto the voxel steps (corduroy). Occupancy signs only the
  // far field. Built fresh and disposed below (the build is negligible next to
  // the field sweep, so a cache would only risk a leak / stale geometry).
  const bvhGeom = new THREE.BufferGeometry();
  bvhGeom.setAttribute('position', new THREE.BufferAttribute(extractPositions(mesh), 3));
  bvhGeom.setIndex(new THREE.BufferAttribute(Uint32Array.from(mesh.triVerts), 1));
  const bvh = new MeshBVH(bvhGeom, { indirect: true });
  const faceNormals = computeFaceNormals(mesh);
  const queryPt = new THREE.Vector3();
  const hit = { point: new THREE.Vector3(), distance: 0, faceIndex: -1 };

  // Padded lattice: one extra ring of "outside" samples on every side so the
  // outer surface closes even when the model touches its bounding box, plus
  // whatever extra headroom the feature asked for (emboss height) — capped so a
  // tall relief can't balloon the field allocation.
  const pad = 2 + Math.min(32, Math.max(0, Math.ceil((opts.padWorld ?? 0) / voxelSize)));
  const fnx = nx + 2 * pad, fny = ny + 2 * pad, fnz = nz + 2 * pad;
  const origin: [number, number, number] = [min[0] - pad * voxelSize, min[1] - pad * voxelSize, min[2] - pad * voxelSize];
  const fidx = (i: number, j: number, k: number) => (k * fny + j) * fnx + i;

  // Band mask: samples within `bandVox` hops of the surface get an exact
  // distance; the rest get a clamped sign. The band must reach the deepest place
  // `combine` reads `|d|` (≈ bandWorld inside).
  const bandVox = Math.ceil(bandWorld / voxelSize) + 3;
  const band = markBand(fnx, fny, fnz, pad, surface, at, bandVox);
  const BIG = bandWorld + (bandVox + 2) * voxelSize; // exceeds any in-band magnitude

  const d = new Float32Array(fnx * fny * fnz);
  // Yield roughly every YIELD_SLICES depth-slices so the event loop can paint
  // the progress modal and apply a cancel; small enough to stay responsive,
  // large enough that the setTimeout overhead is negligible next to the sweep.
  const YIELD_SLICES = 4;
  for (let k = 0; k < fnz; k++) {
    if (k > 0 && k % YIELD_SLICES === 0) {
      await yieldToEventLoop();
      if (ctl?.signal?.aborted) { bvhGeom.dispose(); throw new SdfAbortError(); }
      ctl?.onProgress?.(k / fnz);
    }
    for (let j = 0; j < fny; j++) {
      for (let i = 0; i < fnx; i++) {
        const fi = fidx(i, j, k);
        const wx = origin[0] + i * voxelSize;
        const wy = origin[1] + j * voxelSize;
        const wz = origin[2] + k * voxelSize;
        const inside = isSolid(i - pad, j - pad, k - pad);

        if (band[fi]) {
          queryPt.set(wx, wy, wz);
          bvh.closestPointToPoint(queryPt, hit);
          const fIdx = hit.faceIndex >= 0 ? hit.faceIndex : 0;
          const ox = wx - hit.point.x, oy = wy - hit.point.y, oz = wz - hit.point.z;
          const dot = ox * faceNormals[fIdx * 3] + oy * faceNormals[fIdx * 3 + 1] + oz * faceNormals[fIdx * 3 + 2];
          const outside = Math.abs(dot) > 1e-9 ? dot > 0 : !inside;
          d[fi] = outside ? hit.distance : -hit.distance;
        } else {
          d[fi] = inside ? -BIG : BIG;
        }
      }
    }
  }
  bvhGeom.dispose(); // BVH is only consulted in the field sweep above
  ctl?.onProgress?.(1);

  return { d, fnx, fny, fnz, origin, voxelSize };
}

/** Keep only the largest 6-connected (face-adjacent) region of inside samples
 *  (`field < iso`); push every other inside sample to +∞ so it meshes as empty. */
export function keepLargestFaceConnected(field: Float32Array, nx: number, ny: number, nz: number, iso: number): void {
  const total = nx * ny * nz;
  const label = new Int32Array(total).fill(-1);
  const inside = (i: number) => field[i] < iso;
  const stack: number[] = [];
  let bestLabel = -1, bestSize = 0, next = 0;
  for (let s = 0; s < total; s++) {
    if (!inside(s) || label[s] !== -1) continue;
    const id = next++;
    let size = 0;
    label[s] = id; stack.push(s);
    while (stack.length) {
      const idx = stack.pop()!;
      size++;
      const k = Math.floor(idx / (nx * ny));
      const j = Math.floor((idx - k * nx * ny) / nx);
      const i = idx - (k * ny + j) * nx;
      const tryN = (x: number, y: number, z: number) => {
        if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) return;
        const ni = (z * ny + y) * nx + x;
        if (label[ni] !== -1 || !inside(ni)) return;
        label[ni] = id; stack.push(ni);
      };
      tryN(i + 1, j, k); tryN(i - 1, j, k);
      tryN(i, j + 1, k); tryN(i, j - 1, k);
      tryN(i, j, k + 1); tryN(i, j, k - 1);
    }
    if (size > bestSize) { bestSize = size; bestLabel = id; }
  }
  if (bestLabel < 0) return;
  const BIG = 1e9;
  for (let s = 0; s < total; s++) if (inside(s) && label[s] !== bestLabel) field[s] = BIG;
}

/** Mark lattice samples within `bandVox` hops of a surface voxel (BFS over the
 *  padded lattice). Cells outside the raster are empty and never seed. */
function markBand(
  fnx: number, fny: number, fnz: number, pad: number,
  surface: Int32Array, at: (x: number, y: number, z: number) => number,
  bandVox: number,
): Uint8Array {
  const total = fnx * fny * fnz;
  const fidx = (i: number, j: number, k: number) => (k * fny + j) * fnx + i;
  const dist = new Int16Array(total).fill(-1);
  const band = new Uint8Array(total);
  let queue: number[] = [];

  const rnx = fnx - 2 * pad, rny = fny - 2 * pad, rnz = fnz - 2 * pad;
  for (let z = 0; z < rnz; z++) {
    for (let y = 0; y < rny; y++) {
      for (let x = 0; x < rnx; x++) {
        if (surface[at(x, y, z)] === 0) continue;
        const fi = fidx(x + pad, y + pad, z + pad);
        if (dist[fi] === -1) { dist[fi] = 0; band[fi] = 1; queue.push(fi); }
      }
    }
  }

  for (let step = 0; step < bandVox && queue.length; step++) {
    const nextQ: number[] = [];
    for (const fi of queue) {
      const k = Math.floor(fi / (fnx * fny));
      const j = Math.floor((fi - k * fnx * fny) / fnx);
      const i = fi - (k * fny + j) * fnx;
      const tryN = (x: number, y: number, z: number) => {
        if (x < 0 || y < 0 || z < 0 || x >= fnx || y >= fny || z >= fnz) return;
        const ni = fidx(x, y, z);
        if (dist[ni] !== -1) return;
        dist[ni] = step + 1; band[ni] = 1; nextQ.push(ni);
      };
      tryN(i + 1, j, k); tryN(i - 1, j, k);
      tryN(i, j + 1, k); tryN(i, j - 1, k);
      tryN(i, j, k + 1); tryN(i, j, k - 1);
    }
    queue = nextQ;
  }
  return band;
}

/** Unit face normals (numTri·3), used to sign the BVH distance from the true
 *  surface. Indexed by triangle, matching three-mesh-bvh's `faceIndex`. */
function computeFaceNormals(mesh: MeshData): Float32Array {
  const pos = extractPositions(mesh);
  const tv = mesh.triVerts;
  const out = new Float32Array(mesh.numTri * 3);
  for (let t = 0; t < mesh.numTri; t++) {
    const a = tv[t * 3], b = tv[t * 3 + 1], c = tv[t * 3 + 2];
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2];
    const cx = pos[c * 3], cy = pos[c * 3 + 1], cz = pos[c * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    out[t * 3] = nx / len; out[t * 3 + 1] = ny / len; out[t * 3 + 2] = nz / len;
  }
  return out;
}
