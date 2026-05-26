// Unit tests for the brush footprint signed-distance field (the basis of the
// in/out test and the boundary-conforming clip). Pure geometry — no browser.

import { describe, test, expect } from 'vitest';
import { strokeSignedDist, sprayCoverage, airbrushDither, type BrushStroke } from '../../src/color/subdivide';

const at = (s: BrushStroke, p: [number, number, number]) => strokeSignedDist(p[0], p[1], p[2], s);

describe('strokeSignedDist', () => {
  test('legacy circle: signed distance to a sphere of radius r', () => {
    const s: BrushStroke = { samples: [[0, 0, 0]], radius: 2, shape: 'circle', maxEdge: 0.1 };
    expect(at(s, [0, 0, 0])).toBeCloseTo(-2);   // centre, r inside
    expect(at(s, [2, 0, 0])).toBeCloseTo(0);     // on the boundary
    expect(at(s, [3, 0, 0])).toBeCloseTo(1);     // outside
  });

  test('legacy square: Chebyshev box, corners are inside (not clipped to a sphere)', () => {
    const s: BrushStroke = { samples: [[0, 0, 0]], radius: 2, shape: 'square', maxEdge: 0.1 };
    expect(at(s, [1.9, 1.9, 0])).toBeLessThan(0);   // near a corner — inside the box
    expect(at(s, [2.1, 0, 0])).toBeGreaterThan(0);  // just past a face — outside
  });

  test('legacy diamond: L1 ball', () => {
    const s: BrushStroke = { samples: [[0, 0, 0]], radius: 2, shape: 'diamond', maxEdge: 0.1 };
    expect(at(s, [1, 0.9, 0])).toBeLessThan(0);     // |1|+|0.9| = 1.9 < 2 → inside
    expect(at(s, [1.2, 1.2, 0])).toBeGreaterThan(0); // 2.4 > 2 → outside
  });

  test('slab circle: cylinder — gated by depth along the normal', () => {
    const s: BrushStroke = {
      samples: [[0, 0, 0]], radius: 2, shape: 'circle', maxEdge: 0.1,
      surface: 'slab', depth: 1, sampleNormals: [[0, 0, 1]],
    };
    expect(at(s, [1, 0, 0])).toBeLessThan(0);    // on the surface, within radius
    expect(at(s, [0, 0, 0.5])).toBeLessThan(0);  // within depth through the wall
    expect(at(s, [0, 0, 1.5])).toBeGreaterThan(0); // beyond depth → outside the slab
    expect(at(s, [2.5, 0, 0])).toBeGreaterThan(0); // beyond radius → outside laterally
  });

  test('union over samples takes the nearest footprint', () => {
    const s: BrushStroke = { samples: [[0, 0, 0], [10, 0, 0]], radius: 2, shape: 'circle', maxEdge: 0.1 };
    expect(at(s, [10, 0, 0])).toBeCloseTo(-2);   // inside the second sample
    expect(at(s, [5, 0, 0])).toBeGreaterThan(0); // between, outside both
  });
});

describe('airbrush spray coverage', () => {
  // sd = signed distance to the footprint edge (≤0 inside). For a radius-10
  // circle, sd = d - 10 where d is the distance from the centre.
  const stroke = (spray: Partial<{ strength: number; softness: number }> = {}): BrushStroke =>
    ({ samples: [[0, 0, 0]], radius: 10, shape: 'circle', maxEdge: 0.5, spray: { strength: 1, softness: 0.5, seed: 1, ...spray } });

  test('coverage: full in the core, fades across the feather, zero at/past the edge', () => {
    const s = stroke(); // featherWidth = 5 (softness 0.5)
    expect(sprayCoverage(-10, s)).toBeCloseTo(1);  // centre (depth 10)
    expect(sprayCoverage(-5, s)).toBeCloseTo(1);   // core boundary (depth = featherWidth)
    expect(sprayCoverage(-2.5, s)).toBeCloseTo(0.5); // mid-feather
    expect(sprayCoverage(0, s)).toBe(0);           // edge
    expect(sprayCoverage(1, s)).toBe(0);           // outside
  });

  test('strength scales coverage; lower softness widens the solid core', () => {
    expect(sprayCoverage(-10, stroke({ strength: 0.4 }))).toBeCloseTo(0.4);
    // depth 2 inside: softness 0.1 → featherWidth 1 (solid); softness 0.9 → featherWidth 9 (deep feather)
    expect(sprayCoverage(-2, stroke({ softness: 0.1 }))).toBeCloseTo(1);
    expect(sprayCoverage(-2, stroke({ softness: 0.9 }))).toBeLessThan(0.5);
  });

  test('dither is deterministic and ~uniform in [0,1)', () => {
    expect(airbrushDither(1.23, 4.56, 7.89, 1)).toBe(airbrushDither(1.23, 4.56, 7.89, 1)); // stable
    expect(airbrushDither(1.23, 4.56, 7.89, 1)).not.toBe(airbrushDither(1.23, 4.56, 7.89, 2)); // seed matters
    let sum = 0; const N = 4000;
    for (let i = 0; i < N; i++) { const v = airbrushDither(i * 0.013, i * 0.029, 0, 7); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); sum += v; }
    expect(sum / N).toBeGreaterThan(0.45); // mean ≈ 0.5 (well-distributed)
    expect(sum / N).toBeLessThan(0.55);
  });

  test('coverage is monotonic in strength (the dither superset → non-flaky tests)', () => {
    const lo = stroke({ strength: 0.5 }), hi = stroke({ strength: 0.9 });
    for (const sd of [-10, -6, -3, -1]) expect(sprayCoverage(sd, hi)).toBeGreaterThanOrEqual(sprayCoverage(sd, lo));
  });
});
