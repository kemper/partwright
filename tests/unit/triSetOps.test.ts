import { describe, expect, it } from 'vitest';
import {
  absorbSmallRegions, adjacencyFromNeighborLists, adjacencyFromPairs, despeckleMask, growMask,
  majorityFilter, maskComponents, maskFromIndices, maskToIndices, partitionRegions, shrinkMask,
  subtractMask, unionMask, intersectMask,
} from '../../src/geometry/triSetOps';

// A path graph 0—1—2—…—9 stands in for a strip of triangles.
const N = 10;
const pathAdj = adjacencyFromPairs(N, [0, 1, 2, 3, 4, 5, 6, 7, 8], [1, 2, 3, 4, 5, 6, 7, 8, 9]);

describe('triSetOps masks', () => {
  it('grow / shrink / boolean ops', () => {
    const m = maskFromIndices(N, [4, 5]);
    expect(maskToIndices(growMask(m, pathAdj, 2))).toEqual([2, 3, 4, 5, 6, 7]);
    expect(maskToIndices(shrinkMask(growMask(m, pathAdj, 2), pathAdj, 1))).toEqual([3, 4, 5, 6]);
    const a = maskFromIndices(N, [1, 2, 3]), b = maskFromIndices(N, [3, 4]);
    expect(maskToIndices(unionMask(a, b))).toEqual([1, 2, 3, 4]);
    expect(maskToIndices(subtractMask(a, b))).toEqual([1, 2]);
    expect(maskToIndices(intersectMask(a, b))).toEqual([3]);
  });

  it('components and despeckle', () => {
    const m = maskFromIndices(N, [0, 1, 2, 3, 5, 7, 8, 9]);
    expect(maskComponents(m, pathAdj).count).toBe(3);
    // Island {5} dropped; hole {4} and {6} filled once the island is gone? No —
    // holes are filled only when enclosed by members; {4} sits between 3 and 5.
    const d = despeckleMask(m, pathAdj, { minIsland: 2, maxHole: 2 });
    expect(maskToIndices(d)).toEqual([0, 1, 2, 3, 7, 8, 9]);
    const filled = despeckleMask(maskFromIndices(N, [0, 1, 2, 4, 5]), pathAdj, { maxHole: 2 });
    expect(maskToIndices(filled)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('adapts neighbour lists', () => {
    const adj = adjacencyFromNeighborLists([[1], [0, 2], [1]]);
    expect([...adj.start]).toEqual([0, 1, 3, 4]);
    expect([...adj.nbr]).toEqual([1, 0, 2, 1]);
  });
});

describe('triSetOps partitions', () => {
  it('absorbs a small island into its host', () => {
    const p = Int32Array.from([0, 0, 0, 0, 1, 0, 0, 2, 2, 2]);
    const n = absorbSmallRegions(p, pathAdj, new Float32Array(N).fill(1), 2);
    expect(n).toBe(1);
    expect([...p]).toEqual([0, 0, 0, 0, 0, 0, 0, 2, 2, 2]);
    expect(partitionRegions(p, pathAdj).count).toBe(2);
  });

  it('absorbs unassigned gaps but never targets them', () => {
    const p = Int32Array.from([0, 0, 0, -1, 1, 1, 1, 1, 1, 1]);
    absorbSmallRegions(p, pathAdj, new Float32Array(N).fill(1), 2);
    expect(p.includes(-1)).toBe(false);
  });

  it('majority filter flips a lone triangle with both neighbours elsewhere', () => {
    const p = Int32Array.from([0, 0, 0, 1, 0, 0, 1, 1, 1, 1]);
    majorityFilter(p, pathAdj, 3);
    expect([...p]).toEqual([0, 0, 0, 0, 0, 0, 1, 1, 1, 1]);
  });
});
