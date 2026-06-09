import { describe, it, expect } from 'vitest';
import { createGeom2dNamespace } from '../../src/geometry/geom2d';

// The geom2d namespace lowers thi.ng vector profiles into Manifold's
// CrossSection. The thi.ng side is pure JS, so we can exercise it here in the
// unit tier by stubbing CrossSection.ofPolygons to capture the contour it
// would receive — no WASM needed.
interface Captured { contours: number[][][] }

function stubModule(): { module: { CrossSection: unknown }; captured: Captured } {
  const captured: Captured = { contours: [] };
  const CrossSection = {
    ofPolygons(polys: number[][][]) {
      captured.contours.push(polys);
      return { __stubSection: true, polys };
    },
  };
  return { module: { CrossSection }, captured };
}

function lastContour(captured: Captured): number[][] {
  const polys = captured.contours[captured.contours.length - 1];
  return polys[0];
}

describe('geom2d namespace', () => {
  it('ngon emits one closed contour with `sides` vertices', () => {
    const { module, captured } = stubModule();
    const geom = createGeom2dNamespace(module);
    geom.ngon(10, 6);
    const c = lastContour(captured);
    expect(c).toHaveLength(6);
    // every vertex is a finite [x, y] pair roughly on the circumradius
    for (const [x, y] of c) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Math.hypot(x, y)).toBeCloseTo(10, 5);
    }
  });

  it('star alternates outer/inner radii over 2*points vertices', () => {
    const { module, captured } = stubModule();
    const geom = createGeom2dNamespace(module);
    geom.star(10, 6, 0.5);
    const c = lastContour(captured);
    expect(c).toHaveLength(12);
    const radii = c.map(([x, y]) => Math.hypot(x, y));
    expect(Math.max(...radii)).toBeCloseTo(10, 5);
    expect(Math.min(...radii)).toBeCloseTo(5, 5);
  });

  it('ellipse honors the segment count', () => {
    const { module, captured } = stubModule();
    const geom = createGeom2dNamespace(module);
    geom.ellipse(8, 4, 48);
    expect(lastContour(captured)).toHaveLength(48);
  });

  it('smooth (chaikin) increases the vertex count of a coarse polyline', () => {
    const { module, captured } = stubModule();
    const geom = createGeom2dNamespace(module);
    const coarse: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    geom.smooth(coarse, { iterations: 3, kernel: 'chaikin', closed: true });
    expect(lastContour(captured).length).toBeGreaterThan(coarse.length);
  });

  it('rejects invalid arguments instead of coercing', () => {
    const { module } = stubModule();
    const geom = createGeom2dNamespace(module);
    expect(() => geom.ngon(10, 2)).toThrow();              // <3 sides
    expect(() => geom.star(10, 6, 5)).toThrow();           // innerRatio > 1
    // @ts-expect-error — exercising the runtime guard with a bad type
    expect(() => geom.fromPoints([[0, 0], [1, 1]])).toThrow(); // <3 points
    // @ts-expect-error — unknown option key must be rejected
    expect(() => geom.smooth([[0, 0], [1, 0], [0, 1]], { bogus: 1 })).toThrow();
  });
});
