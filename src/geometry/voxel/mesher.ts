// Voxel grid → triangle mesh, by exposed-face culling with vertex welding.
//
// Each occupied voxel (x,y,z) owns the unit cube [x,x+1]×[y,y+1]×[z,z+1] in
// world space (1 voxel = 1 unit). A face is emitted only where a solid voxel
// borders an empty cell, so interior faces vanish and the result is the
// boundary surface of the solid. Corner vertices are welded (deduplicated by
// position), so for any face-connected set of voxels the output is a watertight,
// consistently-wound 2-manifold that `Manifold.ofMesh` accepts directly —
// which is what lets voxel models flow through stats, slicing, and export
// unchanged.
//
// Caveat: voxels that touch only along an edge or corner (diagonal-only
// adjacency) form a non-manifold edge/vertex, the same limitation every cube
// mesher has. Face-connected models — the overwhelming common case — are fine.
//
// Pure logic (no DOM/WASM): unit-tested in the vitest tier.

import type { MeshData } from '../types';
import { VoxelGrid, colorComponents } from './grid';
import { taubinSmooth, scaleMeshPositions } from './smooth';

/** Per-triangle voxel coordinate provenance. `triVoxel` is `numTri * 3`,
 *  flattened (x, y, z, x, y, z, …), giving the integer coord of the voxel
 *  each triangle came from. Used by voxel paint mode to map a clicked face
 *  back to a single voxel for color/erase.
 *
 *  `triNormal` is the matching `numTri * 3` flattened outward face direction
 *  (each component ∈ {−1,0,1}) — the empty side the triangle faces. Voxel
 *  Studio's "add" tool places the new cube at `triVoxel + triNormal`, so a
 *  click on a top face stacks a block on top, a click on a side face extends
 *  sideways, etc. */
export interface VoxelMesh { mesh: MeshData; triVoxel: Int16Array; triNormal: Int8Array }

// The 6 face directions: neighbor offset + the 4 corner offsets (relative to
// the voxel's min corner) in CCW order viewed from outside, so each face's
// triangles wind with the outward normal.
interface Face { d: [number, number, number]; corners: [number, number, number][] }
const FACES: Face[] = [
  { d: [1, 0, 0],  corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] }, // +X
  { d: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] }, // -X
  { d: [0, 1, 0],  corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] }, // +Y
  { d: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] }, // -Y
  { d: [0, 0, 1],  corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] }, // +Z
  { d: [0, 0, -1], corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] }, // -Z
];

/** Mesh a voxel grid into welded, outward-wound `MeshData` with per-triangle
 *  colors (`triColors`). Returns an empty mesh (numVert/numTri = 0) for an
 *  empty grid — callers should check `grid.size` first to surface a friendlier
 *  message. */
export function gridToMeshData(grid: VoxelGrid): MeshData {
  const positions: number[] = [];
  const tris: number[] = [];
  const triColors: number[] = [];
  // Welds coincident corners. Corners range [-1024, 1024]; pack with a 12-bit
  // (4096) stride, offset 2048, so the key stays a safe integer.
  const vertIndex = new Map<number, number>();
  const VKEY = (vx: number, vy: number, vz: number) =>
    ((vx + 2048) * 4096 + (vy + 2048)) * 4096 + (vz + 2048);

  function vertex(vx: number, vy: number, vz: number): number {
    const k = VKEY(vx, vy, vz);
    let i = vertIndex.get(k);
    if (i === undefined) {
      i = positions.length / 3;
      positions.push(vx, vy, vz);
      vertIndex.set(k, i);
    }
    return i;
  }

  grid.forEach((x, y, z, rgb) => {
    const [r, g, b] = colorComponents(rgb);
    for (const face of FACES) {
      // Skip faces buried against another solid voxel.
      if (grid.has(x + face.d[0], y + face.d[1], z + face.d[2])) continue;
      const [c0, c1, c2, c3] = face.corners;
      const i0 = vertex(x + c0[0], y + c0[1], z + c0[2]);
      const i1 = vertex(x + c1[0], y + c1[1], z + c1[2]);
      const i2 = vertex(x + c2[0], y + c2[1], z + c2[2]);
      const i3 = vertex(x + c3[0], y + c3[1], z + c3[2]);
      // Two CCW triangles: (0,1,2) and (0,2,3).
      tris.push(i0, i1, i2, i0, i2, i3);
      triColors.push(r, g, b, r, g, b);
    }
  });

  const numTri = tris.length / 3;
  const triColorArr = Uint8Array.from(triColors);
  // Every voxel triangle carries an authored color, so mark them all
  // "painted". Without this mask the color pipeline's fallback heuristic
  // (`r||g||b ≠ 0`) would treat a pure-black voxel — a legal color — as
  // unpainted and recolor it to the default blue.
  //
  // NB: this `_painted` expando is dropped by structured clone when the mesh
  // crosses the geometry Worker boundary, so the Worker-result handler in
  // engine.ts re-establishes it on arrival. Setting it here still covers the
  // synchronous (main-thread) execution path and keeps the module honest.
  (triColorArr as Uint8Array & { _painted?: Uint8Array })._painted = new Uint8Array(numTri).fill(1);

  return {
    vertProperties: Float32Array.from(positions),
    triVerts: Uint32Array.from(tris),
    numVert: positions.length / 3,
    numTri,
    numProp: 3,
    triColors: triColorArr,
  };
}

