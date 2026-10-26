import { describe, it, expect } from 'vitest';
import { planObjectPartsMove, shortListName, checkMoveExpectation } from '../../src/geometry/objectPartMove';
import { parsePieceFilter, type PieceBox } from '../../src/geometry/objectPartCode';
import type { ObjectPartsSummary } from '../../src/geometry/meshPieces';
import { extendPartSelection, describePartKeys, partSelectionChatContext, splitPartSelectionContext } from '../../src/ui/partSelection';

const CODE = `const { Manifold } = api;
const a = api.label(Manifold.cube(1), 'a');
const b = api.label(Manifold.cube(1).translate([5, 0, 0]), 'b');
return a.add(b);`;

// Piece i covers triangles [10i, 10i+10); its box is centred at x = 5i.
const box = (i: number): PieceBox => [5 * i, 0, 0, 1, 1, 1];
const range = (from: number, n: number) => Array.from({ length: n }, (_, k) => from + k);
const piece = (i: number, part?: string) => ({ index: i, triangles: range(10 * i, 10), ...(part ? { part } : {}) });

function summary(parts: Record<string, number[]>, pieces: number, unlabeled: number[] = []): ObjectPartsSummary {
  return {
    parts: Object.entries(parts).map(([name, tris]) => ({ name, triangles: new Set(tris) })),
    unlabeled,
    pieces: range(0, pieces).map(i => piece(i)),
  };
}

const plan = (s: ObjectPartsSummary, keys: string[], separate = false) => planObjectPartsMove(CODE, s, keys, { separate, boxOf: box });

describe('planObjectPartsMove — pieces', () => {
  const s = summary({}, 3);
  it('moves several pieces together with one drop filter and one keep filter', () => {
    const p = plan(s, ['piece:0', 'piece:2']);
    if ('error' in p) throw new Error(p.error);
    expect(p.via).toBe('pieces');
    expect(parsePieceFilter(p.dropCode)).toMatchObject({ mode: 'drop', boxes: [box(0), box(2)] });
    expect(p.objects).toHaveLength(1);
    expect(parsePieceFilter(p.objects[0].code)).toMatchObject({ mode: 'keep', boxes: [box(0), box(2)] });
    expect(p.objects[0].name).toBe('piece 1, piece 3');
  });
  it('splits into one keep filter per piece', () => {
    const p = plan(s, ['piece:0', 'piece:1'], true);
    if ('error' in p) throw new Error(p.error);
    expect(p.objects.map(o => parsePieceFilter(o.code)?.boxes)).toEqual([[box(0)], [box(1)]]);
  });
  it('moving a piece out of a keep-filtered object narrows its keep list (no duplicates)', () => {
    const first = plan(s, ['piece:0', 'piece:2']);
    if ('error' in first) throw new Error(first.error);
    // The new object keeps pieces 0 and 2; now it has 2 pieces of its own.
    const again = planObjectPartsMove(first.objects[0].code, summary({}, 2), ['piece:0'], { separate: false, boxOf: i => [box(0), box(2)][i] });
    if ('error' in again) throw new Error(again.error);
    expect(parsePieceFilter(again.objects[0].code)).toMatchObject({ mode: 'keep', boxes: [box(0)] });
    expect(again.drop.pieces).toBe(1);
    expect(again.objects[0].expect.pieces).toBe(1);
  });
  it('refuses to move every piece, mixes, and the unlabeled remainder', () => {
    expect(plan(s, ['piece:0', 'piece:1', 'piece:2'])).toHaveProperty('error');
    expect(plan(summary({ a: [0] }, 3), ['piece:0', 'part:a'])).toHaveProperty('error');
    expect(plan(s, ['unlabeled'])).toHaveProperty('error');
    expect(plan(s, ['piece:7'])).toHaveProperty('error');
  });
});

