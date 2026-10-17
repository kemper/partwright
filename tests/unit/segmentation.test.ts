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

  it('keeps part names unique (they become labels)', () => {
    const r = fresh();
    expect(() => r.edit([{ op: 'rename', id: 1, name: 'right' }])).toThrow(/already named "right".*merge/);
    // merge may reuse a merged part's own name
    const s = r.edit([{ op: 'merge', ids: ['left', 'right'], name: 'right' }]);
    expect(s.parts.map((p) => p.name)).toEqual(['right']);
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
