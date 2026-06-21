import { describe, it, expect } from 'vitest';
import type { MeshData } from '../../src/geometry/types';
import {
  computePlacementDelta,
  isNoopDelta,
  isNoopRotation,
  isNoopScale,
  buildTransformCode,
  placementLabel,
  rotationLabel,
  scaleLabel,
  eulerToMatrix,
  matrixToEuler,
  rotationFromTo,
  applySteps,
  meshBox,
  bestFlatDownRotation,
  rotateAboutCenterSteps,
  mirrorAboutCenterSteps,
  mirrorLabel,
  type PlacementBox,
  type TransformStep,
  type Vec3,
} from '../../src/surface/placement';

/** Axis-aligned box spanning [min, min+size] as an 8-vertex MeshData (2 tris). */
function cube(min: Vec3 = [0, 0, 0], size: Vec3 = [10, 10, 10]): MeshData {
  const [ox, oy, oz] = min;
  const [sx, sy, sz] = size;
  const vertProperties = new Float32Array([
    ox, oy, oz, ox + sx, oy, oz, ox + sx, oy + sy, oz, ox, oy + sy, oz,
    ox, oy, oz + sz, ox + sx, oy, oz + sz, ox + sx, oy + sy, oz + sz, ox, oy + sy, oz + sz,
  ]);
  const triVerts = new Uint32Array([0, 2, 1, 4, 5, 6]);
  return { vertProperties, triVerts, numVert: 8, numTri: 2, numProp: 3 };
}

/** A closed axis-aligned box (8 verts, 12 triangles) so region-grow has real
 *  shared edges to walk — unlike `cube`, which is just two loose triangles. */
function solidBox(size: Vec3 = [10, 10, 10]): MeshData {
  const [sx, sy, sz] = size;
  const vertProperties = new Float32Array([
    0, 0, 0, sx, 0, 0, sx, sy, 0, 0, sy, 0,
    0, 0, sz, sx, 0, sz, sx, sy, sz, 0, sy, sz,
  ]);
  const triVerts = new Uint32Array([
    0, 2, 1, 0, 3, 2, // bottom (−Z)
    4, 5, 6, 4, 6, 7, // top (+Z)
    0, 1, 5, 0, 5, 4, // −Y
    1, 2, 6, 1, 6, 5, // +X
    2, 3, 7, 2, 7, 6, // +Y
    3, 0, 4, 3, 4, 7, // −X
  ]);
  return { vertProperties, triVerts, numVert: 8, numTri: 12, numProp: 3 };
}

/** A short cylinder ("coin"): broad ±Z faces vs a faceted rim. radius/height
 *  chosen so the flat faces dominate the rim by area. */
function disk(radius = 10, height = 2, segs = 48): MeshData {
  const v: number[] = [];
  const cb = 0, ct = 1;            // bottom/top center vertices
  v.push(0, 0, 0, 0, 0, height);
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const x = Math.cos(a) * radius, y = Math.sin(a) * radius;
    v.push(x, y, 0, x, y, height); // rim bottom (2+2i), rim top (3+2i)
  }
  const rb = (i: number) => 2 + 2 * (i % segs);
  const rt = (i: number) => 3 + 2 * (i % segs);
  const tri: number[] = [];
  for (let i = 0; i < segs; i++) {
    tri.push(cb, rb(i + 1), rb(i));            // bottom fan (−Z)
    tri.push(ct, rt(i), rt(i + 1));            // top fan (+Z)
    tri.push(rb(i), rb(i + 1), rt(i + 1));     // side
    tri.push(rb(i), rt(i + 1), rt(i));
  }
  return {
    vertProperties: new Float32Array(v), triVerts: new Uint32Array(tri),
    numVert: v.length / 3, numTri: tri.length / 3, numProp: 3,
  };
}

