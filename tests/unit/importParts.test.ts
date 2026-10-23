import { describe, expect, it } from 'vitest';
import { generateImportCode, rewriteImportsWithParts } from '../../src/import/codegen';
import type { ImportedMesh } from '../../src/import/importedMesh';
import { normalizeImportParts, orderTrianglesByPart, removeImportPartTriangles } from '../../src/import/importParts';

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

// A closed unit cube (vertex i = x + 2y + 4z), outward-facing quads split in two.
function cube(offset = 0): { vertProperties: number[]; triVerts: number[] } {
  const vertProperties: number[] = [];
  for (let i = 0; i < 8; i++) vertProperties.push((i & 1) + offset, (i >> 1) & 1, (i >> 2) & 1);
  const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
  const triVerts: number[] = [];
  for (const [a, b, c, d] of quads) triVerts.push(a, b, c, a, c, d);
  return { vertProperties, triVerts };
}

function isClosed(triVerts: Uint32Array): boolean {
  const edges = new Set<string>();
  for (let i = 0; i < triVerts.length; i += 3) {
    for (let k = 0; k < 3; k++) edges.add(`${triVerts[i + k]},${triVerts[i + (k + 1) % 3]}`);
  }
  for (const e of edges) {
    const [a, b] = e.split(',');
    if (!edges.has(`${b},${a}`)) return false;
  }
  return true;
}

describe('removeImportPartTriangles', () => {
  it('drops a fused part and caps the opening it leaves', () => {
    const c = cube();
    const triVerts = Uint32Array.from(c.triVerts);
    expect(isClosed(triVerts)).toBe(true); // precondition: the fixture is watertight
    const triPart = new Int32Array(12).fill(0);
    triPart[2] = triPart[3] = 1; // the top face is part 1
    const out = removeImportPartTriangles({ numProp: 3, vertProperties: Float32Array.from(c.vertProperties), triVerts }, triPart, new Set([1]));
    expect(out.openings).toBe(1);
    expect(out.triVerts.length / 3).toBe(10 + 4); // 10 kept + a 4-triangle fan
    expect(out.vertProperties.length).toBe(9 * 3); // one centroid vertex added
    expect([...out.vertProperties.slice(24)]).toEqual([0.5, 0.5, 1]);
    expect(isClosed(out.triVerts)).toBe(true);
    // The cap closes part 0's surface, so it joins part 0.
    expect([...out.triPart].filter(p => p === 0)).toHaveLength(14);
    expect([...out.triPart].includes(1)).toBe(false);
  });

  it('leaves no opening when the part was its own closed shell', () => {
    const a = cube(), b = cube(5);
    const vertProperties = Float32Array.from([...a.vertProperties, ...b.vertProperties]);
    const triVerts = Uint32Array.from([...a.triVerts, ...b.triVerts.map(v => v + 8)]);
    const triPart = Int32Array.from([...new Array(12).fill(0), ...new Array(12).fill(1)]);
    const out = removeImportPartTriangles({ numProp: 3, vertProperties, triVerts }, triPart, new Set([1]));
    expect(out.openings).toBe(0);
    expect(out.triVerts.length / 3).toBe(12);
    expect(isClosed(out.triVerts)).toBe(true);
  });
});
