import { describe, it, expect } from 'vitest';
import {
  parseSelector, selectTriangles, vertexWeights, weightLookup, weightedWarp, selectionBounds, parseSelectOpts,
  type SelectorMesh, type LabelLookup,
} from '../../src/geometry/selector';
import { makeTransformFn } from '../../src/geometry/sculpt';

// Two labelled patches:
//   "floor" (originalID 10): two triangles in the z=0 plane, facing +Z, x∈[0,10]
//   "wall"  (originalID 20): two triangles in the x=20 plane, facing +X, z∈[0,10]
const V = [
  0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0, // 0-3 floor
  20, 0, 0, 20, 10, 0, 20, 10, 10, 20, 0, 10, // 4-7 wall
];
const MESH: SelectorMesh = {
  vertProperties: new Float32Array(V),
  numProp: 3,
  triVerts: new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]),
  numTri: 4,
  runIndex: new Uint32Array([0, 6, 12]),
  runOriginalID: new Uint32Array([10, 20]),
};
const LABELS: LabelLookup = {
  ids: (n) => (n === 'floor' ? [10] : n === 'wall' ? [20] : null),
  names: () => ['floor', 'wall'],
};
const sel = (raw: unknown) => [...selectTriangles(MESH, parseSelector(raw, 'test'), LABELS, 'test')];

