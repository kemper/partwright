// Deterministic 3D gradient noise + fractal Brownian motion (fBm).
//
// A small, dependency-free, *seedable* scalar noise field — the
// stochastic counterpart to the SDF layer's deterministic domain warps
// (twist / bend / taper). Feed the field returned by `makeNoise()` to
// `SdfNode.displace()` to push a surface in and out for organic texture:
// rock, bark, coral, terrain.
//
// This vendors a classic Perlin implementation as a spike toward
// adopting @thi.ng/noise (Apache-2.0, so license-compatible). The
// `SdfNode.displace()` consumer accepts ANY `(x, y, z) => number` field,
// so swapping in a thi.ng simplex/curl field later is a drop-in change
// that needs no SDF-side edits. Single-octave output is ~[-1, 1]; fBm is
// renormalised back into that range so `displace(amount, …)` means "push
// by at most `amount` world units".

export type ScalarField = (x: number, y: number, z: number) => number;

export interface NoiseOptions {
  /** Seed for the permutation table — the same seed gives byte-identical
   *  noise, so models are reproducible across runs/machines. */
  seed?: number;
  /** Spatial frequency (cycles per world unit). Higher = finer detail. */
  frequency?: number;
  /** fBm octave count (layers of detail summed at rising frequency).
   *  1 = plain single-octave noise; 4–6 gives natural-looking surfaces. */
  octaves?: number;
  /** Frequency multiplier between octaves (> 1, typically 2). */
  lacunarity?: number;
  /** Amplitude multiplier between octaves (0..1, typically 0.5). */
  gain?: number;
  /** Ridged multifractal — sharp creases/ridges (think eroded rock or
   *  brain coral) instead of smooth rolling hills. */
  ridged?: boolean;
}

// --- Seeded PRNG ---------------------------------------------------------

/** mulberry32 — a tiny, fast, well-distributed 32-bit PRNG. Used only to
 *  shuffle the permutation table at construction time, never per-sample. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 12 edge-midpoint gradient directions (Perlin's "improved noise" set).
const GRAD3: ReadonlyArray<readonly [number, number, number]> = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];

/** Seeded 512-entry permutation table (256 shuffled, then duplicated so
 *  index arithmetic never needs a modulo). */
function buildPerm(seed: number): Uint8Array {
  const perm = new Uint8Array(256);
  for (let i = 0; i < 256; i++) perm[i] = i;
  const rng = mulberry32(seed || 1);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
  }
  const p = new Uint8Array(512);
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  return p;
}

function fade(t: number): number { return t * t * t * (t * (t * 6 - 15) + 10); }
function lerp(a: number, b: number, t: number): number { return a + t * (b - a); }

function grad(hash: number, x: number, y: number, z: number): number {
  const g = GRAD3[hash % 12];
  return g[0] * x + g[1] * y + g[2] * z;
}

/** Classic 3D Perlin gradient noise. Output is ~[-0.7, 0.7] for this
 *  gradient set; the caller scales by `PERLIN_NORM` to reach ~[-1, 1]. */
function perlin3(p: Uint8Array, x: number, y: number, z: number): number {
  const xi = Math.floor(x) & 255, yi = Math.floor(y) & 255, zi = Math.floor(z) & 255;
  const xf = x - Math.floor(x), yf = y - Math.floor(y), zf = z - Math.floor(z);
  const u = fade(xf), v = fade(yf), w = fade(zf);
  const a = p[xi] + yi, aa = p[a] + zi, ab = p[a + 1] + zi;
  const b = p[xi + 1] + yi, ba = p[b] + zi, bb = p[b + 1] + zi;
  return lerp(
    lerp(
      lerp(grad(p[aa], xf, yf, zf), grad(p[ba], xf - 1, yf, zf), u),
      lerp(grad(p[ab], xf, yf - 1, zf), grad(p[bb], xf - 1, yf - 1, zf), u), v),
    lerp(
      lerp(grad(p[aa + 1], xf, yf, zf - 1), grad(p[ba + 1], xf - 1, yf, zf - 1), u),
      lerp(grad(p[ab + 1], xf, yf - 1, zf - 1), grad(p[bb + 1], xf - 1, yf - 1, zf - 1), u), v),
    w);
}

// Empirical scale that maps this gradient set's output to ~[-1, 1].
const PERLIN_NORM = 1.4;

/** Build a reusable noise field. The returned function is cheap per call
 *  (no allocation) and is meant to be handed to `SdfNode.displace()`,
 *  where it is evaluated millions of times during meshing. */
export function makeNoise(opts: NoiseOptions = {}): ScalarField {
  const seed = opts.seed ?? 1;
  const frequency = opts.frequency ?? 1;
  const octaves = Math.max(1, Math.floor(opts.octaves ?? 4));
  const lacunarity = opts.lacunarity ?? 2;
  const gain = opts.gain ?? 0.5;
  const ridged = !!opts.ridged;
  const perm = buildPerm(seed);

  return (x, y, z) => {
    let freq = frequency, amp = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      let n = perlin3(perm, x * freq, y * freq, z * freq) * PERLIN_NORM;
      // Ridged: fold the absolute value so the zero-crossings become
      // sharp ridges at 1 and the troughs sit at 0.
      if (ridged) n = 1 - Math.abs(n);
      sum += n * amp;
      norm += amp;
      freq *= lacunarity;
      amp *= gain;
    }
    const v = sum / norm;               // ~[-1, 1] smooth, or [0, 1] ridged
    return ridged ? v * 2 - 1 : v;      // remap ridged to a symmetric [-1, 1]
  };
}
