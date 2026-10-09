import { describe, it, expect } from 'vitest';
import { findLabelSource, renameLabelInCode, upsertPaintLabelInCode, wrapWithPieceFilter, parsePieceFilter } from '../../src/geometry/objectPartCode';

const CODE = `const { Manifold } = api;
// the 'handle' sticks out
const body = api.label(Manifold.cylinder(40, 22, 22, 64), 'body');
const handle = api.label(Manifold.cube([4, 4, 20], true), "handle", { color: '#f97316' });
api.paint.label('handle', '#ff0000');
api.surface.knurl({ label: 'handle', depth: 0.4 });
return body.add(handle);`;

describe('findLabelSource', () => {
  it('prefers the api.label declaration over earlier mentions and paint calls', () => {
    const src = findLabelSource(CODE, 'handle')!;
    expect(src.line).toBe(4);
    expect(CODE.slice(src.from, src.to)).toBe('"handle"');
  });
  it('finds SCAD label("name") and returns null when absent', () => {
    expect(findLabelSource('cube(1);\nlabel("lid") cube(2);', 'lid')!.line).toBe(2);
    expect(findLabelSource(CODE, 'nope')).toBeNull();
  });
});

describe('renameLabelInCode', () => {
  it('renames every literal naming the part, keeping each quote style', () => {
    const { code, count } = renameLabelInCode(CODE, 'handle', 'grip');
    expect(count).toBe(4);
    expect(code).toContain(`"grip", { color`);
    expect(code).toContain(`api.paint.label('grip'`);
    expect(code).toContain(`{ label: 'grip', depth`);
    expect(code).toContain('const handle ='); // identifiers untouched
    expect(code).not.toContain("'handle'");
  });
  it('escapes quotes in the new name and ignores interpolated templates', () => {
    const { code } = renameLabelInCode("api.label(x, 'a'); `a${1}`", 'a', "it's");
    expect(code).toBe("api.label(x, 'it\\'s'); `a${1}`");
  });
  it('is a no-op when nothing matches', () => {
    expect(renameLabelInCode(CODE, 'zzz', 'q')).toEqual({ code: CODE, count: 0 });
  });
});

describe('upsertPaintLabelInCode', () => {
  it('updates an existing api.paint.label colour', () => {
    const out = upsertPaintLabelInCode(CODE, 'handle', '#00ff00')!;
    expect(out).toContain("api.paint.label('handle', '#00ff00');");
    expect(out.match(/api\.paint\.label/g)).toHaveLength(1);
  });
  it('inserts a call before the final top-level return', () => {
    const out = upsertPaintLabelInCode(CODE, 'body', '#112233')!;
    expect(out).toContain("api.paint.label('body', '#112233');\nreturn body.add(handle);");
  });
  it('returns null without a top-level return', () => {
    expect(upsertPaintLabelInCode('const f = () => { return 1; };', 'x', '#000000')).toBeNull();
  });
});

describe('wrapWithPieceFilter', () => {
  it('wraps the code once and appends to an existing filter of the same mode', () => {
    const once = wrapWithPieceFilter(CODE, 'drop', [[1, 2, 3, 4, 5, 6]])!;
    expect(parsePieceFilter(once)).toMatchObject({ mode: 'drop', boxes: [[1, 2, 3, 4, 5, 6]] });
    expect(once).toContain('  return body.add(handle);'); // original indented inside the IIFE
    const twice = wrapWithPieceFilter(once, 'drop', [[7, 8, 9, 1, 1, 1]])!;
    expect(parsePieceFilter(twice)!.boxes).toHaveLength(2);
    expect(twice.match(/__pwFilterPieces/g)).toHaveLength(1);
  });
  it('nests a keep filter around a drop-filtered object', () => {
    const drop = wrapWithPieceFilter(CODE, 'drop', [[0, 0, 0, 1, 1, 1]])!;
    const keep = wrapWithPieceFilter(drop, 'keep', [[0, 0, 0, 2, 2, 2]])!;
    expect(parsePieceFilter(keep)!.mode).toBe('keep');
    expect(keep.match(/__pwFilterPieces/g)).toHaveLength(2);
  });
  it('needs a top-level return', () => {
    expect(wrapWithPieceFilter('function f() { return 1; }', 'drop', [[0, 0, 0, 1, 1, 1]])).toBeNull();
  });
});

describe('parsePieceFilter after auto-format', () => {
  it('reads a spec the formatter spread over several lines', () => {
    const wrapped = wrapWithPieceFilter(CODE, 'drop', [[1, 2, 3, 4, 5, 6]])!;
    const formatted = wrapped.replace(/const __pwPieces = .*;/, `const __pwPieces = {\n  mode: 'drop',\n  boxes: [\n    [1, 2, 3, 4, 5, 6],\n  ],\n};`);
    const parsed = parsePieceFilter(formatted)!;
    expect(parsed.mode).toBe('drop');
    expect(parsed.boxes).toEqual([[1, 2, 3, 4, 5, 6]]);
    const again = wrapWithPieceFilter(formatted, 'drop', [[0, 0, 0, 1, 1, 1]])!;
    expect(again.match(/__pwFilterPieces/g)).toHaveLength(1);
    expect(parsePieceFilter(again)!.boxes).toHaveLength(2);
  });
});
