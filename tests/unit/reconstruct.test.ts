import { describe, it, expect } from 'vitest';
import { sliceMesh, douglasPeucker, polygonSignedArea } from '../../src/reconstruct/slice2d';
import { samplePoints, buildKdTree, makeRng } from '../../src/reconstruct/sampleMesh';
import { meshDistance } from '../../src/reconstruct/meshDistance';
import { connectedComponents, toTriangleSoup, meshBBox } from '../../src/reconstruct/meshComponents';
import { buildReconstructionCode, deriveOptions } from '../../src/reconstruct/sectionCode';

// ---- fixtures ----------------------------------------------------------

/** Axis-aligned box as a 12-triangle soup (outward winding not required by
 *  any code under test — slicing and sampling are winding-agnostic). */
function boxSoup(cx: number, cy: number, cz: number, w: number, h: number, d: number): Float32Array {
  const x0 = cx - w / 2, x1 = cx + w / 2;
  const y0 = cy - h / 2, y1 = cy + h / 2;
  const z0 = cz - d / 2, z1 = cz + d / 2;
  // 8 corners
  const c = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  // 12 triangles (2 per face), consistent outward winding
  const quads = [
    [0, 3, 2, 1], // bottom (z0), viewed from below
    [4, 5, 6, 7], // top
    [0, 1, 5, 4], // front (y0)
    [2, 3, 7, 6], // back
    [1, 2, 6, 5], // right (x1)
    [3, 0, 4, 7], // left
  ];
  const out: number[] = [];
  for (const [a, b, cc, dd] of quads) {
    out.push(...c[a], ...c[b], ...c[cc]);
    out.push(...c[a], ...c[cc], ...c[dd]);
  }
  return Float32Array.from(out);
}

function concat(...soups: Float32Array[]): Float32Array {
  const total = soups.reduce((acc, s) => acc + s.length, 0);
  const out = new Float32Array(total);
  let o = 0;
  for (const s of soups) {
    out.set(s, o);
    o += s.length;
  }
  return out;
}

// ---- sliceMesh ---------------------------------------------------------

describe('reconstruct slice2d', () => {
  it('slices a box into one closed contour with the right area', () => {
    const soup = { triangles: boxSoup(0, 0, 0, 4, 6, 10) };
    const contours = sliceMesh(soup, 'z', 0);
    expect(contours).toHaveLength(1);
    expect(contours[0].open).toBe(false);
    expect(contours[0].isHole).toBe(false);
    expect(contours[0].area).toBeCloseTo(24, 5);
  });

  it('classifies a nested contour as a hole (tube cross-section)', () => {
    // Outer box shell + inner box "hole wall" — geometrically a tube's slice.
    const outer = boxSoup(0, 0, 0, 10, 10, 4);
    const inner = boxSoup(0, 0, 0, 4, 4, 4);
    const contours = sliceMesh({ triangles: concat(outer, inner) }, 'z', 0);
    expect(contours).toHaveLength(2);
    expect(contours[0].isHole).toBe(false); // largest first
    expect(contours[1].isHole).toBe(true);
    expect(contours[1].area).toBeCloseTo(16, 5);
  });

  it('returns nothing when the plane misses the mesh', () => {
    const soup = { triangles: boxSoup(0, 0, 0, 4, 4, 4) };
    expect(sliceMesh(soup, 'z', 99)).toHaveLength(0);
  });

  it('douglasPeucker collapses collinear detail within tolerance', () => {
    // Dense square outline: many collinear points along each edge.
    const pts: number[] = [];
    const N = 32;
    for (let i = 0; i < N; i++) pts.push(-1 + (2 * i) / N, -1);
    for (let i = 0; i < N; i++) pts.push(1, -1 + (2 * i) / N);
    for (let i = 0; i < N; i++) pts.push(1 - (2 * i) / N, 1);
    for (let i = 0; i < N; i++) pts.push(-1, 1 - (2 * i) / N);
    const dense = Float64Array.from(pts);
    const simplified = douglasPeucker(dense, 0.01);
    expect(simplified.length / 2).toBeLessThan(10);
    // Area is preserved (square of side 2)
    expect(Math.abs(polygonSignedArea(simplified))).toBeCloseTo(4, 3);
  });
});

// ---- sampling + distance ------------------------------------------------