/** Mesh a grid according to its surfacing setting. `blocks` (default) returns
 *  the hard-faced mesh; `smooth` rounds the edges by Taubin-smoothing the
 *  block mesh (optionally over a supersampled grid, then scaled back to the
 *  original world size). Topology is unchanged by smoothing, so per-voxel
 *  colors and manifoldness carry through. This is what the engine calls. */
export function meshGrid(grid: VoxelGrid): MeshData {
  const surf = grid.surfacing();
  if (surf.mode !== 'smooth') return gridToMeshData(grid);
  const dense = surf.detail > 1 ? grid.supersample(surf.detail) : grid;
  let mesh = gridToMeshData(dense);
  mesh = taubinSmooth(mesh, surf.iterations);
  if (surf.detail > 1) scaleMeshPositions(mesh, 1 / surf.detail);
  return mesh;
}

/** Block-mesh a grid AND record which voxel each triangle came from. Voxel
 *  paint mode uses this on the main thread to map a clicked face back to a
 *  single voxel. Only the `blocks` surfacing is supported — smoothing
 *  resamples / supersamples the grid, so the provenance no longer maps to
 *  the user-authored voxels in any useful way. Paint mode falls back to the
 *  unprovenanced `meshGrid` when surfacing is `smooth`. */
export function gridToMeshWithProvenance(grid: VoxelGrid): VoxelMesh {
  const positions: number[] = [];
  const tris: number[] = [];
  const triColors: number[] = [];
  const triVoxelList: number[] = [];
  const triNormalList: number[] = [];
  const vertIndex = new Map<number, number>();
  const VKEY = (vx: number, vy: number, vz: number) =>
    ((vx + 2048) * 4096 + (vy + 2048)) * 4096 + (vz + 2048);

  function vertex(vx: number, vy: number, vz: number): number {
    const k = VKEY(vx, vy, vz);
    let i = vertIndex.get(k);
    if (i === undefined) {
      i = positions.length / 3;
      positions.push(vx, vy, vz);
      vertIndex.set(k, i);
    }
    return i;
  }

  grid.forEach((x, y, z, rgb) => {
    const [r, g, b] = colorComponents(rgb);
    for (const face of FACES) {
      if (grid.has(x + face.d[0], y + face.d[1], z + face.d[2])) continue;
      const [c0, c1, c2, c3] = face.corners;
      const i0 = vertex(x + c0[0], y + c0[1], z + c0[2]);
      const i1 = vertex(x + c1[0], y + c1[1], z + c1[2]);
      const i2 = vertex(x + c2[0], y + c2[1], z + c2[2]);
      const i3 = vertex(x + c3[0], y + c3[1], z + c3[2]);
      tris.push(i0, i1, i2, i0, i2, i3);
      triColors.push(r, g, b, r, g, b);
      // Both triangles of this face belong to voxel (x, y, z) and face the
      // same empty-side direction (the face's outward normal).
      triVoxelList.push(x, y, z, x, y, z);
      const [nx, ny, nz] = face.d;
      triNormalList.push(nx, ny, nz, nx, ny, nz);
    }
  });

  const numTri = tris.length / 3;
  const triColorArr = Uint8Array.from(triColors);
  (triColorArr as Uint8Array & { _painted?: Uint8Array })._painted = new Uint8Array(numTri).fill(1);

  return {
    mesh: {
      vertProperties: Float32Array.from(positions),
      triVerts: Uint32Array.from(tris),
      numVert: positions.length / 3,
      numTri,
      numProp: 3,
      triColors: triColorArr,
    },
    triVoxel: Int16Array.from(triVoxelList),
    triNormal: Int8Array.from(triNormalList),
  };
}
