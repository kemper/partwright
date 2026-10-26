import { describe, expect, it } from 'vitest';
import type { MeshData } from '../../src/geometry/types';
import { alreadyImportedItems, buildMultiFileSource, layoutMultiFileSource, suggestMultiFileLayout, type MultiFileInput } from '../../src/import/multiFileImport';
import { planImportSplit, groupPartLabels } from '../../src/import/meshImportSplit';

/** An axis-aligned box mesh (12 triangles) from `min` to `max`. */
function box(min: [number, number, number], max: [number, number, number]): MeshData {
  const [x0, y0, z0] = min, [x1, y1, z1] = max;
  const v = [x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1];
  const t = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5];
  return { vertProperties: new Float32Array(v), triVerts: new Uint32Array(t), numVert: 8, numTri: 12, numProp: 3 };
}

/** Two boxes in one indexed mesh (a 3MF with two objects). */
function twoBoxes(a: MeshData, b: MeshData): MeshData {
  const vertProperties = new Float32Array([...a.vertProperties, ...b.vertProperties]);
  const triVerts = new Uint32Array([...a.triVerts, ...Array.from(b.triVerts, i => i + a.numVert)]);
  return { vertProperties, triVerts, numVert: a.numVert + b.numVert, numTri: a.numTri + b.numTri, numProp: 3 };
}

function bboxOf(mesh: MeshData, first: number, count: number) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = first * 3; i < (first + count) * 3; i++) {
    const v = mesh.triVerts[i];
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], mesh.vertProperties[v * 3 + k]);
      max[k] = Math.max(max[k], mesh.vertProperties[v * 3 + k]);
    }
  }
  return { min, max };
}

const stl = (name: string, mesh: MeshData): MultiFileInput => ({ name, format: 'stl', mesh });

const kit: MultiFileInput = {
  name: 'kit.3mf',
  format: '3mf',
  mesh: twoBoxes(box([0, 0, 0], [1, 1, 1]), box([5, 0, 0], [6, 1, 1])),
  triColor: new Int32Array(24).map((_, i) => (i < 12 ? 0 : 1)),
  palette: [{ name: 'Red', hex: '#FF0000' }, { name: 'Blue', hex: '#0000ff' }],
  objects: [
    { name: 'left', firstTriangle: 0, triangleCount: 12, parts: [{ name: 'lid', firstTriangle: 0, triangleCount: 6 }] },
    { name: 'right', firstTriangle: 12, triangleCount: 12 },
  ],
};

describe('buildMultiFileSource', () => {
  it('merges STL and 3MF files into one source, one item per STL and per 3MF object', () => {
    const src = buildMultiFileSource([stl('a.stl', box([0, 0, 0], [2, 2, 2])), kit, stl('b.STL', box([0, 0, 0], [1, 1, 1]))]);
    expect(src.files).toEqual(['a', 'kit', 'b']);
    expect(src.items.map(i => [i.name, i.file, i.first, i.count])).toEqual([
      ['a', 0, 0, 12], ['left', 1, 12, 12], ['right', 1, 24, 12], ['b', 2, 36, 12],
    ]);
    expect(src.mesh.numTri).toBe(48);
    expect(src.mesh.numVert).toBe(32);
    // A 3MF part run moves with its object.
    expect(src.items[1].parts).toEqual([{ name: 'lid', firstTriangle: 12, triangleCount: 6 }]);
    // Colours: STLs uncoloured, 3MF objects keep their slots.
    expect(src.triColor[0]).toBe(-1);
    expect(src.triColor[12]).toBe(0);
    expect(src.triColor[24]).toBe(1);
    expect(src.triColor[36]).toBe(-1);
    // Geometry is copied, not moved.
    expect(bboxOf(src.mesh, 24, 12)).toEqual({ min: [5, 0, 0], max: [6, 1, 1] });
  });

  it('merges palettes by colour, so the same colour in two files is one slot', () => {
    const other: MultiFileInput = { ...kit, name: 'kit2.3mf', palette: [{ name: 'Blue again', hex: '#0000FF' }, { name: 'Green', hex: '#00ff00' }] };
    const src = buildMultiFileSource([kit, other]);
    expect(src.palette).toEqual([{ name: 'Red', hex: '#FF0000' }, { name: 'Blue', hex: '#0000ff' }, { name: 'Green', hex: '#00ff00' }]);
    // kit2's slot 0 (blue) maps to merged slot 1, its slot 1 (green) to 2.
    expect(src.triColor[24]).toBe(1);
    expect(src.triColor[36]).toBe(2);
  });
});

