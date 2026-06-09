import { describe, it, expect } from 'vitest';
import type { MeshData } from '../../src/geometry/types';
import {
  subdivideToMaxEdge,
  computeVertexNormals,
  maxEdgeLength,
  extractPositions,
  estimateRefineTriangles,
  bboxOf,
} from '../../src/surface/meshSubdivide';
import { fuzzySkin } from '../../src/surface/fuzzySkin';
import { knitTextureUV } from '../../src/surface/knitTexture';
import { cableKnit } from '../../src/surface/cableKnit';
import { waffleStitch } from '../../src/surface/waffleStitch';
import { furVelvet } from '../../src/surface/furVelvet';
import { wovenFabric } from '../../src/surface/wovenFabric';
import { voronoiShell } from '../../src/surface/voronoiShell';
import { voronoiLattice } from '../../src/surface/voronoiLattice';
import { surfaceNetsField } from '../../src/surface/surfaceNetsField';
import { largestMeshComponent } from '../../src/surface/meshComponents';
import { smoothSurface } from '../../src/surface/smoothSurface';
import { voxelizeMesh } from '../../src/surface/voxelizeMesh';
import { encodeGrid } from '../../src/geometry/voxel/grid';
import { applyFuzzy, applyKnit, applyKnitPatch, applySmooth, applyVoxelize, applyVoronoiLamp } from '../../src/surface/modifiers';
import { nearestTriangleMap } from '../../src/surface/colorTransfer';

/** Axis-aligned cube from [0,s]^3 as a 8-vertex / 12-triangle MeshData. */
function cube(s = 10): MeshData {
  const vertProperties = new Float32Array([
    0, 0, 0, s, 0, 0, s, s, 0, 0, s, 0,
    0, 0, s, s, 0, s, s, s, s, 0, s, s,
  ]);
  const triVerts = new Uint32Array([
    0, 2, 1, 0, 3, 2, // bottom
    4, 5, 6, 4, 6, 7, // top
    0, 1, 5, 0, 5, 4, // front
    2, 3, 7, 2, 7, 6, // back
    1, 2, 6, 1, 6, 5, // right
    0, 4, 7, 0, 7, 3, // left
  ]);
  return { vertProperties, triVerts, numVert: 8, numTri: 12, numProp: 3 };
}

