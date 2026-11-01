import { describe, it, expect } from 'vitest';
import { fitSeam, frameMatrix, maskAreaNormal, projectMask, runsFromIds, symmetricEigen3, triangleIds, type SplitMesh } from '../../src/geometry/splitPartsMath';
import { formatSplitValue, parseSplitReport, removeSplitCall, upsertSplitCall } from '../../src/editor/splitCode';

/** A closed axis-aligned grid tube (square cross-section, side 2, centred on
 *  the Z axis) of `rings` rings along Z from z=0, capped at both ends. Each
 *  side face of every ring band is two triangles. */
function tube(rings: number, tilt = 0): SplitMesh {
  const verts: number[] = [];
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let r = 0; r < rings; r++) {
    for (const [x, y] of corners) verts.push(x, y, r + tilt * x);
  }
  const tris: number[] = [];
  for (let r = 0; r + 1 < rings; r++) {
    for (let k = 0; k < 4; k++) {
      const a = r * 4 + k, b = r * 4 + ((k + 1) % 4), c = (r + 1) * 4 + ((k + 1) % 4), d = (r + 1) * 4 + k;
      tris.push(a, b, c, a, c, d);
    }
  }
  // caps
  tris.push(0, 2, 1, 0, 3, 2);
  const t = (rings - 1) * 4;
  tris.push(t, t + 1, t + 2, t, t + 2, t + 3);
  return { vertProperties: Float32Array.from(verts), triVerts: Uint32Array.from(tris), numProp: 3 };
}

/** Mask of side triangles in bands at or above `fromBand` (+ the top cap). */
function upperMask(mesh: SplitMesh, rings: number, fromBand: number): Uint8Array {
  const numTri = mesh.triVerts.length / 3;
  const mask = new Uint8Array(numTri);
  const sideTris = (rings - 1) * 8;
  for (let t = fromBand * 8; t < sideTris; t++) mask[t] = 1;
  mask[numTri - 2] = 1; mask[numTri - 1] = 1;
  return mask;
}

describe('splitPartsMath.fitSeam', () => {
  it('finds a planar seam loop between two parts of a tube, normal into the part', () => {
    const mesh = tube(6);
    const fit = fitSeam(mesh, upperMask(mesh, 6, 3))!;
    expect(fit).not.toBeNull();
    expect(fit.loops).toBe(1);
    expect(fit.rms).toBeLessThan(1e-6);
    expect(fit.point[2]).toBeCloseTo(3, 6);
    expect(fit.normal[2]).toBeCloseTo(1, 6); // the part is above the seam
    expect(fit.length).toBeCloseTo(8, 6);
  });

  it('reports a non-planar seam with a large rms', () => {
    const mesh = tube(6);
    const mask = upperMask(mesh, 6, 3);
    // Pull one side's band down a ring: the seam steps.
    for (let t = 2 * 8; t < 2 * 8 + 2; t++) mask[t] = 1;
    const fit = fitSeam(mesh, mask)!;
    expect(fit.loops).toBe(1);
    expect(fit.rms / fit.radius).toBeGreaterThan(0.08);
  });

  it('counts separate loops and returns null with no seam', () => {
    const mesh = tube(8);
    const numTri = mesh.triVerts.length / 3;
    const mid = new Uint8Array(numTri);
    for (let t = 3 * 8; t < 4 * 8; t++) mid[t] = 1; // one band in the middle: two loops
    expect(fitSeam(mesh, mid)!.loops).toBe(2);
    expect(fitSeam(mesh, new Uint8Array(numTri).fill(1))).toBeNull();
  });

  it('ignores seams against faces of pieces already cut away', () => {
    const mesh = tube(8);
    const numTri = mesh.triVerts.length / 3;
    const mid = new Uint8Array(numTri);
    for (let t = 3 * 8; t < 4 * 8; t++) mid[t] = 1;
    const gone = new Uint8Array(numTri);
    for (let t = 4 * 8; t < numTri; t++) gone[t] = 1; // everything above already removed
    const fit = fitSeam(mesh, mid, gone)!;
    expect(fit.loops).toBe(1);
    expect(fit.point[2]).toBeCloseTo(3, 6);
  });
});