describe('layoutMultiFileSource', () => {
  const src = buildMultiFileSource([
    stl('a.stl', box([-1, -1, 0], [1, 1, 2])),
    stl('b.stl', box([10, 10, 5], [12, 14, 6])),
    stl('c.stl', box([-1, -1, 0], [1, 1, 1])),
  ]);

  it('keep leaves everything where the files put it', () => {
    const m = layoutMultiFileSource(src, 'keep', { gapRatio: 0.2 });
    expect(Array.from(m.vertProperties)).toEqual(Array.from(src.mesh.vertProperties));
  });

  it('center puts each model on the origin, on the plate', () => {
    const m = layoutMultiFileSource(src, 'center', { gapRatio: 0.2 });
    expect(bboxOf(m, 12, 12)).toEqual({ min: [-1, -2, 0], max: [1, 2, 1] });
    // The source itself is untouched.
    expect(bboxOf(src.mesh, 12, 12).min).toEqual([10, 10, 5]);
  });

  it('grid lays the selected models side by side without overlap', () => {
    const m = layoutMultiFileSource(src, 'grid', { gapRatio: 0.2 });
    const boxes = [0, 1, 2].map(i => bboxOf(m, i * 12, 12));
    for (const b of boxes) expect(b.min[2]).toBe(0);
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        const a = boxes[i], b = boxes[j];
        const overlap = a.min[0] < b.max[0] && b.min[0] < a.max[0] && a.min[1] < b.max[1] && b.min[1] < a.max[1];
        expect(overlap).toBe(false);
      }
    }
  });

  it('grid moves only the selected models', () => {
    const m = layoutMultiFileSource(src, 'grid', { selected: [0, 2], gapRatio: 0.2 });
    expect(bboxOf(m, 12, 12).min).toEqual([10, 10, 5]);
  });
});

describe('suggestMultiFileLayout', () => {
  it('suggests a grid when separately made models would pile up on the origin', () => {
    const src = buildMultiFileSource([stl('a.stl', box([-1, -1, 0], [1, 1, 2])), stl('b.stl', box([-1.2, -1, 0], [1, 1.1, 1]))]);
    expect(suggestMultiFileLayout(src)).toBe('grid');
  });

  it('keeps positions for an assembly (side by side, or a small part inside a big one)', () => {
    expect(suggestMultiFileLayout(buildMultiFileSource([stl('a.stl', box([0, 0, 0], [1, 1, 1])), stl('b.stl', box([3, 0, 0], [4, 1, 1]))]))).toBe('keep');
    expect(suggestMultiFileLayout(buildMultiFileSource([stl('case.stl', box([0, 0, 0], [10, 10, 4])), stl('pin.stl', box([4, 4, 0], [5, 5, 6]))]))).toBe('keep');
  });
});

describe('alreadyImportedItems', () => {
  const src = buildMultiFileSource([stl('a.stl', box([0, 0, 0], [1, 1, 1])), kit]);
  const names = ['a.stl', 'kit.3mf'];

  it('matches an object imported from the same file with the same triangle count', () => {
    // The kit's objects also have 12 triangles, but come from another file.
    expect(alreadyImportedItems(src, names, [{ filename: 'a.stl', numTri: 12 }])).toEqual([true, false, false]);
  });

  it('matches every object of a file that came in as one object', () => {
    expect(alreadyImportedItems(src, names, [{ filename: 'kit.3mf', numTri: 24 }])).toEqual([false, true, true]);
  });

  it('does not match a different triangle count (an edited file)', () => {
    expect(alreadyImportedItems(src, names, [{ filename: 'a.stl', numTri: 13 }])).toEqual([false, false, false]);
  });
});

describe('planImportSplit across files', () => {
  const src = buildMultiFileSource([stl('a.stl', box([0, 0, 0], [1, 1, 1])), kit]);

  it('file mode makes one object per file', () => {
    expect(planImportSplit(src.items, 'file', { files: src.files, baseName: 'x' })).toEqual([
      { name: 'a', items: [0] },
      { name: 'kit', items: [1, 2] },
    ]);
  });

  it('object mode groups a file’s objects under the file when it has several', () => {
    expect(planImportSplit(src.items, 'object', { files: src.files, baseName: 'x' })).toEqual([
      { name: 'a', items: [0] },
      { name: 'left', group: 'kit', items: [1] },
      { name: 'right', group: 'kit', items: [2] },
    ]);
  });

  it('one object keeps every model as a named part', () => {
    const [group] = planImportSplit(src.items, 'none', { files: src.files, baseName: 'x' });
    const labels = groupPartLabels(src.items, group)!;
    expect(labels.names).toEqual(['a', 'left · lid', 'left', 'right']);
    expect(labels.triPart.length).toBe(36);
  });
});