/** Concatenate several meshes into one (offsetting triangle indices). */
function mergeMeshes(...meshes: MeshData[]): MeshData {
  const verts: number[] = [];
  const tris: number[] = [];
  let base = 0;
  for (const m of meshes) {
    verts.push(...m.vertProperties);
    for (let i = 0; i < m.triVerts.length; i++) tris.push(m.triVerts[i] + base);
    base += m.numVert;
  }
  return {
    vertProperties: new Float32Array(verts), triVerts: new Uint32Array(tris),
    numVert: verts.length / 3, numTri: tris.length / 3, numProp: 3,
  };
}

function applyMat(m: number[], p: Vec3): Vec3 {
  return [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2],
    m[3] * p[0] + m[4] * p[1] + m[5] * p[2],
    m[6] * p[0] + m[7] * p[1] + m[8] * p[2],
  ];
}

describe('computePlacementDelta', () => {
  const box: PlacementBox = { min: [4, -6, 12], max: [14, 4, 22] };
  it('drops the floor to Z=0 without touching XY', () => {
    expect(computePlacementDelta(box, { dropToFloor: true })).toEqual([0, 0, -12]);
  });
  it('centers XY without touching Z', () => {
    expect(computePlacementDelta(box, { centerX: true, centerY: true })).toEqual([-9, 1, 0]);
  });
  it('dropToFloor wins over centerZ on the Z axis', () => {
    expect(computePlacementDelta(box, { dropToFloor: true, centerZ: true })).toEqual([0, 0, -12]);
  });
});

describe('isNoopDelta / isNoopRotation', () => {
  const box: PlacementBox = { min: [0, 0, 0], max: [10, 10, 10] };
  it('treats sub-epsilon moves as no-ops', () => {
    expect(isNoopDelta([0, 0, 1e-8], box)).toBe(true);
    expect(isNoopDelta([0, 0, -5], box)).toBe(false);
  });
  it('treats sub-0.01° rotations as no-ops', () => {
    expect(isNoopRotation([0, 0, 0])).toBe(true);
    expect(isNoopRotation([0, 90, 0])).toBe(false);
  });
});

describe('applySteps does not mutate the source', () => {
  it('returns a fresh mesh', () => {
    const src = cube();
    applySteps(src, [{ kind: 'translate', v: [100, 0, 0] }]);
    expect(src.vertProperties[0]).toBe(0);
  });
});

describe('rotation math', () => {
  it('eulerToMatrix([90,0,0]) maps +Y → +Z and +Z → -Y', () => {
    const m = eulerToMatrix(90, 0, 0);
    expect(applyMat(m, [0, 1, 0])).toEqual([expect.closeTo(0, 6), expect.closeTo(0, 6), expect.closeTo(1, 6)]);
    expect(applyMat(m, [0, 0, 1])).toEqual([expect.closeTo(0, 6), expect.closeTo(-1, 6), expect.closeTo(0, 6)]);
  });

  it('matrixToEuler inverts eulerToMatrix', () => {
    for (const e of [[20, 35, 50], [-15, 0, 80], [0, 0, 0], [10, -40, 5]] as Vec3[]) {
      const back = matrixToEuler(eulerToMatrix(e[0], e[1], e[2]));
      const round = eulerToMatrix(back[0], back[1], back[2]);
      const m = eulerToMatrix(e[0], e[1], e[2]);
      // Compare the matrices (Euler triples can differ but represent the same rotation).
      for (let i = 0; i < 9; i++) expect(round[i]).toBeCloseTo(m[i], 5);
    }
  });

  it('rotationFromTo maps a normal onto the target direction', () => {
    const r = rotationFromTo([0, 0, 1], [0, 0, -1]);
    expect(applyMat(r, [0, 0, 1])).toEqual([expect.closeTo(0, 6), expect.closeTo(0, 6), expect.closeTo(-1, 6)]);
    const r2 = rotationFromTo([1, 0, 0], [0, 0, -1]);
    expect(applyMat(r2, [1, 0, 0])).toEqual([expect.closeTo(0, 6), expect.closeTo(0, 6), expect.closeTo(-1, 6)]);
  });
});

