import { describe, expect, it } from 'vitest';
import { computeMeshFeatures, toSegMesh } from '../../src/segmentation/features';
import { SegmentationRunner } from '../../src/segmentation/runner';
import { getDetector, resolveParams } from '../../src/segmentation/registry';
import { jitterMesh, scorePartition, seedsFromTruth } from '../../src/segmentation/scoring';
import type { SegMesh } from '../../src/segmentation/types';

/** Heightfield over [0,1]² with z = h(x), N×N vertices, normals +Z. */
function heightfield(N: number, h: (x: number, y: number) => number): SegMesh {
  const positions = new Float32Array(N * N * 3);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = i / (N - 1), y = j / (N - 1);
    positions.set([x, y, h(x, y)], (j * N + i) * 3);
  }
  const tris: number[] = [];
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
    const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
    tris.push(a, b, d, a, d, c);
  }
  return { positions, triVerts: Uint32Array.from(tris) };
}

/** V-groove (valley) along x = 0.5. */
const groove = (N = 41) => heightfield(N, (x) => 0.3 * Math.abs(x - 0.5));

function centroidX(m: SegMesh, t: number): number {
  const p = m.positions, tv = m.triVerts;
  return (p[tv[t * 3] * 3] + p[tv[t * 3 + 1] * 3] + p[tv[t * 3 + 2] * 3]) / 3;
}

