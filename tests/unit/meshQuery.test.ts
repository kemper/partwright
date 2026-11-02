import { describe, it, expect } from 'vitest';
import { buildMeshBvh, raycastAll, closestPoint, meshContains, type QueryMesh, type Vec3 } from '../../src/geometry/meshQuery';
import { padViewBox, pointInViewBox, viewBoxHalfSpaces } from '../../src/renderer/viewFocus';

const raycastFirst = (...a: Parameters<typeof raycastAll>) => raycastAll(...a)[0] ?? null;

/** Axis-aligned box [min, max] as an outward-wound triangle mesh. */
function boxMesh(min: Vec3, max: Vec3): QueryMesh {
  const [x0, y0, z0] = min, [x1, y1, z1] = max;
  const v = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [3, 0, 4, 7]];
  const tri: number[] = [];
  for (const [a, b, c, d] of quads) tri.push(a, b, c, a, c, d);
  return { numProp: 3, vertProperties: Float32Array.from(v.flat()), triVerts: Uint32Array.from(tri) };
}

/** A UV sphere (outward winding) — enough triangles to exercise the tree. */
function sphereMesh(r: number, seg: number, rings: number, c: Vec3 = [0, 0, 0]): QueryMesh {
  const verts: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const th = (Math.PI * i) / rings;
    for (let j = 0; j < seg; j++) {
      const ph = (2 * Math.PI * j) / seg;
      verts.push(c[0] + r * Math.sin(th) * Math.cos(ph), c[1] + r * Math.sin(th) * Math.sin(ph), c[2] + r * Math.cos(th));
    }
  }
  const tri: number[] = [];
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * seg + j, b = i * seg + ((j + 1) % seg), c2 = (i + 1) * seg + j, d = (i + 1) * seg + ((j + 1) % seg);
      if (i > 0) tri.push(a, c2, b);
      if (i < rings - 1) tri.push(b, c2, d);
    }
  }
  return { numProp: 3, vertProperties: Float64Array.from(verts), triVerts: Uint32Array.from(tri) };
}

describe('meshQuery raycast', () => {
  const bvh = buildMeshBvh(boxMesh([-1, -1, -1], [1, 1, 1]));

  it('hits the near face of a box first, entering, with an outward normal', () => {
    const hit = raycastFirst(bvh, [0.2, 0.3, 5], [0, 0, -1])!;
    expect(hit.point[2]).toBeCloseTo(1);
    expect(hit.distance).toBeCloseTo(4);
    expect(hit.normal).toEqual([0, 0, 1]);
    expect(hit.entering).toBe(true);
  });

  it('returns both crossings with all, nearest first', () => {
    const hits = raycastAll(bvh, [0.2, 0.3, 5], [0, 0, -2]);
    expect(hits.map(h => Math.round(h.point[2] * 1000) / 1000)).toEqual([1, -1]);
    expect(hits.map(h => h.entering)).toEqual([true, false]);
    expect(hits[1].distance).toBeCloseTo(6); // along the normalised direction
  });

  it('counts a crossing through a shared edge once', () => {
    // (0, 0) lies on the diagonal splitting the top and bottom quads.
    const hits = raycastAll(bvh, [0, 0, 5], [0, 0, -1]);
    expect(hits.map(h => h.entering)).toEqual([true, false]);
  });

  it('respects maxDistance and misses cleanly', () => {
    expect(raycastFirst(bvh, [0, 0, 5], [0, 0, -1], 3)).toBeNull();
    expect(raycastFirst(bvh, [5, 5, 5], [0, 0, -1])).toBeNull();
    expect(raycastFirst(bvh, [0, 0, 5], [0, 0, 1])).toBeNull(); // pointing away
  });

  it('agrees with a brute-force scan on a dense mesh', () => {
    const mesh = sphereMesh(3, 48, 32, [1, -2, 0.5]);
    const tree = buildMeshBvh(mesh);
    // One tree leaf can't hold the whole sphere — the test is meaningful.
    expect(tree.count[0]).toBe(0);
    for (const [o, d] of [
      [[10, -2, 0.5], [-1, 0, 0]], [[1, -2, 10], [0.1, 0.05, -1]], [[-6, 3, -4], [1, -0.9, 0.7]],
    ] as [Vec3, Vec3][]) {
      const fast = raycastAll(tree, o, d).map(h => h.distance);
      // Brute force: every triangle in one leaf.
      const flat = { ...tree, boxes: Float64Array.from([-1e9, -1e9, -1e9, 1e9, 1e9, 1e9]), left: Int32Array.of(0), start: Int32Array.of(0), count: Int32Array.of(tree.numTri), tris: Int32Array.from({ length: tree.numTri }, (_, i) => i) };
      const slow = raycastAll(flat, o, d).map(h => h.distance);
      expect(fast.length).toBe(slow.length);
      fast.forEach((v, i) => expect(v).toBeCloseTo(slow[i], 9));
    }
  });
});