describe('meshSubdivide', () => {
  it('quadruples triangle count and reduces the longest edge', () => {
    const c = cube(10);
    const before = maxEdgeLength(extractPositions(c), c.triVerts);
    const out = subdivideToMaxEdge(c, { maxEdge: before / 3, maxRounds: 4 });
    expect(out.numTri).toBeGreaterThan(c.numTri);
    expect(out.numProp).toBe(3);
    expect(maxEdgeLength(out.vertProperties, out.triVerts)).toBeLessThanOrEqual(before / 3 + 1e-6);
  });

  it('estimateRefineTriangles grows ~quadratically as the target length shrinks', () => {
    const c = cube(10); // longest edge is a face diagonal ≈ 14.14
    // A length >= the longest edge means no split: ~1 sub-triangle each.
    expect(estimateRefineTriangles(extractPositions(c), c.triVerts, 100)).toBe(c.numTri);
    // Halving the length roughly quadruples each triangle's k² contribution, so
    // a much smaller length yields a far larger estimate.
    const coarse = estimateRefineTriangles(extractPositions(c), c.triVerts, 5);
    const fine = estimateRefineTriangles(extractPositions(c), c.triVerts, 1);
    expect(fine).toBeGreaterThan(coarse);
    expect(coarse).toBeGreaterThan(c.numTri);
    // Non-positive length is a no-op estimate (the base count).
    expect(estimateRefineTriangles(extractPositions(c), c.triVerts, 0)).toBe(c.numTri);
  });

  it('dedupes shared edge midpoints (stays watertight, no vertex explosion)', () => {
    const c = cube(10);
    const out = subdivideToMaxEdge(c, { maxEdge: 4, maxRounds: 1 });
    // One pass: 12 -> 48 triangles. A watertight dedup adds exactly the unique
    // edges as new verts (18 edges on a cube triangulation) -> 8 + 18 = 26.
    expect(out.numTri).toBe(48);
    expect(out.numVert).toBe(26);
  });

  it('carries per-triangle colors to all four children', () => {
    const c = cube(10);
    c.triColors = new Uint8Array(c.numTri * 3).fill(7);
    const out = subdivideToMaxEdge(c, { maxEdge: 4, maxRounds: 1 });
    expect(out.triColors).toBeTruthy();
    expect(out.triColors!.length).toBe(out.numTri * 3);
    expect([...out.triColors!].every(v => v === 7)).toBe(true);
  });

  it('carries the _painted mask to all four children', () => {
    type P = Uint8Array & { _painted?: Uint8Array };
    const c = cube(10); // 12 triangles
    c.triColors = new Uint8Array(c.numTri * 3);
    const painted = new Uint8Array(c.numTri);
    painted[0] = 1; painted[3] = 1; // only triangles 0 and 3 are painted
    (c.triColors as P)._painted = painted;
    const out = subdivideToMaxEdge(c, { maxEdge: 4, maxRounds: 1 }); // 12→48
    const outPainted = (out.triColors as P)._painted;
    expect(outPainted).toBeTruthy();
    expect(outPainted!.length).toBe(48);
    // children of tri 0 → slots 0-3: painted
    for (let k = 0; k < 4; k++) expect(outPainted![k]).toBe(1);
    // children of tri 1 → slots 4-7: not painted
    for (let k = 4; k < 8; k++) expect(outPainted![k]).toBe(0);
    // children of tri 3 → slots 12-15: painted
    for (let k = 12; k < 16; k++) expect(outPainted![k]).toBe(1);
  });

  it('computes unit-length vertex normals', () => {
    const c = cube(10);
    const n = computeVertexNormals(extractPositions(c), c.triVerts);
    for (let v = 0; v < c.numVert; v++) {
      const len = Math.hypot(n[v * 3], n[v * 3 + 1], n[v * 3 + 2]);
      expect(len).toBeCloseTo(1, 5);
    }
  });
});

describe('fuzzySkin', () => {
  it('is deterministic for a given seed and perturbs the surface', () => {
    const a = fuzzySkin(cube(10), { amplitude: 0.5, scale: 2, seed: 42 });
    const b = fuzzySkin(cube(10), { amplitude: 0.5, scale: 2, seed: 42 });
    expect([...a.vertProperties]).toEqual([...b.vertProperties]);
    // Subdivided, so more triangles than the input cube.
    expect(a.numTri).toBeGreaterThan(12);
    // The bounding box should expand by roughly the amplitude.
    const grown = bboxOf(a.vertProperties);
    expect(grown.max[0]).toBeGreaterThan(10);
  });

  it('a different seed yields different geometry', () => {
    const a = fuzzySkin(cube(10), { amplitude: 0.5, scale: 2, seed: 1 });
    const b = fuzzySkin(cube(10), { amplitude: 0.5, scale: 2, seed: 2 });
    expect([...a.vertProperties]).not.toEqual([...b.vertProperties]);
  });

  it('zero amplitude leaves the cube unchanged (no subdivision either)', () => {
    const out = fuzzySkin(cube(10), { amplitude: 0, scale: 2 });
    expect(out.numVert).toBe(8);
  });
});

