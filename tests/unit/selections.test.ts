import { describe, it, expect, beforeEach } from 'vitest';
import {
  createSelection, getSelection, listSelections, removeSelection,
  renameSelection, addRefinement, popRefinement, resolveSelection,
  clearSelections, type SelectorNode,
} from '../../src/color/selections';

/** Fake resolver: {set: number[]} nodes resolve to their set; {bad: msg}
 *  nodes return the error string — enough to exercise the algebra without
 *  a mesh. */
function fakeResolve(node: SelectorNode): Set<number> | string {
  if (Array.isArray((node as { set?: number[] }).set)) return new Set((node as { set: number[] }).set);
  return String((node as { bad?: string }).bad ?? 'unknown node');
}

const MESH_A = { tag: 'a' };
const MESH_B = { tag: 'b' };

beforeEach(() => clearSelections());

describe('selection store', () => {
  it('creates, gets by name and id, lists, removes', () => {
    const sel = createSelection({ set: [1, 2, 3] }, '3 ids', 'shoulder');
    if ('error' in sel) throw new Error(sel.error);
    expect(getSelection('shoulder')).toBe(sel);
    expect(getSelection(sel.id)).toBe(sel);
    expect(listSelections()).toHaveLength(1);
    expect(removeSelection('shoulder')).toBe(true);
    expect(listSelections()).toHaveLength(0);
  });

  it('rejects duplicate names', () => {
    createSelection({ set: [1] }, 'x', 'eye');
    const dup = createSelection({ set: [2] }, 'y', 'eye');
    expect('error' in dup).toBe(true);
  });

  it('auto-names when no name supplied and renames', () => {
    const sel = createSelection({ set: [1] }, 'x');
    if ('error' in sel) throw new Error(sel.error);
    expect(sel.name).toMatch(/^selection-\d+$/);
    const renamed = renameSelection(sel.id, 'pupil');
    expect('error' in renamed ? null : renamed.name).toBe('pupil');
  });
});

describe('resolveSelection — algebra + caching', () => {
  it('applies add / subtract / intersect in order', () => {
    const sel = createSelection({ set: [1, 2, 3, 4] }, 'base', 's');
    if ('error' in sel) throw new Error(sel.error);
    addRefinement('s', 'subtract', { set: [4] }, 'minus 4');
    addRefinement('s', 'add', { set: [9] }, 'plus 9');
    addRefinement('s', 'intersect', { set: [2, 3, 9, 50] }, 'clamp');
    const res = resolveSelection(sel, MESH_A, fakeResolve);
    expect(res instanceof Set ? [...res].sort((a, b) => a - b) : res).toEqual([2, 3, 9]);
  });

  it('errors (not empty set) when the chain empties, and popRefinement recovers', () => {
    const sel = createSelection({ set: [1, 2] }, 'base', 's');
    if ('error' in sel) throw new Error(sel.error);
    addRefinement('s', 'intersect', { set: [7] }, 'disjoint');
    const res = resolveSelection(sel, MESH_A, fakeResolve);
    expect(res instanceof Set).toBe(false);
    expect(popRefinement('s')).toBe(true);
    const res2 = resolveSelection(sel, MESH_A, fakeResolve);
    expect(res2 instanceof Set ? res2.size : 0).toBe(2);
  });

  it('caches per mesh identity and re-resolves on a new mesh', () => {
    let calls = 0;
    const counting = (node: SelectorNode): Set<number> | string => { calls++; return fakeResolve(node); };
    const sel = createSelection({ set: [1] }, 'base', 's');
    if ('error' in sel) throw new Error(sel.error);
    resolveSelection(sel, MESH_A, counting);
    resolveSelection(sel, MESH_A, counting);
    expect(calls).toBe(1); // second hit served from cache
    resolveSelection(sel, MESH_B, counting);
    expect(calls).toBe(2); // new mesh identity → re-resolved
  });

  it('propagates node resolution errors with the selection name', () => {
    const sel = createSelection({ bad: 'island 99 out of range' }, 'base', 'ghost');
    if ('error' in sel) throw new Error(sel.error);
    const res = resolveSelection(sel, MESH_A, fakeResolve);
    expect(res instanceof Set ? '' : res.error).toContain('ghost');
    expect(res instanceof Set ? '' : res.error).toContain('island 99');
  });

  it('refinements invalidate the cache', () => {
    const sel = createSelection({ set: [1, 2] }, 'base', 's');
    if ('error' in sel) throw new Error(sel.error);
    const r1 = resolveSelection(sel, MESH_A, fakeResolve);
    expect(r1 instanceof Set ? r1.size : 0).toBe(2);
    addRefinement('s', 'subtract', { set: [2] }, 'minus 2');
    const r2 = resolveSelection(sel, MESH_A, fakeResolve);
    expect(r2 instanceof Set ? r2.size : 0).toBe(1);
  });
});
