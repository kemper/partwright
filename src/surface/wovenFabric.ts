// Woven-fabric surface texture.
//
// Simulates a plain-weave interlacing pattern: warp threads (running up the
// model) and weft threads (running across) alternate over/under at each crossing,
// producing the characteristic checker-board weave appearance.
//
// Algorithm:
//   1. Map world position onto thread-grid axes (grainAngleDeg rotates in XY).
//   2. Compute warp-thread coordinate (u = across warp threads) and weft-thread
//      coordinate (v = along warp / across weft threads).
//   3. At each crossing, determine which thread is "over":
//        crossing parity = (floor(u/threadSpacing) + floor(v/threadSpacing)) % 2
//        even → warp thread is over; odd → weft thread is over.
//   4. Each thread is modelled as a cosine-squared ridge centred on its thread axis:
//        warpShape = cos²(uf·π) where uf is position within the thread cell
//        weftShape = cos²(vf·π) similarly
//   5. The "over" thread gets full amplitude; the "under" thread is depressed
//      (contributes a small negative displacement for the under-thread valley).
//        d = amplitude × (overShape − underDepth × underShape)
//
// threadWidth controls how wide the raised bump is relative to the cell.
// underDepth (default 0.3) controls how much the under-thread is recessed.
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

export interface WovenFabricOptions {
  /** Peak displacement in world units. */
  amplitude: number;
  /** Distance between thread centre-lines in world units (the weave cell size). */
  threadSpacing: number;
  /** Width of each thread bump as a fraction of threadSpacing [0.1, 0.9].
   *  0.4 = ~half the cell is raised (default). Higher = fatter threads. */
  threadWidth?: number;
  /** How much the under-thread is depressed relative to amplitude [0, 1].
   *  0 = flat valleys; 0.3 = subtle under-thread dip (default); 1 = deep recess. */
  underDepth?: number;
  /** Rotate the weave in the XY plane (degrees). Default 0 = warp runs up Z. */
  grainAngleDeg?: number;
  /** Deterministic seed (reserved for future per-thread variation). Default 1. */
  seed?: number;
  /** Densify mesh before displacing. Default true. */
  subdivide?: boolean;
  /** Subdivision quality 1 (draft) – 5 (ultra). Default 3. */
  quality?: number;
}

export function wovenFabric(mesh: MeshData, opts: WovenFabricOptions): MeshData {
  const amplitude = Math.max(0, opts.amplitude);
  const spacing = Math.max(1e-4, opts.threadSpacing);
  const threadWidth = Math.max(0.1, Math.min(0.9, opts.threadWidth ?? 0.4));
  const underDepth = Math.max(0, Math.min(1, opts.underDepth ?? 0.3));
  const angleRad = ((opts.grainAngleDeg ?? 0) * Math.PI) / 180;
  const cosA = Math.cos(angleRad), sinA = Math.sin(angleRad);

  // The cosine-squared ridge peaks at the thread centre and tapers to zero at
  // ±halfWidth from center. Scale the phase so the bump occupies `threadWidth`
  // fraction of the cell.
  const halfFrac = threadWidth / 2;

  let base: MeshData = mesh;
  if (opts.subdivide !== false && amplitude > 0) {
    const quality = Math.max(1, Math.min(5, Math.round(opts.quality ?? 3)));
    const qScale = 2 ** ((quality - 3) / 2);
    const diag = Math.hypot(...bboxOf(extractPositions(mesh)).size);
    const targetEdge = Math.max(spacing / (4 * qScale), diag / (400 * qScale));
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
      const gx = cosA * s + sinA * t;   // weft axis
      const gz = -sinA * s + cosA * t;  // warp axis

      const warpF = gz / spacing;
      const weftF = gx / spacing;

      const warpInt = Math.floor(warpF);
      const weftInt = Math.floor(weftF);
      const uf = warpF - warpInt;
      const vf = weftF - weftInt;

      const warpOver = ((warpInt + weftInt) % 2 + 2) % 2 === 0;

      const warpDist = Math.abs(uf - 0.5);
      const weftDist = Math.abs(vf - 0.5);

      const warpShape = warpDist < halfFrac
        ? Math.cos((warpDist / halfFrac) * (Math.PI / 2)) ** 2 : 0;
      const weftShape = weftDist < halfFrac
        ? Math.cos((weftDist / halfFrac) * (Math.PI / 2)) ** 2 : 0;

      const overShape  = warpOver ? warpShape : weftShape;
      const underShape = warpOver ? weftShape : warpShape;

      d += weights[i] * amplitude * (overShape - underDepth * underShape);
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
