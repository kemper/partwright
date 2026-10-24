import { describe, it, expect } from 'vitest';
import { planImportSplit, extractTriangles, groupTriangles, groupPartLabels, triangleRange, pieceItems, type ImportSplitItem } from '../../src/import/meshImportSplit';
import type { MeshData } from '../../src/geometry/types';

const items: ImportSplitItem[] = [
  { name: 'Base', triangles: [0, 1], plate: 1 },
  { name: 'Peg', triangles: [2], plate: 1 },
  { name: 'Peg', triangles: [3], plate: 2 },
  { name: 'Lid', triangles: [4], plate: 2 },
  { name: 'Loose', triangles: [5] },
];
const plates = [{ id: 1, name: 'Plate 1' }, { id: 2, name: 'Lids' }];

describe('planImportSplit', () => {
  it('none: one object of everything selected, named after the file', () => {
    expect(planImportSplit(items, 'none', { baseName: 'kit', selected: [0, 3] })).toEqual([{ name: 'kit', items: [0, 3] }]);
  });

  it('object: one object each, unique names, grouped by plate across plates', () => {
    expect(planImportSplit(items, 'object', { baseName: 'kit', plates })).toEqual([
      { name: 'Base', group: 'Plate 1', items: [0] },
      { name: 'Peg', group: 'Plate 1', items: [1] },
      { name: 'Peg (2)', group: 'Lids', items: [2] },
      { name: 'Lid', group: 'Lids', items: [3] },
      { name: 'Loose', items: [4] },
    ]);
  });

  it('object: no grouping when the selection sits on one plate', () => {
    const g = planImportSplit(items, 'object', { baseName: 'kit', plates, selected: [0, 1] });
    expect(g.map(x => x.group)).toEqual([undefined, undefined]);
  });

  it('plate: one object per plate in plate order; unplated items stand alone', () => {
    expect(planImportSplit(items, 'plate', { baseName: 'kit', plates, selected: [3, 0, 4, 1] })).toEqual([
      { name: 'Plate 1', items: [0, 1] },
      { name: 'Lids', items: [3] },
      { name: 'Loose', items: [4] },
    ]);
  });

  it('ignores out-of-range selections and returns nothing for an empty selection', () => {
    expect(planImportSplit(items, 'object', { baseName: 'kit', selected: [] })).toEqual([]);
    expect(planImportSplit(items, 'none', { baseName: 'kit', selected: [9, -1, 2] })).toEqual([{ name: 'kit', items: [2] }]);
  });
});

describe('extractTriangles', () => {
  // Two triangles far apart, sharing no vertices; a third shares vertex 0.
  const mesh: MeshData = {
    vertProperties: new Float32Array([100, 50, 0, 102, 50, 0, 100, 54, 3, -9, -9, 0, -8, -9, 0, -9, -8, 0]),
    triVerts: new Uint32Array([0, 1, 2, 3, 4, 5, 0, 2, 1]),
    numVert: 6, numTri: 3, numProp: 3,
  };
  const triColor = new Int32Array([4, 7, 5]);

  it('compacts vertices, keeps triangle order and colours, recentres XY only', () => {
    const r = extractTriangles(mesh, triColor, [2, 0], { recenter: true });
    expect(r.mesh.numTri).toBe(2);
    expect(r.mesh.numVert).toBe(3);
    expect(Array.from(r.triColor!)).toEqual([5, 4]);
    expect(Array.from(r.mesh.triVerts)).toEqual([0, 1, 2, 0, 2, 1]);
    // bbox x 100..102 → -1..1, y 50..54 → -2..2, z kept.
    expect(Array.from(r.mesh.vertProperties)).toEqual([-1, -2, 0, -1, 2, 3, 1, -2, 0]);
  });

  it('leaves positions alone without recenter and handles no colours', () => {
    const r = extractTriangles(mesh, null, [1]);
    expect(r.triColor).toBeNull();
    expect(Array.from(r.mesh.vertProperties)).toEqual([-9, -9, 0, -8, -9, 0, -9, -8, 0]);
  });
});

describe('triangle helpers', () => {
  it('triangleRange and groupTriangles concatenate in order', () => {
    expect(Array.from(triangleRange(3, 3))).toEqual([3, 4, 5]);
    expect(Array.from(groupTriangles(items, { name: 'x', items: [3, 0] }))).toEqual([4, 0, 1]);
  });

  it('pieceItems orders pieces largest first', () => {
    const pieceOfTri = new Int32Array([0, 1, 1, 1, 0, 2]);
    const r = pieceItems(pieceOfTri, 3);
    expect(r.map(p => p.name)).toEqual(['Piece 1', 'Piece 2', 'Piece 3']);
    expect(r.map(p => Array.from(p.triangles))).toEqual([[1, 2, 3], [0, 4], [5]]);
  });
});

describe('groupPartLabels', () => {
  const withParts: ImportSplitItem[] = [
    { name: 'Cart', triangles: [0, 1, 2, 3], parts: [{ name: 'Body', firstTriangle: 0, triangleCount: 2 }, { name: 'Wheel', firstTriangle: 2, triangleCount: 2 }] },
    { name: 'Lid', triangles: [4, 5] },
    { name: 'Cart', triangles: [6, 7], parts: [{ name: 'Body', firstTriangle: 6, triangleCount: 1 }, { name: 'Wheel', firstTriangle: 7, triangleCount: 1 }] },
  ];

  it('one object: its own parts', () => {
    expect(groupPartLabels(withParts, { name: 'x', items: [0] })).toEqual({ names: ['Body', 'Wheel'], triPart: new Int32Array([0, 0, 1, 1]) });
  });

  it('a single object without parts gets none', () => {
    expect(groupPartLabels(withParts, { name: 'x', items: [1] })).toBeNull();
  });

  it('merged objects: each object a part, sub-parts qualified, names unique', () => {
    expect(groupPartLabels(withParts, { name: 'x', items: [0, 1, 2] })).toEqual({
      names: ['Cart · Body', 'Cart · Wheel', 'Lid', 'Cart · Body (2)', 'Cart · Wheel (2)'],
      triPart: new Int32Array([0, 0, 1, 1, 2, 2, 3, 4]),
    });
  });
});
