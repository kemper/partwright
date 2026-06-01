// Knit-stitch surface texture.
//
// Simulates the look of stockinette (plain knit) fabric: a brick-offset grid of
// smooth raised bumps shaped by the V-profile of interlocking stitch loops.
// Parameters mirror fuzzySkin (amplitude, subdivide, seed) but add stitch
// dimensions (stitchWidth / stitchHeight), a roundness blend from sharp V-ridges
// to soft circular bumps, a grain rotation angle, and per-stitch variation.
//
// Algorithm:
//   1. Optionally densify the mesh so features have geometry to live on.
//   2. Compute vertex normals (area-weighted).
//   3. For each vertex, project world position onto the knit grain (rotated in XY,
//      Z always as the row axis so stitches naturally run "up" the model).
//   4. Apply a brick row offset (rowOffset fraction, default 0.5) so alternating
//      rows are staggered — that interlock is what makes it look like knit.
//   5. Within each stitch cell, compute displacement from two cosine waves:
//      uShape (column: peaks at column edges = "legs" of the V, trough at center)
//      vShape (row: bell per row height, peak at row boundaries).
//      roundness blends from column-only (sharp vertical ridges, roundness=0)
//      to the product uShape*vShape (round bump at each intersection, roundness=1).
//   6. Per-stitch amplitude variation adds organic randomness (deterministic hash).
//
// Pure logic (no DOM/WASM) → unit-tested in the vitest tier.

import type { MeshData } from '../geometry/types';
import {
  subdivideToMaxEdge,
  extractPositions,
  computeVertexNormals,
  bboxOf,
  triplanarCoords,
} from './meshSubdivide';
import { bfsUnwrapMesh } from './uvUnwrap';

export interface KnitTextureOptions {
  /** Peak outward displacement in world units. */
  amplitude: number;
  /** Width of one stitch cell in world units (horizontal repeat). */
  stitchWidth: number;
  /** Height of one stitch cell in world units (vertical repeat).
   *  Defaults to stitchWidth × 1.4 (stitches are taller than wide). */
  stitchHeight?: number;
  /** Horizontal offset for alternating rows (brick pattern) as a fraction
   *  of stitchWidth. Default 0.5 (classic half-stitch offset). */
  rowOffset?: number;
  /** Blend from sharp V-ridges (0) to soft round bumps (1). Default 0.5. */
  roundness?: number;
  /** Rotate the knit grain in the XY plane (degrees). Default 0 = stitches run
   *  along the Z axis (up the model). 90° = stitches run left–right. */
  grainAngleDeg?: number;
  /** Per-stitch amplitude variation as a fraction 0–1. A value of 0.1 varies
   *  each stitch's amplitude by ±10%, giving an organic handmade feel. Default 0.1. */
  variation?: number;
  /** Deterministic seed for per-stitch variation. Default 1. */
  seed?: number;
  /** Densify the mesh before displacing so the texture is visible. Default true. */
  subdivide?: boolean;
  /** Subdivision quality 1 (draft) – 5 (ultra). Controls how finely the mesh is
   *  tessellated before displacement. Higher = smoother curves, more triangles.
   *  Default 3 (medium). */
  quality?: number;
}

// --- Per-stitch variation noise -----------------------------------------------

/** 2-D integer hash → [0, 1). Used for per-stitch amplitude variation. */
function hash2(ix: number, iz: number, seed: number): number {
  let h = (ix * 374761393 + iz * 668265263 + seed * 1013904223) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177) | 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

// --- Main algorithm -----------------------------------------------------------

/** Apply knit-stitch displacement, returning a new position-only MeshData. */
export function knitTexture(mesh: MeshData, opts: KnitTextureOptions): MeshData {
  const amplitude = Math.max(0, opts.amplitude);
  const stitchW = Math.max(1e-4, opts.stitchWidth);
  const stitchH = Math.max(1e-4, opts.stitchHeight ?? stitchW * 1.4);
  const rowOffset = opts.rowOffset ?? 0.5;
  const roundness = Math.max(0, Math.min(1, opts.roundness ?? 0.5));
  const variation = Math.max(0, Math.min(1, opts.variation ?? 0.1));
  const seed = (opts.seed ?? 1) | 0;
  const angleRad = ((opts.grainAngleDeg ?? 0) * Math.PI) / 180;
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);

  // Densify so a coarse mesh shows the stitch pattern. Target edge roughly
  // stitch_min/4, but never smaller than diag/400 to avoid triangle explosion.
  let base: MeshData = mesh;
  if (opts.subdivide !== false && amplitude > 0) {
    const quality = Math.max(1, Math.min(5, Math.round(opts.quality ?? 3)));
    const qScale = 2 ** ((quality - 3) / 2);  // 0.5 at q=1, 1.0 at q=3, 2.0 at q=5
    const diag = Math.hypot(...bboxOf(extractPositions(mesh)).size);
    const targetEdge = Math.max(Math.min(stitchW, stitchH) / (4 * qScale), diag / (400 * qScale));
    base = subdivideToMaxEdge(mesh, { maxEdge: targetEdge, maxRounds: 6 });
  }

  const positions = base.numProp === 3
    ? Float32Array.from(base.vertProperties)
    : extractPositions(base);
  const normals = computeVertexNormals(positions, base.triVerts);

  const TAU = 2 * Math.PI;

  for (let v = 0; v < base.numVert; v++) {
    const px = positions[v * 3], py = positions[v * 3 + 1], pz = positions[v * 3 + 2];
    const nx = normals[v * 3], ny = normals[v * 3 + 1], nz = normals[v * 3 + 2];

    // Triplanar blend: sample the stitch pattern from all three axis planes
    // weighted by how much the surface normal faces each plane. This makes
    // the pattern follow the surface on every face of a cube or sphere
    // instead of degenerating into columns when a face is perpendicular to Z.
    const { pairs, weights } = triplanarCoords(px, py, pz, nx, ny, nz);
    let d = 0;
    for (let i = 0; i < 3; i++) {
      const [s, t] = pairs[i];
      const gx = cosA * s + sinA * t;   // column axis (grain-rotated)
      const gz = -sinA * s + cosA * t;  // row    axis (perpendicular)

      const col = gx / stitchW;
      const row = gz / stitchH;

      const rowInt = Math.floor(row);
      const evenRow = ((rowInt % 2) + 2) % 2 === 0;
      const colShifted = col + (evenRow ? 0 : rowOffset);

      const uf = ((colShifted % 1) + 1) % 1;
      const vf = ((row % 1) + 1) % 1;

      const colInt = Math.floor(colShifted);
      const stitchScale = 1 + variation * (hash2(colInt, rowInt, seed) * 2 - 1);

      const uWave = Math.cos(uf * TAU);
      const vShape = (1 + Math.cos(vf * TAU)) / 2;
      d += weights[i] * amplitude * stitchScale * uWave * (1 - roundness + roundness * vShape);
    }

    positions[v * 3]     = px + nx * d;
    positions[v * 3 + 1] = py + ny * d;
    positions[v * 3 + 2] = pz + nz * d;
  }

  return {
    vertProperties: positions,
    triVerts: base.triVerts,
    numVert: base.numVert,
    numTri: base.numTri,
    numProp: 3,
    triColors: base.triColors,
  };
}

