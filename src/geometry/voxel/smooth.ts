// Taubin (λ|μ) mesh smoothing — the "rounded edges" surfacing for voxel models.
//
// Plain Laplacian smoothing rounds a blocky mesh but shrinks it (every pass
// pulls vertices toward their neighbours' centroid). Taubin alternates a
// positive λ pass with a slightly larger negative μ pass, which relaxes the
// surface while pushing back against shrinkage — so corners and edges round
// off but the model keeps its size.
//
// This runs on the welded block mesh produced by the face-culling mesher, so:
//   - topology is unchanged (same triVerts) → per-triangle `triColors` stay
//     valid and the result is still a watertight manifold for ofMesh;
//   - only vertex positions move, toward a rounded form.
//
// Pure logic (no DOM/WASM): unit-tested in the vitest tier.

import type { MeshData } from '../types';

// Standard Taubin coefficients: a smoothing λ and an anti-shrink μ with
// |μ| > λ. These values are the widely-used defaults (pass-band ~0.1).
const LAMBDA = 0.5;
const MU = -0.53;

// Per-vertex axis-freeze flags. A frozen axis keeps its initial coordinate
// through every relaxation pass, so the smoother leaves that part of the mesh
// in place. This is how a smoothed voxel model can keep a flat build-plate
// face or a blocky base while everything else rounds.
const FREEZE_X = 1, FREEZE_Y = 2, FREEZE_Z = 4;
const FREEZE_ALL = FREEZE_X | FREEZE_Y | FREEZE_Z;

/** Which vertices the smoother must hold in place, expressed in the SAME world
 *  coordinates as the mesh being smoothed (i.e. supersampled space when
 *  `detail > 1` — the caller scales these to match). All fields are optional;
 *  an empty/absent spec smooths every vertex (the original behavior). */
export interface SmoothPins {
  /** Pin the Z coordinate of every vertex on the minimum-Z plane, so the
   *  build-plate face stays flat while sides and edges still round. */
  flatBottom?: boolean;
  /** Fully pin (all axes) every vertex with `z <= minZ + baseBandZ`, keeping
   *  the bottom band perfectly blocky as a solid pedestal. */
  baseBandZ?: number;
  /** Fully pin (all axes) every vertex inside this inclusive AABB, keeping an
   *  arbitrary region blocky. */
  lockBox?: { min: [number, number, number]; max: [number, number, number] };
}

/** Build a per-vertex freeze mask from a pin spec, or `undefined` when nothing
 *  is pinned (so the smoother takes its original allocation-free fast path).
 *  Evaluated once against the initial positions and reused across passes. */
function buildPinMask(pos: Float32Array, numVert: number, pins?: SmoothPins): Uint8Array | undefined {
  if (!pins || (!pins.flatBottom && pins.baseBandZ === undefined && !pins.lockBox)) return undefined;
  let minZ = Infinity;
  for (let v = 0; v < numVert; v++) { const z = pos[v * 3 + 2]; if (z < minZ) minZ = z; }
  // Voxel-corner coordinates are exact integers; a small epsilon absorbs the
  // float32 round-trip and includes the band's top corner ring (the clean seam
  // between blocky base and smooth body).
  const EPS = 1e-3;
  const bandTop = pins.baseBandZ !== undefined ? minZ + pins.baseBandZ + EPS : -Infinity;
  const box = pins.lockBox;
  const mask = new Uint8Array(numVert);
  for (let v = 0; v < numVert; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    if (z <= bandTop) { mask[v] = FREEZE_ALL; continue; }
    if (box
      && x >= box.min[0] - EPS && x <= box.max[0] + EPS
      && y >= box.min[1] - EPS && y <= box.max[1] + EPS
      && z >= box.min[2] - EPS && z <= box.max[2] + EPS) { mask[v] = FREEZE_ALL; continue; }
    if (pins.flatBottom && z <= minZ + EPS) mask[v] = FREEZE_Z;
  }
  return mask;
}