describe('applySteps / meshBox', () => {
  it('rotate then translate composes in chain order', () => {
    const steps: TransformStep[] = [{ kind: 'rotate', v: [90, 0, 0] }, { kind: 'translate', v: [0, 0, 5] }];
    const out = applySteps(cube([0, 0, 0], [2, 4, 6]), steps);
    const box = meshBox(out);
    // After +90° about X, the original Y-extent (4) becomes the Z-extent, then +5.
    expect(box.max[2] - box.min[2]).toBeCloseTo(4, 5);
  });
});

describe('bestFlatDownRotation + lay-flat', () => {
  it('lays a tilted slab flat: the large face ends pointing down', () => {
    // A flat slab (big 10x20 faces, thin in Z), tilted 30° about Y.
    const slab = applySteps(cube([0, 0, 0], [10, 20, 4]), [{ kind: 'rotate', v: [0, 30, 0] }]);
    const euler = bestFlatDownRotation(slab);
    expect(euler).not.toBeNull();
    const rotated = applySteps(slab, rotateAboutCenterSteps(meshBox(slab), euler!));
    // Laid flat, the thin dimension (4) becomes the height again.
    const box = meshBox(rotated);
    expect(box.max[2] - box.min[2]).toBeCloseTo(4, 4);
  });

  it('lays a coin on its broad face, not its rim', () => {
    // Stand the coin on its rim (90° about X puts the flat faces vertical),
    // then lay-flat must rotate a flat face back down.
    const coin = applySteps(disk(10, 2, 48), [{ kind: 'rotate', v: [90, 0, 0] }]);
    const euler = bestFlatDownRotation(coin);
    expect(euler).not.toBeNull();
    const box = meshBox(applySteps(coin, rotateAboutCenterSteps(meshBox(coin), euler!)));
    // On its face the height is the 2-unit thickness, not the 20-unit diameter.
    expect(box.max[2] - box.min[2]).toBeCloseTo(2, 3);
  });

  it('lays a standing box on its largest face', () => {
    // A book stood on its spine: largest face (8×10) has a ±X normal.
    const standing = solidBox([2, 8, 10]);
    const euler = bestFlatDownRotation(standing);
    expect(euler).not.toBeNull();
    const box = meshBox(applySteps(standing, rotateAboutCenterSteps(meshBox(standing), euler!)));
    // Largest face down ⇒ the 2-unit thickness becomes the height.
    expect(box.max[2] - box.min[2]).toBeCloseTo(2, 4);
  });

  it('does not pool non-coplanar faces that share a normal', () => {
    // Two thin slabs stacked with a gap: each top face (+Z) is small on its own,
    // but together they out-area the genuinely-largest face (a side). The old
    // direction-bucketing summed them and tipped the part onto a tiny ledge;
    // contiguous clustering keeps them separate and picks the real big face.
    const lower = solidBox([8, 8, 1]);                                   // +Z face area 64
    const upper = applySteps(solidBox([8, 8, 1]), [{ kind: 'translate', v: [0, 0, 5] }]); // +Z face area 64, z=6
    // +Z pool (old algo) = 64 + 64 + the wall's own small +Z (30) = 158.
    // A tall thin wall whose ±X face (30×3 = 90) is the single largest flat face.
    const wall = applySteps(solidBox([1, 30, 3]), [{ kind: 'translate', v: [20, 0, 0] }]);
    const merged = mergeMeshes(lower, upper, wall);
    const euler = bestFlatDownRotation(merged);
    expect(euler).not.toBeNull();
    const out = applySteps(merged, rotateAboutCenterSteps(meshBox(merged), euler!));
    const n = applyMat(eulerToMatrix(euler![0], euler![1], euler![2]), [1, 0, 0]);
    // The chosen down-face is the wall's ±X side (its normal maps to −Z), not the
    // +Z ledges (which would have left +Z mapping to −Z, i.e. n[2] ≈ 0 here).
    expect(Math.abs(n[2])).toBeCloseTo(1, 3);
    void out;
  });

  it('returns null for a degenerate mesh', () => {
    const empty: MeshData = { vertProperties: new Float32Array(0), triVerts: new Uint32Array(0), numVert: 0, numTri: 0, numProp: 3 };
    expect(bestFlatDownRotation(empty)).toBeNull();
  });
});

