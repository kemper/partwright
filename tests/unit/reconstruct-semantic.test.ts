import { describe, it, expect } from 'vitest';
import { fitCircle2D, fitRoundedRect2D, contourStats } from '../../src/reconstruct/slice2d';
import { profileMesh, probeSection } from '../../src/reconstruct/profileMesh';
import { voxelDiff, voxelizeSoup, makeSharedGrid } from '../../src/reconstruct/voxelDiff';
import { fitInscribedBox, fitInscribedCylinder } from '../../src/reconstruct/inscribed';

// ---- fixtures ----------------------------------------------------------

function boxSoup(cx: number, cy: number, cz: number, w: number, h: number, d: number): Float32Array {
  const x0 = cx - w / 2, x1 = cx + w / 2;
  const y0 = cy - h / 2, y1 = cy + h / 2;
  const z0 = cz - d / 2, z1 = cz + d / 2;
  const c = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const quads = [
    [0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [3, 0, 4, 7],
  ];
  const out: number[] = [];
  for (const [a, b, cc, dd] of quads) {
    out.push(...c[a], ...c[b], ...c[cc]);
    out.push(...c[a], ...c[cc], ...c[dd]);
  }
  return Float32Array.from(out);
}

/** Closed cylinder along Z, radius r, from z0 to z1, N side facets. */
function cylinderSoup(cx: number, cy: number, r: number, z0: number, z1: number, N = 64): Float32Array {
  const out: number[] = [];
  for (let i = 0; i < N; i++) {
    const a0 = (2 * Math.PI * i) / N;
    const a1 = (2 * Math.PI * (i + 1)) / N;
    const p0 = [cx + r * Math.cos(a0), cy + r * Math.sin(a0)];
    const p1 = [cx + r * Math.cos(a1), cy + r * Math.sin(a1)];
    // side quad
    out.push(p0[0], p0[1], z0, p1[0], p1[1], z0, p1[0], p1[1], z1);
    out.push(p0[0], p0[1], z0, p1[0], p1[1], z1, p0[0], p0[1], z1);
    // caps (fan from center)
    out.push(cx, cy, z0, p1[0], p1[1], z0, p0[0], p0[1], z0);
    out.push(cx, cy, z1, p0[0], p0[1], z1, p1[0], p1[1], z1);
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

function circlePts(cx: number, cy: number, r: number, n = 48): Float64Array {
  const out = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    out[i * 2] = cx + r * Math.cos((2 * Math.PI * i) / n);
    out[i * 2 + 1] = cy + r * Math.sin((2 * Math.PI * i) / n);
  }
  return out;
}

// ---- 2D fitters ---------------------------------------------------------

describe('contour primitive fits', () => {
  it('fitCircle2D recovers center/radius with near-zero residual', () => {
    const fit = fitCircle2D(circlePts(3, -2, 5.5));
    expect(fit.cx).toBeCloseTo(3, 4);
    expect(fit.cy).toBeCloseTo(-2, 4);
    expect(fit.r).toBeCloseTo(5.5, 3);
    expect(fit.rmsResidual).toBeLessThan(0.01 * fit.r);
  });

  it('fitCircle2D rejects a dense square outline (large residual)', () => {
    // NOTE: 4 bare corners fit a circle EXACTLY (any 4 points do) — the
    // residual only discriminates on a dense outline, which is why the
    // profiler ALSO gates circle verdicts on a minimum point count.
    const pts: number[] = [];
    const N = 16;
    for (let i = 0; i < N; i++) pts.push(-1 + (2 * i) / N, -1);
    for (let i = 0; i < N; i++) pts.push(1, -1 + (2 * i) / N);
    for (let i = 0; i < N; i++) pts.push(1 - (2 * i) / N, 1);
    for (let i = 0; i < N; i++) pts.push(-1, 1 - (2 * i) / N);
    const fit = fitCircle2D(Float64Array.from(pts));
    expect(fit.rmsResidual).toBeGreaterThan(0.03 * fit.r);
  });

  it('fitRoundedRect2D recovers a sharp rectangle', () => {
    // Dense rectangle outline 8×4 centered at (1, 2)
    const pts: number[] = [];
    const N = 20;
    for (let i = 0; i < N; i++) pts.push(-3 + (8 * i) / N, 0);
    for (let i = 0; i < N; i++) pts.push(5, (4 * i) / N);
    for (let i = 0; i < N; i++) pts.push(5 - (8 * i) / N, 4);
    for (let i = 0; i < N; i++) pts.push(-3, 4 - (4 * i) / N);
    const fit = fitRoundedRect2D(Float64Array.from(pts));
    expect(fit.w).toBeCloseTo(8, 1);
    expect(fit.h).toBeCloseTo(4, 1);
    expect(fit.cx).toBeCloseTo(1, 1);
    expect(fit.cy).toBeCloseTo(2, 1);
    expect(fit.rmsResidual).toBeLessThan(0.02 * 8);
  });

  it('contourStats reports area/perimeter/centroid', () => {
    const square = Float64Array.from([0, 0, 4, 0, 4, 4, 0, 4]);
    const s = contourStats({ points: square });
    expect(s.area).toBeCloseTo(16, 6);
    expect(s.perimeter).toBeCloseTo(16, 6);
    expect(s.centroid[0]).toBeCloseTo(2, 6);
  });
});

// ---- profiler -------------------------------------------------------------

describe('profileMesh', () => {
  it('detects a cylinder run and a box run in a stacked model', () => {
    // Box 20×20×10 at z 0..10 with a cylinder r=4 on top at z 10..24.
    const soup = {
      triangles: concat(boxSoup(0, 0, 5, 20, 20, 10), cylinderSoup(0, 0, 4, 10, 24)),
    };
    const profile = profileMesh(soup, { sectionsPerAxis: 48, axes: ['z'] });
    const runs = profile.axes[0].runs;
    const cyl = runs.find((r) => r.kind === 'circle');
    const box = runs.find((r) => r.kind === 'rect');
    expect(cyl).toBeDefined();
    expect(cyl!.circle!.r).toBeCloseTo(4, 1);
    expect(cyl!.from).toBeGreaterThan(9);
    expect(cyl!.to).toBeGreaterThan(23);
    expect(box).toBeDefined();
    expect(box!.rect!.w).toBeCloseTo(20, 0);
    expect(box!.rect!.h).toBeCloseTo(20, 0);
    expect(box!.to).toBeLessThan(11.5);
  });

  it('reports a bore as hole fits on the run', () => {
    // Plate with a circular hole: box minus nothing here — emulate with
    // outer box shell + inner cylinder wall (hole) at the same z-range.
    const soup = {
      triangles: concat(boxSoup(0, 0, 2, 20, 20, 4), cylinderSoup(3, 0, 2.5, -0.5, 4.5)),
    };
    const probe = probeSection(soup, 'z', 2, 0.02);
    expect(probe.kind).toBe('rect');
    expect(probe.holeCount).toBe(1);
    expect(probe.holes[0].r).toBeCloseTo(2.5, 1);
    expect(probe.holes[0].cx).toBeCloseTo(3, 1);
  });

  it('marks separated blobs as multi', () => {
    const soup = { triangles: concat(boxSoup(-10, 0, 0, 4, 4, 4), boxSoup(10, 0, 0, 4, 4, 4)) };
    const probe = probeSection(soup, 'z', 0, 0.01);
    expect(probe.kind).toBe('multi');
    expect(probe.outerCount).toBe(2);
  });
});

// ---- voxel diff -------------------------------------------------------------

describe('voxelDiff', () => {
  it('identical meshes → IoU ≈ 1, no findings', () => {
    const a = { triangles: boxSoup(0, 0, 0, 10, 10, 10) };
    const report = voxelDiff(a, a, { res: 0.5 });
    expect(report.volumeIoU).toBeGreaterThan(0.999);
    expect(report.findings).toHaveLength(0);
  });

  it('a missing corner block is located and signed', () => {
    const target = { triangles: boxSoup(0, 0, 0, 10, 10, 10) };
    // Candidate = target minus a 4×4×4 corner: emulate by comparing against a
    // smaller candidate — a box shifted so a corner region is absent.
    const candidate = { triangles: boxSoup(-1, 0, 0, 8, 10, 10) }; // right slab x∈[3,5] missing
    const report = voxelDiff(target, candidate, { res: 0.4 });
    expect(report.volumeIoU).toBeLessThan(0.9);
    const missing = report.findings.find((f) => f.sign === 'missing');
    expect(missing).toBeDefined();
    // The missing slab sits at x ≈ 4 (right side of the target).
    expect(missing!.centroid[0]).toBeGreaterThan(3);
    expect(missing!.volume).toBeCloseTo(2 * 10 * 10, -1); // ~200 units³
    expect(missing!.relCentroid[0]).toBeGreaterThan(0.8);
  });

  it('voxelizeSoup fills a box to ~its analytic volume', () => {
    const box = { triangles: boxSoup(0, 0, 0, 8, 6, 4) };
    const grid = makeSharedGrid(box, box, { res: 0.25 });
    const occ = voxelizeSoup(box, grid);
    let count = 0;
    for (let i = 0; i < occ.length; i++) if (occ[i]) count++;
    expect(count * grid.res ** 3).toBeCloseTo(8 * 6 * 4, -1);
  });
});

// ---- inscribed primitives ---------------------------------------------------

describe('inscribed primitives', () => {
  it('fitInscribedBox finds ~the whole box in a box', () => {
    const soup = { triangles: boxSoup(1, 2, 3, 12, 8, 6) };
    const fit = fitInscribedBox(soup, { res: 0.25 });
    expect(fit.volumeFraction).toBeGreaterThan(0.85);
    expect(fit.center[0]).toBeCloseTo(1, 0);
    expect(fit.size[0]).toBeGreaterThan(10.5);
    expect(fit.size[1]).toBeGreaterThan(6.5);
  });

  it('fitInscribedCylinder recovers a cylinder from a cylinder', () => {
    const soup = { triangles: cylinderSoup(2, -1, 5, 0, 12) };
    const fit = fitInscribedCylinder(soup, { res: 0.25 });
    expect(fit.r).toBeGreaterThan(4);
    expect(fit.center[0]).toBeCloseTo(2, 0);
    expect(fit.center[1]).toBeCloseTo(-1, 0);
    expect(fit.z1 - fit.z0).toBeGreaterThan(10);
    expect(fit.volumeFraction).toBeGreaterThan(0.7);
  });

  it('fitInscribedBox in a sphere-ish solid stays inside (fraction < 1)', () => {
    const soup = { triangles: cylinderSoup(0, 0, 6, 0, 12, 48) };
    const fit = fitInscribedBox(soup, { res: 0.3 });
    // Largest box inside a cylinder: square side r·√2 ≈ 8.49
    expect(fit.size[0]).toBeLessThan(9.5);
    expect(fit.size[0]).toBeGreaterThan(7);
    expect(fit.volumeFraction).toBeLessThan(1);
  });
});