describe('reconstruct sampling + distance', () => {
  it('makeRng is deterministic', () => {
    const a = makeRng(7), b = makeRng(7);
    for (let i = 0; i < 5; i++) expect(a()).toBe(b());
  });

  it('samplePoints stay on the box surface; kd-tree finds itself', () => {
    const soup = { triangles: boxSoup(0, 0, 0, 2, 2, 2) };
    const pts = samplePoints(soup, 500, { seed: 3 });
    for (let i = 0; i < pts.length; i += 3) {
      const onFace =
        Math.abs(Math.abs(pts[i]) - 1) < 1e-5 ||
        Math.abs(Math.abs(pts[i + 1]) - 1) < 1e-5 ||
        Math.abs(Math.abs(pts[i + 2]) - 1) < 1e-5;
      expect(onFace).toBe(true);
    }
    const kd = buildKdTree(pts);
    const { index, distSq } = kd.nearest(pts[30], pts[31], pts[32]);
    expect(index).toBe(10);
    expect(distSq).toBe(0);
  });

  it('meshDistance ≈ 0 for identical meshes, grows with offset', () => {
    const a = { triangles: boxSoup(0, 0, 0, 4, 4, 4) };
    const same = meshDistance(a, a, { samples: 1500 });
    expect(same.chamfer).toBeLessThan(same.sampleSpacing);
    const b = { triangles: boxSoup(1.5, 0, 0, 4, 4, 4) };
    const moved = meshDistance(a, b, { samples: 1500 });
    expect(moved.chamfer).toBeGreaterThan(same.chamfer * 3);
    expect(moved.hausdorff).toBeGreaterThan(1);
  });
});

// ---- components ----------------------------------------------------------

describe('reconstruct components', () => {
  it('splits disjoint solids and keeps touching ones together', () => {
    const a = boxSoup(0, 0, 0, 2, 2, 2);
    const b = boxSoup(10, 0, 0, 4, 2, 2); // disjoint, bigger
    const split = connectedComponents({ triangles: concat(a, b) });
    expect(split).toHaveLength(2);
    // sorted by triangle count desc — equal here, so check via bbox
    const diags = split.map((s) => {
      const bb = meshBBox(s);
      return bb.max[0] - bb.min[0];
    });
    expect(diags.sort((x, y) => x - y)).toEqual([2, 4]);
  });

  it('toTriangleSoup honors the vertProperties stride', () => {
    // 1 triangle, numProp 6 (xyz + 3 junk props)
    const vertProperties = Float32Array.from([
      0, 0, 0, 9, 9, 9,
      1, 0, 0, 9, 9, 9,
      0, 1, 0, 9, 9, 9,
    ]);
    const triVerts = Uint32Array.from([0, 1, 2]);
    const soup = toTriangleSoup({ vertProperties, triVerts, numProp: 6 });
    expect(Array.from(soup.triangles)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  });
});

// ---- code generation ------------------------------------------------------

describe('reconstruct sectionCode', () => {
  it('deriveOptions scales edge with the cell budget', () => {
    const bbox = { min: [0, 0, 0] as [number, number, number], max: [10, 10, 10] as [number, number, number] };
    const coarse = deriveOptions(bbox, 1_000_000);
    const fine = deriveOptions(bbox, 8_000_000);
    expect(fine.edge).toBeLessThan(coarse.edge);
    expect(coarse.edge).toBeCloseTo(0.1, 3); // cbrt(1000/1e6)
    expect(coarse.step).toBeGreaterThan(coarse.edge);
    expect(coarse.dpTol).toBeLessThan(coarse.step);
  });

  it('generates syntactically valid single-component code with a levelSet', () => {
    const soup = { triangles: boxSoup(0, 0, 0, 8, 8, 8) };
    const progress: number[] = [];
    const { code, stats } = buildReconstructionCode(soup, {
      cellBudget: 500_000,
      sourceName: 'unit-box',
      onProgress: (f) => progress.push(f),
    });
    expect(code).toContain('Manifold.levelSet');
    expect(code).toContain('return solid;');
    expect(code).toContain('unit-box');
    expect(stats.components).toBe(1);
    expect(stats.sections).toBeGreaterThan(5);
    expect(stats.smoothSegments).toBeGreaterThanOrEqual(1);
    expect(stats.estCells).toBeGreaterThan(0);
    expect(progress.length).toBeGreaterThan(0);
    expect(progress[progress.length - 1]).toBe(1);
    // Must parse as a function body taking `api` — the sandbox contract.
    expect(() => new Function('api', code)).not.toThrow();
  });

  it('prefixes identifiers per component and composes multi-component input', () => {
    const soup = { triangles: concat(boxSoup(0, 0, 0, 4, 4, 4), boxSoup(20, 0, 0, 4, 4, 4)) };
    const { code, stats } = buildReconstructionCode(soup, { cellBudget: 300_000 });
    expect(stats.components).toBe(2);
    expect(code).toContain('c0_');
    expect(code).toContain('c1_');
    expect(code).toContain('Manifold.compose([c0_solid, c1_solid]);');
    expect(() => new Function('api', code)).not.toThrow();
  });

  it('drops debris components with a warning', () => {
    const big = boxSoup(0, 0, 0, 40, 40, 40);
    const speck = boxSoup(25, 25, 25, 0.05, 0.05, 0.05);
    const { stats } = buildReconstructionCode({ triangles: concat(big, speck) }, { cellBudget: 300_000 });
    expect(stats.components).toBe(1);
    expect(stats.droppedComponents).toBe(1);
    expect(stats.warnings.some((w) => w.includes('debris'))).toBe(true);
  });

  it('rejects meshes with too few triangles', () => {
    const tri = new Float32Array(18);
    expect(() => buildReconstructionCode({ triangles: tri }, { cellBudget: 1000 })).toThrow(/too few/);
  });
});