describe('planObjectPartsMove — parts', () => {
  it('uses piece filters when the parts are whole separate solids', () => {
    // a = piece 0, b = piece 1, c = piece 2.
    const p = plan(summary({ a: range(0, 10), b: range(10, 10), c: range(20, 10) }, 3), ['part:a', 'part:c'], true);
    if ('error' in p) throw new Error(p.error);
    expect(p.via).toBe('pieces');
    expect(p.objects.map(o => o.name)).toEqual(['a', 'c']);
    expect(parsePieceFilter(p.objects[1].code)?.boxes).toEqual([box(2)]);
  });
  it('uses removal lines for parts fused into one solid', () => {
    // a and b share piece 0; c is fused there too.
    const p = plan(summary({ a: range(0, 4), b: range(4, 3), c: range(7, 3) }, 1), ['part:a', 'part:b']);
    if ('error' in p) throw new Error(p.error);
    expect(p.via).toBe('parts');
    expect(p.dropCode).toContain(`api.removePart("a");`);
    expect(p.dropCode).toContain(`api.removePart("b");`);
    expect(p.dropCode).not.toContain(`api.removePart("c");`);
    expect(p.objects).toHaveLength(1);
    expect(p.objects[0].code).toContain(`api.removePart("c");`);
    expect(p.objects[0].code).not.toContain(`api.removePart("a");`);
    // The removal lines go before the first statement.
    expect(p.objects[0].code.split('\n')[0]).toBe(`api.removePart("c");`);
  });
  it('splits fused parts into one object each, each dropping the others', () => {
    const p = plan(summary({ a: range(0, 4), b: range(4, 3), c: range(7, 3) }, 1), ['part:a', 'part:b'], true);
    if ('error' in p) throw new Error(p.error);
    expect(p.objects.map(o => o.name)).toEqual(['a', 'b']);
    expect(p.objects[0].code).toContain(`api.removePart("b");`);
    expect(p.objects[0].code).not.toContain(`api.removePart("a");`);
  });
  it('falls back to removal lines when a split would share a piece', () => {
    // a and b together make piece 0 (whole), but share it — a split can't filter by piece.
    const p = plan(summary({ a: range(0, 5), b: range(5, 5), c: range(10, 10) }, 2), ['part:a', 'part:b'], true);
    if ('error' in p) throw new Error(p.error);
    expect(p.via).toBe('parts');
    // Moving them together CAN use the piece.
    const together = plan(summary({ a: range(0, 5), b: range(5, 5), c: range(10, 10) }, 2), ['part:a', 'part:b']);
    if ('error' in together) throw new Error(together.error);
    expect(together.via).toBe('pieces');
  });
  it('refuses when unlabeled geometry would be copied, or nothing would be left', () => {
    expect(plan(summary({ a: range(0, 4), b: range(4, 3) }, 1, range(7, 3)), ['part:a'])).toHaveProperty('error');
    expect(plan(summary({ a: range(0, 4), b: range(4, 6) }, 1), ['part:a', 'part:b'])).toHaveProperty('error');
    expect(plan(summary({ a: range(0, 4) }, 1), ['part:zzz'])).toHaveProperty('error');
  });
});

describe('checkMoveExpectation', () => {
  const labels = new Map([['a', new Set([1, 2])], ['b', new Set<number>()]]);
  it('passes when parts and pieces match, and names what is wrong otherwise', () => {
    expect(checkMoveExpectation({ hasParts: ['a'], lacksParts: ['b'], pieces: 2 }, { labels, pieces: 2 })).toBeNull();
    expect(checkMoveExpectation({ hasParts: ['b'], lacksParts: [] }, { labels, pieces: 1 })).toContain('"b"');
    expect(checkMoveExpectation({ hasParts: [], lacksParts: ['a'] }, { labels, pieces: 1 })).toContain('"a"');
    expect(checkMoveExpectation({ hasParts: [], lacksParts: [], pieces: 3 }, { labels: null, pieces: 2 })).toContain('3 pieces');
  });
  it('records what each side of a fused-parts move must hold', () => {
    const p = plan(summary({ a: range(0, 4), b: range(4, 3), c: range(7, 3) }, 1), ['part:a']);
    if ('error' in p) throw new Error(p.error);
    expect(p.drop).toEqual({ hasParts: ['b', 'c'], lacksParts: ['a'] });
    expect(p.objects[0].expect).toEqual({ hasParts: ['a'], lacksParts: ['b', 'c'] });
  });
});

describe('shortListName', () => {
  it('lists up to three names, then counts', () => {
    expect(shortListName(['a', 'b', 'c'])).toBe('a, b, c');
    expect(shortListName(['a', 'b', 'c', 'd'])).toBe('a, b +2');
  });
});

describe('extendPartSelection', () => {
  it('adds same-kind keys, removes selected ones, and restarts on another kind', () => {
    expect(extendPartSelection([], 'part:a')).toEqual(['part:a']);
    expect(extendPartSelection(['part:a'], 'part:b')).toEqual(['part:a', 'part:b']);
    expect(extendPartSelection(['part:a', 'part:b'], 'part:a')).toEqual(['part:b']);
    expect(extendPartSelection(['part:a'], 'piece:1')).toEqual(['piece:1']);
    expect(extendPartSelection(['piece:0'], 'piece:2')).toEqual(['piece:0', 'piece:2']);
    expect(extendPartSelection(['part:a'], 'unlabeled')).toEqual(['unlabeled']);
    expect(extendPartSelection(['unlabeled'], 'part:a')).toEqual(['part:a']);
  });
});

describe('multi-selection chat context', () => {
  it('describes several parts and round-trips through splitPartSelectionContext', () => {
    const keys = ['part:a', 'part:b'];
    expect(describePartKeys(keys)).toBe('parts "a", "b"');
    expect(describePartKeys(['piece:0', 'piece:2'])).toBe('pieces 1, 3');
    const text = `${partSelectionChatContext(keys)}\n\nmake them red`;
    expect(splitPartSelectionContext(text)).toEqual({ context: 'parts "a", "b"', rest: 'make them red' });
  });
});