// --- UV-unwrap path -----------------------------------------------------------

/**
 * Apply knit-stitch displacement using BFS surface-following UV coordinates.
 *
 * Unlike `knitTexture` (which uses triplanar world-space projection), this
 * variant first unwraps the mesh surface into a local UV plane and tiles the
 * stitch pattern in that coordinate space.  The texture follows the surface
 * topology — stitches curve around a sphere instead of projecting from fixed
 * world axes — at the cost of a single BFS traversal (~1–5 ms for typical
 * models) before the per-vertex displacement loop.
 *
 * The seam where the BFS "wraps around" will show a slight discontinuity on
 * closed surfaces (expected — same as any UV-atlas approach).
 */
export function knitTextureUV(mesh: MeshData, opts: KnitTextureOptions): MeshData {
  const amplitude = Math.max(0, opts.amplitude);
  const stitchW = Math.max(1e-4, opts.stitchWidth);
  const stitchH = Math.max(1e-4, opts.stitchHeight ?? stitchW * 1.4);
  const rowOffset = opts.rowOffset ?? 0.5;
  const roundness = Math.max(0, Math.min(1, opts.roundness ?? 0.5));
  const variation = Math.max(0, Math.min(1, opts.variation ?? 0.1));
  const seed = (opts.seed ?? 1) | 0;
  const angleRad = ((opts.grainAngleDeg ?? 0) * Math.PI) / 180;
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);

  // Densify mesh
  let base: MeshData = mesh;
  if (opts.subdivide !== false && amplitude > 0) {
    const quality = Math.max(1, Math.min(5, Math.round(opts.quality ?? 3)));
    const qScale = 2 ** ((quality - 3) / 2);
    const diag = Math.hypot(...bboxOf(extractPositions(mesh)).size);
    const targetEdge = Math.max(Math.min(stitchW, stitchH) / (4 * qScale), diag / (400 * qScale));
    base = subdivideToMaxEdge(mesh, { maxEdge: targetEdge, maxRounds: 6 });
  }

  const positions = base.numProp === 3
    ? Float32Array.from(base.vertProperties)
    : extractPositions(base);
  const normals = computeVertexNormals(positions, base.triVerts);

  // BFS UV unwrap on the densified mesh
  const { uvs } = bfsUnwrapMesh(positions, base.triVerts);

  const TAU = 2 * Math.PI;

  for (let v = 0; v < base.numVert; v++) {
    const px = positions[v * 3], py = positions[v * 3 + 1], pz = positions[v * 3 + 2];
    const nx = normals[v * 3], ny = normals[v * 3 + 1], nz = normals[v * 3 + 2];

    // Raw UV from surface following parameterization (world-unit distances)
    const rawU = uvs[v * 2], rawV = uvs[v * 2 + 1];

    // Apply grain rotation in UV space so grainAngleDeg controls stitch direction
    const gu = cosA * rawU + sinA * rawV;
    const gv = -sinA * rawU + cosA * rawV;

    const col = gu / stitchW;
    const row = gv / stitchH;

    const rowInt = Math.floor(row);
    const evenRow = ((rowInt % 2) + 2) % 2 === 0;
    const colShifted = col + (evenRow ? 0 : rowOffset);

    const uf = ((colShifted % 1) + 1) % 1;
    const vf = ((row % 1) + 1) % 1;

    const colInt = Math.floor(colShifted);
    const stitchScale = 1 + variation * (hash2(colInt, rowInt, seed) * 2 - 1);

    const uWave = Math.cos(uf * TAU);
    const vShape = (1 + Math.cos(vf * TAU)) / 2;
    const d = amplitude * stitchScale * uWave * (1 - roundness + roundness * vShape);

    positions[v * 3]     = px + nx * d;
    positions[v * 3 + 1] = py + ny * d;
    positions[v * 3 + 2] = pz + nz * d;
  }

  return {
    vertProperties: positions,
    triVerts: base.triVerts,
    numVert: base.numVert,
    numTri: base.numTri,
    numProp: 3,
    triColors: base.triColors,
  };
}
