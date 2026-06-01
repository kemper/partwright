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
import { knitDisplaceGPU, type KnitGPUParams } from './knitTextureGPU';

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

// --- Helpers ------------------------------------------------------------------

/** 2-D integer hash → [0, 1). Used for per-stitch amplitude variation. */
function hash2(ix: number, iz: number, seed: number): number {
  let h = (ix * 374761393 + iz * 668265263 + seed * 1013904223) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177) | 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/** 2-D point-to-segment distance (world units). */
function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-14) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
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
 * Models yarn strands as V-shaped paths in UV space: each stitch cell has two
 * legs running from a shared tip (bottom of the V) up to the left and right
 * column boundaries at the top. Displacement is a semicircle cross-section
 * based on perpendicular distance to each leg, combined with max() so
 * crossing strands show a clear over-under depth relationship.
 *
 * `roundness` controls yarn plumpness: 0 = thin strand, 1 = fat/round yarn.
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

  // Yarn strand radius: roundness blends thin (0.22×W) → plump (0.40×W).
  const yarnRadius = stitchW * (0.22 + roundness * 0.18);

  // Densify mesh — tighter target so yarn cross-sections resolve clearly.
  let base: MeshData = mesh;
  if (opts.subdivide !== false && amplitude > 0) {
    const quality = Math.max(1, Math.min(5, Math.round(opts.quality ?? 3)));
    const qScale = 2 ** ((quality - 3) / 2);
    const diag = Math.hypot(...bboxOf(extractPositions(mesh)).size);
    const targetEdge = Math.max(
      Math.min(stitchW, stitchH) / (6 * qScale),
      diag / (500 * qScale),
    );
    base = subdivideToMaxEdge(mesh, { maxEdge: targetEdge, maxRounds: 6, maxTriangles: 600_000 });
  }

  const positions = base.numProp === 3
    ? Float32Array.from(base.vertProperties)
    : extractPositions(base);
  const normals = computeVertexNormals(positions, base.triVerts);

  // BFS UV unwrap on the densified mesh
  const { uvs } = bfsUnwrapMesh(positions, base.triVerts);

  displaceKnitJS(positions, normals, uvs, base.numVert,
    amplitude, stitchW, stitchH, rowOffset, yarnRadius, cosA, sinA, variation, seed);

  return knitMeshResult(base, positions);
}

/**
 * Async variant of knitTextureUV: same setup, but runs the displacement loop
 * on the GPU when WebGPU is available.  Falls back to the JS path silently.
 * Use this for the "apply" path where quality matters; the preview path uses
 * the sync knitTextureUV so slider updates stay responsive.
 */
export async function knitTextureUVAsync(mesh: MeshData, opts: KnitTextureOptions): Promise<MeshData> {
  const amplitude  = Math.max(0, opts.amplitude);
  const stitchW    = Math.max(1e-4, opts.stitchWidth);
  const stitchH    = Math.max(1e-4, opts.stitchHeight ?? stitchW * 1.4);
  const rowOffset  = opts.rowOffset ?? 0.5;
  const roundness  = Math.max(0, Math.min(1, opts.roundness ?? 0.5));
  const variation  = Math.max(0, Math.min(1, opts.variation ?? 0.1));
  const seed       = (opts.seed ?? 1) | 0;
  const angleRad   = ((opts.grainAngleDeg ?? 0) * Math.PI) / 180;
  const cosA       = Math.cos(angleRad);
  const sinA       = Math.sin(angleRad);
  const yarnRadius = stitchW * (0.22 + roundness * 0.18);

  let base: MeshData = mesh;
  if (opts.subdivide !== false && amplitude > 0) {
    const quality    = Math.max(1, Math.min(5, Math.round(opts.quality ?? 3)));
    const qScale     = 2 ** ((quality - 3) / 2);
    const diag       = Math.hypot(...bboxOf(extractPositions(mesh)).size);
    const targetEdge = Math.max(
      Math.min(stitchW, stitchH) / (6 * qScale),
      diag / (500 * qScale),
    );
    base = subdivideToMaxEdge(mesh, { maxEdge: targetEdge, maxRounds: 6, maxTriangles: 600_000 });
  }

  const positions = base.numProp === 3
    ? Float32Array.from(base.vertProperties)
    : extractPositions(base);
  const normals = computeVertexNormals(positions, base.triVerts);
  const { uvs }  = bfsUnwrapMesh(positions, base.triVerts);

  const gpuParams: KnitGPUParams = {
    amplitude, stitchW, stitchH, rowOffset, yarnRadius, cosA, sinA, variation, seed,
  };
  const gpuResult = await knitDisplaceGPU(positions, normals, uvs, base.numVert, gpuParams);

  if (gpuResult) {
    return knitMeshResult(base, gpuResult);
  }

  // JS fallback — same algorithm as knitTextureUV
  displaceKnitJS(positions, normals, uvs, base.numVert,
    amplitude, stitchW, stitchH, rowOffset, yarnRadius, cosA, sinA, variation, seed);
  return knitMeshResult(base, positions);
}

// ---- Shared helpers ----------------------------------------------------------

/** Shared displacement loop — mutates `positions` in place. */
function displaceKnitJS(
  positions: Float32Array, normals: Float32Array, uvs: Float32Array, numVert: number,
  amplitude: number, stitchW: number, stitchH: number, rowOffset: number,
  yarnRadius: number, cosA: number, sinA: number, variation: number, seed: number,
): void {
  for (let v = 0; v < numVert; v++) {
    const px = positions[v * 3], py = positions[v * 3 + 1], pz = positions[v * 3 + 2];
    const nx = normals[v * 3], ny = normals[v * 3 + 1], nz = normals[v * 3 + 2];

    const rawU = uvs[v * 2], rawV = uvs[v * 2 + 1];
    const gu = cosA * rawU + sinA * rawV;
    const gv = -sinA * rawU + cosA * rawV;

    const rowInt = Math.floor(gv / stitchH);
    let d = 0;

    for (let dr = -1; dr <= 1; dr++) {
      const ri    = rowInt + dr;
      const even  = ((ri % 2) + 2) % 2 === 0;
      const shift = even ? 0 : rowOffset;

      const vTip   = ri * stitchH;
      const vExit  = (ri + 1) * stitchH;
      const colInt = Math.floor(gu / stitchW - shift);

      for (let dc = -1; dc <= 1; dc++) {
        const ci   = colInt + dc;
        const uTip = (ci + 0.5 + shift) * stitchW;
        const uL   = (ci       + shift) * stitchW;
        const uR   = (ci + 1   + shift) * stitchW;

        const sv   = 1 + variation * (hash2(ci, ri, seed) * 2 - 1);
        const dist = Math.min(
          distToSeg(gu, gv, uTip, vTip, uL, vExit),
          distToSeg(gu, gv, uTip, vTip, uR, vExit),
        );
        const r = dist / yarnRadius;
        if (r < 1) {
          const layerBias = even ? 0 : -amplitude * 0.2;
          const contrib   = amplitude * sv * Math.sqrt(1 - r * r) + layerBias;
          if (contrib > d) d = contrib;
        }
      }
    }

    positions[v * 3]     = px + nx * d;
    positions[v * 3 + 1] = py + ny * d;
    positions[v * 3 + 2] = pz + nz * d;
  }
}

function knitMeshResult(base: MeshData, positions: Float32Array): MeshData {
  return {
    vertProperties: positions,
    triVerts: base.triVerts,
    numVert: base.numVert,
    numTri: base.numTri,
    numProp: 3,
    triColors: base.triColors,
  };
}
