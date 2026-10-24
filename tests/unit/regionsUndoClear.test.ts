// Undo-clear must only ever restore what a USER-facing Clear removed. Internal
// resets (version/object load, rehydrate, simplify colour carry) call
// clearRegions({ snapshot: false }), which records nothing and drops any
// pending snapshot — otherwise undoClearColors() could resurrect another
// version's or object's paint (#1085 review).

import { describe, it, expect, beforeEach } from 'vitest';
import { addRegion, clearRegions, clearRegionsBySource, canUndoClear, undoClear, getRegions } from '../../src/color/regions';

const tri = (i: number) => [{ kind: 'triangles' as const, ids: [i] }, new Set([i])] as const;

describe('undo-clear snapshot', () => {
  beforeEach(() => { clearRegions({ snapshot: false }); });

  it('a user clear can be undone', () => {
    addRegion('A', [1, 0, 0], 'face-pick', ...tri(0));
    clearRegions();
    expect(getRegions()).toHaveLength(0);
    expect(canUndoClear()).toBe(true);
    undoClear();
    expect(getRegions().map(r => r.name)).toEqual(['A']);
    expect(canUndoClear()).toBe(false);
  });

  it('an internal reset records no snapshot', () => {
    addRegion('A', [1, 0, 0], 'face-pick', ...tri(0));
    clearRegions({ snapshot: false });
    expect(getRegions()).toHaveLength(0);
    expect(canUndoClear()).toBe(false);
  });

  it('an internal reset discards a pending user snapshot (no cross-model resurrection)', () => {
    addRegion('version-1 paint', [1, 0, 0], 'face-pick', ...tri(0));
    clearRegions();                      // user clears on version 1
    expect(canUndoClear()).toBe(true);
    clearRegions({ snapshot: false });   // a version/object switch resets paint
    expect(canUndoClear()).toBe(false);
    undoClear();                         // no-op
    expect(getRegions()).toHaveLength(0);
  });

  it('also discards a pending scoped (image-stamp) snapshot', () => {
    addRegion('stamp', [0, 0, 1], 'imagePaint', ...tri(1));
    clearRegionsBySource('imagePaint');
    expect(canUndoClear()).toBe(true);
    clearRegions({ snapshot: false });
    expect(canUndoClear()).toBe(false);
  });
});
