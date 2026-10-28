import { describe, it, expect } from 'vitest';
import type { MeshData } from '../../src/geometry/types';
import type { RegionDescriptor } from '../../src/color/regions';
import { refineMeshPipeline, descriptorRefines } from '../../src/color/refinePipeline';
import { buildAdjacency } from '../../src/color/adjacency';
import {
  smoothFillFor,
  resolveSmoothFillTriangles,
  bucketFillTriangles,
  buildSmoothFillField,
  type SmoothFillDescriptor,
} from '../../src/color/smoothFill';

/** Flat N×N grid of unit cells, each split along its (i,j)→(i+1,j+1) diagonal:
 *  the lower-right triangle's centroid sits at x = i+⅔, the upper-left at i+⅓. */
function grid(n: number): MeshData {
  const verts: number[] = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) verts.push(i, j, 0);
  const tris: number[] = [];
  const v = (i: number, j: number) => j * (n + 1) + i;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      tris.push(v(i, j), v(i + 1, j), v(i + 1, j + 1));
      tris.push(v(i, j), v(i + 1, j + 1), v(i, j + 1));
    }
  }
  return { vertProperties: new Float32Array(verts), triVerts: new Uint32Array(tris), numVert: (n + 1) * (n + 1), numTri: tris.length / 3, numProp: 3 };
}

/** x of every vertex on an edge between a painted and an unpainted triangle,
 *  restricted to interior rows (y in (2, n-2)) so the grid border is ignored. */
function boundaryXs(mesh: MeshData, painted: Set<number>, n: number): number[] {
  const P = mesh.numProp;
  const key = (v: number) => `${mesh.vertProperties[v * P]},${mesh.vertProperties[v * P + 1]}`;
  const edgeOwners = new Map<string, boolean[]>();
  for (let t = 0; t < mesh.numTri; t++) {
    const ids = [0, 1, 2].map(k => mesh.triVerts[t * 3 + k]);
    for (let k = 0; k < 3; k++) {
      const a = key(ids[k]), b = key(ids[(k + 1) % 3]);
      const e = a < b ? `${a}|${b}` : `${b}|${a}`;
      const arr = edgeOwners.get(e) ?? [];
      arr.push(painted.has(t));
      edgeOwners.set(e, arr);
    }
  }
  const xs: number[] = [];
  for (const [e, owners] of edgeOwners) {
    if (!(owners.includes(true) && owners.includes(false))) continue;
    for (const p of e.split('|')) {
      const [x, y] = p.split(',').map(Number);
      if (y > 2 && y < n - 2) xs.push(x);
    }
  }
  return xs;
}

const N = 12;
// Flood the whole plane but clamp at x ≤ 5.5: in column 5 only the upper-left
// triangles (centroid 5.33) pass, so the raw boundary zigzags between x=5 and 6.
const desc: SmoothFillDescriptor = {
  kind: 'connectedFromSeed',
  seedPoint: [1, 1, 0],
  seedNormal: [0, 0, 1],
  maxDeviationDeg: 180,
  clampMax: [5.5, 1e9, 1e9],
  smooth: true,
  smoothness: 4,
};

describe('smooth bucket fill', () => {
  it('counts as a refining descriptor only when smooth is set', () => {
    expect(descriptorRefines(desc as RegionDescriptor)).toBe(true);
    expect(descriptorRefines({ ...desc, smooth: false } as RegionDescriptor)).toBe(false);
    const { smooth: _s, ...legacy } = desc;
    expect(descriptorRefines(legacy as RegionDescriptor)).toBe(false);
  });

  it('turns the zigzag boundary into a straight cut through the triangles (worker pipeline)', () => {
    const base = grid(N);
    const raw = bucketFillTriangles(desc, base, buildAdjacency(base));
    const rawXs = boundaryXs(base, raw, N);
    expect(Math.max(...rawXs) - Math.min(...rawXs)).toBe(1); // the sawtooth: x = 5 and 6

    // Exactly what the subdivision worker runs.
    const { mesh } = refineMeshPipeline(base, base, [desc as RegionDescriptor]);
    expect(mesh.numTri).toBeGreaterThan(base.numTri); // boundary triangles were cut
    const painted = resolveSmoothFillTriangles(desc, base, mesh);
    const xs = boundaryXs(mesh, painted, N);
    expect(xs.length).toBeGreaterThan(0);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(0.05); // one straight line
    expect(xs[0]).toBeGreaterThan(5.3);
    expect(xs[0]).toBeLessThan(5.7);
  });

  it('every refined triangle sits wholly on one side of the cut', () => {
    const base = grid(N);
    const { mesh } = refineMeshPipeline(base, base, [desc as RegionDescriptor]);
    const field = smoothFillFor(desc, base);
    const P = mesh.numProp;
    for (let t = 0; t < mesh.numTri; t++) {
      const c = [0, 1, 2].map(k => {
        const v = mesh.triVerts[t * 3 + k] * P;
        return field.coverage(mesh.vertProperties[v], mesh.vertProperties[v + 1], mesh.vertProperties[v + 2]) - 0.5;
      });
      const above = c.some(x => x > 1e-4), below = c.some(x => x < -1e-4);
      expect(above && below).toBe(false);
    }
  });

  it('keeps roughly the same painted area as the raw fill', () => {
    const base = grid(N);
    const raw = bucketFillTriangles(desc, base, buildAdjacency(base));
    const { mesh } = refineMeshPipeline(base, base, [desc as RegionDescriptor]);
    const painted = resolveSmoothFillTriangles(desc, base, mesh);
    const area = (m: MeshData, set: Set<number>) => {
      let a = 0;
      for (const t of set) {
        const p = [0, 1, 2].map(k => m.triVerts[t * 3 + k] * m.numProp);
        const [ax, ay] = [m.vertProperties[p[0]], m.vertProperties[p[0] + 1]];
        const [bx, by] = [m.vertProperties[p[1]], m.vertProperties[p[1] + 1]];
        const [cx, cy] = [m.vertProperties[p[2]], m.vertProperties[p[2] + 1]];
        a += Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
      }
      return a;
    };
    expect(area(mesh, painted)).toBeCloseTo(area(base, raw), 0);
  });

  it('a fill only a triangle wide blurs away and reports empty', () => {
    const base = grid(N);
    const f = buildSmoothFillField(base, new Set([40]), 4);
    expect(f.empty).toBe(true);
    const thick = buildSmoothFillField(base, bucketFillTriangles(desc, base, buildAdjacency(base)), 4);
    expect(thick.empty).toBe(false);
  });
});

