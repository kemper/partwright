// "Fuzzy skin" surface texture — the 3D-printing finish that roughens a model's
// outer surface with a fine, irregular displacement. We densify the mesh so the
// texture has somewhere to live, then push every vertex along its normal by a
// deterministic value-noise field. Topology is untouched, so the result stays a
// watertight manifold and any per-triangle colors carried through subdivision
// remain valid.
//
// Pure logic (no DOM/WASM) → unit-tested in the vitest tier.

import type { MeshData } from '../geometry/types';
import {
  subdivideToMaxEdge,
  extractPositions,
  computeVertexNormals,
  bboxOf,
} from './meshSubdivide';

export interface FuzzySkinOptions {
  /** Peak outward/inward displacement in world units. */
  amplitude: number;
  /** Characteristic feature size in world units (smaller = finer fuzz). */
  scale: number;
  /** Octaves of fractal noise (more = busier surface). Default 2. */
  octaves?: number;
  /** Deterministic seed so the same inputs reproduce the same texture. */
  seed?: number;
  /** Densify the mesh before displacing so the texture is visible. Default true. */
  subdivide?: boolean;
  /** Subdivision quality 1 (draft) – 5 (ultra). Default 3. */
  quality?: number;
}

// --- Deterministic value noise -------------------------------------------------

/** Integer hash → [0, 1). 32-bit mix, stable across runs. */
function hash3(ix: number, iy: number, iz: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + iz * 2147483647 + seed * 1013904223) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177) | 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

function smootherstep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Trilinearly-interpolated value noise at a point, in [0, 1). */
function valueNoise(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = smootherstep(x - ix), fy = smootherstep(y - iy), fz = smootherstep(z - iz);
  const c000 = hash3(ix, iy, iz, seed), c100 = hash3(ix + 1, iy, iz, seed);
  const c010 = hash3(ix, iy + 1, iz, seed), c110 = hash3(ix + 1, iy + 1, iz, seed);
  const c001 = hash3(ix, iy, iz + 1, seed), c101 = hash3(ix + 1, iy, iz + 1, seed);
  const c011 = hash3(ix, iy + 1, iz + 1, seed), c111 = hash3(ix + 1, iy + 1, iz + 1, seed);
  const x00 = lerp(c000, c100, fx), x10 = lerp(c010, c110, fx);
  const x01 = lerp(c001, c101, fx), x11 = lerp(c011, c111, fx);
  return lerp(lerp(x00, x10, fy), lerp(x01, x11, fy), fz);
}

/** Fractal (multi-octave) value noise, normalized to roughly [-1, 1]. */
function fbm(x: number, y: number, z: number, octaves: number, seed: number): number {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * (valueNoise(x * freq, y * freq, z * freq, seed + o * 101) * 2 - 1);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return norm > 0 ? sum / norm : 0;
}

/** Apply fuzzy-skin displacement, returning a new position-only MeshData. */
export function fuzzySkin(mesh: MeshData, opts: FuzzySkinOptions): MeshData {
  const amplitude = Math.max(0, opts.amplitude);
  const scale = Math.max(1e-4, opts.scale);
  const octaves = Math.max(1, Math.min(5, Math.floor(opts.octaves ?? 2)));
  const seed = (opts.seed ?? 1) | 0;

  // Densify so a coarse model (e.g. a 12-triangle cube) actually shows texture.
  // Aim for edges at least a few times finer than the feature size, bounded by
  // the model's own scale so we never explode a large flat slab.
  let base: MeshData = mesh;
  if (opts.subdivide !== false && amplitude > 0) {
    const quality = Math.max(1, Math.min(5, Math.round(opts.quality ?? 3)));
    const qScale = 2 ** ((quality - 3) / 2);
    const diag = Math.hypot(...bboxOf(extractPositions(mesh)).size);
    const targetEdge = Math.max(scale / (2 * qScale), diag / (200 * qScale));
    base = subdivideToMaxEdge(mesh, { maxEdge: targetEdge, maxRounds: 4 });
  }

  const positions = base.numProp === 3
    ? Float32Array.from(base.vertProperties)
    : extractPositions(base);
  const normals = computeVertexNormals(positions, base.triVerts);
  const invScale = 1 / scale;

  for (let v = 0; v < base.numVert; v++) {
    const px = positions[v * 3], py = positions[v * 3 + 1], pz = positions[v * 3 + 2];
    const d = fbm(px * invScale, py * invScale, pz * invScale, octaves, seed) * amplitude;
    positions[v * 3] = px + normals[v * 3] * d;
    positions[v * 3 + 1] = py + normals[v * 3 + 1] * d;
    positions[v * 3 + 2] = pz + normals[v * 3 + 2] * d;
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
