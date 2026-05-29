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
 *  (both length numVert*3). */
function relaxPass(src: Float32Array, dst: Float32Array, adj: number[][], factor: number): void {
  for (let v = 0; v < adj.length; v++) {
    const nbrs = adj[v];
    const i = v * 3;
    if (nbrs.length === 0) { // isolated vertex (shouldn't happen on a closed mesh)
      dst[i] = src[i]; dst[i + 1] = src[i + 1]; dst[i + 2] = src[i + 2];
      continue;
    }
    let cx = 0, cy = 0, cz = 0;
    for (const n of nbrs) { cx += src[n * 3]; cy += src[n * 3 + 1]; cz += src[n * 3 + 2]; }
    const inv = 1 / nbrs.length;
    cx *= inv; cy *= inv; cz *= inv;
    dst[i] = src[i] + factor * (cx - src[i]);
    dst[i + 1] = src[i + 1] + factor * (cy - src[i + 1]);
    dst[i + 2] = src[i + 2] + factor * (cz - src[i + 2]);
  }
}

/** Taubin-smooth a mesh's vertex positions. `iterations` is the number of
 *  λ/μ pass pairs (more = rounder). Returns a NEW MeshData sharing the input's
 *  triangle and color arrays (topology is untouched). Assumes `numProp === 3`
 *  (voxel meshes are position-only), which all callers satisfy. */
export function taubinSmooth(mesh: MeshData, iterations = 2): MeshData {
  const n = Math.max(0, Math.floor(iterations));
  if (n === 0 || mesh.numVert === 0) return mesh;

  const adj = buildAdjacency(mesh.triVerts, mesh.numVert);
  let pos = Float32Array.from(mesh.vertProperties);
  let scratch = new Float32Array(pos.length);

  for (let i = 0; i < n; i++) {
    relaxPass(pos, scratch, adj, LAMBDA);
    [pos, scratch] = [scratch, pos];
    relaxPass(pos, scratch, adj, MU);
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
