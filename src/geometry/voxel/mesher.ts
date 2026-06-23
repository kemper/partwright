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
import { VoxelGrid, colorComponents, DEFAULT_SMOOTH_ALGORITHM, type Surfacing } from './grid';
import { taubinSmooth, scaleMeshPositions, type SmoothPins } from './smooth';
import { surfaceNetsMesh } from './surfaceNets';

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

// Greedy meshing: per face-plane, merge coplanar same-color faces into maximal
// rectangles before triangulating. A 32×8 flat same-color wall drops from ~512
// triangles to 2 — the big lever for keeping voxelized / image-import models
// under the catalog triangle budget. Output welds corners exactly like the
// per-face mesher and uses the same outward winding (verified per-direction
// against FACES for the single-voxel case), so it's a drop-in for `blocks`.
//
// The merged quads span multiple voxels, so this is NOT used for paint mode —
// that path keeps `gridToMeshWithProvenance`'s 1 triangle ↔ 1 voxel mapping.
interface GreedyDir {
  pa: 0 | 1 | 2;   // face-normal (primary) axis
  s: 1 | -1;       // outward direction along pa
  ua: 0 | 1 | 2;   // in-plane U axis
  va: 0 | 1 | 2;   // in-plane V axis
  flip: boolean;   // winding: false = U-then-V (CCW), true = V-then-U
}
// Per-direction winding chosen so the quad normal points outward — matches the
// FACES corner orders exactly for a single voxel.
const GREEDY_DIRS: GreedyDir[] = [
  { pa: 0, s: 1,  ua: 1, va: 2, flip: false }, // +X
  { pa: 0, s: -1, ua: 1, va: 2, flip: true },  // -X
  { pa: 1, s: 1,  ua: 0, va: 2, flip: true },  // +Y
  { pa: 1, s: -1, ua: 0, va: 2, flip: false }, // -Y
  { pa: 2, s: 1,  ua: 0, va: 1, flip: false }, // +Z
  { pa: 2, s: -1, ua: 0, va: 1, flip: true },  // -Z
];

/** Greedy-meshed `MeshData`: coplanar same-color faces coalesced into the
 *  fewest rectangles. Equivalent surface to {@link gridToMeshData}, far fewer
 *  triangles on flat regions. */