describe('buildTransformCode', () => {
  const code = 'const { Manifold } = api;\nreturn Manifold.cube([10, 10, 10]).translate([0, 0, 20]);';

  it('wraps the source in an IIFE and appends the chain', () => {
    const out = buildTransformCode(code, [{ kind: 'translate', v: [0, 0, -20] }], 'drop to floor', '2026-06-06');
    expect(out).toContain('@partwright-placement');
    expect(out).toContain('return (() => {');
    expect(out).toContain(code);
    expect(out).toContain('})().translate([0, 0, -20]);');
  });

  it('preserves user code verbatim (no re-indentation of template literals)', () => {
    const withTemplate = 'const s = `a\n  b`;\nreturn Manifold.cube([1, 1, 1]);';
    const out = buildTransformCode(withTemplate, [{ kind: 'rotate', v: [0, 90, 0] }], 'rotate', '2026-06-06');
    expect(out).toContain('const s = `a\n  b`;');
    expect(out).toContain('})().rotate([0, 90, 0]);');
  });

  it('merges consecutive translates but chains rotations', () => {
    const first = buildTransformCode(code, [{ kind: 'translate', v: [0, 0, -20] }], 'drop', '2026-06-06');
    const second = buildTransformCode(first, [{ kind: 'translate', v: [-5, -5, 0] }], 'center', '2026-06-06');
    expect(second.match(/return \(\(\) => \{/g)?.length).toBe(1);
    expect(second).toContain('})().translate([-5, -5, -20]);');
    const withRot = buildTransformCode(second, [{ kind: 'rotate', v: [90, 0, 0] }], 'rotate', '2026-06-06');
    expect(withRot).toContain('})().translate([-5, -5, -20]).rotate([90, 0, 0]);');
  });

  it('returns the inner code unwrapped when the chain folds away', () => {
    const first = buildTransformCode(code, [{ kind: 'translate', v: [0, 0, -20] }], 'drop', '2026-06-06');
    const undo = buildTransformCode(first, [{ kind: 'translate', v: [0, 0, 20] }], 'lift', '2026-06-06');
    expect(undo).not.toContain('@partwright-placement');
    expect(undo.trim()).toBe(code.trim());
  });
});

describe('mirror', () => {
  it('mirrorAboutCenterSteps flips in place: bbox unchanged, winding inverted', () => {
    const box: PlacementBox = { min: [2, 0, 0], max: [12, 4, 6] }; // X center = 7
    const out = applySteps(cube([2, 0, 0], [10, 4, 6]), mirrorAboutCenterSteps(box, 'x'));
    const b = meshBox(out);
    expect(b.min[0]).toBeCloseTo(2, 5);
    expect(b.max[0]).toBeCloseTo(12, 5);
    // A single reflection inverts orientation: triangle [0,2,1] → [0,1,2].
    expect(Array.from(out.triVerts.slice(0, 3))).toEqual([0, 1, 2]);
  });

  it('reflects across the center plane: a vertex at x=min lands at x=max', () => {
    const box: PlacementBox = { min: [0, 0, 0], max: [10, 10, 10] };
    const out = applySteps(cube([0, 0, 0], [10, 10, 10]), mirrorAboutCenterSteps(box, 'x'));
    expect(out.vertProperties[0]).toBeCloseTo(10, 5); // vertex 0 was at x=0
  });

  it('two mirrors cancel: orientation restored (even winding parity)', () => {
    const out = applySteps(cube(), [{ kind: 'mirror', v: [1, 0, 0] }, { kind: 'mirror', v: [1, 0, 0] }]);
    expect(Array.from(out.triVerts.slice(0, 3))).toEqual([0, 2, 1]); // back to original
  });

  it('buildTransformCode emits and re-parses a .mirror chain', () => {
    const code = 'return api.Manifold.cube([10, 10, 10]);';
    const out = buildTransformCode(code, [{ kind: 'mirror', v: [1, 0, 0] }], 'mirror X', '2026-06-08');
    expect(out).toContain('})().mirror([1, 0, 0]);');
    // A follow-up transform extends the same wrapper rather than nesting an IIFE.
    const out2 = buildTransformCode(out, [{ kind: 'translate', v: [0, 0, 5] }], 'lift', '2026-06-08');
    expect(out2.match(/return \(\(\) => \{/g)?.length).toBe(1);
    expect(out2).toContain('.mirror([1, 0, 0]).translate([0, 0, 5]);');
  });
});

describe('scale', () => {
  it('applySteps scales vertex positions about the origin', () => {
    const out = applySteps(cube([0, 0, 0], [10, 10, 10]), [{ kind: 'scale', v: [2, 1, 0.5] }]);
    const b = meshBox(out);
    expect(b.max[0]).toBeCloseTo(20, 5); // X doubled
    expect(b.max[1]).toBeCloseTo(10, 5); // Y unchanged
    expect(b.max[2]).toBeCloseTo(5, 5);  // Z halved
    // A positive scale preserves winding (no mirror parity flip).
    expect(Array.from(out.triVerts.slice(0, 3))).toEqual([0, 2, 1]);
  });

  it('a negative scale on one axis mirrors and inverts winding', () => {
    const out = applySteps(cube([0, 0, 0], [10, 10, 10]), [{ kind: 'scale', v: [-1, 1, 1] }]);
    expect(Array.from(out.triVerts.slice(0, 3))).toEqual([0, 1, 2]); // flipped
  });

  it('buildTransformCode emits and re-parses a .scale chain, merging successive scales', () => {
    const code = 'return api.Manifold.cube([10, 10, 10]);';
    const out = buildTransformCode(code, [{ kind: 'scale', v: [2, 2, 2] }], 'scale 2×', '2026-06-12');
    expect(out).toContain('})().scale([2, 2, 2]);');
    // A second scale folds into the first (componentwise product), not a new call.
    const out2 = buildTransformCode(out, [{ kind: 'scale', v: [1.5, 1.5, 1.5] }], 'scale 1.5×', '2026-06-12');
    expect(out2.match(/\.scale\(/g)?.length).toBe(1);
    expect(out2).toContain('.scale([3, 3, 3]);');
  });

  it('an identity scale folds away to the bare inner code', () => {
    const code = 'return api.Manifold.cube([10, 10, 10]);';
    const out = buildTransformCode(code, [{ kind: 'scale', v: [1, 1, 1] }], 'scale 1×', '2026-06-12');
    expect(out).not.toContain('.scale(');
    expect(out).toContain('api.Manifold.cube');
  });

  it('isNoopScale / scaleLabel', () => {
    expect(isNoopScale([1, 1, 1])).toBe(true);
    expect(isNoopScale([1, 1, 2])).toBe(false);
    expect(scaleLabel([2, 2, 2])).toBe('scale 2×');
    expect(scaleLabel([2, 1, 0.5])).toBe('scale (2, 1, 0.5)');
  });
});

describe('labels', () => {
  it('placementLabel describes combined ops, dropping centerZ when dropToFloor owns Z', () => {
    expect(placementLabel({ dropToFloor: true, centerX: true, centerY: true })).toBe('drop to floor + center XY');
    expect(placementLabel({ dropToFloor: true, centerZ: true })).toBe('drop to floor');
    expect(placementLabel({})).toBe('placed');
  });
  it('rotationLabel formats degrees', () => {
    expect(rotationLabel([0, 90, 0])).toBe('rotate (0°, 90°, 0°)');
  });
  it('mirrorLabel formats the axis', () => {
    expect(mirrorLabel('x')).toBe('mirror X');
    expect(mirrorLabel('z')).toBe('mirror Z');
  });
});