describe('splitPartsMath helpers', () => {
  it('triangleIds / runsFromIds round-trip without reordering', () => {
    const ids = Uint32Array.from([5, 5, 7, 7, 7, 5, 9]);
    const runs = runsFromIds(ids);
    expect(Array.from(runs.runOriginalID)).toEqual([5, 7, 5, 9]);
    expect(Array.from(runs.runIndex)).toEqual([0, 6, 15, 18, 21]);
    const mesh: SplitMesh = { vertProperties: new Float32Array(9), triVerts: new Uint32Array(21), numProp: 3, ...runs };
    expect(Array.from(triangleIds(mesh))).toEqual(Array.from(ids));
  });

  it('symmetricEigen3 sorts eigenvalues ascending with unit vectors', () => {
    const { values, vectors } = symmetricEigen3([4, 0, 0, 0, 1, 0, 0, 0, 9]);
    expect(values).toEqual([1, 4, 9]);
    expect(Math.abs(vectors[0][1])).toBeCloseTo(1, 9);
    expect(Math.abs(vectors[2][2])).toBeCloseTo(1, 9);
  });

  it('frameMatrix builds a right-handed orthonormal frame on the axis', () => {
    const { u, v, mat } = frameMatrix([0, -1, 0], [1, 2, 3]);
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    expect(dot(u, v)).toBeCloseTo(0, 9);
    expect(dot(u, [0, -1, 0])).toBeCloseTo(0, 9);
    expect(mat.slice(8, 11)).toEqual([0, -1, 0]);
    expect(mat.slice(12, 15)).toEqual([1, 2, 3]);
  });

  it('maskAreaNormal / projectMask on the top cap of a tube', () => {
    const mesh = tube(4);
    const numTri = mesh.triVerts.length / 3;
    const cap = new Uint8Array(numTri);
    cap[numTri - 2] = 1; cap[numTri - 1] = 1;
    const an = maskAreaNormal(mesh, cap)!;
    expect(an.area).toBeCloseTo(4, 6);
    expect(an.normal[2]).toBeCloseTo(1, 6);
    const { u, v } = frameMatrix(an.normal, [0, 0, 0]);
    const proj = projectMask(mesh, cap, u, v, an.normal);
    expect(proj.polys).toHaveLength(2);
    expect(proj.minA).toBeCloseTo(3, 6);
    expect(proj.maxA).toBeCloseTo(3, 6);
    // every projected triangle is counter-clockwise
    for (const p of proj.polys) {
      const a2 = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[2][0] - p[0][0]) * (p[1][1] - p[0][1]);
      expect(a2).toBeGreaterThan(0);
    }
  });
});

describe('splitCode', () => {
  it('wraps the final top-level return and updates it in place', () => {
    const code = "const m = api.importWithParts(0);\nreturn m;\n";
    const a = upsertSplitCall(code, { seams: { eyeL: 'plug' }, explode: 0.6 })!;
    expect(a.replaced).toBe(false);
    expect(a.code).toBe("const m = api.importWithParts(0);\nreturn api.splitParts(m, { seams: { eyeL: 'plug' }, explode: 0.6 });\n");
    const b = upsertSplitCall(a.code, { clearance: 0.15 })!;
    expect(b.replaced).toBe(true);
    expect(b.code).toBe("const m = api.importWithParts(0);\nreturn api.splitParts(m, { clearance: 0.15 });\n");
    expect(removeSplitCall(b.code)).toBe(code);
  });

  it('handles a call expression, no semicolon, nested returns and comments', () => {
    const code = [
      'function helper() { return 1; }',
      '// return notThis;',
      "const s = 'return nope;';",
      'return api.importWithParts(0)',
    ].join('\n');
    const a = upsertSplitCall(code, {})!;
    expect(a.code.endsWith('return api.splitParts(api.importWithParts(0))')).toBe(true);
    expect(a.code).toContain('function helper() { return 1; }');
    expect(removeSplitCall(a.code)).toBe(code);
  });

  it('quotes non-identifier keys and returns null without a return', () => {
    expect(formatSplitValue({ seams: { 'patch 3': 'flat', 'torso+tail': { mode: 'plug', axis: [0, -1, 0] } } }))
      .toBe("{ seams: { 'patch 3': 'flat', 'torso+tail': { mode: 'plug', axis: [0, -1, 0] } } }");
    expect(upsertSplitCall('const a = 1;', {})).toBeNull();
    expect(removeSplitCall('return m;')).toBeNull();
  });

  it('parses the last [splitParts] report line', () => {
    const r = parseSplitReport(['hello', '[splitParts] {"pieces":[{"name":"a"}],"warnings":["w"]}']);
    expect(r).toEqual({ pieces: [{ name: 'a' }], warnings: ['w'] });
    expect(parseSplitReport(['[splitParts] {broken'])).toBeNull();
    expect(parseSplitReport(undefined)).toBeNull();
  });
});
