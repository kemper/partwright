import { describe, it, expect } from 'vitest';
import { parseSTL, parseSTLSoup, weldPositions, weldSoup } from '../../src/import/parsers/stl';
import { probeSTL, weldToleranceLadder } from '../../src/import/stlProbe';
import type { MeshData } from '../../src/geometry/types';

type V = [number, number, number];

const CUBE: V[][] = (() => {
  const s = 5;
  const v: V[] = [
    [-s, -s, -s], [s, -s, -s], [s, s, -s], [-s, s, -s],
    [-s, -s, s], [s, -s, s], [s, s, s], [-s, s, s],
  ];
  return [
    [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4],
    [2, 3, 7], [2, 7, 6], [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5],
  ].map(f => f.map(i => v[i]));
})();

function binarySTL(tris: V[][]): Uint8Array {
  const buf = new ArrayBuffer(84 + tris.length * 50);
  const view = new DataView(buf);
  view.setUint32(80, tris.length, true);
  let off = 84;
  for (const t of tris) {
    off += 12;
    for (const p of t) for (const c of p) { view.setFloat32(off, c, true); off += 4; }
    off += 2;
  }
  return new Uint8Array(buf);
}

function asciiSTL(tris: V[][]): Uint8Array {
  const body = tris.map(t => `facet normal 0 0 0\n outer loop\n${t.map(p => `  vertex ${p.join(' ')}`).join('\n')}\n endloop\nendfacet`).join('\n');
  return new TextEncoder().encode(`solid test\n${body}\nendsolid test\n`);
}

/** The pre-rewrite string-keyed weld, as the reference the hash weld must match. */
function referenceWeld(pos: ArrayLike<number>, count: number, tol: number) {
  const inv = 1 / tol;
  const map = new Map<string, number>();
  const out: number[] = [];
  const remap: number[] = [];
  for (let v = 0; v < count; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    const key = `${Math.round(x * inv)},${Math.round(y * inv)},${Math.round(z * inv)}`;
    let idx = map.get(key);
    if (idx === undefined) { idx = out.length / 3; out.push(x, y, z); map.set(key, idx); }
    remap.push(idx);
  }
  return { positions: Float32Array.from(out), remap };
}

describe('STL parsing', () => {
  it('parses binary and ASCII STLs to the same welded cube', () => {
    for (const bytes of [binarySTL(CUBE), asciiSTL(CUBE)]) {
      const m = parseSTL(bytes)!;
      expect(m.numTri).toBe(12);
      expect(m.numVert).toBe(8);
      expect(m.triVerts.length).toBe(36);
      expect(m.vertProperties.length).toBe(24);
    }
  });

  it('rejects non-finite coordinates, truncated files and empty input', () => {
    const bad: V[][] = [[[0, 0, 0], [1, 0, 0], [0, NaN, 0]]];
    expect(parseSTL(binarySTL(bad))).toBeNull();
    expect(parseSTL(new TextEncoder().encode('solid x\n vertex 1e999 0 0\n vertex 0 0 0\n vertex 0 1 0\nendsolid'))).toBeNull();
    expect(parseSTL(binarySTL(CUBE).subarray(0, 300))).toBeNull();
    expect(parseSTL(new TextEncoder().encode('solid empty\nendsolid'))).toBeNull();
  });

  it('welds within the tolerance only, and drops collapsed triangles', () => {
    const tris: V[][] = [
      [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      [[1.000001, 0, 0], [1, 1, 0], [0, 1, 0]], // shares an edge up to 1e-6 noise
      [[0, 0, 0], [0.0000001, 0, 0], [0, 0, 1]], // collapses at a loose tolerance
    ];
    const soup = parseSTLSoup(binarySTL(tris))!;
    expect(weldSoup(soup, 1e-7)!.numVert).toBe(7);
    const loose = weldSoup(soup, 1e-4)!;
    expect(loose.numVert).toBe(5);
    expect(loose.numTri).toBe(2);
  });

  it('welds -0 and 0 together', () => {
    const { numVert } = weldPositions(new Float32Array([0, 0, 0, -0, -0, -0, -0.000001, 0, 0]), 3, 1e-4);
    expect(numVert).toBe(1);
  });

  it('matches the string-keyed weld on noisy random data', () => {
    let seed = 7;
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const count = 5000;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // Half the vertices are near-duplicates of an earlier one.
      const src = i > 0 && rand() < 0.5 ? Math.floor(rand() * i) : -1;
      for (let c = 0; c < 3; c++) {
        pos[i * 3 + c] = src >= 0 ? pos[src * 3 + c] + (rand() - 0.5) * 1e-5 : (rand() - 0.5) * 2000;
      }
    }
    for (const tol of [1e-5, 1e-4, 1e-3, 0.5]) {
      const got = weldPositions(pos, count, tol);
      const ref = referenceWeld(pos, count, tol);
      expect(Array.from(got.remap)).toEqual(ref.remap);
      expect(Array.from(got.positions)).toEqual(Array.from(ref.positions));
    }
  });
});

describe('probeSTL', () => {
  it('returns the first welded mesh the manifold check accepts', () => {
    const tried: number[] = [];
    const r = probeSTL(binarySTL(CUBE), {
      configuredTolerance: 1e-5,
      tryManifold: (m: MeshData) => { tried.push(m.numVert); return tried.length === 2 ? { ok: true } : { ok: false, error: 'Not manifold' }; },
    })!;
    expect(r.isManifold).toBe(true);
    expect(tried).toHaveLength(2);
    expect(r.mesh.numTri).toBe(12);
  });

  it('reports the render-only fallback when every tolerance fails', () => {
    const progress: number[] = [];
    const r = probeSTL(binarySTL(CUBE), {
      configuredTolerance: 1e-5,
      tryManifold: () => ({ ok: false, error: 'Not manifold' }),
      onProgress: (f) => progress.push(f),
    })!;
    expect(r.isManifold).toBe(false);
    if (r.isManifold) return;
    expect(r.manifoldError).toBe('Not manifold');
    expect(r.maxTried).toBe(1e-3);
    expect(r.triCount).toBe(12);
    expect(r.vertCount).toBe(8);
    expect(progress[0]).toBe(0);
    expect(progress.every((f, i) => i === 0 || f > progress[i - 1])).toBe(true);
  });

  it('returns null for bytes that are not an STL', () => {
    expect(probeSTL(new TextEncoder().encode('hello'), { configuredTolerance: 1e-5, tryManifold: () => ({ ok: true }) })).toBeNull();
  });

  it('scales the last weld tolerance to the model size', () => {
    const m = parseSTL(binarySTL(CUBE))!;
    const ladder = weldToleranceLadder(m, 2e-5);
    expect(ladder.slice(0, 3)).toEqual([2e-5, 1e-4, 1e-3]);
    expect(ladder[3]).toBeCloseTo(Math.hypot(10, 10, 10) * 5e-6, 12);
  });
});
