// Knurl surface texture.
//
// Produces functional grip relief — the diamond cross-hatch of a thumbscrew,
// the straight axial splines of a knob, or horizontal finger ribs — displaced
// along surface normals over a triplanar projection (the same projection the
// waffle / woven textures use). Unlike the `api.knurl.*` shape generator (which
// builds a whole knurled cylinder), this textures ANY existing mesh's surface.
//
// Algorithm (mirrors waffleStitch):
//   1. Map world position onto grip-grid axes (grainAngleDeg rotates in XY; the
//      second axis is Z so the pattern runs "up" the model by default).
//   2. Compute a raise field in [0,1] per style:
//        diamond  — product of two opposite-handed cosine ridge families →
//                   a 45°-rotated diamond bump grid
//        straight — a single cosine ridge family across the column axis →
//                   vertical splines
//        ribs     — a single cosine ridge family across the row axis →
//                   horizontal rings
//   3. Displacement = amplitude × raise^sharpness, accumulated triplanar.
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

export type KnurlStyle = 'diamond' | 'straight' | 'ribs';

export interface KnurlTextureOptions {
  /** Peak ridge height in world units. */
  amplitude: number;
  /** Spacing of one ridge cell along the column axis, world units. */
  cellWidth: number;
  /** Spacing along the row (Z) axis. Default cellWidth (square diamonds). */
  cellHeight?: number;
  /** Knurl pattern. Default 'diamond'. */
  style?: KnurlStyle;
  /** Ridge crispness. 1 = soft rounded, 2–4 = crisp, 6+ = sharp peaks. Default 2. */
  sharpness?: number;
  /** Rotate the grid in the XY plane (degrees). Default 0. */
  grainAngleDeg?: number;
  /** Deterministic seed (reserved for future variation). Default 1. */
  seed?: number;
  /** Densify mesh before displacing. Default true. */
  subdivide?: boolean;
  /** Subdivision quality 1 (draft) – 5 (ultra). Default 3. */
  quality?: number;
}

const TAU = Math.PI * 2;

export function knurlTexture(mesh: MeshData, opts: KnurlTextureOptions): MeshData {
  const amplitude = Math.max(0, opts.amplitude);
  const cellW = Math.max(1e-4, opts.cellWidth);
  const cellH = Math.max(1e-4, opts.cellHeight ?? cellW);
  const style: KnurlStyle = opts.style ?? 'diamond';
  const sharpness = Math.max(1, opts.sharpness ?? 2);
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

      let raise: number;
      if (style === 'straight') {
        raise = 0.5 + 0.5 * Math.cos(TAU * col);
      } else if (style === 'ribs') {
        raise = 0.5 + 0.5 * Math.cos(TAU * row);
      } else {
        // diamond: two opposite-handed ridge families → a 45° bump grid.
        const a = 0.5 + 0.5 * Math.cos(TAU * (col + row));
        const b = 0.5 + 0.5 * Math.cos(TAU * (col - row));
        raise = a * b;
      }
      d += weights[i] * amplitude * raise ** sharpness;
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
