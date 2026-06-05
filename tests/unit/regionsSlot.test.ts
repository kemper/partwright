import { describe, it, expect, beforeEach } from 'vitest';
import {
  addRegion,
  clearRegions,
  serialize,
  getRegions,
  recolorRegionsForSlot,
  usedSlotIds,
  reassignRegionColor,
  applyPaletteAutoMatch,
} from '../../src/color/regions';

// Phase 1: per-region palette-slot attribution. regions.ts is a dependency-free
// singleton store, so the slotId plumbing is exercised directly in the node tier.

describe('region slotId attribution', () => {
  beforeEach(() => clearRegions());

  it('stamps slotId onto a region and round-trips it through serialize', () => {
    addRegion('A', [1, 0, 0], 'face-pick', { kind: 'triangles', ids: [0] }, new Set([0]), true, 'def-red');
    const [r] = getRegions();
    expect(r.slotId).toBe('def-red');
    const ser = serialize();
    expect(ser[0].slotId).toBe('def-red');
  });

  it('omits slotId in serialize for unslotted (ad-hoc) regions', () => {
    addRegion('B', [0, 1, 0], 'face-pick', { kind: 'triangles', ids: [1] }, new Set([1]));
    expect(getRegions()[0].slotId).toBeUndefined();
    expect('slotId' in serialize()[0]).toBe(false);
  });

  it('recolors only the regions on a given slot', () => {
    addRegion('A', [1, 0, 0], 'face-pick', { kind: 'triangles', ids: [0] }, new Set([0]), true, 'slot-1');
    addRegion('B', [0, 1, 0], 'face-pick', { kind: 'triangles', ids: [1] }, new Set([1]), true, 'slot-2');
    addRegion('C', [0, 0, 1], 'face-pick', { kind: 'triangles', ids: [2] }, new Set([2]), true, 'slot-1');

    const changed = recolorRegionsForSlot('slot-1', [0.1, 0.2, 0.3]);
    expect(changed).toBe(2);
    const byName = Object.fromEntries(getRegions().map(r => [r.name, r.color]));
    expect(byName['A']).toEqual([0.1, 0.2, 0.3]);
    expect(byName['C']).toEqual([0.1, 0.2, 0.3]);
    expect(byName['B']).toEqual([0, 1, 0]); // untouched
  });

  it('reports the distinct slots in use for the over-budget badge', () => {
    addRegion('A', [1, 0, 0], 'face-pick', { kind: 'triangles', ids: [0] }, new Set([0]), true, 'slot-1');
    addRegion('B', [0, 1, 0], 'face-pick', { kind: 'triangles', ids: [1] }, new Set([1]), true, 'slot-2');
    addRegion('C', [0, 0, 1], 'face-pick', { kind: 'triangles', ids: [2] }, new Set([2]), true, 'slot-1');
    addRegion('D', [1, 1, 1], 'face-pick', { kind: 'triangles', ids: [3] }, new Set([3])); // unslotted
    expect(usedSlotIds()).toEqual(new Set(['slot-1', 'slot-2']));
  });
});

describe('palette reconciliation (reassign + auto-match)', () => {
  beforeEach(() => clearRegions());

  it('reassignRegionColor swaps colour + slot for matching regions only', () => {
    addRegion('A', [1, 0, 0], 'face-pick', { kind: 'triangles', ids: [0] }, new Set([0])); // off-palette red
    addRegion('B', [0, 1, 0], 'face-pick', { kind: 'triangles', ids: [1] }, new Set([1])); // green
    const n = reassignRegionColor([1, 0, 0], [0.2, 0.2, 0.8], 'slot-blue');
    expect(n).toBe(1);
    const a = getRegions().find(r => r.name === 'A')!;
    expect(a.color).toEqual([0.2, 0.2, 0.8]);
    expect(a.slotId).toBe('slot-blue');
    expect(getRegions().find(r => r.name === 'B')!.color).toEqual([0, 1, 0]); // untouched
  });

  it('reassignRegionColor merges one model colour into another (keep target)', () => {
    addRegion('A', [1, 0, 0], 'face-pick', { kind: 'triangles', ids: [0] }, new Set([0])); // red
    addRegion('B', [0, 0, 1], 'face-pick', { kind: 'triangles', ids: [1] }, new Set([1])); // blue (kept)
    // Merge A into B: only A (the source colour) is recoloured to B's colour.
    const n = reassignRegionColor([1, 0, 0], [0, 0, 1], undefined);
    expect(n).toBe(1);
    expect(getRegions().find(r => r.name === 'A')!.color).toEqual([0, 0, 1]);
    expect(getRegions().find(r => r.name === 'B')!.color).toEqual([0, 0, 1]);
  });

  it('applyPaletteAutoMatch snaps each region to the nearest slot', () => {
    addRegion('A', [0.9, 0.1, 0.1], 'face-pick', { kind: 'triangles', ids: [0] }, new Set([0]));
    addRegion('B', [0.1, 0.1, 0.9], 'face-pick', { kind: 'triangles', ids: [1] }, new Set([1]));
    const slots = [
      { id: 'red', color: [1, 0, 0] as [number, number, number] },
      { id: 'blue', color: [0, 0, 1] as [number, number, number] },
    ];
    const n = applyPaletteAutoMatch(slots);
    expect(n).toBe(2);
    const a = getRegions().find(r => r.name === 'A')!;
    const b = getRegions().find(r => r.name === 'B')!;
    expect(a.slotId).toBe('red');
    expect(a.color).toEqual([1, 0, 0]);
    expect(b.slotId).toBe('blue');
    expect(b.color).toEqual([0, 0, 1]);
  });
});
