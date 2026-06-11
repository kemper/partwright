import { describe, it, expect } from 'vitest';
import {
  edgeStats,
  aspectRatioOf,
  buildGeometryHeuristicWarnings,
  type GeometryHeuristicThresholds,
} from '../../src/geometry/geometryHeuristics';

const THRESHOLDS: GeometryHeuristicThresholds = {
  triCountWarnBudget: 200_000,
  minEdgeLengthWarn: 0.4,
  aspectRatioWarn: 12,
};

describe('edgeStats', () => {
  it('measures min and mean edge length of a single triangle (stride 3)', () => {
    // Right triangle: legs 3 and 4, hypotenuse 5.
    const verts = [0, 0, 0,  3, 0, 0,  0, 4, 0];
    const tris = [0, 1, 2];
    const { min, mean } = edgeStats(verts, 3, tris, 1);
    expect(min).toBe(3);
    expect(mean).toBeCloseTo((3 + 5 + 4) / 3, 4);
  });

  it('honors an interleaved stride (xyz + extra props)', () => {
    // stride 6 (xyz + rgb); geometry identical to the stride-3 case.
    const verts = [0, 0, 0, 9, 9, 9,  3, 0, 0, 9, 9, 9,  0, 4, 0, 9, 9, 9];
    const { min } = edgeStats(verts, 6, [0, 1, 2], 1);
    expect(min).toBe(3);
  });

  it('returns zeros for an empty mesh', () => {
    expect(edgeStats([], 3, [], 0)).toEqual({ min: 0, mean: 0 });
  });
});

describe('aspectRatioOf', () => {
  it('is longest ÷ shortest non-zero dimension', () => {
    expect(aspectRatioOf([10, 2, 1])).toBe(10);
  });
  it('ignores zero-thickness axes', () => {
    expect(aspectRatioOf([20, 0, 4])).toBe(5);
  });
  it('returns null when nothing is positive', () => {
    expect(aspectRatioOf([0, 0, 0])).toBeNull();
    expect(aspectRatioOf(null)).toBeNull();
  });
});

describe('buildGeometryHeuristicWarnings', () => {
  const base = {
    triangleCount: 1000,
    aspectRatio: 2,
    minEdgeLength: 1,
    floatingComponentCount: 1,
    componentsInterpenetrate: false,
  };

  it('is silent for a healthy single solid', () => {
    expect(buildGeometryHeuristicWarnings(base, THRESHOLDS)).toEqual([]);
  });

  it('warns over the triangle budget', () => {
    const w = buildGeometryHeuristicWarnings({ ...base, triangleCount: 250_000 }, THRESHOLDS);
    expect(w.some(s => /triangle count/i.test(s))).toBe(true);
  });

  it('warns on an extreme aspect ratio', () => {
    const w = buildGeometryHeuristicWarnings({ ...base, aspectRatio: 30 }, THRESHOLDS);
    expect(w.some(s => /aspect ratio/i.test(s))).toBe(true);
  });

  it('warns on sub-extrusion detail', () => {
    const w = buildGeometryHeuristicWarnings({ ...base, minEdgeLength: 0.1 }, THRESHOLDS);
    expect(w.some(s => /smallest mesh edge/i.test(s))).toBe(true);
  });

  it('does not warn on a zero (unmeasured) min edge', () => {
    const w = buildGeometryHeuristicWarnings({ ...base, minEdgeLength: 0 }, THRESHOLDS);
    expect(w.some(s => /smallest mesh edge/i.test(s))).toBe(false);
  });

  it('warns on interpenetration only with ≥2 floating parts', () => {
    expect(buildGeometryHeuristicWarnings(
      { ...base, floatingComponentCount: 1, componentsInterpenetrate: true }, THRESHOLDS,
    )).toEqual([]);
    const w = buildGeometryHeuristicWarnings(
      { ...base, floatingComponentCount: 2, componentsInterpenetrate: true }, THRESHOLDS,
    );
    expect(w.some(s => /overlapping bounding boxes/i.test(s))).toBe(true);
  });
});
