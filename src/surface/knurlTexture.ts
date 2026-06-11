// Knurl surface texture.
//
// The machinist's grip pattern, as a displacement skin over any model — the
// texture-family counterpart of the parametric `api.knurl` cylinders
// (`src/geometry/knurl.ts`), sharing its vocabulary (pitch / depth / aspect /
// diamond vs straight).
//
// Algorithm (sibling of waffleStitch.ts):
//   1. Map world position onto pattern axes via triplanar coords
//      (grainAngleDeg rotates in the surface plane; the second axis runs "up"
//      the model by default, so diamonds tilt like a helical knurl).
//   2. Diagonal coordinates a = u + v, b = u − v (u = s/pitch,
//      v = t/(pitch·aspect)) — the two opposite-handed groove sets.
//   3. tri(x) = 1 − 2·|frac(x) − ½| is a triangular wave: 1 mid-cell, 0 on the
//      groove lines. Diamond knurl height = amplitude · min(tri(a), tri(b)) —
//      straight-sided pyramids on diamond bases, exactly the intersection look
//      of two opposite-handed ridge sets. `pattern: 'straight'` uses a single
//      set (axial splines): amplitude · tri(u).
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

export interface KnurlTextureOptions {
  /** Peak displacement (ridge height) in world units. */
  amplitude: number;
  /** Spacing between grooves in world units (diamond width). */
  pitch: number;
  /** Diamond height ÷ width. 1 = square diamonds (default); >1 stretches the
   *  diamonds along the grain. Ignored for `pattern: 'straight'`. */
  aspect?: number;
  /** 'diamond' (cross-hatch pyramids, default) or 'straight' (parallel
   *  splines along the grain). */
  pattern?: 'diamond' | 'straight';
  /** Rotate the pattern in the surface plane (degrees). Default 0. */
  grainAngleDeg?: number;
  /** Deterministic seed (currently unused; reserved for future variation). Default 1. */
  seed?: number;
  /** Densify mesh before displacing. Default true. */
  subdivide?: boolean;
  /** Subdivision quality 1 (draft) – 5 (ultra). Default 3. */
  quality?: number;
}

/** Triangular wave: 1 at cell centers, 0 on the groove lines. */
function tri(x: number): number {
  const f = ((x % 1) + 1) % 1;
  return 1 - 2 * Math.abs(f - 0.5);
}

export function knurlTexture(mesh: MeshData, opts: KnurlTextureOptions): MeshData {
  const amplitude = Math.max(0, opts.amplitude);
  const pitch = Math.max(1e-4, opts.pitch);
  const aspect = Math.max(0.1, opts.aspect ?? 1);
  const pattern = opts.pattern ?? 'diamond';
  const angleRad = ((opts.grainAngleDeg ?? 0) * Math.PI) / 180;
  const cosA = Math.cos(angleRad), sinA = Math.sin(angleRad);

  let base: MeshData = mesh;
  if (opts.subdivide !== false && amplitude > 0) {
    const quality = Math.max(1, Math.min(5, Math.round(opts.quality ?? 3)));
    const qScale = 2 ** ((quality - 3) / 2);
    const diag = Math.hypot(...bboxOf(extractPositions(mesh)).size);
    // The pyramid faces are linear, but their edges (the grooves and ridges)
    // need edge lengths well under the pitch to read as crisp.
    const targetEdge = Math.max(pitch / (4 * qScale), diag / (400 * qScale));
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
      const gs = cosA * s + sinA * t;
      const gt = -sinA * s + cosA * t;

      const u = gs / pitch;
      const h = pattern === 'straight'
        ? tri(u)
        : Math.min(tri(u + gt / (pitch * aspect)), tri(u - gt / (pitch * aspect)));
      d += weights[i] * amplitude * h;
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
