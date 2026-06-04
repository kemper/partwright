// Fur / velvet surface texture.
//
// Simulates the look of directional fabric pile (velvet, velour, short fur,
// chenille) by applying anisotropic FBM noise: very fine scale perpendicular to
// the grain direction (creates individual fibers), coarser scale along the grain
// (each fiber has a smooth length envelope). The resulting texture reads as fine
// parallel strands lying against the surface.
//
// Algorithm:
//   1. Rotate world position onto the grain axes: u = across-fiber, v = along-fiber
//      (grainAngleDeg rotates in XY; Z is always the along-fiber direction at 0°).
//   2. Sample FBM with asymmetric frequencies:
//        crossFreq = 1 / fiberSpacing   (tight cross-grain sampling → distinct strands)
//        grainFreq  = 1 / fiberLength   (loose along-grain sampling → smooth fibers)
//   3. Displace each vertex along its normal by the noise value × amplitude.
//      The directionality comes from the frequency asymmetry — the noise "stretches"
//      along the grain direction, giving the visual impression of aligned fibers.
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

export interface FurVelvetOptions {
  /** Peak displacement in world units. */
  amplitude: number;
  /** Individual fiber spacing (cross-grain repeat) in world units.
   *  Smaller = denser, finer fur. ~2% of model diagonal is a good default. */
  fiberSpacing: number;
  /** Fiber length in world units (along-grain scale).
   *  Default fiberSpacing * 6 — fibers are 6× longer than they are wide. */
  fiberLength?: number;
  /** Fractal octaves 1–4. More = finer sub-fiber detail. Default 2. */
  octaves?: number;
  /** Rotate the fiber grain in the XY plane (degrees). Default 0 = fibers run up Z. */
  grainAngleDeg?: number;
  /** Deterministic seed. Default 1. */
  seed?: number;
  /** Densify mesh before displacing. Default true. */
  subdivide?: boolean;
  /** Subdivision quality 1 (draft) – 5 (ultra). Default 3. */
  quality?: number;
}

// --- Value noise (shared with fuzzySkin approach) ----------------------------

function hash3(ix: number, iy: number, iz: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + iz * 2147483647 + seed * 1013904223) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177) | 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

function smoothstep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function valueNoise(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = smoothstep(x - ix), fy = smoothstep(y - iy), fz = smoothstep(z - iz);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const c000 = hash3(ix, iy, iz, seed), c100 = hash3(ix+1, iy, iz, seed);
  const c010 = hash3(ix, iy+1, iz, seed), c110 = hash3(ix+1, iy+1, iz, seed);
  const c001 = hash3(ix, iy, iz+1, seed), c101 = hash3(ix+1, iy, iz+1, seed);
  const c011 = hash3(ix, iy+1, iz+1, seed), c111 = hash3(ix+1, iy+1, iz+1, seed);
  return lerp(lerp(lerp(c000, c100, fx), lerp(c010, c110, fx), fy),
              lerp(lerp(c001, c101, fx), lerp(c011, c111, fx), fy), fz);
}

function fbm(x: number, y: number, z: number, octaves: number, seed: number): number {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * (valueNoise(x * freq, y * freq, z * freq, seed + o * 101) * 2 - 1);
    norm += amp; amp *= 0.5; freq *= 2;
  }
  return norm > 0 ? sum / norm : 0;
}

export function furVelvet(mesh: MeshData, opts: FurVelvetOptions): MeshData {
  const amplitude = Math.max(0, opts.amplitude);
  const fiberSpacing = Math.max(1e-4, opts.fiberSpacing);
  const fiberLength = Math.max(1e-4, opts.fiberLength ?? fiberSpacing * 6);
  const octaves = Math.max(1, Math.min(4, Math.floor(opts.octaves ?? 2)));
  const seed = (opts.seed ?? 1) | 0;
  const angleRad = ((opts.grainAngleDeg ?? 0) * Math.PI) / 180;
  const cosA = Math.cos(angleRad), sinA = Math.sin(angleRad);

  let base: MeshData = mesh;
  if (opts.subdivide !== false && amplitude > 0) {
    const quality = Math.max(1, Math.min(5, Math.round(opts.quality ?? 3)));
    const qScale = 2 ** ((quality - 3) / 2);
    const diag = Math.hypot(...bboxOf(extractPositions(mesh)).size);
    const targetEdge = Math.max(fiberSpacing / (3 * qScale), diag / (400 * qScale));
    base = subdivideToMaxEdge(mesh, { maxEdge: targetEdge, maxRounds: 6 });
  }

  const positions = base.numProp === 3
    ? Float32Array.from(base.vertProperties)
    : extractPositions(base);
  const normals = computeVertexNormals(positions, base.triVerts);

  // Cross-grain frequency (tight) and along-grain frequency (loose).
  const crossFreq = 1 / fiberSpacing;
  const grainFreq  = 1 / fiberLength;

  for (let v = 0; v < base.numVert; v++) {
    const px = positions[v * 3], py = positions[v * 3 + 1], pz = positions[v * 3 + 2];
    const nx = normals[v * 3], ny = normals[v * 3 + 1], nz = normals[v * 3 + 2];

    const { pairs, weights } = triplanarCoords(px, py, pz, nx, ny, nz);
    let d = 0;
    for (let i = 0; i < 3; i++) {
      const [s, t] = pairs[i];
      const u  = cosA * s + sinA * t;    // cross-grain
      const vg = -sinA * s + cosA * t;   // along-grain

      const n = fbm(u * crossFreq, vg * grainFreq, 0, octaves, seed);
      d += weights[i] * amplitude * (n * 0.5 + 0.5);
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
