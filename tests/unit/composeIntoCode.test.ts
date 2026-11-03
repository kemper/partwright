import { describe, expect, it } from 'vitest';
import { besideOffset, composeImportIntoCode, importAsParts, translatedVerts, vertexBox } from '../../src/import/composeIntoCode';
import type { ImportedMesh } from '../../src/import/importedMesh';

const CODE = `// My bracket
api.removePart("old");
api.movePart("a", [1, 0, 0]);

const { Manifold } = api;
return api.label(Manifold.cube(10), 'a');
`;

describe('composeImportIntoCode', () => {
  it('wraps the code and keeps header, removal and edit lines on top', () => {
    const out = composeImportIntoCode(CODE, 2);
    expect(out.split('\n')).toEqual([
      '// My bracket',
      'api.removePart("old");',
      'api.movePart("a", [1, 0, 0]);',
      'const __partwrightBase = (() => {',
      '',
      'const { Manifold } = api;',
      "return api.label(Manifold.cube(10), 'a');",
      '})();',
      'return api.Manifold.compose([__partwrightBase, api.importWithParts(2)]);',
      '',
    ]);
  });

  it('keeps a block-comment header on top', () => {
    const out = composeImportIntoCode('/* header\n * more */\napi.movePart("a", [1, 0, 0]);\nreturn x;', 0);
    expect(out.split('\n').slice(0, 4)).toEqual(['/* header', ' * more */', 'api.movePart("a", [1, 0, 0]);', 'const __partwrightBase = (() => {']);
  });

  it('extends the compose list on a second import', () => {
    const once = composeImportIntoCode(CODE, 1);
    const twice = composeImportIntoCode(once, 2);
    expect(twice.match(/__partwrightBase = /g)).toHaveLength(1);
    expect(twice).toContain('return api.Manifold.compose([__partwrightBase, api.importWithParts(1), api.importWithParts(2)]);');
  });
});

describe('importAsParts', () => {
  const mesh = (parts?: ImportedMesh['parts']): ImportedMesh => ({
    id: 'm', filename: 'x.stl', format: 'stl', numProp: 3, numVert: 3, numTri: 2,
    vertProperties: new Float32Array(9), triVerts: new Uint32Array([0, 1, 2, 0, 2, 1]), ...(parts ? { parts } : {}),
  } as ImportedMesh);

  it('makes a part-less mesh one part, renaming a clash', () => {
    const p = importAsParts(mesh(), 'bolt', ['bolt', 'bolt 2']);
    expect(p.names).toEqual(['bolt 3']);
    expect(Array.from(p.triPart)).toEqual([0, 0]);
  });

  it('keeps a mesh’s own parts, renaming clashes', () => {
    const p = importAsParts(mesh({ names: ['lid', 'base'], colors: ['#ff0000', null], triPart: new Int32Array([0, 1]) }), 'kit', ['base']);
    expect(p.names).toEqual(['lid', 'base 2']);
    expect(p.colors).toEqual(['#ff0000', null]);
  });
});

describe('besideOffset / vertexBox / translatedVerts', () => {
  it('puts the import past the +X side, centred in Y, on the same floor', () => {
    const base = { min: [0, 0, 0], max: [10, 20, 5] } as { min: [number, number, number]; max: [number, number, number] };
    const add = { min: [-1, -1, 3], max: [1, 1, 4] } as typeof base;
    expect(besideOffset(base, add, 2)).toEqual([13, 10, -3]);
  });
  it('reads boxes and moves vertices with extra properties', () => {
    const v = new Float32Array([0, 0, 0, 9, 1, 2, 3, 9]);
    expect(vertexBox(v, 4)).toEqual({ min: [0, 0, 0], max: [1, 2, 3] });
    expect(Array.from(translatedVerts(v, 4, [1, 1, 1]))).toEqual([1, 1, 1, 9, 2, 3, 4, 9]);
  });
});