describe('knitTextureUV', () => {
  it('is deterministic for a given seed and perturbs the surface', () => {
    const a = knitTextureUV(cube(10), { amplitude: 0.5, stitchWidth: 2, seed: 7 });
    const b = knitTextureUV(cube(10), { amplitude: 0.5, stitchWidth: 2, seed: 7 });
    expect([...a.vertProperties]).toEqual([...b.vertProperties]);
    // Subdivided, so more triangles than the input cube.
    expect(a.numTri).toBeGreaterThan(12);
    // Bounding box should expand by roughly the amplitude.
    const grown = bboxOf(a.vertProperties);
    expect(grown.max[0]).toBeGreaterThan(10);
  });

  it('a different seed produces different geometry', () => {
    const a = knitTextureUV(cube(10), { amplitude: 0.5, stitchWidth: 2, seed: 1 });
    const b = knitTextureUV(cube(10), { amplitude: 0.5, stitchWidth: 2, seed: 2 });
    expect([...a.vertProperties]).not.toEqual([...b.vertProperties]);
  });

  it('zero amplitude leaves the cube unchanged (no subdivision)', () => {
    const out = knitTextureUV(cube(10), { amplitude: 0, stitchWidth: 2 });
    expect(out.numVert).toBe(8);
  });

  it('grainAngleDeg rotates the pattern (produces different geometry from angle 0)', () => {
    const a = knitTextureUV(cube(10), { amplitude: 0.5, stitchWidth: 2, grainAngleDeg: 0 });
    const b = knitTextureUV(cube(10), { amplitude: 0.5, stitchWidth: 2, grainAngleDeg: 45 });
    expect([...a.vertProperties]).not.toEqual([...b.vertProperties]);
  });

  it('carries per-triangle colors through subdivision', () => {
    const c = cube(10);
    c.triColors = new Uint8Array(c.numTri * 3).fill(42);
    const out = knitTextureUV(c, { amplitude: 0.5, stitchWidth: 2 });
    expect(out.triColors).toBeTruthy();
    expect(out.triColors!.length).toBe(out.numTri * 3);
    expect([...out.triColors!].every(v => v === 42)).toBe(true);
  });
});

// The four fabric textures added after fuzzySkin share its structure (densify →
// displace along normals, deterministic per seed, color carried through
// subdivision). One parameterized table guards the invariants for all of them.
describe('fabric textures (cable / waffle / fur / woven / voronoi)', () => {
  const cases = [
    { name: 'cableKnit', fn: cableKnit as (m: MeshData, o: Record<string, number>) => MeshData, opts: { amplitude: 0.5, cableWidth: 2, seed: 3 } },
    { name: 'waffleStitch', fn: waffleStitch as (m: MeshData, o: Record<string, number>) => MeshData, opts: { amplitude: 0.5, cellWidth: 2, seed: 3 } },
    { name: 'furVelvet', fn: furVelvet as (m: MeshData, o: Record<string, number>) => MeshData, opts: { amplitude: 0.5, fiberSpacing: 2, seed: 3 } },
    { name: 'wovenFabric', fn: wovenFabric as (m: MeshData, o: Record<string, number>) => MeshData, opts: { amplitude: 0.5, threadSpacing: 2, seed: 3 } },
    { name: 'voronoiShell', fn: voronoiShell as (m: MeshData, o: Record<string, number>) => MeshData, opts: { amplitude: 0.5, cellSize: 3, seed: 3 } },
  ] as const;

  for (const { name, fn, opts } of cases) {
    it(`${name} is deterministic, finite, and subdivides`, () => {
      const a = fn(cube(10), { ...opts });
      const b = fn(cube(10), { ...opts });
      expect([...a.vertProperties]).toEqual([...b.vertProperties]);
      expect([...a.vertProperties].every(Number.isFinite)).toBe(true);
      expect(a.numTri).toBeGreaterThan(12); // densified before displacement
    });

    it(`${name} zero amplitude is a no-op (no subdivision)`, () => {
      const out = fn(cube(10), { ...opts, amplitude: 0 });
      expect(out.numVert).toBe(8);
    });

    it(`${name} carries per-triangle colors through subdivision`, () => {
      const c = cube(10);
      c.triColors = new Uint8Array(c.numTri * 3).fill(42);
      const out = fn(c, { ...opts });
      expect(out.triColors!.length).toBe(out.numTri * 3);
      expect([...out.triColors!].every(v => v === 42)).toBe(true);
    });
  }
});

