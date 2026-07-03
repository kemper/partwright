// Tests for the agglomerative merge post-pass added to `computeFaceGroups`
// (the `merge: { angleDeg, minArea }` option): fragments produced by the
// crease-watershed BFS (e.g. a sculpted pupil or bang strand split into 3-4
// sibling groups by normal jitter) can be reassembled into one region.
//
// These exercise the pure-logic core; the window.partwright wrapper
// (getMeshSummary / detectRegions) is e2e-tested elsewhere.

import { describe, it, expect } from 'vitest';
import { computeFaceGroups } from '../../src/color/faceGroups';
import type { MeshData } from '../../src/geometry/types';

type Vec3 = [number, number, number];

/** Build a MeshData from a list of triangles, each defined by its three
 *  world-space vertices (triangle-soup form). Adjacency layer welds by exact
 *  position. Mirrors the helper in tests/unit/detectRegionsExtension.test.ts. */
function meshFromTriangles(triangles: Vec3[][]): MeshData {
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

/** A 6-face axis-aligned box at the origin with `s` half-extent — same
 *  fixture as detectRegionsExtension.test.ts, used here for the back-compat
 *  check (adjacent faces meet at a 90° crease the watershed never crosses). */
function boxMesh(s: number): Vec3[][] {
  const v = [
    [-s, -s, -s], [s, -s, -s], [s, s, -s], [-s, s, -s],
    [-s, -s, s], [s, -s, s], [s, s, s], [-s, s, s],
  ] as Vec3[];
  return [
    [v[0], v[2], v[1]], [v[0], v[3], v[2]],   // -Z
    [v[4], v[5], v[6]], [v[4], v[6], v[7]],   // +Z
    [v[0], v[1], v[5]], [v[0], v[5], v[4]],   // -Y
    [v[2], v[3], v[7]], [v[2], v[7], v[6]],   // +Y
    [v[0], v[4], v[7]], [v[0], v[7], v[3]],   // -X
    [v[1], v[2], v[6]], [v[1], v[6], v[5]],   // +X
  ];
}

// Independent (from-scratch) triangle-geometry helpers used only to compute
// EXPECTED aggregate stats for the merge assertions — deliberately not
// shared with src/color/faceGroups.ts's own `triangleArea`/`buildGroup` math,
// so a bug in the implementation can't quietly cancel out in the expectation.
function triArea(a: Vec3, b: Vec3, c: Vec3): number {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
  const crx = aby * acz - abz * acy;
  const cry = abz * acx - abx * acz;
  const crz = abx * acy - aby * acx;
  return 0.5 * Math.sqrt(crx * crx + cry * cry + crz * crz);
}
function triCentroid(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  return [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
}

/** A shallow 3-sector cone: a shared apex raised `h` above 3 rim points
 *  spaced 120° apart at radius `r`. Each sector is ONE flat triangle, so its
 *  own raw watershed group is trivially itself — but the shallow cone gives
 *  each sector's normal a several-degree tilt toward a different azimuth
 *  (the "normal jitter" that fragments a real sculpted cap into siblings),
 *  so a *tight* crease tolerance keeps the 3 sectors as separate raw groups
 *  while a looser merge angle reassembles them into one region. */
function shallowConeFan(h: number, r = 10): Vec3[][] {
  const apex: Vec3 = [0, 0, h];
  const angles = [0, 120, 240].map(d => (d * Math.PI) / 180);
  const rim = angles.map(a => [r * Math.cos(a), r * Math.sin(a), 0] as Vec3);
  return [
    [apex, rim[0], rim[1]],
    [apex, rim[1], rim[2]],
    [apex, rim[2], rim[0]],
  ];
}

describe('computeFaceGroups — merge disabled: back-compat', () => {
  it('merge: undefined behaves identically to omitting the option entirely', () => {
    const mesh = meshFromTriangles(boxMesh(5));
    const tol = Math.cos((20 * Math.PI) / 180);
    const withoutOption = computeFaceGroups(mesh, { tolerance: tol, minTriangles: 1, includeNeighborIds: true });
    const withUndefinedMerge = computeFaceGroups(mesh, {
      tolerance: tol,
      minTriangles: 1,
      includeNeighborIds: true,
      merge: undefined,
    });
    expect(withUndefinedMerge).toEqual(withoutOption);
    // Sanity: this is still the familiar 6-faces-of-a-box result.
    expect(withoutOption.groups).toHaveLength(6);
  });

  it('sub-threshold raw fragments are still dropped when merge is not requested', () => {
    // Same shallow-cone fan the merge tests use below. Each sector is a
    // single triangle; with minTriangles: 2 and no merge option, every
    // sector is individually below threshold and the pre-merge behavior
    // (drop it immediately) must be preserved.
    const tris = shallowConeFan(0.3, 10);
    const mesh = meshFromTriangles(tris);
    const rawTol = Math.cos((2 * Math.PI) / 180);
    const summary = computeFaceGroups(mesh, { tolerance: rawTol, minTriangles: 2 });
    expect(summary.groups).toHaveLength(0);
  });
});

describe('computeFaceGroups — merge: fragmented cap reassembly', () => {
  it('3 raw watershed sectors at a 2° tolerance merge into 1 region at angleDeg 10', () => {
    const tris = shallowConeFan(0.3, 10);
    const mesh = meshFromTriangles(tris);
    const rawTol = Math.cos((2 * Math.PI) / 180);

    // Without merge: the shallow cone's per-sector normal jitter (a few
    // degrees, toward 3 different azimuths) exceeds the tight 2° crease
    // gate, so the watershed keeps all 3 sectors separate.
    const raw = computeFaceGroups(mesh, { tolerance: rawTol, minTriangles: 1 });
    expect(raw.groups).toHaveLength(3);
    for (const g of raw.groups) expect(g.triangleCount).toBe(1);

    // With merge at a looser 10° angle, the 3 sectors' area-weighted mean
    // normals are close enough to agglomerate into a single region.
    const merged = computeFaceGroups(mesh, { tolerance: rawTol, minTriangles: 1, merge: { angleDeg: 10 } });
    expect(merged.groups).toHaveLength(1);

    const group = merged.groups[0];
    const areas = tris.map(([a, b, c]) => triArea(a, b, c));
    const expectedArea = areas.reduce((s, a) => s + a, 0);
    expect(group.triangleCount).toBe(3);
    expect(group.area).toBeCloseTo(expectedArea, 3);

    // Area-weighted centroid = sum(triCentroid * triArea) / totalArea.
    let cx = 0, cy = 0, cz = 0;
    tris.forEach(([a, b, c], i) => {
      const [tcx, tcy, tcz] = triCentroid(a, b, c);
      cx += tcx * areas[i];
      cy += tcy * areas[i];
      cz += tcz * areas[i];
    });
    expect(group.centroid[0]).toBeCloseTo(cx / expectedArea, 3);
    expect(group.centroid[1]).toBeCloseTo(cy / expectedArea, 3);
    expect(group.centroid[2]).toBeCloseTo(cz / expectedArea, 3);

    // maxTriangleArea / medianTriangleArea recomputed over the UNION of all
    // 3 sectors' triangles, not approximated from any single raw fragment.
    const sortedAreas = [...areas].sort((a, b) => a - b);
    expect(group.maxTriangleArea).toBeCloseTo(Math.max(...areas), 3);
    expect(group.medianTriangleArea).toBeCloseTo(sortedAreas[1], 3);
  });
});

describe('computeFaceGroups — merge respects genuine creases', () => {
  it('does not merge two quads folded at 90° even with a generous angleDeg', () => {
    // A "folded sheet": a horizontal floor quad and a vertical wall quad
    // sharing one edge, meeting at an exact 90° crease.
    const floor: Vec3[][] = [
      [[0, 0, 0], [10, 0, 0], [10, 10, 0]],
      [[0, 0, 0], [10, 10, 0], [0, 10, 0]],
    ];
    const wall: Vec3[][] = [
      [[10, 0, 0], [10, 10, 0], [10, 10, 10]],
      [[10, 0, 0], [10, 10, 10], [10, 0, 10]],
    ];
    const mesh = meshFromTriangles([...floor, ...wall]);
    const summary = computeFaceGroups(mesh, { tolerance: 0.9995, minTriangles: 1, merge: { angleDeg: 30 } });
    expect(summary.groups).toHaveLength(2);
    for (const g of summary.groups) expect(g.triangleCount).toBe(2);
  });
});

describe('computeFaceGroups — merge: tiny-group rule', () => {
  // A big flat quad (area 100) with a tiny 2-triangle sliver (area 1)
  // attached at one corner vertex, the sliver's plane bent 45° from the
  // big quad's — well past any reasonable angleDeg, so the angle rule alone
  // can't take it. Only the tiny-with-one-neighbour rule can merge it.
  function buildMesh(): MeshData {
    const big: Vec3[][] = [
      [[0, 0, 0], [10, 0, 0], [10, 10, 0]],
      [[0, 0, 0], [10, 10, 0], [0, 10, 0]],
    ];
    const c = Math.cos(Math.PI / 4), s = Math.sin(Math.PI / 4);
    const sliver: Vec3[][] = [
      [[10, 0, 0], [10 + c, 0, s], [10 + c, 1, s]],
      [[10, 0, 0], [10 + c, 1, s], [10, 1, 0]],
    ];
    return meshFromTriangles([...big, ...sliver]);
  }

  it('merges the tiny sliver into the big group when minArea classifies it as tiny', () => {
    const mesh = buildMesh();
    const summary = computeFaceGroups(mesh, {
      tolerance: 0.9995,
      minTriangles: 1,
      merge: { angleDeg: 30, minArea: 10 },
    });
    expect(summary.groups).toHaveLength(1);
    expect(summary.groups[0].triangleCount).toBe(4);
    expect(summary.groups[0].area).toBeCloseTo(101, 3);
  });

  it('keeps the sliver separate when minArea is 0 (tiny rule disabled)', () => {
    const mesh = buildMesh();
    const summary = computeFaceGroups(mesh, { tolerance: 0.9995, minTriangles: 1, merge: { angleDeg: 30 } });
    expect(summary.groups).toHaveLength(2);
  });
});

describe('computeFaceGroups — minTriangles applied AFTER merge', () => {
  it('returns a merged group whose fragments were each individually below minTriangles', () => {
    const tris = shallowConeFan(0.3, 10);
    const mesh = meshFromTriangles(tris);
    const rawTol = Math.cos((2 * Math.PI) / 180);

    // Without merge: each 1-triangle sector is below minTriangles: 2 and is
    // dropped before it could ever be reported.
    const noMerge = computeFaceGroups(mesh, { tolerance: rawTol, minTriangles: 2 });
    expect(noMerge.groups).toHaveLength(0);

    // With merge: the 3 sectors combine into a 3-triangle group BEFORE the
    // minTriangles filter runs, so it clears the threshold and is returned
    // — the fragments would have been dropped pre-merge.
    const withMerge = computeFaceGroups(mesh, { tolerance: rawTol, minTriangles: 2, merge: { angleDeg: 10 } });
    expect(withMerge.groups).toHaveLength(1);
    expect(withMerge.groups[0].triangleCount).toBe(3);
  });
});
