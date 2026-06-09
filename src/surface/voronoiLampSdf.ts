// Voronoi lamp — smooth (SDF) mesh path.
//
// The original voxel-grid lamp meshed a binary occupancy shell, so the curved
// walls came out with vertical "corduroy" stair-stepping that no resolution or
// smoothing could remove (it's inherent to meshing a curved surface through
// binary in/out samples — the same artifact the app's smooth-voxelize shows).
//
// This path instead builds a CONTINUOUS signed-distance field and meshes its
// zero level set with interpolated Surface Nets, exactly the principle behind
// Manifold.levelSet — but pure-JS on the main thread, where surface modifiers
// run (no WASM there). The field is the intersection of two pieces:
//
//   • shell(p) = max(d, -(d + wallThickness))   — material within `wallThickness`
//     inside the original surface, where d is the TRUE signed distance to the
//     original mesh (sign from a watertight occupancy flood-fill, magnitude from
//     a BVH closest-point query). Because d is the true distance to the *smooth*
//     surface, the meshed wall follows that surface sub-voxel → no corduroy.
//
//   • strut(p) = cellEdgeDist3D(p)·cellSize − halfStrutWorld — material near a
//     3D Voronoi cell boundary (the analytic field already used by the voxel
//     lamp), so the window cuts are smooth too.
//
// lamp(p) = max(shell, strut); `< 0` is inside. Resolution sets the field grid
// density (finer = crisper struts + better curvature), and unlike the voxel path
// it genuinely improves the surface.
//
// Pure logic (THREE + three-mesh-bvh are pure-JS, no DOM/WebGL) → unit-tested.

import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { MeshData } from '../geometry/types';
import { rasterizeSolid } from './voxelizeMesh';
import { cellEdgeDist3D } from './voronoiLattice';
import { surfaceNetsField } from './surfaceNetsField';
import { largestMeshComponent } from './meshComponents';
import { smoothSurface } from './smoothSurface';
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

/** Field-grid resolution ceiling. A dense Float32 field of N³ samples is
 *  allocated, so this caps memory (256³ ≈ 67 MB). The continuous field is
 *  already smooth at modest resolution, so going higher mostly sharpens struts. */
const MAX_FIELD_RESOLUTION = 256;
/** Struts should resolve to at least this many voxels across (matches the voxel
 *  path) so the field has room to round them. */
const MIN_STRUT_VOXELS = 6;

/** Build a smooth Voronoi-lamp mesh from a solid model. Returns an empty mesh
 *  for an empty input. */
