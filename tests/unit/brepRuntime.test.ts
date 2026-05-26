import { describe, it, expect } from 'vitest';
import { sourceUsesBrep, _weldDuplicateVerticesForTests as weld } from '../../src/geometry/brepRuntime';

describe('sourceUsesBrep', () => {
  it('detects api.BREP.box(...) usage', () => {
    expect(sourceUsesBrep('return api.BREP.box([10, 10, 10]).fillet(2);')).toBe(true);
  });

  it('detects destructured BREP', () => {
    expect(sourceUsesBrep('const { BREP } = api;\nreturn BREP.cylinder(5, 10);')).toBe(true);
  });

  it('detects BREP in arbitrary positions', () => {
    expect(sourceUsesBrep('// uses BREP for fillets')).toBe(true);
    expect(sourceUsesBrep('const x = "BREP"; return Manifold.cube([1,1,1]);')).toBe(true);
  });

  it('returns false for code without BREP', () => {
    expect(sourceUsesBrep('return Manifold.cube([10, 10, 10]);')).toBe(false);
    expect(sourceUsesBrep('// just manifold')).toBe(false);
  });

  it('uses word boundaries so it does not match substrings', () => {
    // No false-positive on identifiers that happen to contain "BREP".
    expect(sourceUsesBrep('const aBREPb = 1;')).toBe(false);
    expect(sourceUsesBrep('const xBREP = 1;')).toBe(false);
    expect(sourceUsesBrep('const BREPx = 1;')).toBe(false);
  });

  it('handles empty / whitespace input', () => {
    expect(sourceUsesBrep('')).toBe(false);
    expect(sourceUsesBrep('   \n\n   ')).toBe(false);
  });

  it('detects BREP after various preceding whitespace / punctuation', () => {
    expect(sourceUsesBrep('(BREP)')).toBe(true);
    expect(sourceUsesBrep('=BREP\n')).toBe(true);
    // `.BREP` matches because `.` is a non-word char and `B` is a word char —
    // this is the desired behaviour: `api.BREP` should trigger the loader.
    expect(sourceUsesBrep('api.BREP')).toBe(true);
  });
});

describe('weldDuplicateVertices', () => {
  it('passes through a mesh that already has unique vertices', () => {
    // A single triangle with three distinct vertices — nothing to weld.
    const verts = [0, 0, 0, 1, 0, 0, 0, 1, 0];
    const tris = [0, 1, 2];
    const out = weld(verts, tris);
    expect(out.numVert).toBe(3);
    expect(out.numTri).toBe(1);
    expect(out.numProp).toBe(3);
    expect(Array.from(out.vertProperties)).toEqual(verts);
    expect(Array.from(out.triVerts)).toEqual(tris);
  });

  it('welds exact duplicates and rewrites indices', () => {
    // Two coplanar triangles sharing one edge — typical of two BREP faces
    // meeting at a shared boundary. Vertices 0 and 3 are at the same
    // position; same for 1 and 5.
    const verts = [
      0, 0, 0,  // 0 — triA corner
      1, 0, 0,  // 1 — triA corner (shared with triB)
      0, 1, 0,  // 2 — triA corner
      0, 0, 0,  // 3 — duplicate of 0
      1, 1, 0,  // 4 — triB corner
      1, 0, 0,  // 5 — duplicate of 1
    ];
    const tris = [0, 1, 2, 3, 4, 5];
    const out = weld(verts, tris);
    expect(out.numVert).toBe(4); // 6 input verts → 4 unique
    expect(out.numTri).toBe(2);
    // Both triangles should now reference the welded indices for the
    // shared edge, so the rewritten triVerts include the canonical index.
    const tA = Array.from(out.triVerts).slice(0, 3);
    const tB = Array.from(out.triVerts).slice(3, 6);
    // Triangle A uses the first occurrence of each position (0, 1, 2).
    expect(tA).toEqual([0, 1, 2]);
    // Triangle B reuses indices 0 and 1 (the shared vertices) and gets a
    // fresh index for its unique corner (1,1,0).
    expect(tB[0]).toBe(0); // duplicate of vertex 0
    expect(tB[2]).toBe(1); // duplicate of vertex 1
    expect(tB[1]).toBe(3); // new corner
  });

  it('treats near-tolerance duplicates as the same vertex', () => {
    // Float roundoff between adjacent BREP face emissions can put the same
    // logical point at slightly different positions. The 1e-6 tolerance
    // should collapse these too — without it, manifold rejects the round-
    // trip as non-watertight. Use ULP-scale noise (1e-9) so we're well
    // inside the welder's tolerance.
    const verts = [
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
      1e-9, -1e-9, 1e-9, // numerically equivalent to vertex 0
    ];
    const tris = [0, 1, 2, 3, 1, 2];
    const out = weld(verts, tris);
    expect(out.numVert).toBe(3);
    // Both triangles should reference vertex 0 for the welded position.
    expect(Array.from(out.triVerts)).toEqual([0, 1, 2, 0, 1, 2]);
  });

  it('keeps genuinely distinct vertices that differ beyond tolerance', () => {
    // Points 1e-3 apart are well above the 1e-6 tolerance — must NOT weld.
    // (Otherwise small mechanical features would silently collapse into a
    // single vertex.)
    const verts = [
      0, 0, 0,
      1e-3, 0, 0, // distinct from vertex 0 at this scale
    ];
    const tris: number[] = [];
    const out = weld(verts, tris);
    expect(out.numVert).toBe(2);
  });

  it('handles an empty mesh without throwing', () => {
    const out = weld([], []);
    expect(out.numVert).toBe(0);
    expect(out.numTri).toBe(0);
    expect(out.vertProperties.length).toBe(0);
    expect(out.triVerts.length).toBe(0);
  });
});
