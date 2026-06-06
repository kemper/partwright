import { describe, it, expect } from 'vitest';
import type { MeshData } from '../../src/geometry/types';
import {
  computePlacementDelta,
  isNoopDelta,
  isNoopRotation,
  buildTransformCode,
  placementLabel,
  rotationLabel,
  eulerToMatrix,
  matrixToEuler,
  rotationFromTo,
  applySteps,
  meshBox,
  bestFlatDownRotation,
  rotateAboutCenterSteps,
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

describe('labels', () => {
  it('placementLabel describes combined ops, dropping centerZ when dropToFloor owns Z', () => {
    expect(placementLabel({ dropToFloor: true, centerX: true, centerY: true })).toBe('drop to floor + center XY');
    expect(placementLabel({ dropToFloor: true, centerZ: true })).toBe('drop to floor');
    expect(placementLabel({})).toBe('placed');
  });
  it('rotationLabel formats degrees', () => {
    expect(rotationLabel([0, 90, 0])).toBe('rotate (0°, 90°, 0°)');
  });
});
