// "Paint within part" (#1025): a descriptor's `withinPart` clips the region to
// one label, in the region store (live paint), the headless api.paint.*
// resolver, and the Paint panel's scope stamping.
import { afterEach, describe, expect, it } from 'vitest';
import { addRegion, clearRegions, clipToPart, getRegions, setPartScopeResolver, setRegionTriangles } from '../../src/color/regions';
import { getPaintScope, setPaintScope, withPaintScope } from '../../src/color/paintScope';
import { resolvePaintDescriptor } from '../../src/color/paintOpsResolve';
import type { MeshData } from '../../src/geometry/types';

const parts = new Map([['left', new Set([0, 1])], ['right', new Set([2, 3])]]);

afterEach(() => {
  setPartScopeResolver(null);
  setPaintScope(null);
  clearRegions();
});

describe('clipToPart', () => {
  it('keeps only the part\'s triangles and colours; unscoped passes through', () => {
    setPartScopeResolver((l) => parts.get(l) ?? null);
    const all = new Set([0, 1, 2, 3]);
    expect([...clipToPart({ kind: 'triangles', ids: [] }, all).triangles]).toEqual([0, 1, 2, 3]);
    const colors = new Map<number, [number, number, number]>([[1, [1, 0, 0]], [2, [0, 1, 0]]]);
    const r = clipToPart({ kind: 'triangles', ids: [], withinPart: 'left' }, all, colors);
    expect([...r.triangles]).toEqual([0, 1]);
    expect([...r.perTriColors!.keys()]).toEqual([1]);
  });

  it('a part that no longer exists clips to nothing', () => {
    setPartScopeResolver((l) => parts.get(l) ?? null);
    expect(clipToPart({ kind: 'triangles', ids: [], withinPart: 'gone' }, new Set([0, 1])).triangles.size).toBe(0);
  });

  it('the store clips on add and on every re-resolve', () => {
    setPartScopeResolver((l) => parts.get(l) ?? null);
    const region = addRegion('band', [1, 1, 1], 'slab', { kind: 'slab', normal: [0, 0, 1], offset: 0, thickness: 9, withinPart: 'right' }, new Set([0, 1, 2, 3]));
    expect([...region.triangles]).toEqual([2, 3]);
    setRegionTriangles(region.id, new Set([1, 2]));
    expect([...getRegions()[0].triangles]).toEqual([2]);
  });
});

describe('Paint panel scope', () => {
  it('stamps the active part on UI descriptors; an explicit withinPart wins', () => {
    expect(withPaintScope({ kind: 'triangles', ids: [1] })).toEqual({ kind: 'triangles', ids: [1] });
    setPaintScope('left');
    expect(getPaintScope()).toBe('left');
    expect(withPaintScope({ kind: 'triangles', ids: [1] }).withinPart).toBe('left');
    expect(withPaintScope({ kind: 'triangles', ids: [1], withinPart: 'right' }).withinPart).toBe('right');
    setPaintScope('');
    expect(getPaintScope()).toBeNull();
  });
});

describe('api.paint.* withinPart (headless resolver)', () => {
  // Four triangles along X, two per part.
  const mesh = {
    vertProperties: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 0, 0, 6, 0, 0, 5, 1, 0, 10, 0, 0, 11, 0, 0, 10, 1, 0, 15, 0, 0, 16, 0, 0, 15, 1, 0]),
    triVerts: new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
    numProp: 3, numVert: 12, numTri: 4,
  } as MeshData;

  it('clips a slab to the part and paints nothing for an unknown part', () => {
    const slab = { kind: 'slab' as const, normal: [0, 0, 1] as [number, number, number], offset: 0, thickness: 2 };
    expect(resolvePaintDescriptor(slab, mesh, parts)!.size).toBe(4);
    expect([...resolvePaintDescriptor({ ...slab, withinPart: 'right' }, mesh, parts)!]).toEqual([2, 3]);
    expect(resolvePaintDescriptor({ ...slab, withinPart: 'nope' }, mesh, parts)!.size).toBe(0);
  });
});
