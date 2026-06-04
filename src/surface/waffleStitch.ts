// Waffle-stitch surface texture.
//
// Produces a regular grid of recessed cells with raised border ridges — the
// pattern you see on waffle-knit fabric, waffle irons, and honeycomb stitches.
//
// Algorithm:
//   1. Map world position onto cell-grid axes (grainAngleDeg rotates in XY; Z is
//      the row axis so the pattern runs "up" the model by default).
//   2. Within each cell, compute cosine-squared "border proximity":
//        uB = cos²(uf·π)  — 1 at cell edges (u=0,1), 0 at center (u=0.5)
//        vB = cos²(vf·π)  — same for the row axis
//   3. Displacement = amplitude × max(uB, vB)^sharpness
//      - max() gives a raised "cross-hatch" border with a sunken cell interior
//      - sharpness > 1 narrows the raised border and deepens the recess
//   4. rowOffset optionally shifts alternate rows by half a cell (brick/honeycomb
//      variant). Default 0 = straight grid (classic waffle); 0.5 = honeycomb.
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

export interface WaffleStitchOptions {
  /** Peak displacement (border height) in world units. */
  amplitude: number;
  /** Width of one cell in world units. */
  cellWidth: number;
  /** Height of one cell in world units. Default cellWidth (square cells). */
  cellHeight?: number;
  /** Controls border width vs. recess size.
   *  1 = smooth round borders; 3–5 = sharp waffle; 8+ = very thin crisp border.
   *  Default 3. */
  sharpness?: number;
  /** Row offset for brick/honeycomb pattern [0, 1]. 0 = straight grid (waffle,
   *  default); 0.5 = hexagonal honeycomb offset. */
  rowOffset?: number;
  /** Rotate the cell grid in the XY plane (degrees). Default 0. */
  grainAngleDeg?: number;
  /** Deterministic seed (currently unused; reserved for future variation). Default 1. */
  seed?: number;
  /** Densify mesh before displacing. Default true. */
  subdivide?: boolean;
  /** Subdivision quality 1 (draft) – 5 (ultra). Default 3. */
  quality?: number;
}

export function waffleStitch(mesh: MeshData, opts: WaffleStitchOptions): MeshData {
  const amplitude = Math.max(0, opts.amplitude);
  const cellW = Math.max(1e-4, opts.cellWidth);
  const cellH = Math.max(1e-4, opts.cellHeight ?? cellW);
  const sharpness = Math.max(1, opts.sharpness ?? 3);
  const rowOffset = opts.rowOffset ?? 0;
  const angleRad = ((opts.grainAngleDeg ?? 0) * Math.PI) / 180;
  const cosA = Math.cos(angleRad), sinA = Math.sin(angleRad);

  let base: MeshData = mesh;
  if (opts.subdivide !== false && amplitude > 0) {
    const quality = Math.max(1, Math.min(5, Math.round(opts.quality ?? 3)));
    const qScale = 2 ** ((quality - 3) / 2);
    const diag = Math.hypot(...bboxOf(extractPositions(mesh)).size);
    const targetEdge = Math.max(Math.min(cellW, cellH) / (4 * qScale), diag / (400 * qScale));
    base = subdivideToMaxEdge(mesh, { maxEdge: targetEdge, maxRounds: 6 });
  }

  const positions = base.numProp === 3
    ? Float32Array.from(base.vertProperties)
    : extractPositions(base);
  const normals = computeVertexNormals(positions, base.triVerts);

  for (let v = 0; v < base.numVert; v++) {
    const px = positions[v * 3], py = positions[v * 3 + 1], pz = positions[v * 3 + 2];
    const nx = normals[v * 3], ny = normals[v * 3 + 1], nz = normals[v * 3 + 2];

    const { pairs, weights } = triplanarCoords(px, py, pz, nx, ny, nz);
    let d = 0;
    for (let i = 0; i < 3; i++) {
      const [s, t] = pairs[i];
      const gx = cosA * s + sinA * t;
      const gz = -sinA * s + cosA * t;

      const col = gx / cellW;
      const row = gz / cellH;
      const rowInt = Math.floor(row);

      const colShifted = col + (((rowInt % 2) + 2) % 2 === 1 ? rowOffset : 0);
      const uf = ((colShifted % 1) + 1) % 1;
      const vf = ((row % 1) + 1) % 1;

      const uB = Math.cos(uf * Math.PI) ** 2;
      const vB = Math.cos(vf * Math.PI) ** 2;
      const border = Math.max(uB, vB) ** sharpness;
      d += weights[i] * amplitude * border;
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
