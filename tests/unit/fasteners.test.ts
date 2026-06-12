// Unit tests for the pure-logic parts of fasteners — the fastener table, the
// clearance presets, and the hex profile math. The geometry builders that need
// the manifold-3d WASM module are exercised in the e2e tier
// (tests/print-fit.spec.ts), where the real kernel runs.

import { describe, it, expect } from 'vitest';
import {
  FASTENERS,
  CLEARANCE_PRESETS,
  fastener,
  clearance,
  clearanceHole,
  __testables__,
} from '../../src/geometry/fasteners';

const { normalizeSize, hexPoints } = __testables__;

describe('fasteners fastener table', () => {
  it('covers the metric range M2..M8', () => {
    expect(Object.keys(FASTENERS)).toEqual(['M2', 'M2_5', 'M3', 'M4', 'M5', 'M6', 'M8']);
  });

  it('clearance holes grow close < normal < loose for every size', () => {
    for (const spec of Object.values(FASTENERS)) {
      expect(spec.clearance.close).toBeLessThan(spec.clearance.normal);
      expect(spec.clearance.normal).toBeLessThan(spec.clearance.loose);
      // A clearance hole is always larger than the nominal screw.
      expect(spec.clearance.close).toBeGreaterThanOrEqual(spec.nominal);
    }
  });

  it('tap/pilot bore is smaller than the screw (threads must bite)', () => {
    for (const spec of Object.values(FASTENERS)) {
      expect(spec.tap).toBeGreaterThan(0);
      expect(spec.tap).toBeLessThan(spec.nominal);
    }
  });

  it('insert bore is wider than the screw (melt-in boss)', () => {
    for (const spec of Object.values(FASTENERS)) {
      expect(spec.insert.hole).toBeGreaterThan(spec.nominal);
      expect(spec.insert.depth).toBeGreaterThan(0);
    }
  });

  it('the table is frozen (cannot be mutated at runtime)', () => {
    expect(Object.isFrozen(FASTENERS)).toBe(true);
  });
});

describe('fasteners.fastener / normalizeSize', () => {
  it('accepts both "M2.5" and "M2_5"', () => {
    expect(fastener('M2.5')).toBe(FASTENERS.M2_5);
    expect(fastener('M2_5')).toBe(FASTENERS.M2_5);
  });

  it('is case-insensitive and tolerates whitespace', () => {
    expect(normalizeSize('  m3 ')).toBe('M3');
  });

  it('throws a helpful error on an unknown size', () => {
    expect(() => fastener('M99')).toThrow(/unknown fastener size/i);
    expect(() => fastener(3 as unknown)).toThrow(/must be a string/i);
  });
});

describe('fasteners.clearance presets', () => {
  it('orders press < snug < normal < loose < free', () => {
    const { press, snug, normal, loose, free } = CLEARANCE_PRESETS;
    expect(press).toBeLessThan(snug);
    expect(snug).toBeLessThan(normal);
    expect(normal).toBeLessThan(loose);
    expect(loose).toBeLessThan(free);
    expect(press).toBe(0);
  });

  it('resolves named fits and passes numbers through', () => {
    expect(clearance('snug')).toBe(0.1);
    expect(clearance('normal')).toBe(0.2);
    expect(clearance(0.42)).toBe(0.42);
    expect(clearance()).toBe(0.2); // default normal
  });

  it('rejects unknown fit names', () => {
    expect(() => clearance('extra-loose')).toThrow(/must be one of/i);
  });
});

describe('fasteners.clearanceHole', () => {
  it('reads the table by fit class', () => {
    expect(clearanceHole('M3', 'close')).toBe(3.2);
    expect(clearanceHole('M3', 'normal')).toBe(3.4);
    expect(clearanceHole('M3', 'loose')).toBe(3.6);
    expect(clearanceHole('M3')).toBe(3.4); // default normal
  });

  it('rejects an unknown fit class', () => {
    expect(() => clearanceHole('M3', 'snug' as unknown as 'close')).toThrow(/close.*normal.*loose/i);
  });
});

describe('fasteners.hexPoints', () => {
  it('returns six vertices', () => {
    expect(hexPoints(10)).toHaveLength(6);
  });

  it('across-flats distance matches the requested width', () => {
    const w = 10;
    const pts = hexPoints(w);
    // Flats face ±Y, so the min/max Y span equals the across-flats width.
    const ys = pts.map((p) => p[1]);
    const span = Math.max(...ys) - Math.min(...ys);
    expect(span).toBeCloseTo(w, 6);
  });

  it('circumradius matches width / sqrt(3)', () => {
    const pts = hexPoints(10);
    const R = Math.hypot(pts[0][0], pts[0][1]);
    expect(R).toBeCloseTo(10 / Math.sqrt(3), 6);
  });
});
