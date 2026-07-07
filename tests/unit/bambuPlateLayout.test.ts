import { describe, test, expect } from 'vitest';
import { assignBambuPlates, packPlates, isBambuPlateLayout, BAMBU_PLATE_LAYOUTS, isPackStrategy, PACK_STRATEGIES } from '../../src/export/threemfProject';

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

// Shelf bin-packing: the fix for "one large part balloons the grid off the plate".
// packPlates must use ACTUAL per-part footprints, stay within the bed, and spill to
// extra plates when a bin overflows — never spread parts off a single plate.
describe('packPlates', () => {
  // Uniform footprint helper: every part is w×d mm.
  const uniform = (w: number, d: number) => (_k: number) => ({ w, d });
  // Per-part footprint from a table keyed by index.
  const table = (sizes: { w: number; d: number }[]) => (k: number) => sizes[k];

  test('a single part is centred on the bed (matches the one-per-plate default)', () => {
    const plates = packPlates([0], uniform(40, 30), 200, 200, 10);
    expect(plates).toHaveLength(1);
    expect(plates[0].members).toEqual([0]);
    expect(plates[0].centers[0]).toEqual({ cx: 100, cy: 100 });
  });

  test('small parts pack onto ONE plate, spread across shelves (distinct positions)', () => {
    // 6 parts of 40×40 on a 200×200 bed with gap 10 → 4 per shelf (40+10=50, ×4=200),
    // so all 6 fit on a single plate. No two parts share a centre.
    const plates = packPlates([0, 1, 2, 3, 4, 5], uniform(40, 40), 200, 200, 10);
    expect(plates).toHaveLength(1);
    expect(plates[0].members).toHaveLength(6);
    const keys = new Set(plates[0].centers.map(c => `${c.cx.toFixed(1)},${c.cy.toFixed(1)}`));
    expect(keys.size).toBe(6);
  });

  test('overflowing parts spill onto additional plates instead of off the bed', () => {
    // 8 parts of 90×90 on a 200×200 bed: 2 per shelf, 2 shelves per plate = 4 per
    // plate → 2 plates. Every part centre stays within [0,200]×[0,200].
    const plates = packPlates(Array.from({ length: 8 }, (_, i) => i), uniform(90, 90), 200, 200, 10);
    expect(plates.length).toBeGreaterThan(1);
    const total = plates.reduce((n, p) => n + p.members.length, 0);
    expect(total).toBe(8);
    for (const p of plates) {
      for (const c of p.centers) {
        expect(c.cx).toBeGreaterThanOrEqual(0); expect(c.cx).toBeLessThanOrEqual(200);
        expect(c.cy).toBeGreaterThanOrEqual(0); expect(c.cy).toBeLessThanOrEqual(200);
      }
    }
  });

  test('one oversized part is placed alone rather than dropped or looped', () => {
    const plates = packPlates([0, 1], table([{ w: 500, d: 500 }, { w: 20, d: 20 }]), 200, 200, 10);
    // The 500×500 part can't fit but is still placed (on its own plate); the small
    // part packs onto a plate too. Both parts survive across the plates.
    const all = plates.flatMap(p => p.members).sort();
    expect(all).toEqual([0, 1]);
  });

  test('a big part no longer inflates the pitch of its neighbours (the reported bug)', () => {
    // One 150-deep part + several tiny parts. The old uniform-max-pitch grid spaced
    // EVERY cell by ~150 (→ off a 200 bed); shelf packing keeps the tiny parts tight,
    // so they share the bed with the big one on a single plate.
    const sizes = [{ w: 150, d: 150 }, { w: 15, d: 15 }, { w: 15, d: 15 }, { w: 15, d: 15 }];
    const plates = packPlates([0, 1, 2, 3], table(sizes), 200, 200, 10);
    expect(plates).toHaveLength(1);
    for (const c of plates[0].centers) {
      expect(c.cx).toBeLessThanOrEqual(200);
      expect(c.cy).toBeLessThanOrEqual(200);
    }
  });

  test('empty bin yields no plates', () => {
    expect(packPlates([], uniform(10, 10), 200, 200, 10)).toEqual([]);
  });

  // The packing strategy shapes how parts sharing a plate are arranged. Four equal
  // 40×40 parts on a 200×200 bed exercise all three: 'grid' clusters into a compact
  // square (2×2), 'horizontal' fills one full-width row, 'vertical' fills one
  // full-depth column. Distinct-X / distinct-Y counts pin each shape.
  describe('packStrategy', () => {
    const four = [0, 1, 2, 3];
    const distinct = (vals: number[]) => new Set(vals.map(v => v.toFixed(3))).size;

    test("'grid' (default) clusters into a compact centred square (2 cols × 2 rows)", () => {
      const [plate] = packPlates(four, uniform(40, 40), 200, 200, 10); // default strategy
      expect(plate.members).toHaveLength(4);
      expect(distinct(plate.centers.map(c => c.cx))).toBe(2);
      expect(distinct(plate.centers.map(c => c.cy))).toBe(2);
      // Centred: the used 90×90 block (2·40 + 10 gap) sits in the middle of the bed.
      const cxs = plate.centers.map(c => c.cx);
      expect(Math.min(...cxs)).toBeGreaterThan(40);
      expect(Math.max(...cxs)).toBeLessThan(160);
    });

    test("'horizontal' fills one full-width row (4 distinct X, 1 Y)", () => {
      const [plate] = packPlates(four, uniform(40, 40), 200, 200, 10, 'horizontal');
      expect(plate.members).toHaveLength(4);
      expect(distinct(plate.centers.map(c => c.cx))).toBe(4);
      expect(distinct(plate.centers.map(c => c.cy))).toBe(1);
    });

    test("'vertical' fills one full-depth column (1 X, 4 distinct Y)", () => {
      const [plate] = packPlates(four, uniform(40, 40), 200, 200, 10, 'vertical');
      expect(plate.members).toHaveLength(4);
      expect(distinct(plate.centers.map(c => c.cx))).toBe(1);
      expect(distinct(plate.centers.map(c => c.cy))).toBe(4);
    });

    test('every strategy keeps all parts on the bed and loses none', () => {
      for (const strategy of PACK_STRATEGIES) {
        const plates = packPlates(four, uniform(40, 40), 200, 200, 10, strategy);
        const all = plates.flatMap(p => p.members).sort();
        expect(all).toEqual([0, 1, 2, 3]);
        for (const p of plates) for (const c of p.centers) {
          expect(c.cx).toBeGreaterThanOrEqual(0); expect(c.cx).toBeLessThanOrEqual(200);
          expect(c.cy).toBeGreaterThanOrEqual(0); expect(c.cy).toBeLessThanOrEqual(200);
        }
      }
    });

    test('isPackStrategy validates the strategy strings', () => {
      expect(isPackStrategy('grid')).toBe(true);
      expect(isPackStrategy('horizontal')).toBe(true);
      expect(isPackStrategy('vertical')).toBe(true);
      expect(isPackStrategy('nope')).toBe(false);
      expect(isPackStrategy('')).toBe(false);
    });
  });
});