export function voronoiLampSdfMesh(mesh: MeshData, opts: VoronoiLampSdfOptions): MeshData {
  const empty: MeshData = { vertProperties: new Float32Array(), triVerts: new Uint32Array(), numVert: 0, numTri: 0, numProp: 3 };
  if (mesh.numTri === 0) return empty;

  const cellSize = Math.max(1e-4, opts.cellSize);
  const wallThickness = Math.max(1e-4, opts.wallThickness);
  const strutFrac = Math.min(0.6, Math.max(0.05, opts.strutWidth ?? 0.3));
  const halfStrutWorld = strutFrac * 0.5 * cellSize;
  const jitter = Math.min(1, Math.max(0, opts.jitter ?? 1));
  const seed = Math.floor(opts.seed ?? 1);
  const angleRad = ((opts.grainAngleDeg ?? 0) * Math.PI) / 180;
  const cosA = Math.cos(angleRad), sinA = Math.sin(angleRad);

  // Auto-raise resolution so a strut spans ≥ MIN_STRUT_VOXELS samples.
  const strutWorld = strutFrac * cellSize;
  const maxDim = Math.max(...bboxOf(extractPositions(mesh)).size, 1e-6);
  const resFloor = Math.ceil((maxDim / Math.max(strutWorld, 1e-4)) * MIN_STRUT_VOXELS);
  const resolution = Math.max(16, Math.min(MAX_FIELD_RESOLUTION, Math.max(Math.round(opts.resolution ?? 140), resFloor)));

  // Occupancy gives a robust inside/outside sign + the world transform.
  const solid = rasterizeSolid(mesh, resolution, MAX_FIELD_RESOLUTION);
  const { nx, ny, nz, surface, exterior, at, min, voxelSize } = solid;
  const isSolid = (x: number, y: number, z: number): boolean => {
    if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) return false;
    const idx = at(x, y, z);
    return surface[idx] !== 0 || exterior[idx] === 0;
  };

  // BVH for exact distance-to-surface, plus per-face normals to SIGN that
  // distance from the true surface (not the stair-stepped occupancy boundary —
  // mixing a true magnitude with an occupancy sign snaps crossings back to the
  // voxel steps, which is exactly the corduroy we're removing). Occupancy is used
  // only for the coarse sign of far-field samples outside the distance band.
  // Built fresh per call and disposed below: the build is negligible next to the
  // field sweep, so a module-level cache would only risk a leak / stale geometry.
  const bvhGeom = new THREE.BufferGeometry();
  bvhGeom.setAttribute('position', new THREE.BufferAttribute(extractPositions(mesh), 3));
  bvhGeom.setIndex(new THREE.BufferAttribute(Uint32Array.from(mesh.triVerts), 1));
  const bvh = new MeshBVH(bvhGeom, { indirect: true });
  const faceNormals = computeFaceNormals(mesh);
  const queryPt = new THREE.Vector3();
  const hit = { point: new THREE.Vector3(), distance: 0, faceIndex: -1 };

  // Padded lattice: one extra ring of "outside" samples on every side so the
  // outer wall closes even when the model touches its bounding box.
  const pad = 2;
  const fnx = nx + 2 * pad, fny = ny + 2 * pad, fnz = nz + 2 * pad;
  const origin: [number, number, number] = [min[0] - pad * voxelSize, min[1] - pad * voxelSize, min[2] - pad * voxelSize];
  const fidx = (i: number, j: number, k: number) => (k * fny + j) * fnx + i;

  // Band mask: lattice samples within `bandVox` hops of the surface — only these
  // need an exact distance (the rest are far inside/outside and get a clamped
  // sign). The band must reach the inner wall (≈ wallThickness inside).
  const bandVox = Math.ceil(wallThickness / voxelSize) + 3;
  const band = markBand(fnx, fny, fnz, pad, isSolid, surface, at, bandVox);
  const BIG = wallThickness + (bandVox + 2) * voxelSize; // exceeds any in-band magnitude

  const field = new Float32Array(fnx * fny * fnz);
  for (let k = 0; k < fnz; k++) {
    for (let j = 0; j < fny; j++) {
      for (let i = 0; i < fnx; i++) {
        const fi = fidx(i, j, k);
        const wx = origin[0] + i * voxelSize;
        const wy = origin[1] + j * voxelSize;
        const wz = origin[2] + k * voxelSize;
        const inside = isSolid(i - pad, j - pad, k - pad);

        // Signed distance to the original surface.
        let d: number;
        if (band[fi]) {
          queryPt.set(wx, wy, wz);
          bvh.closestPointToPoint(queryPt, hit);
          // Sign from the closest face's normal: a sample on the outward side of
          // the surface is positive. Falls back to occupancy when the offset is
          // degenerate (query sitting exactly on the surface).
          const fIdx = hit.faceIndex >= 0 ? hit.faceIndex : 0;
          const ox = wx - hit.point.x, oy = wy - hit.point.y, oz = wz - hit.point.z;
          const dot = ox * faceNormals[fIdx * 3] + oy * faceNormals[fIdx * 3 + 1] + oz * faceNormals[fIdx * 3 + 2];
          const outside = Math.abs(dot) > 1e-9 ? dot > 0 : !inside;
          d = outside ? hit.distance : -hit.distance;
        } else {
          d = inside ? -BIG : BIG;
        }

        // Shell band: inside the wall (between the surface and its inward offset).
        const shell = Math.max(d, -(d + wallThickness));
        // Only the wall band can hold material, so skip the (expensive) Worley
        // strut field everywhere the shell already reads "outside" — combined ≥
        // shell, so those samples are outside the lamp regardless of the strut.
        if (shell > voxelSize) {
          field[fi] = shell;
          continue;
        }
        // Strut network: near a Voronoi cell boundary (grain-rotated in XY).
        const gx = (cosA * wx + sinA * wy) / cellSize;
        const gy = (-sinA * wx + cosA * wy) / cellSize;
        const gz = wz / cellSize;
        const strut = cellEdgeDist3D(gx, gy, gz, jitter, seed) * cellSize - halfStrutWorld;

        field[fi] = Math.max(shell, strut); // intersection; < 0 = inside the lamp
      }
    }
  }

  bvhGeom.dispose(); // BVH is only consulted in the field sweep above

  // Connectivity, the voxel path's way: keep only the largest FACE-connected
  // region of inside samples and discard the rest *before* meshing. A thin
  // Voronoi web meshes into pieces joined at points/edges (which the mesh-level
  // filter can't always rescue), but face-connected cells are what physically
  // fuse on the plate — so this drops detached strut fragments while leaving the
  // windows fully open (unlike growing the iso level, which seals them).
  if (opts.watertight !== false) keepLargestFaceConnected(field, fnx, fny, fnz, 0);

  let m = surfaceNetsField({ field, dims: [fnx, fny, fnz], origin, spacing: voxelSize, iso: 0 });
  if (opts.watertight !== false) m = largestMeshComponent(m);
  // A few light Taubin passes relax the residual lattice ripple on the window
  // rims without subdividing (the walls are already smooth from the continuous
  // field, so no densify is needed).
  m = smoothSurface(m, { iterations: 3, subdivide: false });
  return m;
}

