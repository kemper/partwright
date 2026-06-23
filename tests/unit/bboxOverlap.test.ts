import { describe, it, expect } from 'vitest';
import { componentsOverlap } from '../../src/tools/bboxOverlap';

const box = (min: number[], max: number[]) => ({ bbox: { min, max } });

describe('componentsOverlap', () => {
  it('is false for fewer than two components', () => {
    expect(componentsOverlap([])).toBe(false);
    expect(componentsOverlap([box([0, 0, 0], [1, 1, 1])])).toBe(false);
  });

  it('is false for spatially disjoint components', () => {
    // two boxes separated along X
    expect(componentsOverlap([box([-10, -1, -1], [-2, 1, 1]), box([2, -1, -1], [10, 1, 1])])).toBe(false);
  });

  it('is true for a nested component (captive part)', () => {
    expect(componentsOverlap([box([-10, -10, -10], [10, 10, 10]), box([-2, -2, -2], [2, 2, 2])])).toBe(true);
  });

  it('is true for partially overlapping boxes', () => {
    expect(componentsOverlap([box([0, 0, 0], [5, 5, 5]), box([4, 4, 4], [9, 9, 9])])).toBe(true);
  });

  it('treats face-touching boxes (shared boundary) as overlapping', () => {
    expect(componentsOverlap([box([0, 0, 0], [2, 2, 2]), box([2, 0, 0], [4, 2, 2])])).toBe(true);
  });

  it('finds an overlapping pair anywhere in the set, not just the first two', () => {
    expect(componentsOverlap([
      box([-20, 0, 0], [-18, 1, 1]),
      box([0, 0, 0], [2, 2, 2]),
      box([1, 1, 1], [3, 3, 3]), // overlaps the second
    ])).toBe(true);
  });

  it('skips components without a 3-D bbox', () => {
    expect(componentsOverlap([box([], []), box([0, 0, 0], [1, 1, 1])])).toBe(false);
  });
});