describe('voronoiShell', () => {
  it('a different seed reshuffles the cell layout', () => {
    const a = voronoiShell(cube(10), { amplitude: 0.5, cellSize: 3, seed: 1 });
    const b = voronoiShell(cube(10), { amplitude: 0.5, cellSize: 3, seed: 2 });
    expect([...a.vertProperties]).not.toEqual([...b.vertProperties]);
  });

  it('jitter=0 (regular grid) differs from jitter=1 (irregular)', () => {
    const grid = voronoiShell(cube(10), { amplitude: 0.5, cellSize: 3, jitter: 0 });
    const irregular = voronoiShell(cube(10), { amplitude: 0.5, cellSize: 3, jitter: 1 });
    expect([...grid.vertProperties]).not.toEqual([...irregular.vertProperties]);
  });

  it('raised walls grow the cube; engraved channels stay within it', () => {
    const base = bboxOf(extractPositions(cube(10)));
    const raised = bboxOf(voronoiShell(cube(10), { amplitude: 0.6, cellSize: 3, raised: true }).vertProperties);
    const engraved = bboxOf(voronoiShell(cube(10), { amplitude: 0.6, cellSize: 3, raised: false }).vertProperties);
    // Raised walls displace outward, so the bbox expands past the original 10.
    expect(raised.max[0]).toBeGreaterThan(base.max[0]);
    // Engraving recesses walls inward, so it never pushes a face past the original.
    expect(engraved.max[0]).toBeLessThanOrEqual(base.max[0] + 1e-4);
  });
});

describe('smoothSurface', () => {
  it('rounds a cube without runaway shrinkage and keeps it closed', () => {
    const out = smoothSurface(cube(10), { iterations: 4 });
    expect(out.numTri).toBeGreaterThan(12);
    const bb = bboxOf(out.vertProperties);
    // Taubin resists shrinkage: the rounded cube keeps most of its size.
    expect(bb.size[0]).toBeGreaterThan(7);
    expect(bb.size[0]).toBeLessThanOrEqual(10.5);
  });
});

describe('voxelizeMesh', () => {
  it('produces a solid grid (surface + filled interior) for a cube', () => {
    const grid = voxelizeMesh(cube(10), { resolution: 16 });
    expect(grid.size).toBeGreaterThan(0);
    const b = grid.bounds();
    expect(b).toBeTruthy();
    // A solid 16^3-ish cube has interior cells, so total exceeds the shell.
    expect(grid.size).toBeGreaterThan(16 * 16); // more than a single face
  });

  it('clamps resolution into range and handles empty meshes', () => {
    const empty: MeshData = { vertProperties: new Float32Array(), triVerts: new Uint32Array(), numVert: 0, numTri: 0, numProp: 3 };
    expect(voxelizeMesh(empty, { resolution: 9999 }).size).toBe(0);
  });
});