describe('selectors (#1093)', () => {
  it('label, facing, bounds, region', () => {
    expect(sel({ label: 'floor' })).toEqual([1, 1, 0, 0]);
    expect(sel({ label: ['floor', 'wall'] })).toEqual([1, 1, 1, 1]);
    expect(sel({ where: { facing: 'up' } })).toEqual([1, 1, 0, 0]);
    expect(sel({ where: { facing: '+x', tolerance: 5 } })).toEqual([0, 0, 1, 1]);
    expect(sel({ where: { min: [null, null, 1] } })).toEqual([0, 0, 1, 1]);
    expect(sel({ where: { box: { min: [-1, -1, -1], max: [11, 11, 1] } } })).toEqual([1, 1, 0, 0]);
    // Triangle 0's centroid is (6.67, 3.33, 0); triangle 1's is (3.33, 6.67, 0).
    expect(sel({ region: { center: [7, 3, 0], radius: 1 } })).toEqual([1, 0, 0, 0]);
  });

  it('keys AND, arrays OR, except subtracts', () => {
    expect(sel({ label: 'wall', where: { facing: 'up' } })).toEqual([0, 0, 0, 0]);
    expect(sel([{ label: 'floor' }, { label: 'wall' }])).toEqual([1, 1, 1, 1]);
    expect(sel({ label: ['floor', 'wall'], except: { where: { facing: '+x' } } })).toEqual([1, 1, 0, 0]);
  });

  it('a bare except selects everything else; nesting is bounded', () => {
    expect(sel({ except: { label: 'floor' } })).toEqual([0, 0, 1, 1]);
    const loop: Record<string, unknown> = { label: 'floor' };
    loop.except = loop;
    expect(() => parseSelector(loop, 'op')).toThrow(/nest at most/);
  });

  it('rejects bad selectors and unknown parts with actionable errors', () => {
    expect(() => parseSelector({ lable: 'x' }, 'op')).toThrow(/unknown selector key "lable"/);
    expect(() => parseSelector({ where: { facing: 'sideways' } }, 'op')).toThrow(/facing/);
    expect(() => parseSelector({ region: { center: [0, 0], radius: 1 } }, 'op')).toThrow(/center/);
    expect(() => parseSelector({ where: {} }, 'op')).toThrow(/at least one/);
    expect(() => parseSelector([], 'op')).toThrow(/empty/);
    expect(() => sel({ label: 'roof' })).toThrow(/no part "roof".*"floor", "wall"/);
    expect(() => selectTriangles(MESH, parseSelector({ label: 'floor' }, 't'), null, 't')).toThrow(/api\.label/);
    expect(() => parseSelectOpts({ blend: 2 }, 'op')).toThrow(/only applies together with select/);
  });

  it('labels can resolve by triangle index (the main thread\'s labelMap)', () => {
    const byTri: LabelLookup = {
      ids: () => null,
      names: () => ['wall'],
      triangles: (n) => (n === 'wall' ? new Set([2, 3]) : null),
    };
    const plain = { ...MESH, runIndex: undefined, runOriginalID: undefined };
    expect([...selectTriangles(plain, parseSelector({ label: 'wall' }, 't'), byTri, 't')]).toEqual([0, 0, 1, 1]);
    expect(() => selectTriangles(plain, parseSelector({ label: 'roof' }, 't'), byTri, 't')).toThrow(/no part "roof"/);
  });

  it('vertex weights: hard edge, then feathered by blend', () => {
    const mask = selectTriangles(MESH, parseSelector({ label: 'floor' }, 't'), LABELS, 't');
    expect([...vertexWeights(MESH, mask, 0)]).toEqual([1, 1, 1, 1, 0, 0, 0, 0]);
    // Wall vertices at x=20 are 10 units from the floor's x=10 edge: inside a
    // blend of 15 they get a partial weight; outside a blend of 5, none.
    const soft = vertexWeights(MESH, mask, 15);
    expect(soft[4]).toBeGreaterThan(0);
    expect(soft[4]).toBeLessThan(1);
    expect([...vertexWeights(MESH, mask, 5)].slice(4)).toEqual([0, 0, 0, 0]);
  });

  it('weighted warp moves selected vertices fully and others not at all', () => {
    const mask = selectTriangles(MESH, parseSelector({ label: 'wall' }, 't'), LABELS, 't');
    const w = vertexWeights(MESH, mask, 0);
    const warp = weightedWarp((v) => { v[2] += 5; }, weightLookup(MESH, w));
    const onWall = [20, 0, 10];
    const onFloor = [0, 0, 0];
    warp(onWall); warp(onFloor);
    expect(onWall).toEqual([20, 0, 15]);
    expect(onFloor).toEqual([0, 0, 0]);
    const b = selectionBounds(MESH, w);
    expect(b.min).toEqual([20, 0, 0]);
    expect(b.max).toEqual([20, 10, 10]);
    expect(b.center).toEqual([20, 5, 5]);
  });

  it('weight lookup matches warp doubles against getMesh Float32 positions', () => {
    // warp hands the callback the kernel's double; getMesh exported its Float32
    // rounding. A decimal-grid key split some of these and folded the surface.
    const xs = [40.123456789, 37.00000049, -12.3456781, 0.1 + 0.2];
    const mesh: SelectorMesh = {
      vertProperties: new Float32Array(xs.flatMap(x => [x, x / 3, -x])),
      numProp: 3, triVerts: new Uint32Array([0, 1, 2]), numTri: 1,
    };
    const lookup = weightLookup(mesh, new Float32Array([1, 1, 1, 1]));
    for (const x of xs) expect(lookup([x, x / 3, -x])).toBe(1);
  });

  it('a faded rotation rotates along the arc (no chord pinch)', () => {
    // Half weight on a 90° turn = a 45° turn at full radius, not a point on
    // the chord at 0.707 r.
    const half = makeTransformFn([0, 0, 0], [1, 1, 1], [0, 0, 90], [0, 0, 0], () => 0.5);
    const p = [10, 0, 0];
    half(p);
    expect(Math.hypot(p[0], p[1])).toBeCloseTo(10, 6);
    expect(Math.atan2(p[1], p[0]) * 180 / Math.PI).toBeCloseTo(45, 6);
    const none = makeTransformFn([0, 0, 0], [2, 2, 2], [0, 0, 90], [5, 0, 0], () => 0);
    const q = [1, 2, 3];
    none(q);
    expect(q).toEqual([1, 2, 3]);
  });

  it('makeTransformFn scales and rotates about the pivot, then translates', () => {
    const scale = makeTransformFn([1, 1, 1], [2, 2, 2], [0, 0, 0], [0, 0, 0]);
    const p = [2, 1, 1];
    scale(p);
    expect(p).toEqual([3, 1, 1]);
    const rot = makeTransformFn([0, 0, 0], [1, 1, 1], [0, 0, 90], [0, 0, 5]);
    const q = [1, 0, 0];
    rot(q);
    expect(q[0]).toBeCloseTo(0);
    expect(q[1]).toBeCloseTo(1);
    expect(q[2]).toBeCloseTo(5);
  });
});
