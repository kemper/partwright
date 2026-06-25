// Unit tests for the SDF→flat-JS compiler (src/geometry/sdfCompile.ts).
//
// The compiler must produce a function that is numerically identical to the
// closure-tree `_eval` across every supported op, fall back transparently for
// unsupported ops (opaque leaves), and survive deep/chunked trees. These tests
// build real SdfNode trees via createSdfNamespace (no WASM — `.evaluate()` is
// pure JS) and compare compiled vs closure at many random points.

import { describe, it, expect } from 'vitest';
import { createSdfNamespace, type SdfNamespace } from '../../src/geometry/sdf';
import { buildCompiled, compileSdfEval } from '../../src/geometry/sdfCompile';

// `.evaluate()` never touches Manifold, so a no-op stub is enough to build trees.
const stubManifold = new Proxy({}, { get: () => () => undefined }) as unknown as Parameters<typeof createSdfNamespace>[0];
const sdf: SdfNamespace = createSdfNamespace(stubManifold, (s) => s);

/** Max |compiled - closure| over a deterministic point cloud spanning a box. */
function maxDiff(node: { evaluate(x: number, y: number, z: number): number }, fn: (x: number, y: number, z: number) => number, n = 4000): number {
  let seed = 0x1234567;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let m = 0;
  for (let i = 0; i < n; i++) {
    const x = rnd() * 60 - 30, y = rnd() * 60 - 30, z = rnd() * 60 - 30;
    const a = node.evaluate(x, y, z), b = fn(x, y, z);
    if (Number.isFinite(a) && Number.isFinite(b)) m = Math.max(m, Math.abs(a - b));
    else expect(a).toBe(b); // NaN/Inf must match exactly
  }
  return m;
}

function expectIdentical(node: { evaluate(x: number, y: number, z: number): number }): void {
  const built = buildCompiled(node as never);
  expect(built, 'compiler returned a function').not.toBeNull();
  expect(maxDiff(node as never, built!.fn)).toBeLessThan(1e-9);
}

describe('sdfCompile — per-op numerical identity', () => {
  it('primitives', () => {
    expectIdentical(sdf.sphere(7).translate([3, -2, 5]));
    expectIdentical(sdf.box([10, 6, 14]).translate([1, 2, 3]));
    expectIdentical(sdf.ellipsoid(8, 5, 11).translate([-4, 3, 2]));
    expectIdentical(sdf.cylinder(5, 18).translate([2, 2, -3]));
    expectIdentical(sdf.torus(9, 3).translate([0, 1, 4]));
    expectIdentical(sdf.capsule([-6, 0, -8], [4, 3, 9], 3.5));
    expectIdentical(sdf.roundedBox([12, 8, 10], 2));         // → round(box)
    expectIdentical(sdf.roundedCylinder(6, 20, 1.5));        // → round(cylinder)
  });

  it('booleans (incl. the hidden-b subtract family)', () => {
    const a = sdf.sphere(8), b = sdf.box([10, 10, 10]).translate([4, 0, 0]);
    expectIdentical(a.union(b));
    expectIdentical(a.intersect(b));
    expectIdentical(a.subtract(b));
    expectIdentical(a.smoothUnion(b, 3));
    expectIdentical(a.smoothSubtract(b, 2.5));
    expectIdentical(a.smoothIntersect(b, 4));
  });

  it('transforms', () => {
    const base = sdf.box([8, 5, 12]).translate([2, 1, 0]);
    expectIdentical(base.rotate([20, -35, 50]));
    expectIdentical(base.scale(1.7));
    expectIdentical(base.mirror('x'));
    expectIdentical(base.mirror('y'));
    expectIdentical(base.mirror('z'));
  });

  it('value modifiers', () => {
    expectIdentical(sdf.box([10, 10, 10]).round(2));
    expectIdentical(sdf.sphere(9).shell(1.5));
  });

  it('warps (twist / bend / taper, all axes)', () => {
    const base = sdf.box([6, 6, 22]);
    for (const ax of ['x', 'y', 'z'] as const) {
      expectIdentical(base.twist(4, ax));
      expectIdentical(base.bend(3, ax));
      expectIdentical(base.taper(-0.02, ax));
    }
    expectIdentical(base.twist(5, 'z', [2, -1])); // off-centre twist axis
  });

  it('a deep nested composite (transforms over smooth booleans)', () => {
    let acc = sdf.sphere(4).translate([0, 0, 0]);
    let seed = 99;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 1; i < 40; i++) {
      acc = acc.smoothUnion(sdf.capsule([rnd() * 20 - 10, rnd() * 20 - 10, rnd() * 20 - 10], [rnd() * 20 - 10, rnd() * 20 - 10, rnd() * 20 - 10], 1 + rnd() * 3), 2);
    }
    expectIdentical(acc.rotate([10, 20, 30]).scale(1.2));
  });
});

describe('sdfCompile — chunking', () => {
  it('stays identical across a large tree that must split into sub-functions', () => {
    let acc = sdf.sphere(3);
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 1; i < 400; i++) acc = acc.smoothUnion(sdf.sphere(2 + rnd() * 3).translate([rnd() * 60 - 30, rnd() * 40 - 20, rnd() * 80 - 40]), 3);
    const built = buildCompiled(acc as never);
    expect(built).not.toBeNull();
    expect(maxDiff(acc as never, built!.fn, 2000)).toBeLessThan(1e-9);
  });
});

describe('sdfCompile — opaque-leaf fallback', () => {
  it('compiles supported ops AND defers unsupported ones, exactly', () => {
    // gyroid is unsupported → must be emitted as an opaque-leaf closure call.
    const blended = sdf.sphere(12).intersect(sdf.gyroid(6, 1.5));
    const built = buildCompiled(blended as never);
    expect(built).not.toBeNull();
    expect(built!.coverage).toBeGreaterThan(0);   // sphere+intersect compiled
    expect(built!.coverage).toBeLessThan(1);       // gyroid deferred
    expect(maxDiff(blended as never, built!.fn)).toBeLessThan(1e-9);
  });

  it('returns null when the whole tree is unsupported (nothing to gain)', () => {
    expect(buildCompiled(sdf.gyroid(5, 1) as never)).toBeNull();
  });
});

describe('sdfCompile — verification gate', () => {
  it('passes a faithful tree and returns a usable fn', () => {
    const node = sdf.sphere(8).smoothUnion(sdf.box([12, 6, 6]).rotate([0, 0, 25]), 3);
    const fn = compileSdfEval(node);
    expect(fn).not.toBeNull();
    expect(maxDiff(node as never, fn!)).toBeLessThan(1e-6);
  });
});