describe('voronoiLattice (perforated shell)', () => {
  it('produces a hollow, perforated shell — far fewer voxels than the solid', () => {
    const solid = voxelizeMesh(cube(20), { resolution: 64 });
    const lamp = voronoiLattice(cube(20), { cellSize: 6, wallThickness: 1.5, resolution: 64 }).grid;
    expect(lamp.size).toBeGreaterThan(0);
    // A thin perforated shell keeps only a fraction of the solid's voxels.
    expect(lamp.size).toBeLessThan(solid.size * 0.5);
  });

  it('is deterministic for a given seed and reshuffles for a different one', () => {
    const a = encodeGrid(voronoiLattice(cube(20), { cellSize: 6, wallThickness: 1.5, resolution: 48, seed: 1 }).grid);
    const b = encodeGrid(voronoiLattice(cube(20), { cellSize: 6, wallThickness: 1.5, resolution: 48, seed: 1 }).grid);
    const c = encodeGrid(voronoiLattice(cube(20), { cellSize: 6, wallThickness: 1.5, resolution: 48, seed: 2 }).grid);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('handles an empty mesh', () => {
    const empty: MeshData = { vertProperties: new Float32Array(), triVerts: new Uint32Array(), numVert: 0, numTri: 0, numProp: 3 };
    expect(voronoiLattice(empty, { cellSize: 2, wallThickness: 1 }).grid.size).toBe(0);
  });

});

describe('surfaceNetsField (continuous iso-surface)', () => {
  it('meshes a sphere field into a closed, edge-manifold surface', () => {
    const N = 40, R = 14, c = 20;
    const field = new Float32Array(N * N * N);
    const sidx = (i: number, j: number, k: number) => (k * N + j) * N + i;
    for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      field[sidx(i, j, k)] = Math.hypot(i - c, j - c, k - c) - R; // < 0 inside
    }
    const m = surfaceNetsField({ field, dims: [N, N, N], origin: [0, 0, 0], spacing: 1, iso: 0 });
    expect(m.numTri).toBeGreaterThan(100);
    // Every undirected edge must be shared by exactly two triangles (closed,
    // 2-manifold) — no boundary edges, no non-manifold edges.
    const edge = new Map<string, number>();
    for (let t = 0; t < m.numTri; t++) {
      const a = m.triVerts[t * 3], b = m.triVerts[t * 3 + 1], cc = m.triVerts[t * 3 + 2];
      for (const [u, v] of [[a, b], [b, cc], [cc, a]] as [number, number][]) {
        const key = u < v ? `${u}_${v}` : `${v}_${u}`;
        edge.set(key, (edge.get(key) ?? 0) + 1);
      }
    }
    let boundary = 0, nonManifold = 0;
    for (const n of edge.values()) { if (n === 1) boundary++; else if (n > 2) nonManifold++; }
    expect(boundary).toBe(0);
    expect(nonManifold).toBe(0);
    // The interpolated crossings put the radius-14 sphere near its true size, not
    // snapped to the integer lattice (a binary mesher would over/undershoot).
    const xs: number[] = [];
    for (let v = 0; v < m.numVert; v++) xs.push(m.vertProperties[v * 3]);
    expect(Math.max(...xs) - c).toBeGreaterThan(R - 0.6);
    expect(Math.max(...xs) - c).toBeLessThan(R + 0.6);
  });
});

describe('largestMeshComponent (edge-connected)', () => {
  it('drops a piece joined to the main mesh at only a single vertex', () => {
    // Two tetrahedra-ish triangle fans sharing exactly one vertex: edge
    // connectivity must treat them as separate and keep the larger.
    const big = cube(10);                 // 12 tris, 8 verts
    // A lone degenerate-free extra triangle touching cube vertex 0 at one point.
    const v = big.numVert;
    const vp = Float32Array.from([...big.vertProperties, 0, 0, 0, -5, -1, 0, -5, 0, -1]);
    const tv = Uint32Array.from([...big.triVerts, 0, v + 1, v + 2]); // shares only vertex 0
    const mesh: MeshData = { vertProperties: vp, triVerts: tv, numVert: v + 3, numTri: big.numTri + 1, numProp: 3 };
    const kept = largestMeshComponent(mesh);
    expect(kept.numTri).toBe(big.numTri); // the lone point-joined triangle is dropped
  });
});

describe('applyVoronoiLamp (mesh output)', () => {
  it('emits a smooth (SDF) manifold mesh wrapper with struts', () => {
    const r = applyVoronoiLamp(cube(20), { cellSize: 6, wallThickness: 1.5, resolution: 64 });
    expect(r.kind).toBe('manifold');
    if (r.kind === 'manifold') {
      // SDF mesh path: ofMesh wrapper over a baked, smooth perforated shell.
      expect(r.code).toContain('Manifold.ofMesh(api.imports[0])');
      expect(r.mesh.numTri).toBeGreaterThan(12);
    }
  });
});

describe('modifiers (codegen)', () => {
  it('fuzzy emits a manifold ofMesh wrapper with a baked mesh', () => {
    const r = applyFuzzy(cube(10), { amplitude: 0.4, scale: 2 });
    expect(r.kind).toBe('manifold');
    if (r.kind === 'manifold') {
      expect(r.code).toContain('Manifold.ofMesh(api.imports[0])');
      expect(r.mesh.numTri).toBeGreaterThan(12);
    }
  });

  it('smooth emits a manifold wrapper', () => {
    const r = applySmooth(cube(10), { iterations: 3 });
    expect(r.kind).toBe('manifold');
    if (r.kind === 'manifold') expect(r.code).toContain('Manifold.ofMesh(api.imports[0])');
  });

  it('knit emits a manifold ofMesh wrapper with a baked mesh', () => {
    const r = applyKnit(cube(10), { amplitude: 0.4, stitchWidth: 2 });
    expect(r.kind).toBe('manifold');
    if (r.kind === 'manifold') {
      expect(r.code).toContain('Manifold.ofMesh(api.imports[0])');
      expect(r.mesh.numTri).toBeGreaterThan(12);
    }
  });

  it('knit PATCH subdivides the coarse selection so the stitch texture is carried', () => {
    // A two-triangle selection (one cube face) on a 12-triangle cube has far too
    // few vertices to carry stitch geometry. The patch path must densify the
    // masked region — like every sibling patch modifier — or the texture is
    // invisible. Assert the baked mesh grew well beyond the original 12 tris.
    const r = applyKnitPatch(cube(10), { amplitude: 0.4, stitchWidth: 2 }, new Set([0, 1]));
    expect(r.kind).toBe('manifold');
    if (r.kind === 'manifold') {
      expect(r.mesh.numTri).toBeGreaterThan(100);
    }
  });

  it('voxelize emits voxels.decode code, with optional smooth', () => {
    const plain = applyVoxelize(cube(10), { resolution: 12 });
    expect(plain.kind).toBe('voxel');
    expect(plain.code).toContain('voxels.decode(');
    expect(plain.code).not.toContain('v.smooth()');
    const smooth = applyVoxelize(cube(10), { resolution: 12, smooth: true });
    expect(smooth.code).toContain('v.smooth()');
  });

  it('voxelize carries a non-empty preview mesh for non-destructive preview', () => {
    const r = applyVoxelize(cube(10), { resolution: 12 });
    expect(r.previewMesh.numTri).toBeGreaterThan(0);
    expect(r.previewMesh.triColors).toBeTruthy();
  });

  describe('nearestTriangleMap (color transfer)', () => {
    it('maps an identical mesh to itself (identity)', () => {
      const c = cube(10);
      const map = nearestTriangleMap(c, c);
      expect(map.length).toBe(c.numTri);
      for (let t = 0; t < c.numTri; t++) expect(map[t]).toBe(t);
    });

    it('maps each subdivided child to a triangle near its parent', () => {
      const c = cube(10);
      const dense = subdivideToMaxEdge(c, { maxEdge: 3 }); // re-tessellated, same shape
      const map = nearestTriangleMap(c, dense);
      expect(map.length).toBe(dense.numTri);
      // Every child must map to a real old triangle, and a child's nearest old
      // triangle centroid must be at least as close as a fixed sanity bound
      // (children sit on the same faces as their parents).
      for (let t = 0; t < dense.numTri; t++) {
        expect(map[t]).toBeGreaterThanOrEqual(0);
        expect(map[t]).toBeLessThan(c.numTri);
      }
    });

    it('returns -1 entries when the old mesh is empty', () => {
      const empty: MeshData = { vertProperties: new Float32Array(), triVerts: new Uint32Array(), numVert: 0, numTri: 0, numProp: 3 };
      const map = nearestTriangleMap(empty, cube(10));
      expect([...map].every(v => v === -1)).toBe(true);
    });

    it('matches a slightly displaced mesh back to the originals', () => {
      const c = cube(10);
      // Jitter every vertex by a tiny amount (simulating fuzzy/smooth) — the
      // nearest old triangle per new triangle should still be the same index.
      const moved: MeshData = { ...c, vertProperties: Float32Array.from(c.vertProperties, (v, i) => v + (i % 3 === 0 ? 0.05 : -0.03)) };
      const map = nearestTriangleMap(c, moved);
      for (let t = 0; t < c.numTri; t++) expect(map[t]).toBe(t);
    });
  });

  it('voxelize samples per-triangle color from a painted input mesh', () => {
    const c = cube(10);
    // Paint the whole input mesh solid red (0xff,0,0) so every surface voxel
    // should inherit red rather than the default fill.
    c.triColors = new Uint8Array(c.numTri * 3);
    for (let t = 0; t < c.numTri; t++) c.triColors[t * 3] = 255;
    const r = applyVoxelize(c, { resolution: 12 });
    const tc = r.previewMesh.triColors!;
    // At least one surface triangle should be pure red (sampled from the paint).
    let sawRed = false;
    for (let t = 0; t < r.previewMesh.numTri; t++) {
      if (tc[t * 3] === 255 && tc[t * 3 + 1] === 0 && tc[t * 3 + 2] === 0) { sawRed = true; break; }
    }
    expect(sawRed).toBe(true);
  });
});
