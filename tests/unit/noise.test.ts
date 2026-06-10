// Unit tests for src/geometry/noise.ts — the seeded fBm noise field that
// backs SdfNode.displace(). Pure logic, no WASM.

import { describe, it, expect } from 'vitest';
import { makeNoise, mulberry32 } from '../../src/geometry/noise';

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(42), b = mulberry32(42);
    for (let i = 0; i < 5; i++) expect(a()).toBe(b());
  });

  it('produces values in [0, 1)', () => {
    const r = mulberry32(1);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('differs across seeds', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

describe('makeNoise', () => {
  it('is deterministic for a given seed', () => {
    const a = makeNoise({ seed: 7 });
    const b = makeNoise({ seed: 7 });
    for (const [x, y, z] of [[0.5, 1.2, -3], [10, 20, 30], [-7.7, 0, 4.4]]) {
      expect(a(x, y, z)).toBe(b(x, y, z));
    }
  });

  it('differs across seeds at the same point', () => {
    const a = makeNoise({ seed: 1, frequency: 0.3 });
    const b = makeNoise({ seed: 2, frequency: 0.3 });
    // Vanishingly unlikely to collide at a generic point.
    expect(a(3.3, 1.1, 2.2)).not.toBe(b(3.3, 1.1, 2.2));
  });

  it('stays within ~[-1, 1] across many samples (smooth fBm)', () => {
    const n = makeNoise({ seed: 5, frequency: 0.5, octaves: 5 });
    let max = 0;
    for (let i = 0; i < 4000; i++) {
      const v = n(i * 0.13, i * 0.07 - 5, i * 0.21 + 2);
      max = Math.max(max, Math.abs(v));
    }
    // A small overshoot past 1 is expected from the gradient-set scaling.
    expect(max).toBeLessThan(1.1);
    expect(max).toBeGreaterThan(0.2); // it actually varies, not stuck at 0
  });

  it('stays within ~[-1, 1] for ridged noise too', () => {
    const n = makeNoise({ seed: 9, frequency: 0.4, octaves: 4, ridged: true });
    let max = 0;
    for (let i = 0; i < 4000; i++) {
      max = Math.max(max, Math.abs(n(i * 0.11, i * 0.17, i * 0.05)));
    }
    expect(max).toBeLessThanOrEqual(1.0 + 1e-9);
  });

  it('is continuous — nearby points give nearby values', () => {
    const n = makeNoise({ seed: 3, frequency: 0.5, octaves: 3 });
    const base = n(1, 2, 3);
    const near = n(1.001, 2.001, 3.001);
    expect(Math.abs(near - base)).toBeLessThan(0.05);
  });

  it('frequency scales the feature size (lower freq = slower variation)', () => {
    const lo = makeNoise({ seed: 4, frequency: 0.05, octaves: 1 });
    const hi = makeNoise({ seed: 4, frequency: 1.0, octaves: 1 });
    // Total variation over a fixed off-lattice path is larger for the
    // higher-frequency field. (Sample off integer points — single-octave
    // Perlin is exactly 0 on the lattice.)
    let varLo = 0, varHi = 0;
    for (let i = 0; i < 40; i++) {
      const x0 = i * 0.25 + 0.13, x1 = x0 + 0.25;
      varLo += Math.abs(lo(x0, 0.3, 0.7) - lo(x1, 0.3, 0.7));
      varHi += Math.abs(hi(x0, 0.3, 0.7) - hi(x1, 0.3, 0.7));
    }
    expect(varHi).toBeGreaterThan(varLo);
  });

  it('returns 0 at integer lattice points for a single octave (Perlin property)', () => {
    const n = makeNoise({ seed: 8, frequency: 1, octaves: 1 });
    expect(Math.abs(n(2, 3, 4))).toBeLessThan(1e-9);
    expect(Math.abs(n(-1, 5, 0))).toBeLessThan(1e-9);
  });
});