describe('segmentation features', () => {
  it('pairs every interior edge and marks the valley concave', () => {
    const m = groove(21);
    const f = computeMeshFeatures(m, { normalSmoothRadius: 0 });
    const nTri = 2 * 20 * 20;
    expect(f.triCount).toBe(nTri);
    // Interior edges of a 20×20 grid: horizontal + vertical + diagonals.
    expect(f.edgeA.length).toBe(20 * 19 * 2 + 400);
    expect(f.pieceCount).toBe(1);
    let maxCrease = 0, maxAt = -1;
    for (let e = 0; e < f.edgeA.length; e++) if (f.creaseCost[e] > maxCrease) { maxCrease = f.creaseCost[e]; maxAt = e; }
    expect(maxCrease).toBeGreaterThan(20);
    expect(Math.abs(centroidX(m, f.edgeA[maxAt]) - 0.5)).toBeLessThan(0.06);
    // A ridge is convex: no crease cost.
    const ridge = computeMeshFeatures(heightfield(21, (x) => -0.3 * Math.abs(x - 0.5)), { normalSmoothRadius: 0 });
    expect(Math.max(...ridge.creaseCost)).toBeLessThan(0.5); // float noise on flat diagonals only
  });

  it('defaults to raw normals; smoothing is opt-in', () => {
    expect(computeMeshFeatures(groove(21)).options.normalSmoothRadius).toBe(0);
    const smoothed = computeMeshFeatures(groove(21), { normalSmoothRadius: 0.2 });
    const raw = computeMeshFeatures(groove(21));
    // Smoothing spreads the groove: its peak crease drops.
    expect(Math.max(...smoothed.creaseCost)).toBeLessThan(Math.max(...raw.creaseCost));
  });

  it('toSegMesh extracts xyz from wider vertex records', () => {
    const vp = Float32Array.from([0, 0, 0, 9, 1, 0, 0, 9, 0, 1, 0, 9]);
    const s = toSegMesh(vp, Uint32Array.from([0, 1, 2]), 4);
    expect([...s.positions]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  });
});

describe('crease-watershed', () => {
  // Seed A sits right next to the groove, seed B far away: a pure distance
  // split lands mid-way between them, a crease-aware split lands on the groove.
  const seeds = [
    { label: 'A', point: [0.45, 0.5, 0.015] as [number, number, number] },
    { label: 'B', point: [0.98, 0.5, 0.144] as [number, number, number] },
  ];
  const boundaryX = (algoParams: Record<string, unknown>) => {
    const m = groove();
    const r = new SegmentationRunner(m);
    r.detect({ algorithm: 'crease-watershed', seeds, params: algoParams, featureOptions: { normalSmoothRadius: 0 } });
    // Largest x still labelled A along the mesh.
    let maxA = 0;
    for (let t = 0; t < r.draft!.triPart.length; t++) if (r.draft!.triPart[t] === 0) maxA = Math.max(maxA, centroidX(m, t));
    return maxA;
  };

  it('hybrid and minimax stop at the groove', () => {
    expect(boundaryX({ growth: 'hybrid' })).toBeLessThan(0.52);
    expect(boundaryX({ growth: 'minimax' })).toBeLessThan(0.52);
  });

  it('summed with no crease toll splits by distance (crosses the groove)', () => {
    expect(boundaryX({ growth: 'summed', creaseWeight: 0 })).toBeGreaterThan(0.6);
  });

  it('requires seeds and names parts after seed labels', () => {
    const r = new SegmentationRunner(groove(11));
    expect(() => r.detect({ algorithm: 'crease-watershed' })).toThrow(/needs seeds/);
    const s = r.detect({ algorithm: 'crease-watershed', seeds });
    expect(s.parts.map((p) => p.name)).toEqual(['A', 'B']);
    expect(s.parts.map((p) => p.id)).toEqual([1, 2]);
    expect(s.unassigned.triCount).toBe(0);
    expect(s.quality.partCount).toBe(2);
    expect(s.quality.boundaryCreaseMean).toBeGreaterThan(3);
  });

  it('emits a vertex cost field with two labels only on the boundary', () => {
    const m = groove(11);
    const r = new SegmentationRunner(m);
    r.detect({ algorithm: 'crease-watershed', seeds });
    const g = getDetector('crease-watershed')!.run(m, r.features(), { params: resolveParams(getDetector('crease-watershed')!, {}), seeds });
    const vc = g.vertexCosts!;
    let twoLabel = 0;
    for (let v = 0; v < vc.label1.length; v++) if (vc.label2[v] >= 0) { twoLabel++; expect(vc.cost1[v]).toBeLessThanOrEqual(vc.cost2[v]); }
    expect(twoLabel).toBeGreaterThan(0);
    expect(twoLabel).toBeLessThan(vc.label1.length / 3);
  });
});

describe('pieces', () => {
  it('finds separate solids, largest first', () => {
    const a = groove(5);
    const nv = a.positions.length / 3;
    const big = heightfield(9, () => 2);
    for (let i = 0; i < big.positions.length; i++) big.positions[i] *= 3; // 9× the area
    const positions = new Float32Array(a.positions.length + big.positions.length);
    positions.set(a.positions); positions.set(big.positions, a.positions.length);
    const triVerts = new Uint32Array(a.triVerts.length + big.triVerts.length);
    triVerts.set(a.triVerts); triVerts.set(big.triVerts.map((v) => v + nv), a.triVerts.length);
    const s = new SegmentationRunner({ positions, triVerts }).detect({ algorithm: 'pieces' });
    expect(s.parts.map((p) => p.triCount)).toEqual([128, 32]);
  });
});

describe('registry params', () => {
  const d = getDetector('crease-watershed')!;
  it('fills defaults and rejects bad input', () => {
    expect(resolveParams(d, {})).toEqual({ growth: 'hybrid', creaseQuantumDeg: 5, creaseWeight: 1 });
    expect(() => resolveParams(d, { nope: 1 })).toThrow(/Unknown param "nope"/);
    expect(() => resolveParams(d, { growth: 'fast' })).toThrow(/one of/);
    expect(() => resolveParams(d, { creaseQuantumDeg: 0 })).toThrow(/≥ 0.5/);
    expect(() => resolveParams(d, { creaseWeight: '2' })).toThrow(/number/);
  });
});

describe('part draft edits', () => {
  const seeds3 = [
    { label: 'left', point: [0.1, 0.5, 0.12] as [number, number, number] },
    { label: 'right', point: [0.9, 0.2, 0.12] as [number, number, number] },
    { label: 'right', point: [0.9, 0.8, 0.12] as [number, number, number] },
  ];
  const fresh = () => {
    const r = new SegmentationRunner(groove(21));
    r.detect({ algorithm: 'crease-watershed', seeds: seeds3 });
    return r;
  };

  it('rename / setColor / merge / undo', () => {
    const r = fresh();
    let s = r.edit([{ op: 'rename', id: 1, name: 'hair' }, { op: 'setColor', id: 'right', color: '#FF0000' }]);
    expect(s.parts.map((p) => [p.name, p.color])).toEqual([['hair', null], ['right', '#ff0000']]);
    s = r.edit([{ op: 'merge', ids: [1, 2], name: 'all' }]);
    expect(s.parts.length).toBe(1);
    expect(s.parts[0].name).toBe('all');
    s = r.edit([{ op: 'undo' }]);
    expect(s.parts.map((p) => p.name)).toEqual(['hair', 'right']);
  });

  it('a failing op rolls back the whole batch', () => {
    const r = fresh();
    expect(() => r.edit([{ op: 'rename', id: 1, name: 'x' }, { op: 'rename', id: 9, name: 'y' }])).toThrow(/No part with id 9/);
    expect(r.draft!.summary().parts[0].name).toBe('left');
  });

  it('split grows new parts inside one part only', () => {
    const r = fresh();
    const before = r.draft!.summary().parts[0].triCount;
    const s = r.edit([{ op: 'split', id: 'right', seeds: [
      { label: 'top', point: [0.9, 0.9, 0.12] }, { label: 'bottom', point: [0.9, 0.1, 0.12] },
    ] }]);
    expect(s.parts.map((p) => p.name)).toEqual(['left', 'top', 'bottom']);
    expect(s.parts[0].triCount).toBe(before);
  });

  it('reassign by radius creates a named part; delete leaves it unassigned', () => {
    const r = fresh();
    let s = r.edit([{ op: 'reassign', point: [0.2, 0.5, 0.09], to: 'patch', radius: 0.08 }]);
    const patch = s.parts.find((p) => p.name === 'patch')!;
    expect(patch.triCount).toBeGreaterThan(0);
    s = r.edit([{ op: 'delete', id: patch.id }]);
    expect(s.unassigned.triCount).toBe(patch.triCount);
  });

  it('absorbSmall removes islands; smoothBoundaries keeps part count', () => {
    const r = fresh();
    r.edit([{ op: 'reassign', point: [0.2, 0.5, 0.09], to: 'right', radius: 0.05 }]);
    let s = r.draft!.summary();
    expect(s.quality.islandCount).toBe(1);
    s = r.edit([{ op: 'absorbSmall', minAreaFrac: 0.02 }]);
    expect(s.quality.islandCount).toBe(0);
    s = r.edit([{ op: 'smoothBoundaries', iterations: 2 }]);
    expect(s.parts.length).toBe(2);
  });

  it('addSeed re-runs the detector and keeps colours by name', () => {
    const r = fresh();
    r.edit([{ op: 'setColor', id: 'left', color: '#00ff00' }]);
    const s = r.edit([{ op: 'addSeed', seed: { label: 'mid', point: [0.5, 0.5, 0] } }]);
    expect(s.parts.map((p) => p.name)).toContain('mid');
    expect(s.parts.find((p) => p.name === 'left')!.color).toBe('#00ff00');
    expect(s.seeds.length).toBe(4);
  });
});

describe('bench scoring', () => {
  it('scores a perfect partition 1 and a merged one lower', () => {
    const area = new Float32Array(4).fill(1);
    const truth = Int32Array.from([0, 0, 1, 1]);
    expect(scorePartition(Int32Array.from([5, 5, 2, 2]), truth, area).iou).toBe(1);
    expect(scorePartition(Int32Array.from([0, 0, 0, 0]), truth, area).iou).toBeCloseTo(0.5);
    expect(scorePartition(Int32Array.from([-1, -1, -1, -1]), truth, area).iou).toBe(0);
  });

  it('places one seed per true label on that label', () => {
    const m = groove(11);
    const f = computeMeshFeatures(m);
    const truth = new Int32Array(f.triCount);
    for (let t = 0; t < f.triCount; t++) truth[t] = f.triCentroid[t * 3] < 0.5 ? 0 : 1;
    const seeds = seedsFromTruth(f, truth, ['L', 'R']);
    expect(seeds.map((s) => s.label)).toEqual(['L', 'R']);
    expect(truth[seeds[0].triangle!]).toBe(0);
    expect(truth[seeds[1].triangle!]).toBe(1);
  });

  it('jitter is deterministic and bounded', () => {
    const m = groove(5);
    const a = jitterMesh(m, 0.01, 7), b = jitterMesh(m, 0.01, 7);
    expect([...a.positions]).toEqual([...b.positions]);
    for (let i = 0; i < m.positions.length; i++) expect(Math.abs(a.positions[i] - m.positions[i])).toBeLessThanOrEqual(0.01 + 1e-6);
  });
});
