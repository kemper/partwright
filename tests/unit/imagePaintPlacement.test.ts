import { describe, it, expect } from 'vitest';
import { resolveImageStampPlacement, STAMP_VIEWS } from '../../src/color/imagePaintPlacement';
import type { MeshData } from '../../src/geometry/types';

// A 10×10×10 cube centred at the origin (verts at ±5), 12 triangles.
function makeCube(): MeshData {
  const verts = [
    -5, -5, -5,  // 0
     5, -5, -5,  // 1
     5,  5, -5,  // 2
    -5,  5, -5,  // 3
    -5, -5,  5,  // 4
     5, -5,  5,  // 5
     5,  5,  5,  // 6
    -5,  5,  5,  // 7
  ];
  const tris = [
    0, 5, 1, 0, 4, 5,   // front  (y = -5)
    2, 3, 7, 2, 7, 6,   // back   (y = +5)
    0, 3, 7, 0, 7, 4,   // left   (x = -5)
    1, 5, 6, 1, 6, 2,   // right  (x = +5)
    0, 2, 1, 0, 3, 2,   // bottom (z = -5)
    4, 5, 6, 4, 6, 7,   // top    (z = +5)
  ];
  return {
    vertProperties: new Float32Array(verts),
    triVerts: new Uint32Array(tris),
    numVert: 8,
    numTri: tris.length / 3,
    numProp: 3,
  };
}

describe('resolveImageStampPlacement', () => {
  it('passes explicit at+normal+size straight through', () => {
    const r = resolveImageStampPlacement(makeCube(), {
      at: [1, 2, 3], normal: [0, 0, 1], size: 4,
    });
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.at).toEqual([1, 2, 3]);
    expect(r.normal).toEqual([0, 0, 1]);
    expect(r.size).toBe(4);
  });

  it('resolves a front-view projection to the front face with the front normal', () => {
    const r = resolveImageStampPlacement(makeCube(), { view: 'front', size: 6 });
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    // front faces -Y
    expect(r.normal).toEqual([0, -1, 0]);
    // anchored on the front face (y ≈ -5), centred laterally
    expect(r.at[1]).toBeCloseTo(-5, 4);
    expect(r.at[0]).toBeCloseTo(0, 4);
    expect(r.at[2]).toBeCloseTo(0, 4);
    expect(r.size).toBe(6);
  });

  it('resolves a top-view projection to the top face', () => {
    const r = resolveImageStampPlacement(makeCube(), { view: 'top', size: 3 });
    if ('error' in r) throw new Error(r.error);
    expect(r.normal).toEqual([0, 0, 1]);
    expect(r.at[2]).toBeCloseTo(5, 4);
  });

  it('auto-sizes to a label footprint when size is omitted', () => {
    // front face triangle indices are 0 and 1
    const label = new Set([0, 1]);
    const r = resolveImageStampPlacement(makeCube(), { view: 'front', labelTriangles: label });
    if ('error' in r) throw new Error(r.error);
    // front face spans 10×10 → auto size = 10 * 1.1
    expect(r.size).toBeCloseTo(11, 4);
    expect(r.at[1]).toBeCloseTo(-5, 4);
  });

  it('errors when no view/normal is given', () => {
    const r = resolveImageStampPlacement(makeCube(), { size: 5 });
    expect('error' in r).toBe(true);
  });

  it('errors when size is omitted and there is no label to size against', () => {
    const r = resolveImageStampPlacement(makeCube(), { view: 'front' });
    expect('error' in r).toBe(true);
  });

  it('errors on a zero-length normal', () => {
    const r = resolveImageStampPlacement(makeCube(), { normal: [0, 0, 0], at: [0, 0, 0], size: 2 });
    expect('error' in r).toBe(true);
  });

  it('exposes all six named views', () => {
    expect(STAMP_VIEWS).toEqual(['front', 'back', 'left', 'right', 'top', 'bottom']);
  });
});
