import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  addRegion, addPaintRegion, clearRegions, getRegions, setScopeClipper, setImplicitPaintScope,
  withExplicitPaintScope, withPartScope, descriptorPartLabel, setRegionDescriptor,
} from '../../src/color/regions';

// Part "handle" = triangles 0..4 of the working mesh.
const HANDLE = new Set([0, 1, 2, 3, 4]);

describe('part scope on paint regions (#1003)', () => {
  beforeEach(() => {
    clearRegions();
    setScopeClipper((label, tris) => new Set([...tris].filter(t => label === 'handle' && HANDLE.has(t))));
  });
  afterEach(() => {
    setScopeClipper(null);
    setImplicitPaintScope(null);
  });

  it('interactive paint takes the rail selection as its scope and is clipped to the part', () => {
    setImplicitPaintScope(() => 'handle');
    const r = addPaintRegion('stroke', [1, 0, 0], 'paintbrush', { kind: 'slab', normal: [0, 0, 1], offset: 0, thickness: 1 }, new Set([3, 4, 5, 6]));
    expect(r.descriptor.scope).toEqual({ label: 'handle' });
    expect([...r.triangles]).toEqual([3, 4]);
  });

  it('plain addRegion ignores the UI selection; withExplicitPaintScope applies one', () => {
    setImplicitPaintScope(() => 'handle');
    const plain = addRegion('api', [0, 1, 0], 'slab', { kind: 'slab', normal: [0, 0, 1], offset: 0, thickness: 1 }, new Set([5, 6]));
    expect(plain.descriptor.scope).toBeUndefined();
    expect(plain.triangles.size).toBe(2);
    const scoped = withExplicitPaintScope('handle', () => addRegion('api2', [0, 1, 0], 'slab', { kind: 'slab', normal: [0, 0, 1], offset: 0, thickness: 1 }, new Set([1, 9])));
    expect(scoped.descriptor.scope?.label).toBe('handle');
    expect([...scoped.triangles]).toEqual([1]);
  });

  it('byLabel is the part itself; per-triangle colours are clipped with the set', () => {
    expect(withPartScope({ kind: 'byLabel', label: 'body' }, 'handle')).toEqual({ kind: 'byLabel', label: 'body' });
    expect(descriptorPartLabel({ kind: 'byLabel', label: 'body' })).toBe('body');
    expect(descriptorPartLabel({ kind: 'triangles', ids: [1] })).toBeNull();
    const ptc = new Map<number, [number, number, number]>([[2, [1, 1, 1]], [8, [0, 0, 0]]]);
    const r = addRegion('img', [1, 1, 1], 'imagePaint', { kind: 'imagePaint', entries: [], avgColor: [1, 1, 1], scope: { label: 'handle' } }, new Set([2, 8]), true, undefined, ptc);
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
