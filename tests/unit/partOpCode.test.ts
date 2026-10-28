import { describe, expect, it } from 'vitest';
import { addPartOps, findPartOpLines, formatPartOp, parsePartOpLine, partsCreatedByOps, removeCreatedPart, renamePartInOps } from '../../src/editor/partOpCode';
import type { PartOp } from '../../src/geometry/partOps';

const BODY = `// Imported from kit.3mf
const { Manifold } = api;
return api.importWithParts(0);`;

describe('formatPartOp / parsePartOpLine', () => {
  const ops: PartOp[] = [
    { kind: 'move', part: 'a', offset: [1, -2.5, 0] },
    { kind: 'rotate', part: 'b "x"', degrees: [0, 0, 90] },
    { kind: 'scale', part: 'c', factor: [2, 2, 2] },
    { kind: 'scale', part: 'c', factor: [1, 2, 3] },
    { kind: 'mirror', part: 'd', axis: 'y' },
    { kind: 'copy', part: 'a', as: 'a 2', offset: [10, 0, 0] },
    { kind: 'group', parts: ['a', 'b'], as: 'ab' },
    { kind: 'cut', part: 'hole' },
  ];
  it('round-trips every kind', () => {
    for (const op of ops) expect(parsePartOpLine(formatPartOp(op))).toEqual(op);
  });
  it('writes readable lines', () => {
    expect(formatPartOp(ops[0])).toBe('api.movePart("a", [1, -2.5, 0]);');
    expect(formatPartOp(ops[2])).toBe('api.scalePart("c", 2);');
    expect(formatPartOp(ops[6])).toBe('api.groupParts(["a", "b"], "ab");');
  });
  it('reads single quotes and ignores other code', () => {
    expect(parsePartOpLine("api.movePart('a', [1, 2, 3]); // nudge")).toEqual({ kind: 'move', part: 'a', offset: [1, 2, 3] });
    expect(parsePartOpLine('return api.importWithParts(0);')).toBeNull();
    expect(parsePartOpLine('api.movePart("a", [1, 2]);')).toBeNull();
  });
});

describe('addPartOps', () => {
  it('puts the block under the header comment and removal lines, in order', () => {
    const code = `// header\napi.removePart("old");\n${BODY.split('\n').slice(1).join('\n')}`;
    const out = addPartOps(code, [{ kind: 'move', part: 'a', offset: [1, 0, 0] }, { kind: 'mirror', part: 'b', axis: 'x' }]);
    expect(out.split('\n').slice(0, 4)).toEqual(['// header', 'api.removePart("old");', 'api.movePart("a", [1, 0, 0]);', 'api.mirrorPart("b", "x");']);
    // Later edits go after the existing block.
    const again = addPartOps(out, [{ kind: 'cut', part: 'c' }]);
    expect(findPartOpLines(again).map(x => x.op.kind)).toEqual(['move', 'mirror', 'cut']);
  });

  it('folds repeated moves of a part, and drops a move that cancels out', () => {
    let code = addPartOps(BODY, [{ kind: 'move', part: 'a', offset: [1, 0, 0] }]);
    code = addPartOps(code, [{ kind: 'move', part: 'b', offset: [0, 1, 0] }, { kind: 'move', part: 'a', offset: [1, 2, 0] }]);
    expect(findPartOpLines(code).map(x => x.op)).toEqual([
      { kind: 'move', part: 'a', offset: [2, 2, 0] },
      { kind: 'move', part: 'b', offset: [0, 1, 0] },
    ]);
    code = addPartOps(code, [{ kind: 'move', part: 'b', offset: [0, -1, 0] }]);
    expect(findPartOpLines(code).map(x => x.op.part)).toEqual(['a']);
  });

  it('does not fold across a later edit that reads the part', () => {
    let code = addPartOps(BODY, [{ kind: 'move', part: 'a', offset: [1, 0, 0] }, { kind: 'copy', part: 'a', as: 'a 2', offset: [5, 0, 0] }]);
    code = addPartOps(code, [{ kind: 'move', part: 'a', offset: [1, 0, 0] }]);
    expect(findPartOpLines(code).map(x => x.op.kind)).toEqual(['move', 'copy', 'move']);
  });

  it('adds up quarter turns about one axis', () => {
    let code = addPartOps(BODY, [{ kind: 'rotate', part: 'a', degrees: [0, 0, 90] }]);
    code = addPartOps(code, [{ kind: 'rotate', part: 'a', degrees: [0, 0, 90] }]);
    expect(findPartOpLines(code).map(x => x.op)).toEqual([{ kind: 'rotate', part: 'a', degrees: [0, 0, 180] }]);
    code = addPartOps(code, [{ kind: 'rotate', part: 'a', degrees: [0, 0, 180] }]);
    expect(findPartOpLines(code)).toEqual([]);
    // Different axes stay separate lines.
    code = addPartOps(code, [{ kind: 'rotate', part: 'a', degrees: [90, 0, 0] }, { kind: 'rotate', part: 'a', degrees: [0, 90, 0] }]);
    expect(findPartOpLines(code).length).toBe(2);
  });
});

describe('renamePartInOps / removeCreatedPart', () => {
  const code = addPartOps(BODY, [
    { kind: 'copy', part: 'a', as: 'a 2', offset: [5, 0, 0] },
    { kind: 'move', part: 'a 2', offset: [0, 5, 0] },
    { kind: 'copy', part: 'a 2', as: 'a 3', offset: [5, 0, 0] },
    { kind: 'group', parts: ['b', 'c'], as: 'bc' },
    { kind: 'move', part: 'bc', offset: [1, 1, 0] },
  ]);

  it('renames a part everywhere it appears', () => {
    const out = renamePartInOps(code, 'a 2', 'spare');
    expect(findPartOpLines(out).map(x => x.op)).toContainEqual({ kind: 'copy', part: 'spare', as: 'a 3', offset: [5, 0, 0] });
    expect(partsCreatedByOps(out)).toEqual(new Set(['spare', 'a 3', 'bc']));
  });

  it('deleting a copy removes the copies made from it too', () => {
    const out = removeCreatedPart(code, 'a 2');
    expect(findPartOpLines(out).map(x => x.op.kind)).toEqual(['group', 'move']);
  });

  it('ungrouping removes the group and its edits', () => {
    const out = removeCreatedPart(code, 'bc');
    expect(findPartOpLines(out).map(x => x.op.kind)).toEqual(['copy', 'move', 'copy']);
    expect(removeCreatedPart(code, 'nope')).toBe(code);
  });
});
