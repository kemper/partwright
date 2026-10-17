import { describe, expect, it } from 'vitest';
import { generateImportCode, rewriteImportsWithParts } from '../../src/import/codegen';
import type { ImportedMesh } from '../../src/import/importedMesh';
import { normalizeImportParts, orderTrianglesByPart } from '../../src/import/importParts';

describe('orderTrianglesByPart', () => {
  it('groups triangles into contiguous runs, unassigned last', () => {
    const triVerts = Uint32Array.from([0, 1, 2, 10, 11, 12, 20, 21, 22, 30, 31, 32]);
    const { triVerts: out, runs } = orderTrianglesByPart(triVerts, Int32Array.from([1, -1, 0, 1]), 3);
    expect([...out]).toEqual([20, 21, 22, 0, 1, 2, 30, 31, 32, 10, 11, 12]);
    expect(runs).toEqual([
      { part: 0, startTri: 0, endTri: 1 },
      { part: 1, startTri: 1, endTri: 3 },
      { part: -1, startTri: 3, endTri: 4 },
    ]);
  });
});

describe('normalizeImportParts', () => {
  const ok = { names: ['hair', 'face'], colors: ['#111111', 'bad'], triPart: Int32Array.from([0, 1, -1]) };
  it('accepts valid parts and drops bad colours', () => {
    expect(normalizeImportParts(ok, 3)?.colors).toEqual(['#111111', null]);
  });
  it('rejects mismatched length, out-of-range indices, duplicate names', () => {
    expect(normalizeImportParts(ok, 4)).toBeNull();
    expect(normalizeImportParts({ ...ok, triPart: Int32Array.from([0, 2, 0]) }, 3)).toBeNull();
    expect(normalizeImportParts({ ...ok, names: ['a', 'a'] }, 3)).toBeNull();
    expect(normalizeImportParts({ ...ok, triPart: [0, 1, 0] }, 3)).toBeNull();
  });
});

describe('import codegen with parts', () => {
  const mesh = (parts?: boolean): ImportedMesh => ({
    id: 'a', filename: 'fig.stl', format: 'stl', numProp: 3, numVert: 3, numTri: 1,
    vertProperties: new Float32Array(9), triVerts: Uint32Array.from([0, 1, 2]),
    ...(parts ? { parts: { names: ['x'], colors: [null], triPart: Int32Array.from([0]) } } : {}),
  });
  it('emits api.importWithParts when parts are committed', () => {
    expect(generateImportCode([mesh(true)])).toContain('return api.importWithParts(0);');
    expect(generateImportCode([mesh(false)])).toContain('Manifold.ofMesh(api.imports[0])');
    expect(generateImportCode([mesh(false), mesh(true)])).toContain('  api.importWithParts(1),');
  });
  it('rewrites existing ofMesh calls for the given index only', () => {
    const code = 'const a = Manifold.ofMesh(api.imports[0]);\nconst b = Manifold.ofMesh( api.imports[ 1 ] );';
    const r = rewriteImportsWithParts(code, 1);
    expect(r.changed).toBe(true);
    expect(r.code).toBe('const a = Manifold.ofMesh(api.imports[0]);\nconst b = api.importWithParts(1);');
    expect(rewriteImportsWithParts(r.code, 1).changed).toBe(false);
  });
});
