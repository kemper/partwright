import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  addRegion, clearRegions, getRegions, setPartScopeResolver, descriptorPartLabel, setRegionDescriptor,
} from '../../src/color/regions';
import { getPaintScope, setPaintScope, withPaintScope } from '../../src/color/paintScope';

// Part "handle" = triangles 0..4 of the working mesh.
const HANDLE = new Set([0, 1, 2, 3, 4]);

describe('part scope on paint regions (#1003 / #1025)', () => {
  beforeEach(() => {
    clearRegions();
    setPartScopeResolver((label) => (label === 'handle' ? HANDLE : null));
  });
  afterEach(() => {
    setPartScopeResolver(null);
    setPaintScope(null);
  });

  it('the UI paint scope stamps withinPart and the region is clipped to the part', () => {
    setPaintScope('handle');
    const d = withPaintScope({ kind: 'slab', normal: [0, 0, 1], offset: 0, thickness: 1 } as const);
    const r = addRegion('stroke', [1, 0, 0], 'paintbrush', d, new Set([3, 4, 5, 6]));
    expect(r.descriptor.withinPart).toBe('handle');
    expect([...r.triangles]).toEqual([3, 4]);
  });

  it('plain addRegion ignores the UI scope; an explicit withinPart applies one', () => {
    setPaintScope('handle');
    const plain = addRegion('api', [0, 1, 0], 'slab', { kind: 'slab', normal: [0, 0, 1], offset: 0, thickness: 1 }, new Set([5, 6]));
    expect(plain.descriptor.withinPart).toBeUndefined();
    expect(plain.triangles.size).toBe(2);
    const scoped = addRegion('api2', [0, 1, 0], 'slab', { kind: 'slab', normal: [0, 0, 1], offset: 0, thickness: 1, withinPart: 'handle' }, new Set([1, 9]));
    expect([...scoped.triangles]).toEqual([1]);
    expect(getPaintScope()).toBe('handle');
  });

  it('byLabel is the part itself; per-triangle colours are clipped with the set', () => {
    expect(descriptorPartLabel({ kind: 'byLabel', label: 'body' })).toBe('body');
    expect(descriptorPartLabel({ kind: 'triangles', ids: [1] })).toBeNull();
    expect(descriptorPartLabel({ kind: 'triangles', ids: [1], withinPart: 'handle' })).toBe('handle');
    const ptc = new Map<number, [number, number, number]>([[2, [1, 1, 1]], [8, [0, 0, 0]]]);
    const r = addRegion('img', [1, 1, 1], 'imagePaint', { kind: 'imagePaint', entries: [], avgColor: [1, 1, 1], withinPart: 'handle' }, new Set([2, 8]), true, undefined, ptc);
    expect([...r.triangles]).toEqual([2]);
    expect([...(r.perTriColors?.keys() ?? [])]).toEqual([2]);
  });

  it('setRegionDescriptor re-points a region in place', () => {
    const r = addRegion('fill', [1, 0, 0], 'paintbrush', { kind: 'byLabel', label: 'body' }, new Set());
    expect(setRegionDescriptor(r.id, { kind: 'byLabel', label: 'cup' }, new Set([7]))).toBe(true);
    const after = getRegions().find(x => x.id === r.id)!;
    expect(after.descriptor).toEqual({ kind: 'byLabel', label: 'cup' });
    expect(after.triangles.size).toBe(1);
  });
});
