// Voronoi lamp / perforated shell.
//
// Turns a solid model into a true see-through Voronoi shell — the look of a
// 3D-printed Voronoi lamp or planter: a thin hollow wall with the cell interiors
// cut clean through, leaving an organic network of struts along the cell edges.
//
// Unlike the `voronoiShell` *relief* texture (which only displaces the surface
// along its normals and cannot change topology), this opens real holes, so it is
// built on the voxel engine — the same pure-JS path as `voxelizeMesh`:
//   1. Rasterize the model to a solid occupancy grid (shared `rasterizeSolid`).
//   2. Keep only a thin shell: solid cells within `wallThickness` of the surface,
//      measured by a BFS distance from the boundary inward.
//   3. Cut the cells: for each shell cell, evaluate a 3D cellular (Worley) field
//      over jittered seed points in world space and keep the cell only where it
//      sits near a cell boundary (the F2−F1 bisector) — everything in the cell
//      interiors is removed, which punches the windows through the wall. A true
//      3D field wraps uniformly around any surface (no triplanar-projection
//      seams or smearing on curved/cylindrical walls), so the strut web stays
//      connected.
//
// The result is a `VoxelGrid` (optionally smoothed into rounded struts), so the
// lamp inherits voxel paint / `.vox` export for free, exactly like voxelize.
//
// Pure logic (no DOM/WASM) → unit-tested in the vitest tier.

import type { MeshData } from '../geometry/types';
import { VoxelGrid } from '../geometry/voxel/grid';
import { rasterizeSolid } from './voxelizeMesh';

export interface VoronoiLampOptions {
  /** Approximate spacing between cells, in world units (same scale as the model). */
  cellSize: number;
  /** Shell wall thickness in world units (how thick the kept struts are through the wall). */
  wallThickness: number;
  /** Strut width as a fraction of cellSize [0.05, 0.6] — how wide the kept edge
   *  network is. Larger = chunkier struts / smaller windows. Default 0.3. */
  strutWidth?: number;
  /** Voxels along the longest axis. Higher = crisper holes, slower. Default 110. */
  resolution?: number;
  /** Cell irregularity [0, 1]. 1 = full irregular Voronoi (default); 0 = a grid. */
  jitter?: number;
  /** Rotate the cell pattern in the XY plane (degrees). Default 0. */
  grainAngleDeg?: number;
  /** Deterministic seed. Default 1. */
  seed?: number;
}

const DEFAULT_FILL = 0x4a9eff; // app default unpainted blue (matches voxelizeMesh)

/** Deterministic integer hash → three independent floats in [0, 1). */
function hash3(ix: number, iy: number, iz: number, seed: number): [number, number, number] {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263)
        ^ Math.imul(iz | 0, 2147483647) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 15), 2246822519); h ^= h >>> 13;
  const a = (h >>> 0) / 4294967296;
  h = Math.imul(h ^ (h >>> 16), 3266489917); h ^= h >>> 13;
  const b = (h >>> 0) / 4294967296;
  h = Math.imul(h ^ (h >>> 14), 668265263); h ^= h >>> 13;
  const c = (h >>> 0) / 4294967296;
  return [a, b, c];
}

/** True perpendicular distance (in cell units) from grid point (gx,gy,gz) to the
 *  nearest 3D Voronoi cell boundary, via the two-pass method (Iñigo Quílez):
 *  pass 1 finds the nearest jittered seed, pass 2 takes the min distance to the
 *  bisector plane with every other seed. 0 on a boundary, growing into the cell
 *  — so it maps directly to a strut half-width and stays uniform on any surface. */
