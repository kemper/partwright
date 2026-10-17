import { describe, it, expect } from 'vitest';
import { changedLineRange, tokenizeMinimapLines, type MinimapRun } from '../../src/editor/minimapModel';

const kinds = (runs: MinimapRun[], line: string) => runs.map((r) => [line.slice(r.start, r.end), r.kind]);

describe('tokenizeMinimapLines', () => {
  it('classifies keywords, calls, properties, numbers, strings, and punctuation', () => {
    const line = "const box = Manifold.cube([10, 2.5], 'x');";
    const [runs] = tokenizeMinimapLines([line], 'js');
    expect(kinds(runs, line)).toEqual([
      ['const', 'keyword'],
      ['box', 'text'],
      ['=', 'punct'],
      ['Manifold', 'text'],
      ['.', 'punct'],
      ['cube', 'call'],
      ['([', 'punct'],
      ['10', 'number'],
      [',', 'punct'],
      ['2.5', 'number'],
      ['],', 'punct'],
      ["'x'", 'string'],
      [');', 'punct'],
    ]);
  });

  it('tags a dotted member access that is not called as a property', () => {
    const line = 'const { Manifold } = api.lib;';
    const [runs] = tokenizeMinimapLines([line], 'js');
    expect(kinds(runs, line)).toContainEqual(['lib', 'property']);
  });

  it('skips whitespace and preserves indentation columns', () => {
    const line = '    return x;';
    const [runs] = tokenizeMinimapLines([line], 'js');
    expect(runs[0]).toEqual({ start: 4, end: 10, kind: 'keyword' });
  });

  it('carries block comments and template literals across lines', () => {
    const lines = ['/* start', 'middle', 'end */ let a = `one', 'two` + 1;'];
    const runs = tokenizeMinimapLines(lines, 'js');
    expect(runs[0]).toEqual([{ start: 0, end: 8, kind: 'comment' }]);
    expect(runs[1]).toEqual([{ start: 0, end: 6, kind: 'comment' }]);
    expect(kinds(runs[2], lines[2])).toEqual([
      ['end */', 'comment'], ['let', 'keyword'], ['a', 'text'], ['=', 'punct'], ['`one', 'string'],
    ]);
    expect(kinds(runs[3], lines[3])).toEqual([['two`', 'string'], ['+', 'punct'], ['1', 'number'], [';', 'punct']]);
  });

  it('handles escaped quotes and line comments', () => {
    const line = 'x("a\\"b"); // done';
    const [runs] = tokenizeMinimapLines([line], 'js');
    expect(kinds(runs, line)).toEqual([
      ['x', 'call'], ['(', 'punct'], ['"a\\"b"', 'string'], [');', 'punct'], ['// done', 'comment'],
    ]);
  });

  it('clips runs to maxCols but still carries comment state past the cap', () => {
    const long = `const data = [${Array.from({ length: 200 }, (_, i) => i).join(', ')}]; /* open`;
    const runs = tokenizeMinimapLines([long, 'still comment */ x'], 'js', 20);
    expect(runs[0].every((r) => r.end <= 20)).toBe(true);
    expect(runs[1][0]).toEqual({ start: 0, end: 16, kind: 'comment' });
  });

  it('uses the SCAD keyword set (and no template literals) for scad', () => {
    const line = 'module m() { cube(3); } // `tick';
    const [runs] = tokenizeMinimapLines([line], 'scad');
    expect(kinds(runs, line)).toContainEqual(['module', 'keyword']);
    expect(kinds(runs, line)).toContainEqual(['cube', 'call']);
    // `const` isn't a SCAD keyword.
    const [constRuns] = tokenizeMinimapLines(['const = 1;'], 'scad');
    expect(constRuns[0].kind).toBe('text');
  });
});

describe('changedLineRange', () => {
  const base = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];

  it('returns null for identical docs or an empty baseline', () => {
    expect(changedLineRange(base, [...base])).toBeNull();
    expect(changedLineRange([], base)).toBeNull();
    expect(changedLineRange([''], base)).toBeNull();
  });

  it('finds an in-place edit', () => {
    const next = [...base];
    next[4] = 'E';
    expect(changedLineRange(base, next)).toEqual({ from: 4, to: 4 });
  });

  it('spans inserted lines', () => {
    const next = [...base.slice(0, 3), 'x', 'y', ...base.slice(3)];
    expect(changedLineRange(base, next)).toEqual({ from: 3, to: 4 });
  });

  it('anchors a pure deletion on the line where text vanished', () => {
    const next = [...base.slice(0, 5), ...base.slice(7)];
    expect(changedLineRange(base, next)).toEqual({ from: 5, to: 5 });
  });

  it('anchors a deletion at the end of the doc on the last line', () => {
    expect(changedLineRange(base, base.slice(0, 8))).toEqual({ from: 7, to: 7 });
  });

  it('ignores a wholesale replacement (session / version swap)', () => {
    expect(changedLineRange(base, base.map((l) => l.toUpperCase()))).toBeNull();
  });
});
