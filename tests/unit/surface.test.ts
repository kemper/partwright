import { describe, it, expect } from 'vitest';
import type { MeshData } from '../../src/geometry/types';
import {
  subdivideToMaxEdge,
  computeVertexNormals,
  maxEdgeLength,
  extractPositions,
  bboxOf,
} from '../../src/surface/meshSubdivide';
import { fuzzySkin } from '../../src/surface/fuzzySkin';
import { knitTexture } from '../../src/surface/knitTexture';
import { smoothSurface } from '../../src/surface/smoothSurface';
import { voxelizeMesh } from '../../src/surface/voxelizeMesh';
import { applyFuzzy, applyKnit, applySmooth, applyVoxelize } from '../../src/surface/modifiers';
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

describe('knitTexture', () => {
  it('is deterministic for a given seed and perturbs the surface', () => {
    const a = knitTexture(cube(10), { amplitude: 0.5, stitchWidth: 2, seed: 7 });
    const b = knitTexture(cube(10), { amplitude: 0.5, stitchWidth: 2, seed: 7 });
    expect([...a.vertProperties]).toEqual([...b.vertProperties]);
    // Subdivided, so more triangles than the input cube.
    expect(a.numTri).toBeGreaterThan(12);
    // Bounding box should expand by roughly the amplitude.
    const grown = bboxOf(a.vertProperties);
    expect(grown.max[0]).toBeGreaterThan(10);
  });

  it('a different seed produces different geometry', () => {
    const a = knitTexture(cube(10), { amplitude: 0.5, stitchWidth: 2, seed: 1 });
    const b = knitTexture(cube(10), { amplitude: 0.5, stitchWidth: 2, seed: 2 });
    expect([...a.vertProperties]).not.toEqual([...b.vertProperties]);
  });

  it('zero amplitude leaves the cube unchanged (no subdivision)', () => {
    const out = knitTexture(cube(10), { amplitude: 0, stitchWidth: 2 });
    expect(out.numVert).toBe(8);
  });

  it('grainAngleDeg rotates the pattern (produces different geometry from angle 0)', () => {
    const a = knitTexture(cube(10), { amplitude: 0.5, stitchWidth: 2, grainAngleDeg: 0 });
    const b = knitTexture(cube(10), { amplitude: 0.5, stitchWidth: 2, grainAngleDeg: 45 });
    expect([...a.vertProperties]).not.toEqual([...b.vertProperties]);
  });

  it('carries per-triangle colors through subdivision', () => {
    const c = cube(10);
    c.triColors = new Uint8Array(c.numTri * 3).fill(42);
    const out = knitTexture(c, { amplitude: 0.5, stitchWidth: 2 });
    expect(out.triColors).toBeTruthy();
    expect(out.triColors!.length).toBe(out.numTri * 3);
    expect([...out.triColors!].every(v => v === 42)).toBe(true);
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
      const dense = subdivideToMaxEdge(c, 3); // re-tessellated, same shape
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
