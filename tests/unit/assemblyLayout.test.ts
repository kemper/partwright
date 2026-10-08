import { describe, it, expect } from 'vitest';
import { computeAssemblyGrid, gridColumns, type PartFootprint } from '../../src/assembly/layout';

describe('gridColumns', () => {
  it('is a near-square grid (ceil sqrt)', () => {
    expect(gridColumns(0)).toBe(0);
    expect(gridColumns(1)).toBe(1);
    expect(gridColumns(2)).toBe(2);
    expect(gridColumns(4)).toBe(2);
    expect(gridColumns(5)).toBe(3);
    expect(gridColumns(9)).toBe(3);
    expect(gridColumns(10)).toBe(4);
  });
});

describe('computeAssemblyGrid', () => {
  it('returns an empty layout for no parts', () => {
    const g = computeAssemblyGrid([]);
    expect(g.cells.size).toBe(0);
    expect(g.cols).toBe(0);
    expect(g.rows).toBe(0);
  });

  it('places a single part at the origin', () => {
    const g = computeAssemblyGrid([{ id: 'a', width: 10, depth: 10 }]);
    expect(g.cols).toBe(1);
    expect(g.rows).toBe(1);
    expect(g.cells.get('a')).toEqual({ x: 0, y: 0 });
  });

  it('uses a uniform pitch = largest footprint + gutter', () => {
    const parts: PartFootprint[] = [
      { id: 'a', width: 20, depth: 4 },
      { id: 'b', width: 4, depth: 4 },
    ];
    const g = computeAssemblyGrid(parts, 0.25);
    // largest dim is 20 → pitch 20 * 1.25 = 25
    expect(g.pitchX).toBe(25);
    expect(g.pitchY).toBe(25);
  });

  it('centres a 2x2 grid on the origin in row-major order', () => {
    const parts: PartFootprint[] = [
      { id: 'a', width: 10, depth: 10 },
      { id: 'b', width: 10, depth: 10 },
      { id: 'c', width: 10, depth: 10 },
      { id: 'd', width: 10, depth: 10 },
    ];
    const g = computeAssemblyGrid(parts, 0); // pitch = 10, no gutter
    expect(g.cols).toBe(2);
    expect(g.rows).toBe(2);
    // Row 0 at +Y (back), col 0 at -X (left).
    expect(g.cells.get('a')).toEqual({ x: -5, y: 5 });
    expect(g.cells.get('b')).toEqual({ x: 5, y: 5 });
    expect(g.cells.get('c')).toEqual({ x: -5, y: -5 });
    expect(g.cells.get('d')).toEqual({ x: 5, y: -5 });
  });

  it('never overlaps: cell spacing ≥ largest footprint', () => {
    const parts: PartFootprint[] = [
      { id: 'a', width: 30, depth: 8 },
      { id: 'b', width: 6, depth: 6 },
      { id: 'c', width: 12, depth: 20 },
    ];
    const g = computeAssemblyGrid(parts, 0.1);
    const maxDim = 30;
    expect(g.pitchX).toBeGreaterThanOrEqual(maxDim);
    expect(g.pitchY).toBeGreaterThanOrEqual(maxDim);
  });

  it('honours minPitch when footprints are zero (parts still building)', () => {
    const parts: PartFootprint[] = [
      { id: 'a', width: 0, depth: 0 },
      { id: 'b', width: 0, depth: 0 },
    ];
    const g = computeAssemblyGrid(parts, 0, 5);
    expect(g.pitchX).toBe(5);
    expect(g.cells.get('a')!.x).not.toBe(g.cells.get('b')!.x);
  });
});
