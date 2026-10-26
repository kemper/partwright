// api.offset / api.shell (meshSdfOps.ts) against the real manifold-3d kernel:
// the offset surface must sit `distance` from the input, and a shell must keep
// the input's own surface while adding a wall of the requested thickness.

import { describe, it, expect, beforeAll } from 'vitest';
import { createMeshSdfOps } from '../../src/geometry/meshSdfOps';

let Manifold: any;
let ops: ReturnType<typeof createMeshSdfOps>;

beforeAll(async () => {
  const Module = (await import('manifold-3d')).default;
  const mod = await Module();
  mod.setup();
  Manifold = mod.Manifold;
  ops = createMeshSdfOps(mod);
});

const ball = (r: number) => (4 / 3) * Math.PI * r ** 3;

describe('meshOps.offset', () => {
  it('grows a sphere by the distance', () => {
    const s = Manifold.sphere(10, 96);
    const out = ops.offset(s, { distance: 2 });
    expect(out.status()).toBe('NoError');
    const bb = out.boundingBox();
    expect(bb.max[0]).toBeCloseTo(12, 0);
    expect(out.volume()).toBeGreaterThan(ball(12) * 0.97);
    expect(out.volume()).toBeLessThan(ball(12) * 1.03);
  });

  it('shrinks a sphere by a negative distance', () => {
    const out = ops.offset(Manifold.sphere(10, 96), { distance: -2 });
    expect(out.volume()).toBeGreaterThan(ball(8) * 0.96);
    expect(out.volume()).toBeLessThan(ball(8) * 1.04);
  });

  it('errors with the fix when shrinking removes everything', () => {
    expect(() => ops.offset(Manifold.cube([20, 20, 2], true), { distance: -1.5 })).toThrow(/nowhere thicker/);
  });

  it('rejects bad options', () => {
    const s = Manifold.sphere(5, 24);
    expect(() => ops.offset(s, { distance: 0 })).toThrow(/non-zero/);
    expect(() => ops.offset(s, { distance: 1, thickness: 2 } as any)).toThrow(/unknown option "thickness"/);
    expect(() => ops.offset({} as any, { distance: 1 })).toThrow(/must be a Manifold/);
  });
});

describe('meshOps.shell', () => {
  it('hollows a cube inward to a uniform wall, keeping the outer surface exact', () => {
    const cube = Manifold.cube([30, 30, 30], true);
    const out = ops.shell(cube, { thickness: 3 });
    expect(out.status()).toBe('NoError');
    // Outer box untouched; inner cavity is a 24-unit cube.
    const bb = out.boundingBox();
    expect(bb.min).toEqual([-15, -15, -15]);
    expect(bb.max).toEqual([15, 15, 15]);
    const want = 30 ** 3 - 24 ** 3;
    expect(out.volume()).toBeGreaterThan(want * 0.97);
    expect(out.volume()).toBeLessThan(want * 1.03);
    // The cavity is sealed inside: a point in the middle is empty, one in the wall is solid.
    const probe = (p: [number, number, number]) => !Manifold.cube([0.2, 0.2, 0.2], true).translate(p).intersect(out).isEmpty();
    expect(probe([0, 0, 0])).toBe(false);
    expect(probe([0, 0, 13.5])).toBe(true);
    expect(probe([0, 0, 11])).toBe(false);
  });

  it("side: 'outside' wraps a skin around the input", () => {
    const s = Manifold.sphere(10, 96);
    const out = ops.shell(s, { thickness: 2, side: 'outside' });
    const want = ball(12) - s.volume();
    expect(out.volume()).toBeGreaterThan(want * 0.95);
    expect(out.volume()).toBeLessThan(want * 1.05);
  });

  it('cut open, the shell is a single wearable piece', () => {
    const head = Manifold.sphere(10, 96).scale([1, 0.8, 1.2]);
    const mask = ops.shell(head, { thickness: 1.5 }).subtract(Manifold.cube([40, 40, 40], true).translate([0, 20 + 2, 0]));
    expect(mask.decompose().length).toBe(1);
    expect(mask.genus()).toBe(0);
  });

  it('errors when the model is too thin to hollow', () => {
    expect(() => ops.shell(Manifold.cube([20, 20, 2], true), { thickness: 1.5 })).toThrow(/nowhere thicker/);
  });
});
