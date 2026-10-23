import { describe, it, expect } from 'vitest';
import { insertRemovalLine, removePartCall, removePieceCall, removePieceComment, findRemovalLines, removeRemovalLine, pieceAnchorPoint } from '../../src/editor/removalCode';

describe('removal code lines', () => {
  it('quotes part names safely', () => {
    expect(removePartCall('wheel')).toBe('api.removePart("wheel");');
    expect(removePartCall('it\'s "x"')).toBe('api.removePart("it\'s \\"x\\"");');
  });

  it('rounds piece points and avoids -0', () => {
    expect(removePieceCall([1.234567, -0.00001, 30])).toBe('api.removePiece([1.2346, 0, 30]);');
  });
});

describe('insertRemovalLine', () => {
  it('inserts before the first statement, after a header comment', () => {
    const code = '// header\n// more\n\nconst { Manifold } = api;\nreturn x;';
    expect(insertRemovalLine(code, 'L;')).toBe('// header\n// more\n\nL;\nconst { Manifold } = api;\nreturn x;');
  });

  it('skips block comments', () => {
    const code = '/* a\n b */\nreturn x;';
    expect(insertRemovalLine(code, 'L;')).toBe('/* a\n b */\nL;\nreturn x;');
  });

  it('inserts at the very top when there is no header', () => {
    expect(insertRemovalLine('return x;', 'L;')).toBe('L;\nreturn x;');
  });

  it('keeps earlier removals together and is idempotent', () => {
    const once = insertRemovalLine('// h\nreturn x;', 'A;');
    const twice = insertRemovalLine(once, 'B;');
    expect(twice).toBe('// h\nB;\nA;\nreturn x;');
    expect(insertRemovalLine(twice, 'A;')).toBe(twice);
  });
});

describe('removal comments', () => {
  it('names the piece 1-based, with its part when known', () => {
    expect(removePieceComment(2, 'wheel')).toBe('// piece 3 ("wheel")');
    expect(removePieceComment(0)).toBe('// piece 1');
  });

  it('treats a commented piece line as the same removal', () => {
    const line = `${removePieceCall([1, 2, 3])} ${removePieceComment(0)}`;
    const code = insertRemovalLine('return x;', line);
    expect(code).toBe(`${line}\nreturn x;`);
    expect(insertRemovalLine(code, removePieceCall([1, 2, 3]))).toBe(code);
  });
});

describe('findRemovalLines', () => {
  it('lists part and piece removals with canonical calls and piece labels', () => {
    const code = [
      '// header',
      'api.removePart("wheel");',
      "  api.removePart('it\\'s');",
      'api.removePiece([1.5, -2, 3e2]); // piece 3 ("hub")',
      'api.removePiece([0, 0, 0])',
      'const keep = api.removePart; // not a call line',
      'return x;',
    ].join('\n');
    expect(findRemovalLines(code)).toEqual([
      { kind: 'part', name: 'wheel', call: 'api.removePart("wheel");', source: 'api.removePart("wheel");' },
      { kind: 'part', name: "it's", call: 'api.removePart("it\'s");', source: "api.removePart('it\\'s');" },
      { kind: 'piece', point: [1.5, -2, 300], label: 'piece 3 ("hub")', call: 'api.removePiece([1.5, -2, 300]);', source: 'api.removePiece([1.5, -2, 3e2]); // piece 3 ("hub")' },
      { kind: 'piece', point: [0, 0, 0], call: 'api.removePiece([0, 0, 0]);', source: 'api.removePiece([0, 0, 0])' },
    ]);
  });

  it('decodes escapes in both quote styles', () => {
    const name = 'it\'s "x"\\y';
    const lines = [removePartCall(name), `api.removePart('it\\'s \\"x\\"\\\\y');`].join('\n');
    expect(findRemovalLines(lines).map(r => r.name)).toEqual([name, name]);
  });

  it('ignores code without removals', () => {
    expect(findRemovalLines('const a = 1;\nreturn a;')).toEqual([]);
  });
});

describe('removeRemovalLine', () => {
  it('is the inverse of insertRemovalLine', () => {
    const base = '// h\nreturn x;';
    const line = `${removePieceCall([1, 2, 3])} ${removePieceComment(1, 'a')}`;
    const withBoth = insertRemovalLine(insertRemovalLine(base, removePartCall('wheel')), line);
    const noPiece = removeRemovalLine(withBoth, removePieceCall([1, 2, 3]));
    expect(noPiece).toBe(insertRemovalLine(base, removePartCall('wheel')));
    expect(removeRemovalLine(noPiece, removePartCall('wheel'))).toBe(base);
  });

  it('matches a hand-written single-quoted call', () => {
    expect(removeRemovalLine("api.removePart('wheel')\nreturn x;", removePartCall('wheel'))).toBe('return x;');
  });

  it('leaves code unchanged when the removal is absent', () => {
    expect(removeRemovalLine('return x;', removePartCall('wheel'))).toBe('return x;');
  });
});

describe('pieceAnchorPoint', () => {
  it('returns the centroid of the largest triangle', () => {
    const vertProperties = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 10, 0, 0, 0, 10, 0]);
    const triVerts = new Uint32Array([0, 1, 2, 0, 3, 4]);
    const p = pieceAnchorPoint({ vertProperties, triVerts, numProp: 3 }, [0, 1]);
    expect(p).not.toBeNull();
    expect(p![0]).toBeCloseTo(10 / 3);
    expect(p![1]).toBeCloseTo(10 / 3);
    expect(p![2]).toBe(0);
  });

  it('is null for no triangles', () => {
    expect(pieceAnchorPoint({ vertProperties: new Float32Array(), triVerts: new Uint32Array(), numProp: 3 }, [])).toBeNull();
  });
});
