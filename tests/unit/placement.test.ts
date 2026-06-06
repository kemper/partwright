import { describe, it, expect } from 'vitest';
import type { MeshData } from '../../src/geometry/types';
import {
  translateMesh,
  computePlacementDelta,
  isNoopDelta,
  buildPlacementCode,
  placementLabel,
  type PlacementBox,
} from '../../src/surface/placement';

/** Axis-aligned cube spanning [min, min+s]^3 as an 8-vertex MeshData. */
function cube(min: [number, number, number] = [0, 0, 0], s = 10): MeshData {
  const [ox, oy, oz] = min;
  const vertProperties = new Float32Array([
    ox, oy, oz, ox + s, oy, oz, ox + s, oy + s, oz, ox, oy + s, oz,
    ox, oy, oz + s, ox + s, oy, oz + s, ox + s, oy + s, oz + s, ox, oy + s, oz + s,
  ]);
  const triVerts = new Uint32Array([0, 2, 1, 4, 5, 6]);
  return { vertProperties, triVerts, numVert: 8, numTri: 2, numProp: 3 };
}

describe('computePlacementDelta', () => {
  const box: PlacementBox = { min: [4, -6, 12], max: [14, 4, 22] };

  it('drops the floor to Z=0 without touching XY', () => {
    expect(computePlacementDelta(box, { dropToFloor: true })).toEqual([0, 0, -12]);
  });

  it('centers XY without touching Z', () => {
    // center is (9, -1, 17)
    expect(computePlacementDelta(box, { centerX: true, centerY: true })).toEqual([-9, 1, 0]);
  });

  it('dropToFloor wins over centerZ on the Z axis', () => {
    expect(computePlacementDelta(box, { dropToFloor: true, centerZ: true })).toEqual([0, 0, -12]);
  });

  it('centerZ centers Z when dropToFloor is off', () => {
    expect(computePlacementDelta(box, { centerZ: true })).toEqual([0, 0, -17]);
  });

  it('returns zero when no ops requested', () => {
    expect(computePlacementDelta(box, {})).toEqual([0, 0, 0]);
  });
});

describe('isNoopDelta', () => {
  const box: PlacementBox = { min: [0, 0, 0], max: [10, 10, 10] };

  it('is true for an already-grounded model', () => {
    expect(isNoopDelta([0, 0, 0], box)).toBe(true);
  });

  it('is true for sub-epsilon jitter relative to size', () => {
    expect(isNoopDelta([0, 0, 1e-8], box)).toBe(true);
  });

  it('is false for a real move', () => {
    expect(isNoopDelta([0, 0, -5], box)).toBe(false);
  });
});

describe('translateMesh', () => {
  it('shifts every vertex and leaves topology intact', () => {
    const out = translateMesh(cube([0, 0, 5]), 0, 0, -5);
    // Min-Z vertex (index 0) moves from z=5 to z=0.
    expect(out.vertProperties[2]).toBeCloseTo(0, 6);
    // Top vertex (index 4) moves from z=15 to z=10.
    expect(out.vertProperties[4 * 3 + 2]).toBeCloseTo(10, 6);
    expect(Array.from(out.triVerts)).toEqual([0, 2, 1, 4, 5, 6]);
    expect(out.numVert).toBe(8);
  });

  it('does not mutate the source mesh', () => {
    const src = cube([0, 0, 0]);
    const before = src.vertProperties[0];
    translateMesh(src, 100, 0, 0);
    expect(src.vertProperties[0]).toBe(before);
  });
});

describe('buildPlacementCode', () => {
  const code = 'const { Manifold } = api;\nreturn Manifold.cube([10, 10, 10]).translate([0, 0, 20]);';

  it('wraps the source in an IIFE and appends a translate', () => {
    const out = buildPlacementCode(code, [0, 0, -20], 'drop to floor', '2026-06-06');
    expect(out).toContain('@partwright-placement');
    expect(out).toContain('return (() => {');
    expect(out).toContain(code);
    expect(out).toContain('})().translate([0, 0, -20]);');
  });

  it('preserves user code verbatim (no re-indentation of template literals)', () => {
    const withTemplate = 'const s = `a\n  b`;\nreturn Manifold.cube([1, 1, 1]);';
    const out = buildPlacementCode(withTemplate, [1, 0, 0], 'center X', '2026-06-06');
    expect(out).toContain('const s = `a\n  b`;');
  });

  it('folds a second placement into one wrapper instead of nesting', () => {
    const first = buildPlacementCode(code, [0, 0, -20], 'drop to floor', '2026-06-06');
    const second = buildPlacementCode(first, [-5, -5, 0], 'center XY', '2026-06-06');
    // Only one wrapper, with summed deltas.
    expect(second.match(/return \(\(\) => \{/g)?.length).toBe(1);
    expect(second).toContain('})().translate([-5, -5, -20]);');
    expect(second).toContain(code);
  });

  it('returns the inner code unwrapped when a fold cancels the move out', () => {
    const first = buildPlacementCode(code, [0, 0, -20], 'drop to floor', '2026-06-06');
    const undo = buildPlacementCode(first, [0, 0, 20], 'lift', '2026-06-06');
    expect(undo).not.toContain('@partwright-placement');
    expect(undo.trim()).toBe(code.trim());
  });
});

describe('placementLabel', () => {
  it('describes combined ops', () => {
    expect(placementLabel({ dropToFloor: true, centerX: true, centerY: true })).toBe('drop to floor + center XY');
    expect(placementLabel({ centerZ: true })).toBe('center Z');
    // dropToFloor owns Z, so a co-requested centerZ is dropped from the label
    // (matching computePlacementDelta, which ignores it).
    expect(placementLabel({ dropToFloor: true, centerZ: true })).toBe('drop to floor');
    expect(placementLabel({})).toBe('placed');
  });
});