/** Keep only the largest 6-connected (face-adjacent) region of inside samples
 *  (`field < iso`); push every other inside sample to +∞ so it meshes as empty.
 *  Face-connectivity is what fuses on an FDM plate, so this leaves one physically
 *  connected, printable web and drops detached fragments. In-place on `field`. */
function keepLargestFaceConnected(field: Float32Array, nx: number, ny: number, nz: number, iso: number): void {
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
 *  padded lattice, treating cells outside the raster as empty). */
function markBand(
  fnx: number, fny: number, fnz: number, pad: number,
  isSolid: (x: number, y: number, z: number) => boolean,
  surface: Int32Array, at: (x: number, y: number, z: number) => number,
  bandVox: number,
): Uint8Array {
  const total = fnx * fny * fnz;
  const fidx = (i: number, j: number, k: number) => (k * fny + j) * fnx + i;
  const dist = new Int16Array(total).fill(-1);
  const band = new Uint8Array(total);
  let queue: number[] = [];

  // Seed: lattice samples whose raster cell is a surface voxel.
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
  void isSolid; // sign comes from occupancy directly; band only needs proximity

  // BFS outward bandVox steps (6-neighbour).
  for (let step = 0; step < bandVox && queue.length; step++) {
    const next: number[] = [];
    for (const fi of queue) {
      const k = Math.floor(fi / (fnx * fny));
      const j = Math.floor((fi - k * fnx * fny) / fnx);
      const i = fi - (k * fny + j) * fnx;
      const tryN = (x: number, y: number, z: number) => {
        if (x < 0 || y < 0 || z < 0 || x >= fnx || y >= fny || z >= fnz) return;
        const ni = fidx(x, y, z);
        if (dist[ni] !== -1) return;
        dist[ni] = step + 1; band[ni] = 1; next.push(ni);
      };
      tryN(i + 1, j, k); tryN(i - 1, j, k);
      tryN(i, j + 1, k); tryN(i, j - 1, k);
      tryN(i, j, k + 1); tryN(i, j, k - 1);
    }
    queue = next;
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
