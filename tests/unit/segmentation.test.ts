import { describe, expect, it } from 'vitest';
import { computeMeshFeatures, toSegMesh } from '../../src/segmentation/features';
import { SegmentationRunner } from '../../src/segmentation/runner';
import { autoProposeDetectors, describeDetector, getDetector, listDetectors, paramsJsonSchema, resolveParams } from '../../src/segmentation/registry';
import { jitterMesh, scorePartition, seedsFromTruth } from '../../src/segmentation/scoring';
import { planarGroupsDetector } from '../../src/segmentation/planarGroups';
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
    expect(Math.abs(centroidX(m, f.edgeA[maxAt]) - 0.5)).toBeLessThan(0.12);
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

describe('random-walker', () => {
  // Same layout as the watershed test: A hugs the groove, B is far away.
  const seeds = [
    { label: 'A', point: [0.45, 0.5, 0.015] as [number, number, number] },
    { label: 'B', point: [0.98, 0.5, 0.144] as [number, number, number] },
  ];
  const run = (m: SegMesh, sd = seeds, params: Record<string, unknown> = {}, allow?: Uint8Array) => {
    const r = new SegmentationRunner(m);
    const f = r.features();
    const d = getDetector('random-walker')!;
    return { f, out: d.run(m, f, { params: resolveParams(d, params), seeds: sd, allow }) };
  };
  const maxX = (m: SegMesh, triPart: Int32Array, label: number) => {
    let mx = 0;
    for (let t = 0; t < triPart.length; t++) if (triPart[t] === label) mx = Math.max(mx, centroidX(m, t));
    return mx;
  };

  it('puts the boundary on the groove', () => {
    const m = groove();
    const { out } = run(m);
    expect(maxX(m, out.triPart, 0)).toBeLessThan(0.52);
    expect(maxX(m, out.triPart, 0)).toBeGreaterThan(0.45);
  });

  it('requires seeds and names parts after seed labels', () => {
    const r = new SegmentationRunner(groove(11));
    expect(() => r.detect({ algorithm: 'random-walker' })).toThrow(/needs seeds/);
    const s = r.detect({ algorithm: 'random-walker', seeds });
    expect(s.parts.map((p) => p.name)).toEqual(['A', 'B']);
    expect(s.unassigned.triCount).toBe(0);
  });

  it('emits a vertex cost field with two labels only near the boundary', () => {
    const { out } = run(groove(21));
    const vc = out.vertexCosts!;
    let twoLabel = 0;
    for (let v = 0; v < vc.label1.length; v++) {
      if (vc.label2[v] >= 0) { twoLabel++; expect(vc.cost1[v]).toBeLessThanOrEqual(vc.cost2[v]); }
      else expect(vc.cost2[v]).toBe(Infinity);
    }
    expect(twoLabel).toBeGreaterThan(0);
    expect(twoLabel).toBeLessThan(vc.label1.length / 3);
  });

  it('respects the allow mask', () => {
    const m = groove(21);
    const f = new SegmentationRunner(m).features();
    const allow = new Uint8Array(f.triCount);
    for (let t = 0; t < f.triCount; t++) allow[t] = centroidX(m, t) < 0.8 ? 1 : 0;
    const { out } = run(m, seeds, {}, allow);
    // Seed B sits outside the mask and is dropped; only A remains.
    expect(out.partNames).toEqual(['A']);
    for (let t = 0; t < f.triCount; t++) {
      if (allow[t]) expect(out.triPart[t]).toBe(0); else expect(out.triPart[t]).toBe(-1);
    }
  });

  it('splits a flat sheet near the midpoint with a straight-ish boundary', () => {
    // Equilateral-triangle lattice (isotropic graph), flat, no creases at all.
    const cols = 31, rows = 35, sc = 1 / (cols - 1), rowH = sc * Math.sqrt(3) / 2;
    const positions = new Float32Array(cols * rows * 3);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) positions.set([(i + 0.5 * (j % 2)) * sc, j * rowH, 0], (j * cols + i) * 3);
    const tris: number[] = [];
    const v = (i: number, j: number) => j * cols + i;
    for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
      if (j % 2 === 0) tris.push(v(i, j), v(i + 1, j), v(i, j + 1), v(i + 1, j), v(i + 1, j + 1), v(i, j + 1));
      else tris.push(v(i, j), v(i + 1, j + 1), v(i, j + 1), v(i, j), v(i + 1, j), v(i + 1, j + 1));
    }
    const m: SegMesh = { positions, triVerts: Uint32Array.from(tris) };
    const yMid = (rows - 1) * rowH / 2;
    const two = [
      { label: 'L', point: [0.2, yMid, 0] as [number, number, number] },
      { label: 'R', point: [0.8, yMid, 0] as [number, number, number] },
    ];
    const { out } = run(m, two);
    // Per row strip: the L/R boundary sits between the rightmost L and the leftmost R.
    const rowsL = new Map<number, number>(), rowsR = new Map<number, number>();
    for (let t = 0; t < out.triPart.length; t++) {
      const y = Math.floor((positions[m.triVerts[t * 3 + 2] * 3 + 1] + positions[m.triVerts[t * 3] * 3 + 1]) / 2 / rowH + 0.25);
      const x = centroidX(m, t);
      if (out.triPart[t] === 0) rowsL.set(y, Math.max(rowsL.get(y) ?? 0, x));
      else rowsR.set(y, Math.min(rowsR.get(y) ?? 2, x));
    }
    const mids = [...rowsL.keys()].filter((y) => rowsR.has(y)).map((y) => (rowsL.get(y)! + rowsR.get(y)!) / 2).sort((a, b) => a - b);
    expect(mids.length).toBeGreaterThan(rows / 2);
    expect(mids[Math.floor(mids.length / 2)]).toBeGreaterThan(0.45);
    expect(mids[Math.floor(mids.length / 2)]).toBeLessThan(0.55);
    // Straight-ish: no row's boundary strays far from the others.
    expect(mids[mids.length - 1] - mids[0]).toBeLessThan(0.12);
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

describe('registry AI schema', () => {
  it('a param key shared by detectors lists every detector\'s meaning', () => {
    const props = (paramsJsonSchema() as { properties: Record<string, { description: string }> }).properties;
    expect(props.minPartPct.description).toContain('[thickness]');
    expect(props.minPartPct.description).toContain('[planar-groups]');
    expect(props.creaseWeight.description).toContain('[crease-watershed]');
    expect(props.creaseWeight.description).toContain('[thickness]');
  });
});

describe('registry auto-propose', () => {
  it('only seedless opted-in detectors run unattended, cheapest first', () => {
    const auto = autoProposeDetectors();
    expect(auto[0]?.id).toBe('pieces');
    expect(auto.every((d) => d.seeds !== 'required' && d.autoPropose !== undefined)).toBe(true);
    for (let i = 1; i < auto.length; i++) expect(auto[i].autoPropose!.priority).toBeGreaterThanOrEqual(auto[i - 1].autoPropose!.priority);
    // Seeded detectors can't run without the user's seeds, so never auto-propose.
    expect(auto.some((d) => d.id === 'crease-watershed')).toBe(false);
  });

  it('describeDetector reports the flag for listPartDetectors', () => {
    const flags = Object.fromEntries(listDetectors().map((d) => [d.id, describeDetector(d).autoPropose]));
    expect(flags.pieces).toBe(true);
    expect(flags['crease-watershed']).toBe(false);
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

  it('keeps part names unique (they become labels): renaming to a taken name merges', () => {
    const r = fresh();
    const s = r.edit([{ op: 'rename', id: 1, name: 'right' }]);
    expect(s.parts.map((p) => p.name)).toEqual(['right']);
    // the merged part owns both parts' pins
    expect(s.seeds.every((sd) => sd.label === 'right')).toBe(true);
    expect(s.parts[0].pins).toBeGreaterThanOrEqual(2);
  });

  it('suffixes duplicate detector names with a free number', () => {
    const r = new SegmentationRunner(groove(11));
    const s = r.detect({ algorithm: 'crease-watershed', seeds: [
      { label: 'a 2', point: [0.1, 0.5, 0.12] }, { label: 'a', point: [0.5, 0.5, 0] }, { label: 'a ', point: [0.9, 0.5, 0.12] },
    ] });
    // 'a ' trims to 'a' (same label as seed 2), so only two distinct parts
    expect(new Set(s.parts.map((p) => p.name)).size).toBe(s.parts.length);
  });

  it('rejects undo inside a multi-op batch', () => {
    const r = fresh();
    r.edit([{ op: 'rename', id: 1, name: 'x' }]);
    expect(() => r.edit([{ op: 'rename', id: 1, name: 'y' }, { op: 'undo' }])).toThrow(/on its own/);
    expect(r.edit([{ op: 'undo' }]).parts[0].name).toBe('left');
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

describe('auto-merge (auto patches)', () => {
  // Two grooves split the strip into three flat bands.
  const twoGrooves = () => heightfield(61, (x) => 0.25 * Math.min(Math.abs(x - 0.33), Math.abs(x - 0.66)));

  it('merges across faint borders but keeps real grooves', () => {
    const r = new SegmentationRunner(twoGrooves());
    const s = r.detect({ algorithm: 'auto-merge', params: { patchSizePct: 6, mergeBelowDeg: 8, minPatchPct: 0 } });
    expect(s.parts.length).toBe(3);
    expect(s.parts.every((p) => /^patch \d+$/.test(p.name))).toBe(true);
    // Coarser threshold dissolves the grooves too.
    const coarse = r.detect({ algorithm: 'auto-merge', params: { patchSizePct: 6, mergeBelowDeg: 40, minPatchPct: 0 } });
    expect(coarse.parts.length).toBe(1);
  });

  it('seedsFromParts places one seed inside each part', () => {
    const r = new SegmentationRunner(twoGrooves());
    r.detect({ algorithm: 'auto-merge', params: { patchSizePct: 6, mergeBelowDeg: 8, minPatchPct: 0 } });
    const s = r.edit([{ op: 'seedsFromParts' }]);
    expect(s.seeds.map((x) => x.label).sort()).toEqual(['patch 1', 'patch 2', 'patch 3']);
    // Re-detecting from those seeds reproduces three parts.
    const again = r.detect({ algorithm: 'crease-watershed', seeds: s.seeds });
    expect(again.parts.length).toBe(3);
  });
});

describe('planar-groups', () => {
  /** Unit cube: 8 shared vertices, 12 outward-wound triangles (2 per face). */
  const cube = (): SegMesh => {
    const positions = Float32Array.from([0,0,0, 1,0,0, 1,1,0, 0,1,0, 0,0,1, 1,0,1, 1,1,1, 0,1,1]);
    const quads = [[0,3,2,1], [4,5,6,7], [0,1,5,4], [2,3,7,6], [0,4,7,3], [1,2,6,5]];
    const tris: number[] = [];
    for (const [a, b, c, d] of quads) tris.push(a, b, c, a, c, d);
    return { positions, triVerts: Uint32Array.from(tris) };
  };
  /** Closed n-gon prism (radius 1, height 2) with fan caps: 2n wall + 2n cap triangles. */
  const prism = (n = 32): SegMesh => {
    const positions: number[] = [];
    for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n; positions.push(Math.cos(a), Math.sin(a), 0); }
    for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n; positions.push(Math.cos(a), Math.sin(a), 2); }
    positions.push(0, 0, 0, 0, 0, 2);
    const bc = 2 * n, tc = 2 * n + 1, tris: number[] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      tris.push(i, j, n + j, i, n + j, n + i); // wall, outward
      tris.push(bc, j, i); // bottom cap, faces −Z
      tris.push(tc, n + i, n + j); // top cap, faces +Z
    }
    return { positions: Float32Array.from(positions), triVerts: Uint32Array.from(tris) };
  };
  const run = (m: SegMesh, params: Record<string, unknown>, allow?: Uint8Array) => {
    const f = computeMeshFeatures(m);
    return planarGroupsDetector.run(m, f, { params: resolveParams(planarGroupsDetector, params), seeds: [], allow });
  };
  const partCount = (triPart: Int32Array) => new Set([...triPart].filter((p) => p >= 0)).size;

  it('is registered, seedless, and not an auto-propose candidate', () => {
    expect(getDetector('planar-groups')!.seeds).toBe('none');
    expect(autoProposeDetectors().map((d) => d.id)).not.toContain('planar-groups');
    expect(planarGroupsDetector.presets!.length).toBeGreaterThanOrEqual(4);
  });

  it('more separate pieces than maxParts: faces are kept, the cap is reported as ignored', () => {
    // Three cubes side by side, not touching.
    const one = cube(), positions: number[] = [], tris: number[] = [];
    for (let k = 0; k < 3; k++) {
      for (let v = 0; v < 8; v++) positions.push(one.positions[v * 3] + 3 * k, one.positions[v * 3 + 1], one.positions[v * 3 + 2]);
      for (const i of one.triVerts) tris.push(i + 8 * k);
    }
    const r = run({ positions: Float32Array.from(positions), triVerts: Uint32Array.from(tris) }, { maxParts: 2, minPartPct: 0 });
    expect(partCount(r.triPart)).toBe(18);
    expect(r.diagnostics?.maxPartsIgnored).toBeTruthy();
  });

  it('smooth mode finds the six faces of a cube', () => {
    const r = run(cube(), {});
    expect(partCount(r.triPart)).toBe(6);
    expect(r.partNames).toEqual(['face 1', 'face 2', 'face 3', 'face 4', 'face 5', 'face 6']);
    expect(r.genericNames).toBe(true);
    expect(r.diagnostics).toEqual({ rawGroups: 6, parts: 6 });
  });

  it('keeps a tessellated cylinder wall as one face; flat mode facets it', () => {
    const m = prism(32);
    expect(partCount(run(m, {}).triPart)).toBe(3); // wall + 2 caps
    // 5° < the 11.25° between neighbouring wall quads: one facet per quad.
    const flat = run(m, { surfaces: 'flat', angleDeg: 5, minPartPct: 0 });
    expect(partCount(flat.triPart)).toBe(34);
    // A looser tolerance gives coarser facets (arcs of the wall), never one smooth face.
    const arcs = partCount(run(m, { surfaces: 'flat', angleDeg: 20 }).triPart);
    expect(arcs).toBeGreaterThan(3);
    expect(arcs).toBeLessThan(34);
  });

  it('respects the allow mask', () => {
    const m = cube();
    // Allow the first three faces (triangles 0..5).
    const allow = new Uint8Array(12);
    allow.fill(1, 0, 6);
    for (const surfaces of ['smooth', 'flat']) {
      const r = run(m, { surfaces }, allow);
      expect(partCount(r.triPart)).toBe(3);
      for (let t = 0; t < 12; t++) expect(r.triPart[t] >= 0).toBe(t < 6);
    }
  });

  it('maxParts caps the part count, and numbering is by descending area', () => {
    // Terraces of unequal width, so the smallest are unambiguous to absorb.
    const m = heightfield(61, (x) => 0.2 * Math.floor(6 * x * x));
    const loose = run(m, { minPartPct: 0 });
    expect(partCount(loose.triPart)).toBeGreaterThan(5);
    const capped = run(m, { minPartPct: 0, maxParts: 4 });
    expect(partCount(capped.triPart)).toBe(4); // one connected piece: the cap is exact
    const f = computeMeshFeatures(m);
    const area = new Float64Array(8);
    for (let t = 0; t < f.triCount; t++) if (capped.triPart[t] >= 0) area[capped.triPart[t]] += f.triArea[t];
    for (let p = 1; p < partCount(capped.triPart); p++) expect(area[p]).toBeLessThanOrEqual(area[p - 1] + 1e-9);
  });

  it('caps a noisy mesh that shatters into specks', () => {
    const f0 = computeMeshFeatures(heightfield(41, () => 0));
    const noisy = jitterMesh(heightfield(41, () => 0), 0.6 * f0.medianEdgeLen, 7);
    expect(partCount(run(noisy, { minPartPct: 0, maxParts: 500 }).triPart)).toBeGreaterThan(20);
    const r = run(noisy, { maxParts: 7 });
    expect(partCount(r.triPart)).toBe(7);
    expect(r.diagnostics!.rawGroups).toBeGreaterThan(20);
  });

  it('reuses the cached grouping when only the size sliders change', () => {
    const m = prism(16), f = computeMeshFeatures(m), cache = new Map<string, unknown>();
    const go = (params: Record<string, unknown>) =>
      planarGroupsDetector.run(m, f, { params: resolveParams(planarGroupsDetector, params), seeds: [], cache });
    go({});
    expect(cache.size).toBe(1);
    go({ minPartPct: 5, maxParts: 3 });
    expect(cache.size).toBe(1);
    go({ angleDeg: 5 });
    expect(cache.size).toBe(2);
  });

  it('runs through the runner like any detector', () => {
    const r = new SegmentationRunner(cube());
    const s = r.detect({ algorithm: 'planar-groups' });
    expect(s.parts.length).toBe(6);
    expect(s.parts.every((p) => /^face \d+$/.test(p.name))).toBe(true);
  });
});

describe('locks and focus', () => {
  const seedsLR = [
    { label: 'left', point: [0.1, 0.5, 0.12] as [number, number, number] },
    { label: 'right', point: [0.9, 0.5, 0.12] as [number, number, number] },
  ];

  it('a locked part keeps its triangles through re-detection', () => {
    const r = new SegmentationRunner(groove(21));
    const s0 = r.detect({ algorithm: 'crease-watershed', seeds: seedsLR });
    const leftTris = s0.parts[0].triCount;
    r.edit([{ op: 'lock', id: 'left' }]);
    // A seed-free "everything" run would otherwise relabel all of it.
    const s1 = r.detect({ algorithm: 'crease-watershed', seeds: [{ label: 'other', point: [0.9, 0.5, 0.12] }] });
    expect(s1.parts.find((p) => p.name === 'left')!.triCount).toBe(leftTris);
    expect(s1.parts.find((p) => p.name === 'left')!.locked).toBe(true);
    expect(s1.parts.map((p) => p.name)).toContain('other');
  });

  it('focus confines detection to one part; seeds elsewhere are ignored', () => {
    const r = new SegmentationRunner(groove(21));
    r.detect({ algorithm: 'crease-watershed', seeds: seedsLR });
    const s = r.edit([{ op: 'focus', id: 'right' }]);
    expect(s.focus!.triCount).toBe(s.parts.find((p) => p.name === 'right')!.triCount);
    const out = r.detect({ algorithm: 'crease-watershed', seeds: [
      { label: 'top', point: [0.9, 0.9, 0.12] }, { label: 'bottom', point: [0.9, 0.1, 0.12] },
      { label: 'ignored', point: [0.1, 0.5, 0.12] },
    ] });
    expect(out.parts.map((p) => p.name).sort()).toEqual(['bottom', 'left', 'top']);
    expect(r.edit([{ op: 'focus', id: null }]).focus).toBeNull();
  });

  it('placeholder names from a focused run never merge into existing parts', () => {
    const r = new SegmentationRunner(groove(21));
    r.detect({ algorithm: 'auto-merge', params: { patchSizePct: 10, mergeBelowDeg: 0.5, minPatchPct: 0 } });
    const before = r.draft!.summary().parts.map((p) => p.name);
    r.edit([{ op: 'focus', id: 1 }]);
    const s = r.detect({ algorithm: 'auto-merge', params: { patchSizePct: 10, mergeBelowDeg: 0.5, minPatchPct: 0 } });
    expect(new Set(s.parts.map((p) => p.name)).size).toBe(s.parts.length);
    for (const nm of before.slice(1)) expect(s.parts.map((p) => p.name)).toContain(nm);
  });

  it('preview honours locks without touching the draft', () => {
    const r = new SegmentationRunner(groove(21));
    r.detect({ algorithm: 'crease-watershed', seeds: seedsLR });
    r.edit([{ op: 'lock', id: 'left' }]);
    const before = r.draft!.triPart.slice();
    const p = r.preview({ algorithm: 'crease-watershed', seeds: [{ label: 'x', point: [0.9, 0.5, 0.12] }] });
    expect(p.summary.parts.map((x) => x.name).sort()).toEqual(['left', 'x']);
    expect([...r.draft!.triPart]).toEqual([...before]);
  });
});

describe('reopen saved parts', () => {
  it('adopts a saved partition with names, colours and seeds', () => {
    const m = groove(11);
    const r = new SegmentationRunner(m);
    const s = r.detect({ algorithm: 'crease-watershed', seeds: [
      { label: 'a', point: [0.1, 0.5, 0.12] }, { label: 'b', point: [0.9, 0.5, 0.12] },
    ] });
    const triPart = r.draft!.triPart.slice();
    const r2 = new SegmentationRunner(m);
    const back = r2.adopt({ triPart, names: ['a', 'b'], colors: ['#ff0000', null], detectorId: 'crease-watershed', params: {}, seeds: s.seeds });
    expect(back.parts.map((p) => [p.name, p.color, p.triCount])).toEqual(s.parts.map((p, i) => [p.name, i === 0 ? '#ff0000' : null, p.triCount]));
    expect(back.seeds.length).toBe(2);
    expect(() => r2.adopt({ triPart: new Int32Array(3), names: [], colors: [] })).toThrow(/match/);
  });
});

/** Closed unit sphere: subdivided octahedron with welded vertices. */
function sphere(levels: number): SegMesh {
  let verts: number[][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  let tris: number[][] = [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]];
  for (let l = 0; l < levels; l++) {
    const mid = new Map<string, number>();
    const m = (a: number, b: number) => {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      let id = mid.get(key);
      if (id === undefined) {
        const v = verts[a].map((x, k) => (x + verts[b][k]) / 2);
        const len = Math.hypot(...v);
        id = verts.length; verts.push(v.map((x) => x / len)); mid.set(key, id);
      }
      return id;
    };
    const next: number[][] = [];
    for (const [a, b, c] of tris) {
      const ab = m(a, b), bc = m(b, c), ca = m(c, a);
      next.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
    }
    tris = next;
  }
  return { positions: Float32Array.from(verts.flat()), triVerts: Uint32Array.from(tris.flat()) };
}

function triArea(p: ArrayLike<number>, a: number, b: number, c: number, stride = 3): number {
  const ux = p[b * stride] - p[a * stride], uy = p[b * stride + 1] - p[a * stride + 1], uz = p[b * stride + 2] - p[a * stride + 2];
  const wx = p[c * stride] - p[a * stride], wy = p[c * stride + 1] - p[a * stride + 1], wz = p[c * stride + 2] - p[a * stride + 2];
  return Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) / 2;
}

describe('smooth edges (edge cut)', () => {
  // Three parts on a sphere: two hemispheres, one split again by x — gives
  // two-part splits and triple junctions.
  const m = sphere(4);
  const nTri = m.triVerts.length / 3;
  const triPart = new Int32Array(nTri);
  for (let t = 0; t < nTri; t++) {
    let cx = 0, cz = 0;
    for (let k = 0; k < 3; k++) { cx += m.positions[m.triVerts[t * 3 + k] * 3]; cz += m.positions[m.triVerts[t * 3 + k] * 3 + 2]; }
    triPart[t] = cz > 0.1 ? (cx > 0 ? 0 : 1) : 2;
  }

  it('re-meshes into a watertight, consistently wound mesh that keeps the area', async () => {
    const { computeEdgeCut, buildCutMesh } = await import('../../src/segmentation/smoothEdges');
    const cut = computeEdgeCut(m, triPart, 3);
    expect(cut.splitTris.length).toBeGreaterThan(0);
    const out = buildCutMesh({ vertProperties: m.positions, triVerts: m.triVerts, numProp: 3 }, cut, ['a', 'b', 'c'], ['#f00', null, '#00f']);
    expect(out.names).toEqual(['a', 'b', 'c']);
    expect(out.colors).toEqual(['#f00', null, '#00f']);
    // Every directed edge appears once and its reverse once.
    const directed = new Map<string, number>();
    for (let t = 0; t < out.numTri; t++) for (let k = 0; k < 3; k++) {
      const a = out.triVerts[t * 3 + k], b = out.triVerts[t * 3 + (k + 1) % 3];
      const key = `${a},${b}`;
      directed.set(key, (directed.get(key) ?? 0) + 1);
    }
    for (const [key, n] of directed) {
      expect(n).toBe(1);
      const [a, b] = key.split(',');
      expect(directed.get(`${b},${a}`)).toBe(1);
    }
    let before = 0, after = 0, minArea = Infinity;
    for (let t = 0; t < nTri; t++) before += triArea(m.positions, m.triVerts[t * 3], m.triVerts[t * 3 + 1], m.triVerts[t * 3 + 2]);
    for (let t = 0; t < out.numTri; t++) {
      const a = triArea(out.vertProperties, out.triVerts[t * 3], out.triVerts[t * 3 + 1], out.triVerts[t * 3 + 2]);
      after += a; minArea = Math.min(minArea, a);
    }
    expect(after).toBeCloseTo(before, 5);
    expect(minArea).toBeGreaterThan(0);
    expect([...new Set(out.triPart)].sort()).toEqual([0, 1, 2]);
  });

  it('smooths stair-steps and leaves triangles away from boundaries alone', async () => {
    const { computeEdgeCut } = await import('../../src/segmentation/smoothEdges');
    // Flat grid with a jagged vertical boundary near x = 0.5 (rows alternate).
    const g = heightfield(41, () => 0);
    const n = g.triVerts.length / 3;
    const jag = new Int32Array(n);
    for (let t = 0; t < n; t++) {
      const row = Math.floor(t / 80);
      jag[t] = centroidX(g, t) > 0.5 + (row % 2 ? 0.05 : -0.05) ? 1 : 0;
    }
    const crossingSpread = (iters: number) => {
      const cut = computeEdgeCut(g, jag, iters);
      // x of each crossing point on the boundary.
      const xs: number[] = [];
      for (let id = 0; id < cut.pointKind.length; id++) {
        if (cut.pointKind[id] !== 1) continue;
        const a = cut.pointA[id], b = cut.pointB[id], tt = cut.pointT[id];
        xs.push(g.positions[a * 3] * (1 - tt) + g.positions[b * 3] * tt);
      }
      const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
      return Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
    };
    expect(crossingSpread(6)).toBeLessThan(crossingSpread(0) * 0.6);
    // Interior triangles far from the boundary are never split.
    const cut = computeEdgeCut(g, jag, 3);
    for (let t = 0; t < n; t++) if (Math.abs(centroidX(g, t) - 0.5) > 0.3) expect(cut.triLabel[t]).toBe(jag[t]);
  });
});

describe('re-detection and conversion', () => {
  const seedsLR = [
    { label: 'left', point: [0.1, 0.5, 0.12] as [number, number, number] },
    { label: 'right', point: [0.9, 0.5, 0.12] as [number, number, number] },
  ];

  it('a second detection is undoable and keeps colours by name', () => {
    const r = new SegmentationRunner(groove(21));
    r.detect({ algorithm: 'crease-watershed', seeds: seedsLR });
    r.edit([{ op: 'setColor', id: 'left', color: '#ff0000' }]);
    const s1 = r.detect({ algorithm: 'pieces' });
    expect(s1.detectorId).toBe('pieces');
    expect(s1.canUndo).toBe(true);
    const s2 = r.edit([{ op: 'undo' }]);
    expect(s2.detectorId).toBe('crease-watershed');
    expect(s2.parts.map((p) => [p.name, p.color])).toEqual([['left', '#ff0000'], ['right', null]]);
  });

  it('seedsFromParts turns a seedless draft into a seeded one', () => {
    const r = new SegmentationRunner(groove(21));
    r.detect({ algorithm: 'auto-merge', params: { mergeBelowDeg: 30 } });
    const s = r.edit([{ op: 'seedsFromParts' }]);
    expect(s.detectorId).toBe('crease-watershed');
    expect(s.seeds.length).toBeGreaterThanOrEqual(s.parts.length);
    // Re-running from the generated seeds reproduces the parts.
    const again = r.edit([{ op: 'rerun' }]);
    expect(again.parts.map((p) => p.name).sort()).toEqual(s.parts.map((p) => p.name).sort());
  });

  it('reports groove coverage and fidelity', () => {
    const r = new SegmentationRunner(groove(21));
    const q = r.detect({ algorithm: 'crease-watershed', seeds: seedsLR }).quality;
    // The only strong groove is the valley and the boundary sits on it.
    expect(q.grooveCoverage).toBeGreaterThan(0.9);
    expect(q.grooveFidelity).toBeGreaterThan(0.9);
  });
});

describe('smooth edges keep crease boundaries', () => {
  // Folded grid: floor (z=0) and wall (x=1) meeting at a 90° fold (a ridge),
  // split exactly along it — smoothing must not pull the boundary off it.
  function folded(N: number): { mesh: SegMesh; part: Int32Array } {
    const pos: number[] = [], tris: number[] = [], part: number[] = [];
    const idx = new Map<string, number>();
    const v = (x: number, y: number, z: number) => {
      const k = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
      let i = idx.get(k);
      if (i === undefined) { i = pos.length / 3; pos.push(x, y, z); idx.set(k, i); }
      return i;
    };
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const a = v(i / N, j / N, 0), b = v((i + 1) / N, j / N, 0), c = v((i + 1) / N, (j + 1) / N, 0), d = v(i / N, (j + 1) / N, 0);
      tris.push(a, b, c, a, c, d); part.push(0, 0);
    }
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const a = v(1, j / N, i / N), b = v(1, (j + 1) / N, i / N), c = v(1, (j + 1) / N, (i + 1) / N), d = v(1, j / N, (i + 1) / N);
      tris.push(a, b, c, a, c, d); part.push(1, 1);
    }
    return { mesh: { positions: Float32Array.from(pos), triVerts: Uint32Array.from(tris) }, part: Int32Array.from(part) };
  }

  it('leaves a boundary that sits on a strong crease untouched', async () => {
    const { computeEdgeCut } = await import('../../src/segmentation/smoothEdges');
    const { mesh, part } = folded(8);
    const f = computeMeshFeatures(mesh);
    for (const it of [0, 3, 8]) {
      const cut = computeEdgeCut(mesh, part, it, { adjacency: f, pinCreaseDeg: 60 }); // the default
      expect(cut.splitTris.length).toBe(0);
      expect([...cut.triLabel]).toEqual([...part]);
    }
    // Without the crease information the same boundary would be cut.
    expect(computeEdgeCut(mesh, part, 3).splitTris.length).toBeGreaterThan(0);
  });

  it('runner cut pins a seeded boundary that settled on a groove', () => {
    const r = new SegmentationRunner(groove(21));
    const s = r.detect({ algorithm: 'crease-watershed', seeds: [
      { label: 'left', point: [0.1, 0.5, 0.12] }, { label: 'right', point: [0.9, 0.5, 0.12] },
    ] });
    expect(s.quality.boundaryCreaseMean).toBeGreaterThan(20);
    expect(r.cut(3, 15)!.splitTris.length).toBe(0);
    expect(r.cut(3, 0)!.splitTris.length).toBeGreaterThan(0); // pinning off
  });
});

describe('parts own pins', () => {
  const seedsLR = [
    { label: 'left', point: [0.1, 0.5, 0.12] as [number, number, number] },
    { label: 'right', point: [0.9, 0.5, 0.12] as [number, number, number] },
  ];

  it('every part gets an automatic pin, and renaming carries pins along', () => {
    const r = new SegmentationRunner(groove(21));
    const s = r.detect({ algorithm: 'auto-merge', params: { mergeBelowDeg: 30 } });
    expect(s.parts.every((p) => p.pins >= 1)).toBe(true);
    expect(s.seeds.every((sd) => sd.auto)).toBe(true);
    const renamed = r.edit([{ op: 'rename', id: 1, name: 'body' }]);
    expect(renamed.seeds.some((sd) => sd.label === 'body')).toBe(true);
    expect(renamed.seeds.some((sd) => sd.label === s.parts[0].name)).toBe(false);
  });

  it('a new pin grows a new part locally; moving a pin re-grows only nearby', () => {
    // Three columns of parts: a, b, c (grooves at x = 1/3 and 2/3).
    const m = heightfield(31, (x) => 0.2 * Math.min(Math.abs(x - 1 / 3), Math.abs(x - 2 / 3)));
    const r = new SegmentationRunner(m);
    r.detect({ algorithm: 'crease-watershed', seeds: [
      { label: 'a', point: [0.1, 0.5, 0.05] }, { label: 'b', point: [0.5, 0.5, 0.03] }, { label: 'c', point: [0.9, 0.5, 0.05] },
    ] });
    const before = r.draft!.triPart.slice();
    // Split part c with a new pin near its top edge.
    const s = r.edit([{ op: 'addSeed', seed: { label: 'cap', point: [0.9, 0.95, 0.05] } }]);
    expect(s.parts.map((p) => p.name)).toContain('cap');
    const aIdx = s.parts.findIndex((p) => p.name === 'a');
    // Part a is not a neighbour of c: untouched.
    for (let t = 0; t < before.length; t++) if (before[t] === 0) expect(r.draft!.triPart[t]).toBe(aIdx);
    // Removing the pin dissolves the new part back into its neighbour.
    const pinIdx = s.seeds.findIndex((sd) => sd.label === 'cap');
    const back = r.edit([{ op: 'removeSeed', index: pinIdx }]);
    expect(back.parts.map((p) => p.name)).not.toContain('cap');
  });

  it('hand fixes are fixed regions a re-grow keeps', () => {
    const r = new SegmentationRunner(groove(21));
    r.detect({ algorithm: 'crease-watershed', seeds: seedsLR });
    // Paint a blob of the left side into "right", then move the right pin.
    r.edit([{ op: 'reassign', point: [0.2, 0.5, 0.09], to: 'right', radius: 0.08 }]);
    const fixed = [...r.draft!.triPart].filter((L) => L === 1).length;
    const pin = r.draft!.seeds.findIndex((sd) => sd.label === 'right');
    const s = r.edit([{ op: 'moveSeed', index: pin, point: [0.85, 0.4, 0.105] }]);
    expect(s.parts.find((p) => p.name === 'right')!.triCount).toBe(fixed);
  });

  it('reorder moves a part and keeps every triangle with its part', () => {
    const r = new SegmentationRunner(groove(21));
    r.detect({ algorithm: 'crease-watershed', seeds: seedsLR });
    const leftTris = r.draft!.summary().parts[0].triCount;
    const s = r.edit([{ op: 'reorder', id: 'left', position: 2 }]);
    expect(s.parts.map((p) => p.name)).toEqual(['right', 'left']);
    expect(s.parts[1].triCount).toBe(leftTris);
  });

  it('clear empties the draft (undoable)', () => {
    const r = new SegmentationRunner(groove(21));
    r.detect({ algorithm: 'crease-watershed', seeds: seedsLR });
    const s = r.edit([{ op: 'clear' }]);
    expect(s.parts).toEqual([]);
    expect(s.seeds).toEqual([]);
    expect(r.edit([{ op: 'undo' }]).parts.length).toBe(2);
  });

  it('neighbouring parts never get clashing colours', () => {
    // 36 parts from a 6×6 grid of seeds on a flat sheet.
    const r = new SegmentationRunner(heightfield(49, () => 0));
    const seeds = [];
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) seeds.push({ label: `p${i}-${j}`, point: [(i + 0.5) / 6, (j + 0.5) / 6, 0] as [number, number, number] });
    const s = r.detect({ algorithm: 'crease-watershed', seeds });
    expect(s.parts.length).toBe(36);
    for (const p of s.parts) for (const n of p.neighbors) {
      expect(p.displayColor).not.toBe(s.parts[n - 1].displayColor);
    }
    // Colours are stable across an unrelated edit.
    const again = r.edit([{ op: 'setColor', id: 1, color: '#123456' }]);
    expect(again.parts.slice(1).map((p) => p.displayColor)).toEqual(s.parts.slice(1).map((p) => p.displayColor));
  });
});

describe('pin edge cases (review round)', () => {
  const seedsLR = [
    { label: 'left', point: [0.1, 0.5, 0.12] as [number, number, number] },
    { label: 'right', point: [0.9, 0.5, 0.12] as [number, number, number] },
  ];
  const fresh = () => {
    const r = new SegmentationRunner(groove(21));
    r.detect({ algorithm: 'crease-watershed', seeds: seedsLR });
    return r;
  };

  it('re-detecting under a lock does not duplicate pins', () => {
    const r = fresh();
    r.edit([{ op: 'lock', id: 'left' }]);
    const a = r.edit([{ op: 'rerun' }]);
    expect(a.seeds.length).toBe(2);
    // The panel passes the full pin list back in.
    const b = r.detect({ algorithm: 'crease-watershed', seeds: a.seeds });
    expect(b.seeds.length).toBe(2);
  });

  it('a part whose pin sits in its own fixed region keeps its unfixed rest', () => {
    const r = fresh();
    const before = r.draft!.summary().parts.find((p) => p.name === 'right')!.triCount;
    // Hand-fix a blob around the right pin (a fix of right into right).
    r.edit([{ op: 'reassign', point: [0.9, 0.5, 0.12], to: 'right', radius: 0.12 }]);
    const left = r.draft!.seeds.findIndex((sd) => sd.label === 'left');
    const s = r.edit([{ op: 'moveSeed', index: left, point: [0.15, 0.45, 0.105] }]);
    expect(s.parts.find((p) => p.name === 'right')!.triCount).toBeGreaterThan(before * 0.9);
  });

  it('a pin on unassigned triangles grows a real part (after clear / delete)', () => {
    const r = fresh();
    r.edit([{ op: 'clear' }]);
    const s = r.edit([{ op: 'addSeed', seed: { label: 'all', point: [0.5, 0.5, 0] } }]);
    expect(s.parts.map((p) => [p.name, p.triCount > 0])).toEqual([['all', true]]);
    const r2 = fresh();
    r2.edit([{ op: 'delete', id: 'right' }]);
    const s2 = r2.edit([{ op: 'addSeed', seed: { label: 'again', point: [0.9, 0.5, 0.12] } }]);
    expect(s2.parts.find((p) => p.name === 'again')!.triCount).toBeGreaterThan(0);
  });

  it('a pin on a locked part is refused with a clear error', () => {
    const r = fresh();
    r.edit([{ op: 'lock', id: 'right' }]);
    expect(() => r.edit([{ op: 'addSeed', seed: { label: 'new', point: [0.9, 0.5, 0.12] } }])).toThrow(/locked part "right"/);
  });

  it('addSeed with rerun:false keeps the pin (and its new part) for a later re-grow', () => {
    const r = fresh();
    const s = r.edit([{ op: 'addSeed', seed: { label: 'later', point: [0.9, 0.9, 0.12] }, rerun: false }]);
    expect(s.seeds.some((sd) => sd.label === 'later')).toBe(true);
    const after = r.edit([{ op: 'rerun' }]);
    expect(after.parts.find((p) => p.name === 'later')!.triCount).toBeGreaterThan(0);
  });

  it('edits sharing a stroke id are one undo step', () => {
    const r = fresh();
    const base = r.draft!.triPart.slice();
    r.edit([{ op: 'reassign', point: [0.2, 0.3, 0.09], to: 'right', radius: 0.05 }], 'stroke-1');
    r.edit([{ op: 'reassign', point: [0.2, 0.7, 0.09], to: 'right', radius: 0.05 }], 'stroke-1');
    r.edit([{ op: 'undo' }]);
    expect([...r.draft!.triPart]).toEqual([...base]);
  });
});

describe('thickness', () => {
  /** Watertight, position-welded surface of revolution about the X axis:
   *  `profile` is a polyline of (x, radius) from one pole (radius 0) to the
   *  other. Smooth radial normals, unlike a voxel staircase, so a ray along
   *  −normal always crosses the axis (the geometry thickness measures). */
  function lathe(profile: [number, number][], M = 28): SegMesh {
    const pos: number[] = [];
    const ring: number[][] = profile.map(([x, r]) => {
      if (r === 0) { pos.push(x, 0, 0); return [pos.length / 3 - 1]; }
      const ids: number[] = [];
      for (let m = 0; m < M; m++) {
        const a = (2 * Math.PI * m) / M;
        pos.push(x, r * Math.cos(a), r * Math.sin(a));
        ids.push(pos.length / 3 - 1);
      }
      return ids;
    });
    const tris: number[] = [];
    for (let i = 0; i + 1 < profile.length; i++) {
      for (let m = 0; m < M; m++) {
        const m1 = (m + 1) % M;
        const a = ring[i], b = ring[i + 1];
        if (a.length === 1) tris.push(a[0], b[m], b[m1]);
        else if (b.length === 1) tris.push(a[m], b[0], a[m1]);
        else tris.push(a[m], b[m], b[m1], a[m], b[m1], a[m1]);
      }
    }
    // Orient outward (signed volume must be positive).
    let vol = 0;
    for (let q = 0; q < tris.length; q += 3) {
      const [a, b, c] = [tris[q] * 3, tris[q + 1] * 3, tris[q + 2] * 3];
      vol += pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1])
        - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c])
        + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c]);
    }
    if (vol < 0) for (let q = 0; q < tris.length; q += 3) { const s = tris[q + 1]; tris[q + 1] = tris[q + 2]; tris[q + 2] = s; }
    return { positions: Float32Array.from(pos), triVerts: Uint32Array.from(tris) };
  }

  // A ball (radius 9, thickness ~18) centred at x = 9, with a stepped-down
  // arm (radius 2.5, thickness ~5) running from x = 16 to x = 40.
  const BALL = 9, JUNCTION = 16, ARM_END = 40;
  const dumbbell = () => {
    const profile: [number, number][] = [[0, 0]];
    for (let x = 0.5; x <= JUNCTION + 1e-9; x += 0.5) profile.push([x, Math.sqrt(BALL * BALL - (x - BALL) ** 2)]);
    profile.push([JUNCTION, 2.5]);
    for (let x = JUNCTION + 4; x <= ARM_END - 1e-9; x += 4) profile.push([x, 2.5]);
    profile.push([ARM_END, 2.5], [ARM_END, 0]);
    return lathe(profile);
  };
  const detector = getDetector('thickness')!;
  type Seed = { label: string; point: [number, number, number] };
  const run = (m: SegMesh, over: Record<string, number>, extra: { seeds?: Seed[]; allow?: Uint8Array } = {}) => {
    const f = computeMeshFeatures(m);
    const params = resolveParams(detector, { resolution: 120, minPartPct: 0, ...over });
    return { f, out: detector.run(m, f, { params, seeds: extra.seeds ?? [], allow: extra.allow, cache: new Map() }) };
  };

  it('is registered, seed-optional, and not an auto-proposal', () => {
    expect(detector.seeds).toBe('optional');
    expect(autoProposeDetectors().map((d) => d.id)).not.toContain('thickness');
  });

  it('unseeded: the thin arm lands in a different part from the thick body', () => {
    const m = dumbbell();
    const { f, out } = run(m, { levels: 2 });
    const armTris: number[] = [], bodyTris: number[] = [];
    for (let t = 0; t < f.triCount; t++) (centroidX(m, t) > JUNCTION + 4 ? armTris : centroidX(m, t) < BALL + 2 ? bodyTris : []).push(t);
    // Dominant part of each side, by area.
    const dominant = (tris: number[]) => {
      const a = new Map<number, number>();
      for (const t of tris) a.set(out.triPart[t], (a.get(out.triPart[t]) ?? 0) + f.triArea[t]);
      const [part, area] = [...a.entries()].sort((x, y) => y[1] - x[1])[0];
      return { part, frac: area / tris.reduce((s, t) => s + f.triArea[t], 0) };
    };
    const arm = dominant(armTris), body = dominant(bodyTris);
    expect(arm.part).not.toBe(body.part);
    expect(arm.frac).toBeGreaterThan(0.85);
    expect(body.frac).toBeGreaterThan(0.85);
    expect(out.partNames![arm.part]).toMatch(/^thin /);
    expect(out.partNames![body.part]).toMatch(/^thick /);
  });

  it('automatic pins from a previous unseeded run do not switch to seeded mode', () => {
    const m = dumbbell();
    // The draft pins every part (auto: true); re-runs pass those pins back.
    const autoPins = [
      { label: 'thick 1', point: [BALL, BALL, 0] as [number, number, number], auto: true },
      { label: 'thin 1', point: [ARM_END - 2, 2.5, 0] as [number, number, number], auto: true },
    ];
    const f = computeMeshFeatures(m);
    const go = (levels: number) => detector.run(m, f, { params: resolveParams(detector, { resolution: 120, minPartPct: 0, levels }), seeds: autoPins, cache: new Map() });
    const two = go(2), three = go(3);
    // Unseeded names (not the pin labels), and `levels` still changes the result.
    expect(two.partNames!.every((n) => /^(thin|thick|medium) /.test(n!))).toBe(true);
    expect(three.partNames).not.toEqual(two.partNames);
  });

  it('seeded: the boundary lands near the junction', () => {
    const m = dumbbell();
    const seeds: Seed[] = [
      { label: 'body', point: [BALL, BALL, 0] },
      { label: 'arm', point: [ARM_END - 2, 2.5, 0] },
    ];
    const { f, out } = run(m, {}, { seeds });
    expect(out.partNames).toEqual(['body', 'arm']);
    // Arm-side surface triangles reach back to (about) the junction, not far into the body.
    let armMinX = Infinity, armTri = 0;
    for (let t = 0; t < f.triCount; t++) {
      if (out.triPart[t] !== 1) continue;
      armTri++;
      armMinX = Math.min(armMinX, centroidX(m, t));
    }
    expect(armTri).toBeGreaterThan(0);
    expect(armMinX).toBeGreaterThan(JUNCTION - 4);
    expect(armMinX).toBeLessThan(JUNCTION + 4);
    // The far end of the arm and the body's far side are on the right labels.
    const labelAt = (x: number, y: number, z: number) => {
      let best = -1, bd = Infinity;
      for (let t = 0; t < f.triCount; t++) {
        const d = (f.triCentroid[t * 3] - x) ** 2 + (f.triCentroid[t * 3 + 1] - y) ** 2 + (f.triCentroid[t * 3 + 2] - z) ** 2;
        if (d < bd) { bd = d; best = t; }
      }
      return out.triPart[best];
    };
    expect(labelAt(ARM_END, 0.5, 0)).toBe(1);
    expect(labelAt(0, 0.5, 0)).toBe(0);
  });

  it('respects the allow mask in both modes', () => {
    const m = dumbbell();
    const f0 = computeMeshFeatures(m);
    const allow = new Uint8Array(f0.triCount);
    for (let t = 0; t < f0.triCount; t++) allow[t] = centroidX(m, t) > BALL ? 1 : 0; // arm + the ball's far half
    const unseeded = run(m, { levels: 2 }, { allow }).out;
    for (let t = 0; t < f0.triCount; t++) expect(allow[t] ? unseeded.triPart[t] >= 0 : unseeded.triPart[t] === -1).toBe(true);
    const seeds: Seed[] = [
      { label: 'arm', point: [ARM_END - 2, 2.5, 0] },
      { label: 'ignored', point: [BALL - 4, 8, 0] }, // outside the allowed area → dropped
    ];
    const seeded = run(m, {}, { allow, seeds }).out;
    expect(seeded.partNames).toEqual(['arm']);
    for (let t = 0; t < f0.triCount; t++) if (!allow[t]) expect(seeded.triPart[t]).toBe(-1);
  });

  it('caches the expensive stage: a slider change does not re-voxelize', () => {
    const m = dumbbell();
    const f = computeMeshFeatures(m);
    const cache = new Map<string, unknown>();
    const go = (over: Record<string, number>) => detector.run(m, f, { params: resolveParams(detector, { resolution: 96, ...over }), seeds: [], cache });
    go({ levels: 2 });
    expect(cache.size).toBe(1);
    go({ levels: 3, smoothing: 8 });
    expect(cache.size).toBe(1);
    go({ resolution: 112 });
    expect(cache.size).toBe(2);
  });

  it('refuses a mesh that is not a closed solid with a clear error', () => {
    // A single open triangle voxelizes to nothing.
    const open: SegMesh = { positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]), triVerts: Uint32Array.from([0, 1, 2]) };
    const f = computeMeshFeatures(open);
    expect(() => detector.run(open, f, { params: resolveParams(detector, {}), seeds: [] })).toThrow(/watertight/);
  });
});
