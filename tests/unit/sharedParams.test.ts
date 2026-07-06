import { describe, it, expect } from 'vitest';
import { buildSharedParams, type PartParams } from '../../src/assembly/sharedParams';
import type { ParamSpec } from '../../src/geometry/params';

function num(key: string, def: number, min?: number, max?: number, step?: number): ParamSpec {
  return { key, type: 'number', default: def, label: key, min, max, step };
}

describe('buildSharedParams', () => {
  it('produces the union of keys across parts, in first-seen order', () => {
    const parts: PartParams[] = [
      { partId: 'p1', partName: 'Body', schema: [num('height', 10), num('width', 20)], values: {} },
      { partId: 'p2', partName: 'Lid', schema: [num('width', 20), num('radius', 5)], values: {} },
    ];
    const { params } = buildSharedParams(parts);
    expect(params.map(p => p.spec.key)).toEqual(['height', 'width', 'radius']);
  });

  it('records which parts each parameter affects', () => {
    const parts: PartParams[] = [
      { partId: 'p1', partName: 'Body', schema: [num('width', 20)], values: {} },
      { partId: 'p2', partName: 'Lid', schema: [num('width', 20)], values: {} },
      { partId: 'p3', partName: 'Foot', schema: [num('height', 3)], values: {} },
    ];
    const { params } = buildSharedParams(parts);
    const width = params.find(p => p.spec.key === 'width')!;
    expect(width.partIds).toEqual(['p1', 'p2']);
    expect(width.partNames).toEqual(['Body', 'Lid']);
    const height = params.find(p => p.spec.key === 'height')!;
    expect(height.partIds).toEqual(['p3']);
  });

  it('widens the numeric range to the union across parts', () => {
    const parts: PartParams[] = [
      { partId: 'p1', partName: 'A', schema: [num('r', 5, 1, 10, 1)], values: {} },
      { partId: 'p2', partName: 'B', schema: [num('r', 5, 0, 50, 0.5)], values: {} },
    ];
    const { params } = buildSharedParams(parts);
    const r = params[0];
    expect(r.spec.min).toBe(0);
    expect(r.spec.max).toBe(50);
    expect(r.spec.step).toBe(0.5); // finest step
  });

  it('flags mixed values and seeds the reconciled default', () => {
    const parts: PartParams[] = [
      { partId: 'p1', partName: 'A', schema: [num('w', 20)], values: { w: 30 } },
      { partId: 'p2', partName: 'B', schema: [num('w', 20)], values: { w: 40 } },
    ];
    const { params } = buildSharedParams(parts);
    expect(params[0].mixed).toBe(true);
    expect(params[0].value).toBe(20); // default when parts disagree
  });

  it('uses the common value when parts agree', () => {
    const parts: PartParams[] = [
      { partId: 'p1', partName: 'A', schema: [num('w', 20)], values: { w: 33 } },
      { partId: 'p2', partName: 'B', schema: [num('w', 20)], values: { w: 33 } },
    ];
    const { params } = buildSharedParams(parts);
    expect(params[0].mixed).toBe(false);
    expect(params[0].value).toBe(33);
  });

  it('keeps the first type on a type conflict and reports it', () => {
    const parts: PartParams[] = [
      { partId: 'p1', partName: 'A', schema: [num('size', 10)], values: {} },
      { partId: 'p2', partName: 'B', schema: [{ key: 'size', type: 'boolean', default: true, label: 'size' }], values: {} },
    ];
    const { params, typeConflicts } = buildSharedParams(parts);
    const size = params.find(p => p.spec.key === 'size')!;
    expect(size.spec.type).toBe('number');
    expect(size.partIds).toEqual(['p1']); // mismatched part omitted
    expect(typeConflicts).toContain('size');
  });

  it('does not mutate a part\'s own spec when widening', () => {
    const spec = num('r', 5, 1, 10, 1);
    const parts: PartParams[] = [
      { partId: 'p1', partName: 'A', schema: [spec], values: {} },
      { partId: 'p2', partName: 'B', schema: [num('r', 5, 0, 99, 1)], values: {} },
    ];
    buildSharedParams(parts);
    expect(spec.min).toBe(1); // untouched
    expect(spec.max).toBe(10);
  });
});
