// Colour seeding for coloured mesh imports (src/import/colorSeed.ts): which
// output triangles take which palette entry, and the single-colour test.

import { describe, it, expect } from 'vitest';
import { matchImportColors, singleColorIndex } from '../../src/import/colorSeed';
import type { CentroidMesh } from '../../src/surface/colorTransfer';

/** A flat n×n grid of quads (2 triangles each) on z = 0, cell size 1, offset by `dx`. */
function grid(n: number, dx = 0): CentroidMesh {
  const vertProperties = new Float32Array((n + 1) * (n + 1) * 3);
  for (let y = 0; y <= n; y++) {
    for (let x = 0; x <= n; x++) {
      const i = (y * (n + 1) + x) * 3;
      vertProperties[i] = x + dx; vertProperties[i + 1] = y; vertProperties[i + 2] = 0;
    }
  }
  const triVerts = new Uint32Array(n * n * 6);
  let k = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const a = y * (n + 1) + x, b = a + 1, c = a + n + 1, d = c + 1;
      triVerts.set([a, b, d, a, d, c], k); k += 6;
    }
  }
  return { vertProperties, triVerts, numProp: 3, numTri: n * n * 2 };
}

/** `m`'s triangles in reverse order (what an import wrapper's reordering looks like). */
function reversed(m: CentroidMesh): CentroidMesh {
  const triVerts = new Uint32Array(m.triVerts.length);
  for (let t = 0; t < m.numTri; t++) triVerts.set(m.triVerts.subarray(t * 3, t * 3 + 3), (m.numTri - 1 - t) * 3);
  return { ...m, triVerts };
}

/** Two meshes as one (the second's vertex indices shifted). */
function concat(a: CentroidMesh, b: CentroidMesh): CentroidMesh {
  const nv = a.vertProperties.length / 3;
  const vertProperties = new Float32Array(a.vertProperties.length + b.vertProperties.length);
  vertProperties.set(a.vertProperties); vertProperties.set(b.vertProperties, a.vertProperties.length);
  const triVerts = new Uint32Array(a.triVerts.length + b.triVerts.length);
  triVerts.set(a.triVerts); triVerts.set(Array.from(b.triVerts, v => v + nv), a.triVerts.length);
  return { vertProperties, triVerts, numProp: 3, numTri: a.numTri + b.numTri };
}

describe('singleColorIndex', () => {
  it('reports the shared palette index', () => {
    expect(singleColorIndex(new Int32Array([2, 2, 2]))).toBe(2);
    expect(singleColorIndex(new Int32Array([0]))).toBe(0);
  });
  it('is -1 when triangles differ, are uncoloured, or there are none', () => {
    expect(singleColorIndex(new Int32Array([0, 1, 0]))).toBe(-1);
    expect(singleColorIndex(new Int32Array([0, -1]))).toBe(-1);
    expect(singleColorIndex(new Int32Array([-1, -1]))).toBe(-1);
    expect(singleColorIndex(new Int32Array())).toBe(-1);
  });
});

describe('matchImportColors', () => {
  it('carries colours onto a reordered copy, grouped in palette order', () => {
    const src = grid(4);
    // Left half colour 1, right half colour 0, one triangle uncoloured.
    const triColor = new Int32Array(src.numTri);
    for (let t = 0; t < src.numTri; t++) triColor[t] = (Math.floor(t / 2) % 4) < 2 ? 1 : 0;
    triColor[0] = -1;
    const out = reversed(src);
    const groups = matchImportColors(src, out, triColor);
    expect(groups.map(g => g.colorIdx)).toEqual([0, 1]);
    const got = new Int32Array(out.numTri).fill(-1);
    for (const g of groups) for (const t of g.triangleIds) got[t] = g.colorIdx;
    for (let t = 0; t < out.numTri; t++) expect(got[t]).toBe(triColor[src.numTri - 1 - t]);
    // Ids come back ascending.
    for (const g of groups) expect([...g.triangleIds]).toEqual([...g.triangleIds].sort((a, b) => a - b));
  });

  it('leaves geometry beside the import uncoloured', () => {
    const src = grid(4);
    const triColor = new Int32Array(src.numTri).fill(0);
    triColor[3] = 1;
    const out = concat(grid(4, 50), src); // other geometry first, then the import
    const groups = matchImportColors(src, out, triColor);
    const coloured = groups.reduce((n, g) => n + g.triangleIds.length, 0);
    expect(coloured).toBe(src.numTri);
    for (const g of groups) for (const t of g.triangleIds) expect(t).toBeGreaterThanOrEqual(src.numTri);
  });

  it('stays fast when most of the output is far from a dense import', () => {
    // 20,000 source triangles; 5,000 output triangles one model-width away.
    // Uncapped, every far triangle walked the whole grid: minutes, not ms.
    const src = grid(100);
    const out = concat(grid(50, 250), src);
    const t0 = performance.now();
    const groups = matchImportColors(src, out, new Int32Array(src.numTri).fill(3));
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(groups).toHaveLength(1);
    expect(groups[0].triangleIds.length).toBe(src.numTri);
  });
});
