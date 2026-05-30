// "Smooth / round" surface modifier — takes a blocky or low-poly model and
// relaxes its sharp edges into a softer, rounded form. We optionally densify
// first (so corners have intermediate vertices to round through), then run the
// shrink-resistant Taubin λ/μ smoother already used for voxel surfacing.
//
// Topology is untouched (Taubin only moves vertices), so per-triangle colors
// survive and the result stays a watertight manifold. Pure logic → vitest tier.

import type { MeshData } from '../geometry/types';
import { taubinSmooth } from '../geometry/voxel/smooth';
import { subdivideToMaxEdge, extractPositions, bboxOf } from './meshSubdivide';

export interface SmoothOptions {
  /** Number of Taubin λ/μ pass pairs — more = rounder. Default 4. */
  iterations?: number;
  /** Densify before smoothing so sharp corners can round. Default true. */
  subdivide?: boolean;
  /** Target edge length when subdividing. Defaults to a fraction of the bbox. */
  maxEdge?: number;
}

/** Smooth/round a mesh, returning a new position-only MeshData. */
export function smoothSurface(mesh: MeshData, opts: SmoothOptions = {}): MeshData {
  const iterations = Math.max(1, Math.min(20, Math.floor(opts.iterations ?? 4)));

  // Normalize to a position-only mesh (taubinSmooth assumes numProp === 3).
  let base: MeshData;
  if (opts.subdivide !== false) {
    const diag = Math.hypot(...bboxOf(extractPositions(mesh)).size);
    const targetEdge = opts.maxEdge ?? Math.max(diag / 120, 1e-3);
    base = subdivideToMaxEdge(mesh, { maxEdge: targetEdge, maxRounds: 4 });
  } else {
    const positions = extractPositions(mesh);
    base = {
      vertProperties: positions,
      triVerts: mesh.triVerts,
      numVert: mesh.numVert,
      numTri: mesh.numTri,
      numProp: 3,
      triColors: mesh.triColors,
    };
  }

  return taubinSmooth(base, iterations);
}
