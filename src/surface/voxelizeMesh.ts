// Mesh → voxel conversion: rasterize an arbitrary solid model into the sparse
// `VoxelGrid` that backs the voxel engine. Once a model is voxelized it inherits
// the entire voxel toolset for free — blocky/smooth surfacing, voxel paint, and
// `.vox` export — so this is the bridge from "any model" to "voxel art".
//
// Approach (robust for watertight manifold meshes):
//   1. Surface pass — for every triangle, sample its area finely and mark the
//      voxel each sample lands in (carrying the triangle's color).
//   2. Solid pass — flood-fill "outside" from the padded grid border through
//      empty cells; every empty cell the flood never reaches is interior and
//      gets filled. Watertightness guarantees the surface shell seals the fill.
//
// Pure logic (no DOM/WASM) → unit-tested in the vitest tier.

import type { MeshData } from '../geometry/types';
import { VoxelGrid, COORD_MIN, COORD_MAX } from '../geometry/voxel/grid';
import { extractPositions, bboxOf } from './meshSubdivide';

export interface VoxelizeOptions {
  /** Voxels along the longest bounding-box axis. Clamped to [4, 200]. */
  resolution?: number;
  /** Fill color for interior voxels when the source has no colors. 0xRRGGBB. */
  fillColor?: number;
}

const DEFAULT_COLOR = 0x4a9eff; // the app's default unpainted blue
const MAX_RESOLUTION = 200;

/** Read a triangle's color (0xRRGGBB) from a triColors buffer, or the default. */
function triColor(triColors: Uint8Array | undefined, t: number): number {
  if (!triColors) return DEFAULT_COLOR;
  return (triColors[t * 3] << 16) | (triColors[t * 3 + 1] << 8) | triColors[t * 3 + 2];
}

/** Voxelize a mesh into a VoxelGrid. The grid uses unit cells indexed from 0,
 *  so the result's world size equals the chosen resolution along each axis
 *  (voxel models carry their own scale — rescale afterward if needed). */
export function voxelizeMesh(mesh: MeshData, opts: VoxelizeOptions = {}): VoxelGrid {
  const grid = new VoxelGrid();
  if (mesh.numTri === 0) return grid;

  const positions = extractPositions(mesh);
  const { min, size } = bboxOf(positions);
  const maxDim = Math.max(size[0], size[1], size[2], 1e-6);

  const resolution = Math.max(4, Math.min(MAX_RESOLUTION, Math.round(opts.resolution ?? 32)));
  const voxelSize = maxDim / resolution;
  const dims: [number, number, number] = [
    Math.max(1, Math.ceil(size[0] / voxelSize)),
    Math.max(1, Math.ceil(size[1] / voxelSize)),
    Math.max(1, Math.ceil(size[2] / voxelSize)),
  ];
  // Keep within the grid's signed-coord range.
  for (let i = 0; i < 3; i++) dims[i] = Math.min(dims[i], COORD_MAX - COORD_MIN);

  const [nx, ny, nz] = dims;
  const toCell = (p: number, axis: number): number =>
    Math.floor((p - min[axis]) / voxelSize);
  const clamp = (v: number, hi: number): number => (v < 0 ? 0 : v >= hi ? hi - 1 : v);

  // surface[idx] = packed color + 1 (0 means "not a surface voxel").
  const surface = new Int32Array(nx * ny * nz);
  const at = (x: number, y: number, z: number): number => (x * ny + y) * nz + z;

  // --- 1. Surface rasterization -------------------------------------------------
  const triVerts = mesh.triVerts;
  for (let t = 0; t < mesh.numTri; t++) {
    const a = triVerts[t * 3], b = triVerts[t * 3 + 1], c = triVerts[t * 3 + 2];
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
    const cx = positions[c * 3], cy = positions[c * 3 + 1], cz = positions[c * 3 + 2];
    const color = triColor(mesh.triColors, t);

    // Sample density: enough barycentric steps that consecutive samples are
    // closer than half a voxel along the triangle's longest edge.
    const e1 = Math.hypot(bx - ax, by - ay, bz - az);
    const e2 = Math.hypot(cx - ax, cy - ay, cz - az);
    const steps = Math.max(1, Math.ceil((Math.max(e1, e2) / voxelSize) * 2));
    for (let i = 0; i <= steps; i++) {
      for (let j = 0; j <= steps - i; j++) {
        const u = i / steps, v = j / steps, w = 1 - u - v;
        const px = ax * w + bx * u + cx * v;
        const py = ay * w + by * u + cy * v;
        const pz = az * w + bz * u + cz * v;
        const gx = clamp(toCell(px, 0), nx);
        const gy = clamp(toCell(py, 1), ny);
        const gz = clamp(toCell(pz, 2), nz);
        surface[at(gx, gy, gz)] = color + 1;
      }
    }
  }

  // --- 2. Flood-fill outside, then fill the rest as interior --------------------
  // visited: 1 = reached from the border through empty space (= exterior).
  const exterior = new Uint8Array(nx * ny * nz);
  const stack: number[] = [];
  const pushIfEmpty = (x: number, y: number, z: number) => {
    if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) return;
    const idx = at(x, y, z);
    if (exterior[idx] || surface[idx]) return;
    exterior[idx] = 1;
    stack.push(idx);
  };
  // Seed from every border cell.
  for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) { pushIfEmpty(x, y, 0); pushIfEmpty(x, y, nz - 1); }
  for (let x = 0; x < nx; x++) for (let z = 0; z < nz; z++) { pushIfEmpty(x, 0, z); pushIfEmpty(x, ny - 1, z); }
  for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) { pushIfEmpty(0, y, z); pushIfEmpty(nx - 1, y, z); }
  while (stack.length) {
    const idx = stack.pop()!;
    const z = idx % nz;
    const y = ((idx - z) / nz) % ny;
    const x = (idx - z - y * nz) / (ny * nz);
    pushIfEmpty(x + 1, y, z); pushIfEmpty(x - 1, y, z);
    pushIfEmpty(x, y + 1, z); pushIfEmpty(x, y - 1, z);
    pushIfEmpty(x, y, z + 1); pushIfEmpty(x, y, z - 1);
  }

  const fillColor = opts.fillColor ?? (mesh.triColors ? 0xcccccc : DEFAULT_COLOR);

  // --- 3. Emit cells ------------------------------------------------------------
  for (let x = 0; x < nx; x++) {
    for (let y = 0; y < ny; y++) {
      for (let z = 0; z < nz; z++) {
        const idx = at(x, y, z);
        const surf = surface[idx];
        if (surf) {
          grid.set(x, y, z, surf - 1);
        } else if (!exterior[idx]) {
          grid.set(x, y, z, fillColor);
        }
      }
    }
  }

  return grid;
}