describe('meshQuery closestPoint', () => {
  it('projects onto the nearest face of a box and reports outside', () => {
    const bvh = buildMeshBvh(boxMesh([0, 0, 0], [2, 2, 2]));
    const r = closestPoint(bvh, [1, 1, 5])!;
    expect(r.point.map(v => Math.round(v * 1e6) / 1e6)).toEqual([1, 1, 2]);
    expect(r.distance).toBeCloseTo(3);
    expect(r.normal).toEqual([0, 0, 1]);
    expect(r.inside).toBe(false);
  });

  it('snaps to an edge/corner and detects inside points', () => {
    const bvh = buildMeshBvh(boxMesh([0, 0, 0], [2, 2, 2]));
    const corner = closestPoint(bvh, [3, 3, 3])!;
    expect(corner.point.map(v => Math.round(v * 1e6) / 1e6)).toEqual([2, 2, 2]);
    expect(corner.distance).toBeCloseTo(Math.sqrt(3));
    const inner = closestPoint(bvh, [1, 1, 1.8])!;
    expect(inner.inside).toBe(true);
    expect(inner.distance).toBeCloseTo(0.2);
    expect(inner.point[2]).toBeCloseTo(2);
  });

  it('matches the analytic distance to a dense sphere', () => {
    const c: Vec3 = [1, -2, 0.5];
    const bvh = buildMeshBvh(sphereMesh(3, 64, 48, c));
    for (const p of [[9, -2, 0.5], [1, -2, 0.5 + 2], [-4, 4, -3]] as Vec3[]) {
      const r = closestPoint(bvh, p)!;
      const analytic = Math.abs(Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) - 3);
      expect(r.distance).toBeCloseTo(analytic, 1); // tessellation error only
      expect(r.inside).toBe(Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) < 3);
    }
  });

  it('meshContains and an empty mesh', () => {
    const bvh = buildMeshBvh(boxMesh([0, 0, 0], [1, 1, 1]));
    expect(meshContains(bvh, [0.5, 0.5, 0.5])).toBe(true);
    expect(meshContains(bvh, [1.5, 0.5, 0.5])).toBe(false);
    const empty = buildMeshBvh({ numProp: 3, vertProperties: new Float32Array(0), triVerts: new Uint32Array(0) });
    expect(closestPoint(empty, [0, 0, 0])).toBeNull();
    expect(raycastAll(empty, [0, 0, 0], [1, 0, 0])).toEqual([]);
  });
});

describe('viewFocus', () => {
  it('pads by a fraction of the largest side', () => {
    const b = padViewBox({ min: [0, 0, 0], max: [10, 2, 4] }, 0.1);
    expect(b.min).toEqual([-1, -1, -1]);
    expect(b.max).toEqual([11, 3, 5]);
  });

  it('gives a degenerate box a margin', () => {
    const b = padViewBox({ min: [1, 1, 1], max: [1, 1, 1] }, 0, 2);
    expect(b.max[0] - b.min[0]).toBeCloseTo(2);
  });

  it('point test and half-spaces agree', () => {
    const box = { min: [-1, 0, 2] as Vec3, max: [1, 3, 4] as Vec3 };
    const planes = viewBoxHalfSpaces(box);
    for (const p of [[0, 1, 3], [1.5, 1, 3], [0, -0.1, 3], [1, 3, 4]] as Vec3[]) {
      const kept = planes.every(h => h.normal[0] * p[0] + h.normal[1] * p[1] + h.normal[2] * p[2] + h.constant >= 0);
      expect(kept).toBe(pointInViewBox(p, box));
    }
  });
});