function cellEdgeDist3D(gx: number, gy: number, gz: number, jitter: number, seed: number): number {
  const cx = Math.floor(gx), cy = Math.floor(gy), cz = Math.floor(gz);
  // 27 jittered seed positions around the query cell.
  const sx = new Float64Array(27), sy = new Float64Array(27), sz = new Float64Array(27);
  let n1 = 0;
  let best = Infinity;
  let i = 0;
  for (let oz = -1; oz <= 1; oz++) {
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++, i++) {
        const ncx = cx + ox, ncy = cy + oy, ncz = cz + oz;
        const [hx, hy, hz] = hash3(ncx, ncy, ncz, seed);
        const px = ncx + 0.5 + jitter * (hx - 0.5);
        const py = ncy + 0.5 + jitter * (hy - 0.5);
        const pz = ncz + 0.5 + jitter * (hz - 0.5);
        sx[i] = px; sy[i] = py; sz[i] = pz;
        const dx = px - gx, dy = py - gy, dz = pz - gz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < best) { best = d2; n1 = i; }
      }
    }
  }
  const ax = sx[n1], ay = sy[n1], az = sz[n1];
  let edge = Infinity;
  for (let j = 0; j < 27; j++) {
    let dx = sx[j] - ax, dy = sy[j] - ay, dz = sz[j] - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-5) continue; // the nearest seed itself
    dx /= len; dy /= len; dz /= len;
    // Distance from the query point to the bisector plane of (nearest, j),
    // positive inside the nearest cell (dir points toward the neighbour seed).
    const mx = (ax + sx[j]) * 0.5, my = (ay + sy[j]) * 0.5, mz = (az + sz[j]) * 0.5;
    const dd = (mx - gx) * dx + (my - gy) * dy + (mz - gz) * dz;
    if (dd < edge) edge = dd;
  }
  return edge;
}

/** Result of {@link voronoiLattice}: the perforated grid plus the world
 *  transform (grid cell (x,y,z) centre = min + (cell+0.5)·voxelSize), so callers
 *  that want a world-scale mesh can map the unit-cell grid back. */
export interface VoronoiLatticeResult {
  grid: VoxelGrid;
  min: [number, number, number];
  voxelSize: number;
}

/** Build a perforated Voronoi shell from a solid mesh. Returns an empty grid for
 *  an empty mesh. */
export function voronoiLattice(mesh: MeshData, opts: VoronoiLampOptions): VoronoiLatticeResult {
  const grid = new VoxelGrid();
  if (mesh.numTri === 0) return { grid, min: [0, 0, 0], voxelSize: 1 };

  const resolution = Math.max(16, Math.min(200, Math.round(opts.resolution ?? 110)));
  const solid = rasterizeSolid(mesh, resolution);
  const { nx, ny, nz, surface, exterior, at, min, voxelSize } = solid;

  const isSolid = (x: number, y: number, z: number): boolean => {
    if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) return false;
    const idx = at(x, y, z);
    return surface[idx] !== 0 || exterior[idx] === 0;
  };

  // --- Shell extraction: BFS distance (in voxels) from the boundary inward ------
  const shellVoxels = Math.max(1, Math.round(Math.max(1e-6, opts.wallThickness) / voxelSize));
  const dist = new Int32Array(nx * ny * nz).fill(-1);
  const queue: number[] = [];
  for (let x = 0; x < nx; x++) {
    for (let y = 0; y < ny; y++) {
      for (let z = 0; z < nz; z++) {
        if (!isSolid(x, y, z)) continue;
        // A boundary cell touches empty space (or the grid edge) on a 6-face.
        if (!isSolid(x + 1, y, z) || !isSolid(x - 1, y, z) ||
            !isSolid(x, y + 1, z) || !isSolid(x, y - 1, z) ||
            !isSolid(x, y, z + 1) || !isSolid(x, y, z - 1)) {
          const idx = at(x, y, z);
          dist[idx] = 1;
          queue.push(idx);
        }
      }
    }
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const idx = queue[qi];
    const d = dist[idx];
    if (d >= shellVoxels) continue; // no need to expand past the shell band
    const z = idx % nz;
    const y = ((idx - z) / nz) % ny;
    const x = (idx - z - y * nz) / (ny * nz);
    const tryStep = (xx: number, yy: number, zz: number) => {
      if (!isSolid(xx, yy, zz)) return;
      const ni = at(xx, yy, zz);
      if (dist[ni] === -1) { dist[ni] = d + 1; queue.push(ni); }
    };
    tryStep(x + 1, y, z); tryStep(x - 1, y, z);
    tryStep(x, y + 1, z); tryStep(x, y - 1, z);
    tryStep(x, y, z + 1); tryStep(x, y, z - 1);
  }

  // --- Cut cells and emit struts ------------------------------------------------
  // A strut of world-width `strutWidth · cellSize` is centred on each cell
  // boundary; in cell units that is a band of ±strutWidth/2 around edgeDist=0.
  const strutFrac = Math.min(0.6, Math.max(0.05, opts.strutWidth ?? 0.3));
  const halfStrut = strutFrac * 0.5;
  const cellSize = Math.max(1e-4, opts.cellSize);
  const jitter = Math.min(1, Math.max(0, opts.jitter ?? 1));
  const seed = Math.floor(opts.seed ?? 1);
  const angleRad = ((opts.grainAngleDeg ?? 0) * Math.PI) / 180;
  const cosA = Math.cos(angleRad), sinA = Math.sin(angleRad);

  // keptColor[idx] = packed color, or -1 when the cell is not part of a strut.
  const keptColor = new Int32Array(nx * ny * nz).fill(-1);
  for (let x = 0; x < nx; x++) {
    for (let y = 0; y < ny; y++) {
      for (let z = 0; z < nz; z++) {
        const idx = at(x, y, z);
        const d = dist[idx];
        if (d < 1 || d > shellVoxels) continue; // not in the shell band

        // World position of the cell centre → grid coords (grain-rotated in XY).
        const wx = min[0] + (x + 0.5) * voxelSize;
        const wy = min[1] + (y + 0.5) * voxelSize;
        const wz = min[2] + (z + 0.5) * voxelSize;
        const gx = (cosA * wx + sinA * wy) / cellSize;
        const gy = (-sinA * wx + cosA * wy) / cellSize;
        const gz = wz / cellSize;

        if (cellEdgeDist3D(gx, gy, gz, jitter, seed) > halfStrut) continue; // interior → window

        const surf = surface[idx];
        keptColor[idx] = surf ? surf - 1 : DEFAULT_FILL;
      }
    }
  }

  // Drop tiny disconnected fragments (loose bits → print hazards): keep only
  // face-connected (6-neighbour) components at least `minFrac` of the largest.
  // Face-connectivity matches what meshes into a single watertight solid —
  // diagonally-touching voxels mesh as separate pieces — so a well-parameterised
  // lamp collapses to one connected web and the cut's speckle is removed.
  pruneSmallComponents(keptColor, nx, ny, nz, at, 0.02);

  for (let x = 0; x < nx; x++) {
    for (let y = 0; y < ny; y++) {
      for (let z = 0; z < nz; z++) {
        const c = keptColor[at(x, y, z)];
        if (c >= 0) grid.set(x, y, z, c);
      }
    }
  }

  return { grid, min, voxelSize };
}

