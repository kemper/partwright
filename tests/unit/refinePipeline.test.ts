// Pure-logic tests for the shared paint-subdivision pipeline used by both the
// main thread and the Web Worker. Verifies that the worker-shaped API
// (descriptors in → refined mesh + per-stroke footprint triangles out)
// preserves the invariants the main thread relies on.

import { describe, expect, test } from 'vitest';
import {
  buildBrushStrokeFromDescriptor,
  collectRefineRegions,
  descriptorRefines,
  refineMeshPipeline,
} from '../../src/color/refinePipeline';
import type { MeshData } from '../../src/geometry/types';
import type { RegionDescriptor } from '../../src/color/regions';

// 20x20 square in the z=0 plane, split into 4 quadrant triangles around the
// origin so a centred stroke covers them all. Z-up is the project convention.
function squarePlate(): MeshData {
  // five vertices: corners (BL, BR, TR, TL) + centre
  const vp = Float32Array.from([
    -10, -10, 0,
     10, -10, 0,
     10,  10, 0,
    -10,  10, 0,
      0,   0, 0,
  ]);
  const tv = Uint32Array.from([
    0, 1, 4,
    1, 2, 4,
    2, 3, 4,
    3, 0, 4,
  ]);
  return { vertProperties: vp, triVerts: tv, numVert: 5, numTri: 4, numProp: 3 };
}

describe('descriptorRefines', () => {
  test('brushStroke descriptors always refine', () => {
    const d: RegionDescriptor = {
      kind: 'brushStroke', samples: [[0, 0, 0]], radius: 1, shape: 'circle', maxEdge: 0.1,
    };
    expect(descriptorRefines(d)).toBe(true);
  });

  test('slab / box descriptors refine only when smooth + maxEdge > 0', () => {
    const flat: RegionDescriptor = { kind: 'slab', normal: [0, 0, 1], offset: 0, thickness: 1 };
    const smooth: RegionDescriptor = { kind: 'slab', normal: [0, 0, 1], offset: 0, thickness: 1, smooth: true, maxEdge: 0.5 };
    const smoothNoEdge: RegionDescriptor = { kind: 'slab', normal: [0, 0, 1], offset: 0, thickness: 1, smooth: true, maxEdge: 0 };
    expect(descriptorRefines(flat)).toBe(false);
    expect(descriptorRefines(smooth)).toBe(true);
    expect(descriptorRefines(smoothNoEdge)).toBe(false);
  });

  test('non-refining descriptor kinds return false', () => {
    const tri: RegionDescriptor = { kind: 'triangles', ids: [0, 1, 2] };
    const label: RegionDescriptor = { kind: 'byLabel', label: 'x' };
    expect(descriptorRefines(tri)).toBe(false);
    expect(descriptorRefines(label)).toBe(false);
  });
});

describe('buildBrushStrokeFromDescriptor', () => {
  const base = squarePlate();

  test('slab surface attaches per-sample normals + tangents', () => {
    const d = {
      kind: 'brushStroke' as const,
      samples: [[0, 0, 0], [3, 3, 0]] as [number, number, number][],
      radius: 4, shape: 'circle' as const, maxEdge: 0.5,
      surface: 'slab' as const, depth: 1,
    };
    const stroke = buildBrushStrokeFromDescriptor(d, base);
    expect(stroke.sampleNormals).toBeDefined();
    expect(stroke.sampleNormals!.length).toBe(2);
    expect(stroke.sampleTangents).toBeDefined();
    expect(stroke.sampleTangents!.length).toBe(2);
    expect(stroke.geoField).toBeUndefined();
  });

  test('geodesic surface attaches a reachability field', () => {
    const d = {
      kind: 'brushStroke' as const,
      samples: [[0, 0, 0]] as [number, number, number][],
      radius: 3, shape: 'circle' as const, maxEdge: 0.5,
      surface: 'geodesic' as const,
    };
    const stroke = buildBrushStrokeFromDescriptor(d, base);
    expect(stroke.geoField).toBeDefined();
    expect(stroke.sampleNormals).toBeUndefined();
  });

  test('a spray descriptor forces geodesic surface (no through-wall paint)', () => {
    const d = {
      kind: 'brushStroke' as const,
      samples: [[0, 0, 0]] as [number, number, number][],
      radius: 3, shape: 'circle' as const, maxEdge: 0.5,
      surface: 'slab' as const, // ← user-requested but…
      spray: { strength: 0.5, softness: 0.5, seed: 7 },
    };
    const stroke = buildBrushStrokeFromDescriptor(d, base);
    expect(stroke.surface).toBe('geodesic');
    expect(stroke.geoField).toBeDefined();
  });
});

describe('collectRefineRegions', () => {
  const base = squarePlate();
  test('skips non-refining descriptors and preserves order', () => {
    const ds: RegionDescriptor[] = [
      { kind: 'triangles', ids: [0] },
      { kind: 'brushStroke', samples: [[0, 0, 0]], radius: 2, shape: 'circle', maxEdge: 0.3 },
      { kind: 'slab', normal: [0, 0, 1], offset: -1, thickness: 2 }, // not smooth → skipped
    ];
    const out = collectRefineRegions(ds, base);
    expect(out.length).toBe(1);
    // The brushStroke region carries the descriptor's target edge length.
    expect(out[0].maxEdge).toBe(0.3);
  });
});

describe('refineMeshPipeline', () => {
  const base = squarePlate();

  test('no descriptors → identity (input mesh returned, identity childToParent)', () => {
    const { mesh, childToParent, brushStrokeTriangles } = refineMeshPipeline(base, base, []);
    expect(mesh).toBe(base);
    expect(childToParent.length).toBe(base.numTri);
    expect(Array.from(childToParent)).toEqual([0, 1, 2, 3]);
    expect(brushStrokeTriangles.size).toBe(0);
  });

  test('brushStroke covering the whole plate refines + resolves footprint triangles', () => {
    const d: RegionDescriptor = {
      kind: 'brushStroke', samples: [[0, 0, 0]],
      // Cover the plate fully so every triangle is "inside" → no rim refinement
      // needed, but the footprint resolution still has to find them all.
      radius: 30, shape: 'circle', maxEdge: 1, surface: 'geodesic',
    };
    const { mesh, brushStrokeTriangles } = refineMeshPipeline(base, base, [d]);
    expect(brushStrokeTriangles.has(0)).toBe(true);
    const tris = brushStrokeTriangles.get(0)!;
    // The plate's four triangles' centroids all fall inside a radius-30 circle
    // around the origin, so the whole mesh paints (no refinement needed).
    expect(tris.length).toBe(mesh.numTri);
  });

  test('a thin rim stroke subdivides only triangles the boundary crosses', () => {
    const d: RegionDescriptor = {
      kind: 'brushStroke', samples: [[0, 0, 0]],
      radius: 5, shape: 'circle', maxEdge: 0.5, surface: 'geodesic',
    };
    const { mesh } = refineMeshPipeline(base, base, [d]);
    // The brush rim straddles all four plate triangles → they get refined.
    expect(mesh.numTri).toBeGreaterThan(base.numTri);
  });
});