/** Build, for each vertex, the set of vertices it shares an edge with. */
function buildAdjacency(triVerts: Uint32Array, numVert: number): number[][] {
  const adj: Set<number>[] = Array.from({ length: numVert }, () => new Set<number>());
  for (let t = 0; t < triVerts.length; t += 3) {
    const a = triVerts[t], b = triVerts[t + 1], c = triVerts[t + 2];
    adj[a].add(b); adj[a].add(c);
    adj[b].add(a); adj[b].add(c);
    adj[c].add(a); adj[c].add(b);
  }
  return adj.map(s => [...s]);
}

/** One Laplacian relaxation pass: move each vertex a `factor` of the way
 *  toward the centroid of its edge-neighbours. Reads from `src`, writes `dst`
 *  (both length numVert*3). When a `mask` is given, any frozen axis keeps its
 *  `src` value (pinned vertices act as fixed boundary conditions their
 *  neighbours still relax toward). */
function relaxPass(src: Float32Array, dst: Float32Array, adj: number[][], factor: number, mask?: Uint8Array): void {
  for (let v = 0; v < adj.length; v++) {
    const nbrs = adj[v];
    const i = v * 3;
    const m = mask ? mask[v] : 0;
    if (m === FREEZE_ALL || nbrs.length === 0) { // pinned, or isolated vertex (shouldn't happen on a closed mesh)
      dst[i] = src[i]; dst[i + 1] = src[i + 1]; dst[i + 2] = src[i + 2];
      continue;
    }
    let cx = 0, cy = 0, cz = 0;
    for (const n of nbrs) { cx += src[n * 3]; cy += src[n * 3 + 1]; cz += src[n * 3 + 2]; }
    const inv = 1 / nbrs.length;
    cx *= inv; cy *= inv; cz *= inv;
    dst[i] = (m & FREEZE_X) ? src[i] : src[i] + factor * (cx - src[i]);
    dst[i + 1] = (m & FREEZE_Y) ? src[i + 1] : src[i + 1] + factor * (cy - src[i + 1]);
    dst[i + 2] = (m & FREEZE_Z) ? src[i + 2] : src[i + 2] + factor * (cz - src[i + 2]);
  }
}

/** Taubin-smooth a mesh's vertex positions. `iterations` is the number of
 *  λ/μ pass pairs (more = rounder). Returns a NEW MeshData sharing the input's
 *  triangle and color arrays (topology is untouched). Assumes `numProp === 3`
 *  (voxel meshes are position-only), which all callers satisfy. */
export function taubinSmooth(mesh: MeshData, iterations = 2, pins?: SmoothPins): MeshData {
  const n = Math.max(0, Math.floor(iterations));
  if (n === 0 || mesh.numVert === 0) return mesh;

  const adj = buildAdjacency(mesh.triVerts, mesh.numVert);
  let pos = Float32Array.from(mesh.vertProperties);
  let scratch = new Float32Array(pos.length);
  const mask = buildPinMask(pos, mesh.numVert, pins);

  for (let i = 0; i < n; i++) {
    relaxPass(pos, scratch, adj, LAMBDA, mask);
    [pos, scratch] = [scratch, pos];
    relaxPass(pos, scratch, adj, MU, mask);
    [pos, scratch] = [scratch, pos];
  }

  return {
    vertProperties: pos,
    triVerts: mesh.triVerts,
    numVert: mesh.numVert,
    numTri: mesh.numTri,
    numProp: mesh.numProp,
    triColors: mesh.triColors,
  };
}

/** Scale every vertex position by `s` in place and return the mesh. Used to
 *  bring a supersampled mesh back to the original grid's world size. */
export function scaleMeshPositions(mesh: MeshData, s: number): MeshData {
  const p = mesh.vertProperties;
  for (let i = 0; i < p.length; i++) p[i] *= s;
  return mesh;
}
