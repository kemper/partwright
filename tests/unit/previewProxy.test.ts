import { describe, it, expect } from 'vitest';
import { previewProxy } from '../../src/renderer/previewProxy';
import type { MeshData } from '../../src/geometry/types';

/** A UV sphere of radius 10 with ~2·segs² triangles. */
function sphere(segs: number): MeshData {
  const rings = segs / 2;
  const verts: number[] = [];
  for (let i = 0; i <= rings; i++) {
    for (let j = 0; j < segs; j++) {
      const th = (Math.PI * i) / rings, ph = (2 * Math.PI * j) / segs;
      verts.push(10 * Math.sin(th) * Math.cos(ph), 10 * Math.sin(th) * Math.sin(ph), 10 * Math.cos(th));
    }
  }
  const at = (i: number, j: number) => i * segs + (j % segs);
  const tris: number[] = [];
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      tris.push(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1));
    }
  }
  return { vertProperties: Float32Array.from(verts), triVerts: Uint32Array.from(tris), numVert: verts.length / 3, numTri: tris.length / 3, numProp: 3 };
}

describe('previewProxy', () => {
  it('returns the mesh itself when it is within budget', () => {
    const m = sphere(20);
    expect(previewProxy(m, m.numTri)).toBe(m);
    expect(previewProxy(m, 0)).toBe(m);
  });

  it('decimates a dense mesh to about the budget, keeping its extent, and caches', () => {
    const m = sphere(200); // 40k triangles
    const p = previewProxy(m, 4000);
    expect(p.numTri).toBeLessThan(6000);
    expect(p.numTri).toBeGreaterThan(1500);
    let maxR = 0;
    for (let v = 0; v < p.numVert; v++) maxR = Math.max(maxR, Math.hypot(p.vertProperties[v * 3], p.vertProperties[v * 3 + 1], p.vertProperties[v * 3 + 2]));
    expect(maxR).toBeCloseTo(10, 1);
    for (let i = 0; i < p.triVerts.length; i++) expect(p.triVerts[i]).toBeLessThan(p.numVert);
    expect(previewProxy(m, 4000)).toBe(p);
  });

  it('carries per-triangle colours and the painted mask with the kept triangles', () => {
    const m = sphere(200);
    const colors = new Uint8Array(m.numTri * 3).fill(200) as Uint8Array & { _painted?: Uint8Array };
    colors._painted = new Uint8Array(m.numTri).fill(1);
    const p = previewProxy({ ...m, triColors: colors }, 4000);
    expect(p.triColors!.length).toBe(p.numTri * 3);
    expect(p.triColors!.every(c => c === 200)).toBe(true);
    expect((p.triColors as Uint8Array & { _painted?: Uint8Array })._painted!.length).toBe(p.numTri);
  });
});
