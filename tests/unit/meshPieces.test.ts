import { describe, it, expect } from 'vitest';
import { computeMeshPieces, summarizeObjectParts, triangleSetStats, extractSubMesh, type PieceMesh } from '../../src/geometry/meshPieces';

/** A closed tetrahedron at `offset`, with its OWN vertex indices (`base`), so
 *  several tets can be concatenated into one mesh. */
function tet(offset: [number, number, number], base: number): { verts: number[]; tris: number[] } {
  const [x, y, z] = offset;
  const verts = [x, y, z, x + 1, y, z, x, y + 1, z, x, y, z + 1];
  const tris = [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3].map(i => i + base);
  return { verts, tris };
}

function mesh(parts: { verts: number[]; tris: number[] }[]): PieceMesh {
  const verts = parts.flatMap(p => p.verts);
  const tris = parts.flatMap(p => p.tris);
  return { vertProperties: new Float32Array(verts), triVerts: new Uint32Array(tris), numTri: tris.length / 3, numProp: 3 };
}

describe('computeMeshPieces', () => {
  it('finds one piece per disconnected solid', () => {
    const m = mesh([tet([0, 0, 0], 0), tet([10, 0, 0], 4), tet([0, 10, 0], 8)]);
    const pieces = computeMeshPieces(m);
    expect(pieces.count).toBe(3);
    expect(Array.from(pieces.pieceOfTri)).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2]);
  });

  it('welds duplicated seam vertices by position (one piece, not two)', () => {
    // Same tetrahedron, but every triangle has its own copy of its vertices —
    // the worst case of MeshGL property-seam duplication.
    const t = tet([0, 0, 0], 0);
    const verts: number[] = [];
    const tris: number[] = [];
    for (let i = 0; i < t.tris.length; i++) {
      const v = t.tris[i];
      verts.push(t.verts[v * 3], t.verts[v * 3 + 1], t.verts[v * 3 + 2]);
      tris.push(i);
    }
    const pieces = computeMeshPieces({ vertProperties: new Float32Array(verts), triVerts: new Uint32Array(tris), numTri: 4, numProp: 3 });
    expect(pieces.count).toBe(1);
  });

  it('handles an empty mesh', () => {
    const pieces = computeMeshPieces({ vertProperties: new Float32Array(0), triVerts: new Uint32Array(0), numTri: 0, numProp: 3 });
    expect(pieces.count).toBe(0);
  });
});

describe('summarizeObjectParts', () => {
  const m = mesh([tet([0, 0, 0], 0), tet([10, 0, 0], 4)]);

  it('lists labels as parts, names each piece by its dominant part, and buckets the rest as unlabeled', () => {
    // "body" covers piece 0 plus one triangle of piece 1; "screw" covers two
    // triangles of piece 1; triangle 7 is unlabeled.
    const labels = new Map<string, Set<number>>([
      ['body', new Set([0, 1, 2, 3, 4])],
      ['screw', new Set([5, 6])],
    ]);
    const s = summarizeObjectParts(m, labels);
    expect(s.parts.map(p => p.name)).toEqual(['body', 'screw']);
    expect(s.unlabeled).toEqual([7]);
    expect(s.pieces.map(p => p.part)).toEqual(['body', 'screw']);
    expect(s.pieces.map(p => p.triangles.length)).toEqual([4, 4]);
  });

  it('reports pieces without parts when the object declares no labels', () => {
    const s = summarizeObjectParts(m, null);
    expect(s.parts).toEqual([]);
    expect(s.unlabeled).toEqual([]);
    expect(s.pieces).toHaveLength(2);
    expect(s.pieces[0].part).toBeUndefined();
  });
});

describe('computeMeshPieces with merge vectors', () => {
  it('welds via mergeFromVert/mergeToVert when present', () => {
    // Two triangles that share an edge geometrically but use distinct vertex
    // indices (3,4 duplicate 1,2) — joined only through the merge vectors.
    const vertProperties = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]);
    const triVerts = new Uint32Array([0, 1, 2, 3, 5, 4]);
    const joined = computeMeshPieces({ vertProperties, triVerts, numTri: 2, numProp: 3, mergeFromVert: new Uint32Array([3, 4]), mergeToVert: new Uint32Array([1, 2]) });
    expect(joined.count).toBe(1);
    // Merge vectors present but empty: trusted as already indexed, so the two
    // index-disjoint triangles stay apart even though they touch in space.
    const apart = computeMeshPieces({ vertProperties, triVerts, numTri: 2, numProp: 3, mergeFromVert: new Uint32Array(0), mergeToVert: new Uint32Array(0) });
    expect(apart.count).toBe(2);
  });

  it('resolves chained merge pairs (a → b → c) into one piece', () => {
    // Three triangles, each with its own vertices; tri 1 shares a point with
    // tri 0 via 3→1, and tri 2 shares a point with tri 1 via 6→3 (a chain).
    const vertProperties = new Float32Array(27);
    const triVerts = new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const p = computeMeshPieces({ vertProperties, triVerts, numTri: 3, numProp: 3, mergeFromVert: new Uint32Array([3, 6]), mergeToVert: new Uint32Array([1, 3]) });
    expect(p.count).toBe(1);
  });
});

describe('summarizeObjectParts piece naming', () => {
  it('names a piece by the part covering the most AREA, not the most triangles', () => {
    // One piece: a big triangle ("body") sharing an edge with two tiny ones ("handle").
    const vertProperties = new Float32Array([0, 0, 0, 100, 0, 0, 0, 100, 0, 1, 1, 0, 0.5, 0.2, 0]);
    const triVerts = new Uint32Array([0, 1, 2, 0, 1, 3, 1, 3, 4]);
    const m = { vertProperties, triVerts, numTri: 3, numProp: 3 };
    const s = summarizeObjectParts(m, new Map([['body', new Set([0])], ['handle', new Set([1, 2])]]));
    expect(s.pieces).toHaveLength(1);
    expect(s.pieces[0].part).toBe('body');
  });
});

describe('triangleSetStats / extractSubMesh', () => {
  const m = mesh([tet([0, 0, 0], 0), tet([10, 0, 0], 4)]);
  it('measures a triangle subset', () => {
    const st = triangleSetStats(m, [4, 5, 6, 7])!;
    expect(st.min).toEqual([10, 0, 0]);
    expect(st.max).toEqual([11, 1, 1]);
    expect(st.area).toBeGreaterThan(0);
    expect(triangleSetStats(m, [])).toBeNull();
  });
  it('extracts a compact standalone mesh', () => {
    const sub = extractSubMesh(m, [4, 5, 6, 7]);
    expect(sub.numTri).toBe(4);
    expect(sub.numVert).toBe(4);
    expect(Math.max(...sub.triVerts)).toBe(3);
    expect(computeMeshPieces(sub).count).toBe(1);
  });
});