/** Closed axis-aligned box [0,w]×[0,w]×[0,h], each face an n×n (or n×m) grid of
 *  split cells, so faces have interior vertices but meet at sharp 90° creases. */
function gridBox(w: number, h: number, n: number): MeshData {
  const verts: number[] = [];
  const tris: number[] = [];
  const index = new Map<string, number>();
  const vid = (x: number, y: number, z: number) => {
    const k = `${x},${y},${z}`;
    let i = index.get(k);
    if (i === undefined) { i = verts.length / 3; verts.push(x, y, z); index.set(k, i); }
    return i;
  };
  // Each face: origin o, axes u, v (outward normal = u × v).
  const faces: [number[], number[], number[]][] = [
    [[0, 0, h], [w, 0, 0], [0, w, 0]],   // top (+z)
    [[0, w, 0], [w, 0, 0], [0, -w, 0]],  // bottom (−z)
    [[0, 0, 0], [w, 0, 0], [0, 0, h]],   // front (−y)
    [[w, w, 0], [-w, 0, 0], [0, 0, h]],  // back (+y)
    [[0, w, 0], [0, -w, 0], [0, 0, h]],  // left (−x)
    [[w, 0, 0], [0, w, 0], [0, 0, h]],   // right (+x)
  ];
  for (const [o, u, v] of faces) {
    const p = (i: number, j: number) => vid(
      o[0] + (u[0] * i + v[0] * j) / n, o[1] + (u[1] * i + v[1] * j) / n, o[2] + (u[2] * i + v[2] * j) / n,
    );
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      tris.push(p(i, j), p(i + 1, j), p(i + 1, j + 1));
      tris.push(p(i, j), p(i + 1, j + 1), p(i, j + 1));
    }
  }
  return { vertProperties: new Float32Array(verts), triVerts: new Uint32Array(tris), numVert: verts.length / 3, numTri: tris.length / 3, numProp: 3 };
}

describe('smooth bucket fill on sharp creases', () => {
  it('keeps a CAD face exactly: a 2-triangle cube top survives, edge stays on the crease', () => {
    const box = gridBox(10, 10, 1); // 2 triangles per face, no interior vertices
    const top: SmoothFillDescriptor = { kind: 'coplanar', seedPoint: [3, 3, 10], seedNormal: [0, 0, 1], normalTolerance: 0.9995, smooth: true, smoothness: 4 };
    const raw = bucketFillTriangles(top, box, buildAdjacency(box));
    expect(raw.size).toBe(2);
    expect(smoothFillFor(top, box).empty).toBe(false);
    const { mesh } = refineMeshPipeline(box, box, [top as RegionDescriptor]);
    const painted = resolveSmoothFillTriangles(top, box, mesh);
    expect(mesh.numTri).toBe(box.numTri); // nothing to cut — the edge is already a crease
    expect([...painted].sort()).toEqual([...raw].sort());
  });

  it('a fill bounded partly by a crease keeps that edge and smooths the rest', () => {
    const box = gridBox(12, 12, 12);
    // Flood the top face, clamped at x ≤ 5.5 → zigzag edge across the face,
    // crisp crease edges along the three sides that meet the walls.
    const d: SmoothFillDescriptor = {
      kind: 'connectedFromSeed', seedPoint: [2, 6, 12], seedNormal: [0, 0, 1], maxDeviationDeg: 10,
      clampMax: [5.5, 1e9, 1e9], smooth: true, smoothness: 4,
    };
    const { mesh } = refineMeshPipeline(box, box, [d as RegionDescriptor]);
    const painted = resolveSmoothFillTriangles(d, box, mesh);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity;
    const P = mesh.numProp;
    for (const t of painted) for (let k = 0; k < 3; k++) {
      const v = mesh.triVerts[t * 3 + k] * P;
      minX = Math.min(minX, mesh.vertProperties[v]); maxX = Math.max(maxX, mesh.vertProperties[v]);
      minY = Math.min(minY, mesh.vertProperties[v + 1]); maxY = Math.max(maxY, mesh.vertProperties[v + 1]);
      minZ = Math.min(minZ, mesh.vertProperties[v + 2]);
    }
    expect(minZ).toBeCloseTo(12, 5);   // never spills down a wall
    expect(minX).toBeCloseTo(0, 5);    // crease edges kept exactly
    expect(minY).toBeCloseTo(0, 5);
    expect(maxY).toBeCloseTo(12, 5);
    expect(maxX).toBeGreaterThan(5);   // the jagged edge became a cut near x≈5.5
    expect(maxX).toBeLessThan(6);
  });
});
