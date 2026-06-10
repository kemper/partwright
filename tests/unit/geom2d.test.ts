import { describe, it, expect } from 'vitest';
import { createGeom2dNamespace } from '../../src/geometry/geom2d';

// geom2d is pure computational geometry that lowers into Manifold's
// CrossSection. We stub the CrossSection statics to capture the contour each
// helper produces — no WASM needed, so this stays in the unit tier.
interface Captured {
  contours: number[][][];
  circleCalls: Array<[number, number | undefined]>;
}

function stubModule(): { module: { CrossSection: unknown }; captured: Captured } {
  const captured: Captured = { contours: [], circleCalls: [] };
  const subtractable = { subtract: (_o: unknown) => subtractable };
  const CrossSection = {
    ofPolygons(polys: number[][][]) {
      captured.contours.push(polys);
      return { __stubSection: true, polys, subtract: (_o: unknown) => subtractable };
    },
    circle(r: number, n?: number) {
      captured.circleCalls.push([r, n]);
      return subtractable;
    },
  };
  return { module: { CrossSection }, captured };
}

function lastContour(captured: Captured): number[][] {
  const polys = captured.contours[captured.contours.length - 1];
  return polys[0];
}

/** Shoelace signed area — positive iff CCW. */
function signedArea(pts: number[][]): number {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

describe('geom2d namespace', () => {
  it('ngon emits a CCW closed contour with `sides` vertices on the circumradius', () => {
    const { module, captured } = stubModule();
    const geom = createGeom2dNamespace(module);
    geom.ngon(10, 6);
    const c = lastContour(captured);
    expect(c).toHaveLength(6);
    for (const [x, y] of c) expect(Math.hypot(x, y)).toBeCloseTo(10, 5);
    expect(signedArea(c)).toBeGreaterThan(0); // section() guarantees CCW
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

  it('roundedRect stays within the requested extents', () => {
    const { module, captured } = stubModule();
    const geom = createGeom2dNamespace(module);
    geom.roundedRect(20, 10, 3, 8);
    const c = lastContour(captured);
    for (const [x, y] of c) {
      expect(Math.abs(x)).toBeLessThanOrEqual(10 + 1e-9);
      expect(Math.abs(y)).toBeLessThanOrEqual(5 + 1e-9);
    }
    // radius 0 degrades to a 4-corner rectangle
    geom.roundedRect(20, 10, 0);
    expect(lastContour(captured)).toHaveLength(4);
  });

  it('chamferedRect produces an 8-point octagonal outline', () => {
    const { module, captured } = stubModule();
    const geom = createGeom2dNamespace(module);
    geom.chamferedRect(14, 10, 3);
    expect(lastContour(captured)).toHaveLength(8);
  });

  it('slot caps span the full length and width', () => {
    const { module, captured } = stubModule();
    const geom = createGeom2dNamespace(module);
    geom.slot(18, 4, 32);
    const c = lastContour(captured);
    const xs = c.map((p) => p[0]), ys = c.map((p) => p[1]);
    expect(Math.max(...xs)).toBeCloseTo(9 + 4, 5); // half-length + cap radius
    expect(Math.max(...ys)).toBeCloseTo(4, 5);
  });

  it('teardrop has an apex above the circle on +Y', () => {
    const { module, captured } = stubModule();
    const geom = createGeom2dNamespace(module);
    geom.teardrop(6, 48, 45);
    const c = lastContour(captured);
    const maxY = Math.max(...c.map((p) => p[1]));
    // apex = r / sin(45°) = 6 * 1.4142… ≈ 8.49, clearly above the radius
    expect(maxY).toBeGreaterThan(6);
    expect(maxY).toBeCloseTo(6 / Math.sin(Math.PI / 4), 4);
  });

  it('annulus subtracts an inner circle from an outer circle', () => {
    const { module, captured } = stubModule();
    const geom = createGeom2dNamespace(module);
    geom.annulus(7, 4, 64);
    expect(captured.circleCalls).toEqual([[7, 64], [4, 64]]);
  });

  it('sector includes the origin plus an arc', () => {
    const { module, captured } = stubModule();
    const geom = createGeom2dNamespace(module);
    geom.sector(8, 0, 270, 24);
    const c = lastContour(captured);
    expect(c.some(([x, y]) => x === 0 && y === 0)).toBe(true);
    expect(c.length).toBeGreaterThan(24);
  });

  it('smooth (chaikin) increases the vertex count of a coarse polyline', () => {
    const { module, captured } = stubModule();
    const geom = createGeom2dNamespace(module);
    const coarse: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    geom.smooth(coarse, { iterations: 3, kernel: 'chaikin', closed: true });
    expect(lastContour(captured).length).toBeGreaterThan(coarse.length);
  });

  it('smooth supports the cubic kernel', () => {
    const { module, captured } = stubModule();
    const geom = createGeom2dNamespace(module);
    geom.smooth([[0, 0], [10, 0], [5, 8]], { kernel: 'cubic', iterations: 2 });
    expect(lastContour(captured).length).toBeGreaterThan(3);
  });

  it('rejects invalid arguments instead of coercing', () => {
    const { module } = stubModule();
    const geom = createGeom2dNamespace(module);
    expect(() => geom.ngon(10, 2)).toThrow();              // <3 sides
    expect(() => geom.star(10, 6, 5)).toThrow();           // innerRatio > 1
    expect(() => geom.annulus(4, 7)).toThrow();            // inner >= outer
    // @ts-expect-error — exercising the runtime guard with too-few points
    expect(() => geom.fromPoints([[0, 0], [1, 1]])).toThrow();
    // @ts-expect-error — unknown option key must be rejected
    expect(() => geom.smooth([[0, 0], [1, 0], [0, 1]], { bogus: 1 })).toThrow();
  });
});
