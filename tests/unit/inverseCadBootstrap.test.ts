// Unit tests for the inverse-CAD bootstrap band-merging logic: sliver
// absorption, the max-bands budget, and full-extent no-gap coverage.
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain .mjs module without type declarations
import { mergeBands } from '../../scripts/inverse-cad/bootstrap.mjs';

interface Band {
  from: number;
  to: number;
  thickness: number;
  medianArea: number;
  stable: boolean;
  bestFit: string;
}

function band(from: number, to: number, medianArea: number, stable: boolean, bestFit = 'freeform'): Band {
  return { from, to, thickness: to - from, medianArea, stable, bestFit };
}

// Every consecutive pair's `to`/`from` must line up and the first/last edges
// must match the original extent — i.e. no gaps and no lost coverage.
function assertContiguous(bands: Band[], expectedFrom: number, expectedTo: number) {
  expect(bands.length).toBeGreaterThan(0);
  expect(bands[0].from).toBeCloseTo(expectedFrom, 9);
  expect(bands[bands.length - 1].to).toBeCloseTo(expectedTo, 9);
  for (let i = 0; i < bands.length - 1; i++) {
    expect(bands[i].to).toBeCloseTo(bands[i + 1].from, 9);
  }
}

describe('inverse-cad/bootstrap mergeBands', () => {
  it('absorbs a thin unstable sliver into its larger neighbor', () => {
    const bands = [
      band(0, 5, 10, true, 'circle'),
      band(5, 5.2, 10.5, false), // thickness 0.2 < 3*step(0.25)=0.75, unstable -> sliver
      band(5.2, 10, 11, true, 'circle'),
    ];
    const merged = mergeBands(bands, { step: 0.25, maxBands: 12 });
    expect(merged.length).toBe(2);
    assertContiguous(merged, 0, 10);
    // The sliver merged into band 0 (thicker neighbor: 5 vs 4.8), so the
    // first merged band now spans [0, 5.2].
    expect(merged[0].from).toBeCloseTo(0, 9);
    expect(merged[0].to).toBeCloseTo(5.2, 9);
    expect(merged[1].from).toBeCloseTo(5.2, 9);
    expect(merged[1].to).toBeCloseTo(10, 9);
  });

  it('does not merge a thin band that is stable (not a sliver)', () => {
    const bands = [
      band(0, 5, 10, true),
      band(5, 5.2, 10.5, true), // thin but STABLE — not a sliver, must survive
      band(5.2, 10, 11, true),
    ];
    const merged = mergeBands(bands, { step: 0.25, maxBands: 12 });
    expect(merged.length).toBe(3);
    assertContiguous(merged, 0, 10);
  });

  it('merges multiple adjacent slivers in one pass, absorbing into the largest available neighbor', () => {
    const bands = [
      band(0, 8, 10, true, 'circle'),
      band(8, 8.2, 10.4, false), // sliver
      band(8.2, 8.35, 10.6, false), // sliver
      band(8.35, 8.5, 10.7, false), // sliver
      band(8.5, 12, 12, true, 'circle'),
    ];
    const merged = mergeBands(bands, { step: 0.25, maxBands: 12 });
    // All the interior slivers get folded into one of the two stable ends.
    expect(merged.length).toBe(2);
    assertContiguous(merged, 0, 12);
  });

  it('honors the maxBands budget by merging the most-similar adjacent pair', () => {
    const bands: Band[] = [];
    for (let i = 0; i < 20; i++) {
      // Distinct medianArea per band so there's always a clear "closest pair".
      bands.push(band(i, i + 1, 10 + i * 0.7, true, 'freeform'));
    }
    const merged = mergeBands(bands, { step: 0.25, maxBands: 5 });
    expect(merged.length).toBeLessThanOrEqual(5);
    assertContiguous(merged, 0, 20);
  });

  it('merges the closest-medianArea adjacent pair first when over budget', () => {
    // Bands 1 and 2 have nearly identical medianArea (10.0 vs 10.05) — the
    // closest pair in the list — so they should merge before any other pair.
    const bands = [
      band(0, 1, 5, true),
      band(1, 2, 10.0, true),
      band(2, 3, 10.05, true),
      band(3, 4, 40, true),
    ];
    const merged = mergeBands(bands, { step: 0.25, maxBands: 3 });
    expect(merged.length).toBe(3);
    assertContiguous(merged, 0, 4);
    // The merged band covering [1,3] should be present (bands 1+2 combined).
    const combined = merged.find((b: Band) => b.from === 1 && b.to === 3);
    expect(combined).toBeTruthy();
  });

  it('covers the full extent with no gaps after both phases run together', () => {
    const bands: Band[] = [];
    let cursor = -3.5;
    for (let i = 0; i < 30; i++) {
      const thickness = i % 4 === 0 ? 0.1 : 1; // sprinkle in slivers
      const stable = i % 4 !== 0; // the thin ones are unstable
      bands.push(band(cursor, cursor + thickness, 5 + Math.sin(i) * 2, stable));
      cursor += thickness;
    }
    const merged = mergeBands(bands, { step: 0.25, maxBands: 8 });
    expect(merged.length).toBeLessThanOrEqual(8);
    assertContiguous(merged, -3.5, cursor);
  });

  it('returns an empty array for an empty input', () => {
    expect(mergeBands([], { step: 0.25, maxBands: 12 })).toEqual([]);
  });

  it('leaves a single band untouched', () => {
    const merged = mergeBands([band(0, 3, 10, true)], { step: 0.25, maxBands: 12 });
    expect(merged.length).toBe(1);
    expect(merged[0].from).toBe(0);
    expect(merged[0].to).toBe(3);
  });
});