export function greedyMeshGrid(grid: VoxelGrid): MeshData {
  const positions: number[] = [];
  const tris: number[] = [];
  const triColors: number[] = [];
  const vertIndex = new Map<number, number>();
  const VKEY = (vx: number, vy: number, vz: number) =>
    ((vx + 2048) * 4096 + (vy + 2048)) * 4096 + (vz + 2048);
  function vertex(vx: number, vy: number, vz: number): number {
    const k = VKEY(vx, vy, vz);
    let i = vertIndex.get(k);
    if (i === undefined) { i = positions.length / 3; positions.push(vx, vy, vz); vertIndex.set(k, i); }
    return i;
  }
  // Pack an in-plane (u,v) cell into a sortable key (u-major, v-minor); same
  // ±2048 offset / 4096 stride as the corner weld, safe for the ±1024 range.
  const UV = (u: number, v: number) => (u + 2048) * 4096 + (v + 2048);
  const UV_U = (key: number) => Math.floor(key / 4096) - 2048;
  const UV_V = (key: number) => (key % 4096) - 2048;

  const coord: [number, number, number] = [0, 0, 0];
  for (const dir of GREEDY_DIRS) {
    // Group exposed faces by slice (the voxel's pa coordinate), each slice a
    // map of in-plane cell → color.
    const slices = new Map<number, Map<number, number>>();
    grid.forEach((x, y, z, rgb) => {
      coord[0] = x; coord[1] = y; coord[2] = z;
      const nx = x + (dir.pa === 0 ? dir.s : 0);
      const ny = y + (dir.pa === 1 ? dir.s : 0);
      const nz = z + (dir.pa === 2 ? dir.s : 0);
      if (grid.has(nx, ny, nz)) return; // face buried against a solid neighbor
      const k = coord[dir.pa];
      let m = slices.get(k);
      if (!m) { m = new Map(); slices.set(k, m); }
      m.set(UV(coord[dir.ua], coord[dir.va]), rgb);
    });

    for (const [k, cells] of slices) {
      const used = new Set<number>();
      const keys = [...cells.keys()].sort((a, b) => a - b); // u-major, v-minor
      for (const key of keys) {
        if (used.has(key)) continue;
        const color = cells.get(key)!;
        const u0 = UV_U(key), v0 = UV_V(key);
        // Grow along V (inner) while same color and free.
        let w = 1;
        while (true) {
          const nk = UV(u0, v0 + w);
          if (cells.get(nk) === color && !used.has(nk)) w++; else break;
        }
        // Grow along U (outer) while the whole V-span matches.
        let h = 1;
        grow: while (true) {
          for (let dv = 0; dv < w; dv++) {
            const nk = UV(u0 + h, v0 + dv);
            if (cells.get(nk) !== color || used.has(nk)) break grow;
          }
          h++;
        }
        for (let du = 0; du < h; du++)
          for (let dv = 0; dv < w; dv++) used.add(UV(u0 + du, v0 + dv));
        emitGreedyQuad(dir, k, u0, u0 + h - 1, v0, v0 + w - 1, color, vertex, tris, triColors);
      }
    }
  }

  const numTri = tris.length / 3;
  const triColorArr = Uint8Array.from(triColors);
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

/** Emit the two triangles of one merged rectangle. `uMin..uMax` / `vMin..vMax`
 *  are inclusive voxel indices; the quad spans corners [uMin, uMax+1] × [vMin,
 *  vMax+1] on the plane at `pa = sliceK (+1 for a +direction)`. */
function emitGreedyQuad(
  dir: GreedyDir, sliceK: number,
  uMin: number, uMax: number, vMin: number, vMax: number,
  color: number,
  vertex: (x: number, y: number, z: number) => number,
  tris: number[], triColors: number[],
): void {
  const plane = dir.s > 0 ? sliceK + 1 : sliceK;
  const pt = (u: number, v: number): number => {
    const p: [number, number, number] = [0, 0, 0];
    p[dir.pa] = plane; p[dir.ua] = u; p[dir.va] = v;
    return vertex(p[0], p[1], p[2]);
  };
  const u0 = uMin, u1 = uMax + 1, v0 = vMin, v1 = vMax + 1;
  let i0: number, i1: number, i2: number, i3: number;
  if (!dir.flip) {            // (u0,v0)→(u1,v0)→(u1,v1)→(u0,v1)
    i0 = pt(u0, v0); i1 = pt(u1, v0); i2 = pt(u1, v1); i3 = pt(u0, v1);
  } else {                    // (u0,v0)→(u0,v1)→(u1,v1)→(u1,v0)
    i0 = pt(u0, v0); i1 = pt(u0, v1); i2 = pt(u1, v1); i3 = pt(u1, v0);
  }
  tris.push(i0, i1, i2, i0, i2, i3);
  const [r, g, b] = colorComponents(color);
  triColors.push(r, g, b, r, g, b);
}

/** Which smoothing algorithm a `smooth()` grid uses. Falls back to the shared
 *  product default for Surfacing objects that predate the `algorithm` field (or
 *  arrive via clone/direct construction); `smooth()` itself stamps that same
 *  default onto every new call. Mesher and UI must agree on this fallback, so
 *  both read DEFAULT_SMOOTH_ALGORITHM rather than hardcoding a value. */
function smoothAlgorithm(surf: Surfacing): 'taubin' | 'surfaceNets' {
  return surf.algorithm ?? DEFAULT_SMOOTH_ALGORITHM;
}

/** Mesh a grid according to its surfacing setting. `blocks` (default) returns
 *  the welded per-face hard surface (manifold, the input to ofMesh). `smooth`
 *  rounds the edges via the grid's chosen algorithm:
 *    - `taubin` (legacy) — Taubin-smooths the block mesh, optionally over a
 *      `detail`× supersampled grid then scaled back. Topology is unchanged, so
 *      per-voxel colors and manifoldness carry through.
 *    - `surfaceNets` — builds a smooth surface from occupancy at native
 *      resolution (no supersampling), then runs `iterations` light Taubin
 *      passes so base-pinning (flatBottom/baseLayers/lockBox) still applies.
 *  This is what the engine calls. */
export function meshGrid(grid: VoxelGrid): MeshData {
  const surf = grid.surfacing();
  // Blocks mode meshes per-face (not greedy): the welded per-face surface is a
  // 2-manifold that Manifold.ofMesh accepts, which voxel stats, slicing, and the
  // printability pill all rely on. Greedy meshing (greedyMeshGrid) coalesces
  // coplanar faces but introduces T-junctions that break ofMesh, so it's used
  // only for triangle-soup file exports (STL/OBJ/3MF), never here.
  if (surf.mode !== 'smooth') return gridToMeshData(grid);

  if (smoothAlgorithm(surf) === 'surfaceNets') {
    let mesh = surfaceNetsMesh(grid);
    // `detail` is meaningless for Surface Nets (it meshes occupancy directly).
    // The Taubin passes here are a light cleanup AND the mechanism that applies
    // the base pins. `flatBottom` is plane-relative so it pins the SN floor
    // exactly; `baseLayers`/`lockBox` are coordinate-based and the SN surface
    // sits ~half a voxel inward of the blocky extent, so those pin the intended
    // region only to within ~0.5 voxel (fine for a "keep this base blocky" hint).
    mesh = taubinSmooth(mesh, surf.iterations, resolveSmoothPins(surf, 1), surf.strength ?? 1);
    return mesh;
  }

  const detail = surf.detail;
  const dense = detail > 1 ? grid.supersample(detail) : grid;
  let mesh = gridToMeshData(dense);
  mesh = taubinSmooth(mesh, surf.iterations, resolveSmoothPins(surf, detail), surf.strength ?? 1);
  if (detail > 1) scaleMeshPositions(mesh, 1 / detail);
  return mesh;
}

/** Translate grid-space base-pinning options into mesh-space `SmoothPins`.
 *  `gridToMeshData` runs on the (possibly supersampled) grid, so voxel-coord
 *  thresholds scale by `detail`; `flatBottom` is plane-relative and needs none.
 *  A voxel at index i spans corner range [i, i+1], so a lockBox over voxels
 *  [min..max] covers corners [min, max+1]. Returns undefined when nothing is
 *  pinned (the smoother then takes its plain fast path). */
function resolveSmoothPins(surf: Surfacing, detail: number): SmoothPins | undefined {
  if (!surf.flatBottom && surf.baseLayers === undefined && !surf.lockBox) return undefined;
  const pins: SmoothPins = {};
  if (surf.flatBottom) pins.flatBottom = true;
  if (surf.baseLayers !== undefined) pins.baseBandZ = surf.baseLayers * detail;
  if (surf.lockBox) {
    const { min, max } = surf.lockBox;
    pins.lockBox = {
      min: [min[0] * detail, min[1] * detail, min[2] * detail],
      max: [(max[0] + 1) * detail, (max[1] + 1) * detail, (max[2] + 1) * detail],
    };
  }
  return pins;
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
