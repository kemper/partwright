import { describe, it, expect } from 'vitest';
import { insertRemovalLine, removePartCall, removePieceCall, pieceAnchorPoint } from '../../src/editor/removalCode';

describe('removal code lines', () => {
  it('quotes part names safely', () => {
    expect(removePartCall('wheel')).toBe('api.removePart("wheel");');
    expect(removePartCall('it\'s "x"')).toBe('api.removePart("it\'s \\"x\\"");');
  });

  it('writes OpenSCAD syntax for scad', () => {
    expect(removePartCall('lid', 'scad')).toBe('remove_part("lid");');
    expect(removePieceCall([1, 2.5, -3], 'scad')).toBe('remove_piece([1, 2.5, -3]);');
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