/** Remove 26-connected components smaller than `minFrac` of the largest, in
 *  place (sets their cells to -1). Keeps fragments that are an absolute minimum
 *  size too, so very small lamps aren't wiped out. */
function pruneSmallComponents(
  keptColor: Int32Array, nx: number, ny: number, nz: number,
  at: (x: number, y: number, z: number) => number,
  minFrac: number,
): void {
  const label = new Int32Array(nx * ny * nz).fill(-1);
  const sizes: number[] = [];
  const members: number[][] = [];
  const stack: number[] = [];
  for (let x = 0; x < nx; x++) {
    for (let y = 0; y < ny; y++) {
      for (let z = 0; z < nz; z++) {
        const start = at(x, y, z);
        if (keptColor[start] < 0 || label[start] !== -1) continue;
        const id = sizes.length;
        let count = 0;
        const mem: number[] = [];
        label[start] = id; stack.push(x, y, z);
        while (stack.length) {
          const cz = stack.pop()!, cy = stack.pop()!, cx = stack.pop()!;
          mem.push(at(cx, cy, cz)); count++;
          // 6-connectivity (face neighbours only).
          const tryN = (ax: number, ay: number, az: number) => {
            if (ax < 0 || ay < 0 || az < 0 || ax >= nx || ay >= ny || az >= nz) return;
            const ni = at(ax, ay, az);
            if (keptColor[ni] < 0 || label[ni] !== -1) return;
            label[ni] = id; stack.push(ax, ay, az);
          };
          tryN(cx + 1, cy, cz); tryN(cx - 1, cy, cz);
          tryN(cx, cy + 1, cz); tryN(cx, cy - 1, cz);
          tryN(cx, cy, cz + 1); tryN(cx, cy, cz - 1);
        }
        sizes.push(count); members.push(mem);
      }
    }
  }
  if (sizes.length === 0) return;
  const largest = Math.max(...sizes);
  const minSize = Math.max(8, Math.floor(largest * minFrac));
  for (let id = 0; id < sizes.length; id++) {
    if (sizes[id] >= minSize) continue;
    for (const idx of members[id]) keptColor[idx] = -1;
  }
}
