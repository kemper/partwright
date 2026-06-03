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
import { unwrapMesh, type UVAlgorithm } from './uvParameterize';
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
  /** UV parameterization strategy for the surface-following knit (knitTextureUV
   *  path only). 'bfs' (default) = triangle unfolding; 'lscm' = conformal map;
   *  'harmonic' = harmonic-field rows + azimuthal columns. */
  algorithm?: UVAlgorithm;
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

  // Surface-following UV unwrap on the densified mesh.
  const { uvs } = unwrapMesh(positions, base.triVerts, opts.algorithm ?? 'bfs');

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
  const { uvs }  = unwrapMesh(positions, base.triVerts, opts.algorithm ?? 'bfs');

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

// ---- Patch / region-select path -----------------------------------------------

interface PatchSetup {
  fullPositions: Float32Array;
  patchPositions: Float32Array;
  patchNormals:   Float32Array;
  patchTriVerts:  Uint32Array;
  patchUVs:       Float32Array;
  hopDist:        Float32Array;
  localToGlobal:  number[];
  numPatchVert:   number;
  amplitude: number; stitchW: number; stitchH: number; rowOffset: number;
  yarnRadius: number; cosA: number; sinA: number; variation: number; seed: number;
}

function extractKnitPatch(mesh: MeshData, opts: KnitTextureOptions, selectedTris: Set<number>): PatchSetup {
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

  const fullPositions = mesh.numProp === 3
    ? Float32Array.from(mesh.vertProperties)
    : extractPositions(mesh);
  const fullNormals = computeVertexNormals(fullPositions, mesh.triVerts);

  // Build local ↔ global vertex maps for the patch.
  const patchVertSet = new Set<number>();
  for (const t of selectedTris) {
    patchVertSet.add(mesh.triVerts[t * 3]);
    patchVertSet.add(mesh.triVerts[t * 3 + 1]);
    patchVertSet.add(mesh.triVerts[t * 3 + 2]);
  }
  const localToGlobal = Array.from(patchVertSet);
  const globalToLocal = new Map<number, number>();
  for (let i = 0; i < localToGlobal.length; i++) globalToLocal.set(localToGlobal[i], i);
  const numPatchVert = localToGlobal.length;

  const patchPositions = new Float32Array(numPatchVert * 3);
  const patchNormals   = new Float32Array(numPatchVert * 3);
  for (let i = 0; i < numPatchVert; i++) {
    const g = localToGlobal[i];
    patchPositions[i * 3]     = fullPositions[g * 3];
    patchPositions[i * 3 + 1] = fullPositions[g * 3 + 1];
    patchPositions[i * 3 + 2] = fullPositions[g * 3 + 2];
    patchNormals[i * 3]       = fullNormals[g * 3];
    patchNormals[i * 3 + 1]   = fullNormals[g * 3 + 1];
    patchNormals[i * 3 + 2]   = fullNormals[g * 3 + 2];
  }

  const patchTriVerts = new Uint32Array(selectedTris.size * 3);
  let tIdx = 0;
  for (const t of selectedTris) {
    patchTriVerts[tIdx++] = globalToLocal.get(mesh.triVerts[t * 3])!;
    patchTriVerts[tIdx++] = globalToLocal.get(mesh.triVerts[t * 3 + 1])!;
    patchTriVerts[tIdx++] = globalToLocal.get(mesh.triVerts[t * 3 + 2])!;
  }

  const { uvs: patchUVs } = unwrapMesh(patchPositions, patchTriVerts, opts.algorithm ?? 'bfs');

  // Vertex neighbor graph within the patch (for BFS falloff).
  const patchNeighbors: Set<number>[] = Array.from({ length: numPatchVert }, () => new Set());
  for (let i = 0; i < selectedTris.size; i++) {
    const v0 = patchTriVerts[i * 3], v1 = patchTriVerts[i * 3 + 1], v2 = patchTriVerts[i * 3 + 2];
    patchNeighbors[v0].add(v1); patchNeighbors[v0].add(v2);
    patchNeighbors[v1].add(v0); patchNeighbors[v1].add(v2);
    patchNeighbors[v2].add(v0); patchNeighbors[v2].add(v1);
  }

  // BFS from boundary vertices to compute topological hop distance.
  // Displacement fades 0→1 over FALLOFF_HOPS so the patch blends seamlessly.
  const hopDist   = new Float32Array(numPatchVert).fill(Infinity);
  const bfsQueue: number[] = [];
  for (let t = 0; t < mesh.numTri; t++) {
    if (selectedTris.has(t)) continue;
    for (let k = 0; k < 3; k++) {
      const l = globalToLocal.get(mesh.triVerts[t * 3 + k]);
      if (l !== undefined && hopDist[l] === Infinity) { hopDist[l] = 0; bfsQueue.push(l); }
    }
  }
  for (let qi = 0; qi < bfsQueue.length; qi++) {
    const v = bfsQueue[qi];
    for (const nb of patchNeighbors[v]) {
      if (hopDist[nb] === Infinity) { hopDist[nb] = hopDist[v] + 1; bfsQueue.push(nb); }
    }
  }

  return {
    fullPositions, patchPositions, patchNormals, patchTriVerts, patchUVs, hopDist,
    localToGlobal, numPatchVert,
    amplitude, stitchW, stitchH, rowOffset, yarnRadius, cosA, sinA, variation, seed,
  };
}

