// Cable-knit surface texture.
//
// Models a "2-ply cable" pattern: within each cable column two rounded ridges
// (plies) sinusoidally cross each other on a fixed pitch, creating the classic
// twisted-rope look of Aran / fisherman's knitwear.
//
// Algorithm per vertex:
//   1. Project world position onto the cable-grain axes (grainAngleDeg rotates
//      the column axis in XY; Z is always the height / row axis).
//   2. Map to cable-column space: integer column index + fractional position u.
//   3. Two ply-center tracks oscillate sinusoidally:
//        u₁(v) = 0.5 + A·sin(2π·v/pitch)
//        u₂(v) = 0.5 - A·sin(2π·v/pitch)
//      where A controls how far the plies sweep across the column and the
//      opposite signs make them cross at pitch/2 intervals.
//   4. Displacement is the sum of two Gaussian bumps centred at u₁ and u₂.
//      σ = plyWidth / 3, bump height = amplitude × per-cable variation.
//   5. Per-cable amplitude variation adds an organic handmade feel.
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

export interface CableKnitOptions {
  /** Peak displacement in world units. */
  amplitude: number;
  /** Width of one cable column in world units. */
  cableWidth: number;
  /** Height of one full crossing cycle in world units.
   *  At pitch/2 the plies cross; at pitch they return to start. */
  cablePitch?: number;
  /** Width of each individual ply (ridge), in world units.
   *  Default cableWidth * 0.3 — two plies fit side-by-side with a valley between. */
  plyWidth?: number;
  /** Rotate the cable columns in the XY plane (degrees). Default 0 = columns run up Z. */
  grainAngleDeg?: number;
  /** Per-cable amplitude variation 0–1. Default 0.08. */
  variation?: number;
  /** Deterministic seed. Default 1. */
  seed?: number;
  /** Densify mesh before displacing. Default true. */
  subdivide?: boolean;
  /** Subdivision quality 1 (draft) – 5 (ultra). Default 3. */
  quality?: number;
}

function hash2(ix: number, iz: number, seed: number): number {
  let h = (ix * 374761393 + iz * 668265263 + seed * 1013904223) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177) | 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

function gaussian(x: number, sigma: number): number {
  return Math.exp(-(x * x) / (2 * sigma * sigma));
}

export function cableKnit(mesh: MeshData, opts: CableKnitOptions): MeshData {
  const amplitude = Math.max(0, opts.amplitude);
  const cableW = Math.max(1e-4, opts.cableWidth);
  const pitch = Math.max(1e-4, opts.cablePitch ?? cableW * 2.5);
  const plyW = Math.max(1e-4, opts.plyWidth ?? cableW * 0.3);
  const variation = Math.max(0, Math.min(1, opts.variation ?? 0.08));
  const seed = (opts.seed ?? 1) | 0;
  const angleRad = ((opts.grainAngleDeg ?? 0) * Math.PI) / 180;
  const cosA = Math.cos(angleRad), sinA = Math.sin(angleRad);
  const sigma = plyW / 3;
  // How far each ply sweeps from center: set so at full sweep they're centred
  // at 1/4 and 3/4 of the cable width.
  const sweep = 0.35;

  let base: MeshData = mesh;
  if (opts.subdivide !== false && amplitude > 0) {
    const quality = Math.max(1, Math.min(5, Math.round(opts.quality ?? 3)));
    const qScale = 2 ** ((quality - 3) / 2);
    const diag = Math.hypot(...bboxOf(extractPositions(mesh)).size);
    const targetEdge = Math.max(Math.min(plyW, cableW) / (3 * qScale), diag / (400 * qScale));
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

    const { pairs, weights } = triplanarCoords(px, py, pz, nx, ny, nz);
    let d = 0;
    for (let i = 0; i < 3; i++) {
      const [s, t] = pairs[i];
      const gx = cosA * s + sinA * t;
      const gz = -sinA * s + cosA * t;

      const colF = gx / cableW;
      const colInt = Math.floor(colF);
      const uf = colF - colInt;

      const rowF = gz / pitch;
      const rowInt = Math.floor(rowF);

      const parity = ((colInt % 2) + 2) % 2 === 0 ? 1 : -1;
      const cableAmp = amplitude * (1 + variation * (hash2(colInt, rowInt, seed) * 2 - 1));

      const phase = TAU * rowF;
      const u1 = 0.5 + sweep * Math.sin(phase * parity);
      const u2 = 0.5 - sweep * Math.sin(phase * parity);

      d += weights[i] * cableAmp * (gaussian(uf - u1, sigma) + gaussian(uf - u2, sigma));
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
