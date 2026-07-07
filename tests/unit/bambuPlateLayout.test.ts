import { describe, test, expect } from 'vitest';
import { assignBambuPlates, isBambuPlateLayout, BAMBU_PLATE_LAYOUTS } from '../../src/export/threemfProject';

// Pure plate-distribution logic for the Bambu multi-part export. `assignBambuPlates`
// turns a per-part group list + a layout mode into a list of plates (each a list of
// part indices). This is what decides whether 30 parts land on 30 plates, one plate,
// or one-plate-per-group — so it's worth pinning here in the fast unit tier.

describe('assignBambuPlates', () => {
  const groups = ['A', 'A', undefined, 'B', 'B', 'B'];

  test("'separate' → one part per plate (the default behaviour)", () => {
    expect(assignBambuPlates(groups, 'separate')).toEqual([[0], [1], [2], [3], [4], [5]]);
  });

  test("'grid' → every part on a single plate", () => {
    expect(assignBambuPlates(groups, 'grid')).toEqual([[0, 1, 2, 3, 4, 5]]);
  });

  test("'group' → one plate per group; ungrouped parts each get their own plate", () => {
    // Group A (indices 0,1) on one plate, the ungrouped index 2 alone, group B
    // (3,4,5) on one plate — in first-appearance order.
    expect(assignBambuPlates(groups, 'group')).toEqual([[0, 1], [2], [3, 4, 5]]);
  });

  test("'group' pulls non-contiguous members of the same group onto one plate", () => {
    // A appears, then B, then A again → A collects both its members on its first
    // plate; the file never splits one group across two plates.
    const g = ['A', 'B', 'A'];
    expect(assignBambuPlates(g, 'group')).toEqual([[0, 2], [1]]);
  });

  test("'group' with no groups degrades to one part per plate (like 'separate')", () => {
    const g = [undefined, undefined, undefined];
    expect(assignBambuPlates(g, 'group')).toEqual([[0], [1], [2]]);
  });

  test('trims whitespace-only group names to ungrouped', () => {
    const g = ['  ', 'A', 'A'];
    expect(assignBambuPlates(g, 'group')).toEqual([[0], [1, 2]]);
  });

  test('empty input yields no plates in every mode', () => {
    for (const layout of BAMBU_PLATE_LAYOUTS) expect(assignBambuPlates([], layout)).toEqual([]);
  });

  test('isBambuPlateLayout validates the mode strings', () => {
    expect(isBambuPlateLayout('separate')).toBe(true);
    expect(isBambuPlateLayout('grid')).toBe(true);
    expect(isBambuPlateLayout('group')).toBe(true);
    expect(isBambuPlateLayout('nope')).toBe(false);
    expect(isBambuPlateLayout('')).toBe(false);
  });
});
