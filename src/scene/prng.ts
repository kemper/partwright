// Deterministic pseudo-random number generation for scene layout.
//
// Pure, dependency-free. A given seed always yields the same stream, so a
// SceneGraph is fully reproducible — re-rolling a scene is just bumping the
// seed. mulberry32 is a tiny, fast, well-distributed 32-bit PRNG.

/** Returns a function producing deterministic floats in [0, 1) for the seed. */
export function mulberry32(seed: number): () => number {
  // Coerce to a 32-bit unsigned integer state.
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rng {
  /** Next float in [0, 1). */
  next(): number;
  /** Float in [min, max). */
  range(min: number, max: number): number;
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Pick one element, optionally weighted by a same-length weights array. */
  pick<T>(arr: readonly T[], weights?: readonly number[]): T;
  /** Approximately-normal sample via Box–Muller. */
  gaussian(mean: number, std: number): number;
}

/** Build an Rng backed by a single mulberry32 stream for the seed. */
export function makeRng(seed: number): Rng {
  const next = mulberry32(seed);
  return {
    next,
    range(min: number, max: number): number {
      return min + (max - min) * next();
    },
    int(min: number, max: number): number {
      // Inclusive on both ends.
      const lo = Math.ceil(min);
      const hi = Math.floor(max);
      if (hi < lo) return lo;
      return lo + Math.floor(next() * (hi - lo + 1));
    },
    pick<T>(arr: readonly T[], weights?: readonly number[]): T {
      if (arr.length === 0) throw new Error('makeRng.pick: empty array');
      if (!weights || weights.length !== arr.length) {
        return arr[Math.floor(next() * arr.length)];
      }
      let total = 0;
      for (const w of weights) total += w > 0 ? w : 0;
      if (total <= 0) return arr[Math.floor(next() * arr.length)];
      let r = next() * total;
      for (let i = 0; i < arr.length; i++) {
        const w = weights[i] > 0 ? weights[i] : 0;
        if (r < w) return arr[i];
        r -= w;
      }
      return arr[arr.length - 1];
    },
    gaussian(mean: number, std: number): number {
      // Box–Muller; guard against log(0).
      let u = next();
      const v = next();
      if (u < 1e-12) u = 1e-12;
      const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      return mean + std * z;
    },
  };
}
