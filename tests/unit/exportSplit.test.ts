import { describe, test, expect } from 'vitest';
import { analyzeObjectSplit, availableSplitModes, extractItemMesh, splitItems, isExportSplitMode } from '../../src/export/exportSplit';
import type { MeshData } from '../../src/geometry/types';

// Splitting one object into export items (the export picker's "Split" control):
// by connected piece, or by api.label part — fused parts stay together.

/** Axis-aligned boxes as one mesh (no shared vertices between boxes). */
function boxes(specs: { at: [number, number, number]; size: [number, number, number]; color?: [number, number, number] }[]): MeshData {
  const verts: number[] = [];
  const tris: number[] = [];
  const colors: number[] = [];
  for (const { at, size, color } of specs) {
    const base = verts.length / 3;
    for (let i = 0; i < 8; i++) {
      verts.push(at[0] + (i & 1 ? size[0] : 0), at[1] + (i & 2 ? size[1] : 0), at[2] + (i & 4 ? size[2] : 0));
    }
    const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
    for (const [a, b, c, d] of quads) {
      tris.push(base + a, base + b, base + c, base + a, base + c, base + d);
      for (let k = 0; k < 2; k++) colors.push(...(color ?? [200, 200, 200]));
    }
  }
  return {
    vertProperties: new Float32Array(verts), triVerts: new Uint32Array(tris),
    numVert: verts.length / 3, numTri: tris.length / 3, numProp: 3,
    triColors: new Uint8Array(colors),
  };
}
const range = (a: number, b: number) => new Set(Array.from({ length: b - a }, (_, i) => a + i));

describe('analyzeObjectSplit', () => {
  // Three separate boxes; box k owns triangles [12k, 12k+12).
  const mesh = boxes([
    { at: [0, 0, 0], size: [10, 10, 10] },
    { at: [20, 0, 0], size: [5, 5, 5] },
    { at: [40, 0, 0], size: [2, 3, 4], color: [255, 0, 0] },
  ]);

  test('one piece item per connected solid, named after its part', () => {
    const labels = new Map([['body', range(0, 12)]]);
    const a = analyzeObjectSplit(mesh, labels);
    expect(a.pieceCount).toBe(3);
    expect(a.pieces!.map(p => p.name)).toEqual(['body', 'Piece 2', 'Piece 3']);
    expect(a.pieces![2].size).toEqual([2, 3, 4]);
    expect(a.size).toEqual([42, 10, 10]);
  });

  test('parts: one item per label; unlabeled pieces travel together', () => {
    const labels = new Map([['body', range(0, 12)], ['lid', range(12, 24)]]);
    const a = analyzeObjectSplit(mesh, labels);
    expect(a.parts!.map(p => [p.name, p.fused, p.triangles.length])).toEqual([
      ['body', false, 12], ['lid', false, 12], ['Unlabeled', false, 12],
    ]);
    expect(availableSplitModes(a)).toEqual(['whole', 'pieces', 'parts']);
  });

  test('parts that share a solid stay together, marked fused', () => {
    // hair + face on the same box; base on another.
    const labels = new Map([['hair', range(0, 6)], ['face', range(6, 12)], ['base', range(12, 36)]]);
    const a = analyzeObjectSplit(mesh, labels);
    expect(a.parts!.map(p => [p.name, p.fused, p.labels])).toEqual([
      ['hair + face', true, ['hair', 'face']], ['base', false, ['base']],
    ]);
  });

  test('a label spanning several pieces makes one item', () => {
    const labels = new Map([['wheels', range(12, 36)], ['body', range(0, 12)]]);
    const a = analyzeObjectSplit(mesh, labels);
    expect(a.parts!.map(p => [p.name, p.triangles.length])).toEqual([['wheels', 24], ['body', 12]]);
  });

  test('modes that would make fewer than two items are unavailable', () => {
    const one = boxes([{ at: [0, 0, 0], size: [1, 1, 1] }]);
    const a = analyzeObjectSplit(one, new Map([['only', range(0, 12)]]));
    expect(a.pieces).toBeNull();
    expect(a.parts).toBeNull();
    expect(availableSplitModes(a)).toEqual(['whole']);
    expect(splitItems(a, 'pieces')).toBeNull();
  });

  test('a label whose ids fall outside the mesh makes no (empty) item', () => {
    const labels = new Map([['body', range(0, 12)], ['ghost', new Set([9999])], ['lid', range(12, 24)]]);
    const a = analyzeObjectSplit(mesh, labels);
    expect(a.parts!.map(p => p.name)).toEqual(['body', 'lid', 'Unlabeled']);
    expect(a.parts!.every(p => p.triangles.length > 0)).toBe(true);
  });

  test('maxItems caps a mode', () => {
    const a = analyzeObjectSplit(mesh, null, { maxItems: 2 });
    expect(a.pieceCount).toBe(3);
    expect(a.pieces).toBeNull();
  });

  test('duplicate piece names get numbered', () => {
    const labels = new Map([['pawn', range(0, 36)]]);
    const a = analyzeObjectSplit(mesh, labels);
    expect(a.pieces!.map(p => p.name)).toEqual(['pawn', 'pawn (2)', 'pawn (3)']);
  });
});

describe('extractItemMesh', () => {
  test('keeps modelled position and per-triangle colour', () => {
    const mesh = boxes([{ at: [0, 0, 0], size: [1, 1, 1] }, { at: [40, 0, 0], size: [2, 3, 4], color: [255, 0, 0] }]);
    const out = extractItemMesh(mesh, Array.from(range(12, 24)));
    expect(out.numTri).toBe(12);
    expect(out.numVert).toBe(8);
    expect(Math.min(...Array.from(out.vertProperties).filter((_, i) => i % 3 === 0))).toBe(40);
    expect(Array.from(out.triColors!.slice(0, 3))).toEqual([255, 0, 0]);
  });
});

test('isExportSplitMode', () => {
  expect(isExportSplitMode('pieces')).toBe(true);
  expect(isExportSplitMode('nope')).toBe(false);
  expect(isExportSplitMode(3)).toBe(false);
});