const PATCH_FALLOFF_HOPS = 2;

function writePatchBack(
  fullPositions: Float32Array,
  patchPositions: Float32Array,
  displaced: Float32Array,
  localToGlobal: number[],
  hopDist: Float32Array,
): void {
  // If the selection is small/coarse and every vertex borders a non-selected
  // triangle (all hopDist = 0), normal falloff gives weight 0 everywhere and
  // nothing moves. Detect this and use full weight instead.
  let maxFiniteHop = 0;
  for (let i = 0; i < localToGlobal.length; i++) {
    if (hopDist[i] !== Infinity && hopDist[i] > maxFiniteHop) maxFiniteHop = hopDist[i];
  }
  const allBoundary = maxFiniteHop === 0;
  for (let i = 0; i < localToGlobal.length; i++) {
    const w = allBoundary ? 1 : Math.min(1, hopDist[i] / PATCH_FALLOFF_HOPS);
    const g = localToGlobal[i];
    fullPositions[g * 3]     = patchPositions[i * 3]     + (displaced[i * 3]     - patchPositions[i * 3])     * w;
    fullPositions[g * 3 + 1] = patchPositions[i * 3 + 1] + (displaced[i * 3 + 1] - patchPositions[i * 3 + 1]) * w;
    fullPositions[g * 3 + 2] = patchPositions[i * 3 + 2] + (displaced[i * 3 + 2] - patchPositions[i * 3 + 2]) * w;
  }
}

/**
 * Applies knit displacement to a user-selected triangle patch only.
 * UV unwrap is solved on the disk-topology sub-mesh for better conformal quality.
 * Displacement fades to zero at patch boundary vertices for a seamless blend.
 */
export function knitTextureUVPatch(
  mesh: MeshData,
  opts: KnitTextureOptions,
  selectedTris: Set<number>,
): MeshData {
  if (selectedTris.size === 0) return knitTextureUV(mesh, opts);

  const p = extractKnitPatch(mesh, opts, selectedTris);
  const displaced = Float32Array.from(p.patchPositions);
  displaceKnitJS(displaced, p.patchNormals, p.patchUVs, p.numPatchVert,
    p.amplitude, p.stitchW, p.stitchH, p.rowOffset, p.yarnRadius,
    p.cosA, p.sinA, p.variation, p.seed);
  writePatchBack(p.fullPositions, p.patchPositions, displaced, p.localToGlobal, p.hopDist);
  return knitMeshResult(mesh, p.fullPositions);
}

/**
 * Async variant of knitTextureUVPatch — uses WebGPU when available, JS fallback otherwise.
 */
export async function knitTextureUVPatchAsync(
  mesh: MeshData,
  opts: KnitTextureOptions,
  selectedTris: Set<number>,
): Promise<MeshData> {
  if (selectedTris.size === 0) return knitTextureUVAsync(mesh, opts);

  const p = extractKnitPatch(mesh, opts, selectedTris);
  const gpuParams: KnitGPUParams = {
    amplitude: p.amplitude, stitchW: p.stitchW, stitchH: p.stitchH,
    rowOffset: p.rowOffset, yarnRadius: p.yarnRadius,
    cosA: p.cosA, sinA: p.sinA, variation: p.variation, seed: p.seed,
  };
  const gpuResult = await knitDisplaceGPU(
    p.patchPositions, p.patchNormals, p.patchUVs, p.numPatchVert, gpuParams,
  );

  let displaced: Float32Array;
  if (gpuResult) {
    displaced = gpuResult;
  } else {
    displaced = Float32Array.from(p.patchPositions);
    displaceKnitJS(displaced, p.patchNormals, p.patchUVs, p.numPatchVert,
      p.amplitude, p.stitchW, p.stitchH, p.rowOffset, p.yarnRadius,
      p.cosA, p.sinA, p.variation, p.seed);
  }

  writePatchBack(p.fullPositions, p.patchPositions, displaced, p.localToGlobal, p.hopDist);
  return knitMeshResult(mesh, p.fullPositions);
}
