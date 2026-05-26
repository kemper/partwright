// Unit tests for the pure edge-overlay default resolution. No THREE / WebGL
// import here (edgeMode.ts is dependency-free), so it stays in the fast unit
// tier; the actual rendering is exercised by the e2e browser suite.

import { describe, test, expect } from 'vitest';
import { resolveEdgeMode, EDGE_MODES, CREASE_ANGLE_DEG } from '../../src/renderer/edgeMode';

describe('resolveEdgeMode', () => {
  test('uncolored meshes default to crease edges', () => {
    expect(resolveEdgeMode(undefined, false)).toBe('crease');
  });

  test('painted meshes default to none (overlay would mask paint)', () => {
    expect(resolveEdgeMode(undefined, true)).toBe('none');
  });

  test('an explicit mode always wins, regardless of color', () => {
    for (const mode of EDGE_MODES) {
      expect(resolveEdgeMode(mode, false)).toBe(mode);
      expect(resolveEdgeMode(mode, true)).toBe(mode);
    }
  });

  test('crease threshold is a sane dihedral angle', () => {
    expect(CREASE_ANGLE_DEG).toBeGreaterThan(0);
    expect(CREASE_ANGLE_DEG).toBeLessThan(90);
  });
});
