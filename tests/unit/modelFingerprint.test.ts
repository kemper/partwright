import { describe, it, expect } from 'vitest';
import {
  computeModelFingerprint,
  compareModelFingerprints,
  parseModelFingerprint,
} from '../../src/geometry/modelFingerprint';
import type { MeshData } from '../../src/geometry/types';

/** An axis-aligned box as a closed triangle mesh (12 triangles). */
function box(sx = 1, sy = 1, sz = 1, ox = 0, oy = 0, oz = 0): MeshData {
  const p: number[] = [];
  for (let i = 0; i < 8; i++) {
    p.push(ox + (i & 1 ? sx : 0), oy + (i & 2 ? sy : 0), oz + (i & 4 ? sz : 0));
  }
  // Outward-wound faces.
  const t = [
    0, 2, 1, 1, 2, 3, // -Z
    4, 5, 6, 5, 7, 6, // +Z
    0, 1, 4, 1, 5, 4, // -Y
    2, 6, 3, 3, 6, 7, // +Y
    0, 4, 2, 2, 4, 6, // -X
    1, 3, 5, 3, 7, 5, // +X
  ];
  return {
    vertProperties: new Float32Array(p),
    triVerts: new Uint32Array(t),
    numVert: 8,
    numTri: 12,
    numProp: 3,
  } as MeshData;
}

/** The same box with its triangles listed in a different order. */
function reordered(m: MeshData): MeshData {
  const tv = Array.from(m.triVerts);
  const tris: number[][] = [];
  for (let i = 0; i < tv.length; i += 3) tris.push(tv.slice(i, i + 3));
  tris.reverse();
  return { ...m, triVerts: new Uint32Array(tris.flat()) };
}

describe('computeModelFingerprint', () => {
  it('measures a box exactly', () => {
    const f = computeModelFingerprint(box(2, 3, 4));
    expect(f.tris).toBe(12);
    expect(f.verts).toBe(8);
    expect(f.volume).toBeCloseTo(24, 9);
    expect(f.area).toBeCloseTo(2 * (6 + 8 + 12), 9);
    expect(f.bbox).toEqual([0, 0, 0, 2, 3, 4]);
    expect(f.centroid![0]).toBeCloseTo(1, 9);
    expect(f.centroid![1]).toBeCloseTo(1.5, 9);
    expect(f.centroid![2]).toBeCloseTo(2, 9);
    expect(typeof f.hash).toBe('string');
  });

  it('is identical for the same mesh', () => {
    expect(computeModelFingerprint(box())).toEqual(computeModelFingerprint(box()));
  });
});

describe('compareModelFingerprints', () => {
  it('reports no change for the same mesh', () => {
    const a = computeModelFingerprint(box());
    expect(compareModelFingerprints(a, computeModelFingerprint(box()))).toEqual({ changed: false, diffs: [] });
  });

  it('ignores triangle order (only the exact hash differs)', () => {
    const a = computeModelFingerprint(box(2, 3, 4));
    const b = computeModelFingerprint(reordered(box(2, 3, 4)));
    expect(a.hash).not.toBe(b.hash);
    expect(compareModelFingerprints(a, b).changed).toBe(false);
  });

  it('ignores float noise far below the tolerance', () => {
    const a = computeModelFingerprint(box(1, 1, 1));
    const b = computeModelFingerprint(box(1 + 1e-7, 1, 1));
    expect(compareModelFingerprints(a, b).changed).toBe(false);
  });

  it('reports a resize in plain words', () => {
    const a = computeModelFingerprint(box(1, 1, 1));
    const b = computeModelFingerprint(box(1, 1, 1.1));
    const r = compareModelFingerprints(a, b);
    expect(r.changed).toBe(true);
    expect(r.diffs[0]).toMatch(/volume \+10%/);
    expect(r.diffs.join(' ')).toMatch(/Z size \+10%/);
  });

  it('reports a move that keeps the size', () => {
    const r = compareModelFingerprints(computeModelFingerprint(box()), computeModelFingerprint(box(1, 1, 1, 0.5, 0, 0)));
    expect(r.changed).toBe(true);
    expect(r.diffs).toContain('moved along X');
  });

  it('does not flag a different triangulation of the same surface', () => {
    const a = box();
    const b = { ...a, triVerts: new Uint32Array(a.triVerts) };
    // Flip the +Z face diagonal: (4,5,6)(5,7,6) → (4,5,7)(4,7,6). Same surface,
    // so this must NOT read as a change.
    b.triVerts.set([4, 5, 7, 4, 7, 6], 6);
    expect(compareModelFingerprints(computeModelFingerprint(a), computeModelFingerprint(b)).changed).toBe(false);
  });

  it('treats a single-triangle count change as noise but a real one as a change', () => {
    const a = computeModelFingerprint(box());
    expect(compareModelFingerprints(a, { ...a, hash: undefined, tris: a.tris + 1 }).changed).toBe(false);
    const r = compareModelFingerprints(a, { ...a, hash: undefined, tris: a.tris + 6 });
    expect(r.changed).toBe(true);
    expect(r.diffs).toContain('6 more triangles');
  });
});

describe('parseModelFingerprint', () => {
  it('round-trips a computed fingerprint through JSON', () => {
    const f = { ...computeModelFingerprint(box(2, 1, 1)), segments: 64 };
    expect(parseModelFingerprint(JSON.parse(JSON.stringify(f)))).toEqual(f);
  });

  it('rejects malformed records', () => {
    expect(parseModelFingerprint(null)).toBeNull();
    expect(parseModelFingerprint({ v: 2 })).toBeNull();
    expect(parseModelFingerprint({ v: 1, tris: 1, verts: 1, volume: 1, area: 1, bbox: [0, 0, 0] })).toBeNull();
  });
});
