// Tests for the computeFaceGroups extensions in PR #870:
//   - tolerance tuned for sculpted-feature segmentation (cos 20°)
//   - restrictTo (segment within a single mesh-island)
//   - includeNeighborIds (region adjacency post-pass)
//
// These exercise the pure-logic core that backs partwright.detectRegions().
// The window.partwright wrapper is e2e-tested elsewhere; this file pins the
// math so a regression in the kernel can't sneak past the unit tier.

import { describe, it, expect } from 'vitest';
import { computeFaceGroups } from '../../src/color/faceGroups';
import type { MeshData } from '../../src/geometry/types';

/** Build a MeshData from a list of triangles, each defined by its three world-
 *  space vertices (triangle-soup form). Adjacency layer welds by exact position. */
function meshFromTriangles(triangles: [number, number, number][][]): MeshData {
  const vertProperties: number[] = [];
  const triVerts: number[] = [];
  triangles.forEach((tri, t) => {
    for (const [x, y, z] of tri) vertProperties.push(x, y, z);
    triVerts.push(t * 3, t * 3 + 1, t * 3 + 2);
  });
  return {
    vertProperties: new Float32Array(vertProperties),
    triVerts: new Uint32Array(triVerts),
    numProp: 3,
    numVert: triangles.length * 3,
    numTri: triangles.length,
  } as MeshData;
}

/** A 6-face axis-aligned box at the origin with `s` half-extent. 12 triangles
 *  (2 per face), all face-normals on ±X/±Y/±Z. Adjacent faces meet at 90°
 *  creases that the watershed should never cross. */
function boxMesh(s: number, offset: [number, number, number] = [0, 0, 0]): [number, number, number][][] {
  const [ox, oy, oz] = offset;
  const v = [
    [ox - s, oy - s, oz - s], [ox + s, oy - s, oz - s], [ox + s, oy + s, oz - s], [ox - s, oy + s, oz - s],
    [ox - s, oy - s, oz + s], [ox + s, oy - s, oz + s], [ox + s, oy + s, oz + s], [ox - s, oy + s, oz + s],
  ] as [number, number, number][];
  return [
    [v[0], v[2], v[1]], [v[0], v[3], v[2]],   // -Z
    [v[4], v[5], v[6]], [v[4], v[6], v[7]],   // +Z
    [v[0], v[1], v[5]], [v[0], v[5], v[4]],   // -Y
    [v[2], v[3], v[7]], [v[2], v[7], v[6]],   // +Y
    [v[0], v[4], v[7]], [v[0], v[7], v[3]],   // -X
    [v[1], v[2], v[6]], [v[1], v[6], v[5]],   // +X
  ];
}

describe('computeFaceGroups — crease-watershed at sculpt-tuned tolerance', () => {
  it('splits a box into its 6 faces at a 20° crease threshold', () => {
    // Each face = 2 coplanar triangles. The 90° crease between faces is well
    // above the 20° threshold, so the BFS stops at every face boundary and
    // returns exactly 6 groups, 2 triangles each.
    const mesh = meshFromTriangles(boxMesh(5));
    const tol = Math.cos(20 * Math.PI / 180);  // ≈ 0.94
    const summary = computeFaceGroups(mesh, { tolerance: tol, minTriangles: 1 });
    expect(summary.groups).toHaveLength(6);
    for (const g of summary.groups) expect(g.triangleCount).toBe(2);
  });

  it('default (1.8°) tolerance also splits a box into 6 faces (the faces ARE coplanar)', () => {
    // The default crease test passes at adjacent-pair angle <= ~1.8°; box
    // faces are perfectly coplanar (0°) so this still gives 6 faces.
    const mesh = meshFromTriangles(boxMesh(5));
    const summary = computeFaceGroups(mesh);
    expect(summary.groups).toHaveLength(6);
  });
});

describe('computeFaceGroups — restrictTo (withinIsland filter)', () => {
  it('only segments triangles in the restriction set', () => {
    // Two disjoint boxes; restrictTo the second box (triangles 12–23) and
    // assert we get exactly its 6 faces back.
    const all = [...boxMesh(5, [0, 0, 0]), ...boxMesh(5, [100, 0, 0])];
    const mesh = meshFromTriangles(all);
    const island2 = new Set<number>();
    for (let t = 12; t < 24; t++) island2.add(t);
    const tol = Math.cos(20 * Math.PI / 180);
    const summary = computeFaceGroups(mesh, { tolerance: tol, minTriangles: 1, restrictTo: island2 });
    expect(summary.groups).toHaveLength(6);
    // Every reported triangle id should belong to the restriction.
    for (const g of summary.groups) {
      for (const t of g.triangleIds) expect(island2.has(t)).toBe(true);
    }
  });

  it('returns no groups when the restriction set is empty', () => {
    const mesh = meshFromTriangles(boxMesh(5));
    const summary = computeFaceGroups(mesh, { restrictTo: new Set<number>() });
    expect(summary.groups).toHaveLength(0);
  });
});

describe('computeFaceGroups — includeNeighborIds (region adjacency)', () => {
  it('reports each box face neighbouring exactly 4 other faces (top/bottom of cube)', () => {
    // On a cube, every face touches the 4 adjacent faces (not the opposite
    // one). So `neighborIds.length === 4` for every group.
    const mesh = meshFromTriangles(boxMesh(5));
    const tol = Math.cos(20 * Math.PI / 180);
    const summary = computeFaceGroups(mesh, { tolerance: tol, minTriangles: 1, includeNeighborIds: true });
    expect(summary.groups).toHaveLength(6);
    for (const g of summary.groups) {
      expect(g.neighborIds).toBeDefined();
      expect(g.neighborIds).toHaveLength(4);
      // No self-loops.
      expect(g.neighborIds).not.toContain(g.id);
    }
  });

  it('reports empty neighbours for a disconnected single face', () => {
    // Single triangle has no neighbours of its own group OR another group.
    const mesh = meshFromTriangles([
      [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
    ]);
    const summary = computeFaceGroups(mesh, { tolerance: 0.9995, minTriangles: 1, includeNeighborIds: true });
    expect(summary.groups).toHaveLength(1);
    expect(summary.groups[0].neighborIds).toEqual([]);
  });

  it('two disjoint boxes: each box face touches 4 of its OWN box, none of the other', () => {
    // 12 faces total. Each face's neighborIds are the 4 adjacent faces ON
    // THE SAME BOX. Crucially, faces on box A never list faces on box B
    // (different topological components).
    const all = [...boxMesh(5, [0, 0, 0]), ...boxMesh(5, [100, 0, 0])];
    const mesh = meshFromTriangles(all);
    const tol = Math.cos(20 * Math.PI / 180);
    const summary = computeFaceGroups(mesh, { tolerance: tol, minTriangles: 1, includeNeighborIds: true });
    expect(summary.groups).toHaveLength(12);

    // Partition groups by box (which mesh-side their centroids live on).
    const boxA: number[] = [];
    const boxB: number[] = [];
    for (const g of summary.groups) (g.centroid[0] < 50 ? boxA : boxB).push(g.id);
    expect(boxA).toHaveLength(6);
    expect(boxB).toHaveLength(6);

    // No face on box A should list a face on box B as a neighbour.
    for (const g of summary.groups) {
      const sameSide = boxA.includes(g.id) ? boxA : boxB;
      const otherSide = boxA.includes(g.id) ? boxB : boxA;
      expect(g.neighborIds).toHaveLength(4);
      for (const n of g.neighborIds!) {
        expect(sameSide).toContain(n);
        expect(otherSide).not.toContain(n);
      }
    }
  });
});
