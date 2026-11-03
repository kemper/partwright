import { describe, expect, it } from 'vitest';
import { applyPartOps, PartOpError, type PartOp, type PartOpsMesh, type Vec3 } from '../../src/geometry/partOps';

// Outward-facing, counter-clockwise triangles of a box whose corner v has
// bit0 = x, bit1 = y, bit2 = z.
const BOX_TRIS: number[][] = [
  [0, 2, 3], [0, 3, 1], [4, 5, 7], [4, 7, 6], [0, 1, 5], [0, 5, 4],
  [2, 6, 7], [2, 7, 3], [0, 4, 6], [0, 6, 2], [1, 3, 7], [1, 7, 5],
];

interface BoxSpec { id: number; min: Vec3; max: Vec3 }

/** Several separate boxes in one mesh (one run per box, own vertices). */
function boxes(specs: BoxSpec[], numProp = 3): PartOpsMesh {
  const vp: number[] = [];
  const tv: number[] = [];
  const runIndex = [0];
  specs.forEach((s, i) => {
    for (let v = 0; v < 8; v++) {
      vp.push(v & 1 ? s.max[0] : s.min[0], v & 2 ? s.max[1] : s.min[1], v & 4 ? s.max[2] : s.min[2]);
      for (let k = 3; k < numProp; k++) vp.push(100 + k); // extra props ride along
    }
    for (const t of BOX_TRIS) tv.push(t[0] + i * 8, t[1] + i * 8, t[2] + i * 8);
    runIndex.push(tv.length);
  });
  return {
    numProp,
    vertProperties: Float32Array.from(vp),
    triVerts: Uint32Array.from(tv),
    runIndex: Uint32Array.from(runIndex),
    runOriginalID: Uint32Array.from(specs.map(s => s.id)),
  };
}

function bbox(m: PartOpsMesh, ids?: number[]): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const np = m.numProp;
  const runs = m.runIndex!;
  for (let r = 0; r < m.runOriginalID!.length; r++) {
    if (ids && !ids.includes(m.runOriginalID![r])) continue;
    for (let i = runs[r]; i < runs[r + 1]; i++) {
      for (let k = 0; k < 3; k++) {
        const x = m.vertProperties[m.triVerts[i] * np + k];
        min[k] = Math.min(min[k], x); max[k] = Math.max(max[k], x);
      }
    }
  }
  return { min, max };
}

/** Signed volume of a run (positive = outward-facing). */
function volume(m: PartOpsMesh, id: number): number {
  const np = m.numProp;
  const r = [...m.runOriginalID!].indexOf(id);
  let v = 0;
  for (let i = m.runIndex![r]; i < m.runIndex![r + 1]; i += 3) {
    const p = [0, 1, 2].map(k => [0, 1, 2].map(a => m.vertProperties[m.triVerts[i + k] * np + a]));
    v += (p[0][0] * (p[1][1] * p[2][2] - p[1][2] * p[2][1])
      - p[0][1] * (p[1][0] * p[2][2] - p[1][2] * p[2][0])
      + p[0][2] * (p[1][0] * p[2][1] - p[1][1] * p[2][0])) / 6;
  }
  return v;
}

const reserve = (start: number) => { let next = start; return (n: number) => { const a = next; next += n; return a; }; };
const run = (m: PartOpsMesh, labels: [number, string][], ops: PartOp[], first = 100) =>
  applyPartOps(m, new Map(labels), ops, reserve(first));
const near = (a: Vec3, b: Vec3) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], 3));

const SCENE = (): PartOpsMesh => boxes([
  { id: 1, min: [0, 0, 0], max: [10, 10, 10] },
  { id: 2, min: [20, 0, 0], max: [24, 6, 2] },
  { id: 3, min: [40, 0, 0], max: [42, 2, 2] },
]);
const LABELS: [number, string][] = [[1, 'body'], [2, 'bolt'], [3, 'nut']];

describe('applyPartOps', () => {
  it('returns an equivalent copy for no ops and never mutates inputs', () => {
    const m = SCENE();
    const before = m.vertProperties.slice();
    const out = run(m, LABELS, []);
    expect(out.mesh.vertProperties).toEqual(m.vertProperties);
    expect(out.mesh.vertProperties).not.toBe(m.vertProperties);
    expect(out.mesh.triVerts).toEqual(m.triVerts);
    expect(out.mesh.mergeFromVert.length).toBe(0);
    run(m, LABELS, [{ kind: 'move', part: 'bolt', offset: [5, 5, 5] }]);
    expect(m.vertProperties).toEqual(before);
  });

  it('moves only the named part', () => {
    const out = run(SCENE(), LABELS, [{ kind: 'move', part: 'bolt', offset: [0, 10, 3] }]);
    near(bbox(out.mesh, [2]).min, [20, 10, 3]);
    near(bbox(out.mesh, [2]).max, [24, 16, 5]);
    expect(bbox(out.mesh, [1]).max).toEqual([10, 10, 10]);
  });

  it('rotates 90 degrees about z around the bbox centre (size swaps, centre fixed)', () => {
    const out = run(SCENE(), LABELS, [{ kind: 'rotate', part: 'bolt', degrees: [0, 0, 90] }]);
    const b = bbox(out.mesh, [2]);
    near([b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]], [6, 4, 2]);
    near([(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2], [22, 3, 1]);
    expect(volume(out.mesh, 2)).toBeCloseTo(48, 3);
  });

  it('applies rotation x first, then y, then z', () => {
    // A bar along x. Ry(90) turns its long axis onto z; the Rz(90) that follows leaves z alone.
    const m = boxes([{ id: 1, min: [-5, -1, -1], max: [5, 1, 1] }]);
    const out = run(m, [[1, 'bar']], [{ kind: 'rotate', part: 'bar', degrees: [0, 90, 90] }]);
    const b = bbox(out.mesh);
    near([b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]], [2, 2, 10]);
    // Rx(90) then Rz(90) on a bar along y: Rx sends y -> z, Rz leaves it vertical.
    const bar = boxes([{ id: 1, min: [-1, -5, -1], max: [1, 5, 1] }]);
    const out2 = run(bar, [[1, 'bar']], [{ kind: 'rotate', part: 'bar', degrees: [90, 0, 90] }]);
    const b2 = bbox(out2.mesh);
    near([b2.max[0] - b2.min[0], b2.max[1] - b2.min[1], b2.max[2] - b2.min[2]], [2, 2, 10]);
    // Order matters: z before x would leave it horizontal; here x is first so the bar stands up.
  });

  it('scales about (centre x, centre y, min z): the part stays on the plate', () => {
    const out = run(SCENE(), LABELS, [{ kind: 'scale', part: 'bolt', factor: [2, 2, 3] }]);
    const b = bbox(out.mesh, [2]);
    near(b.min, [18, -3, 0]);
    near(b.max, [26, 9, 6]);
    expect(() => run(SCENE(), LABELS, [{ kind: 'scale', part: 'bolt', factor: [1, 0, 1] }])).toThrow(PartOpError);
  });

  it('mirrors about the bbox centre and keeps the solid outward-facing', () => {
    const before = volume(SCENE(), 2);
    const out = run(SCENE(), LABELS, [{ kind: 'mirror', part: 'bolt', axis: 'x' }]);
    near(bbox(out.mesh, [2]).min, [20, 0, 0]);
    expect(volume(out.mesh, 2)).toBeCloseTo(before, 3);
    expect(volume(out.mesh, 2)).toBeGreaterThan(0);
  });

  it('mirror flips an asymmetric part', () => {
    // Make vertex 0 of a box stick out in x so the flip is visible.
    const m = boxes([{ id: 1, min: [0, 0, 0], max: [2, 2, 2] }]);
    m.vertProperties[0] = -3;
    const out = run(m, [[1, 'a']], [{ kind: 'mirror', part: 'a', axis: 'x' }]);
    // bbox x was [-3, 2] (centre -0.5): the long side moves to the other end.
    near(bbox(out.mesh).min, [-3, 0, 0]);
    expect(out.mesh.vertProperties[0]).toBeCloseTo(2, 5);
    expect(volume(out.mesh, 1)).toBeGreaterThan(0);
  });

  it('copies a part under a new id and label, shifted', () => {
    const m = SCENE();
    const out = run(m, LABELS, [{ kind: 'copy', part: 'bolt', as: 'bolt2', offset: [0, 20, 0] }], 50);
    expect(out.labels.get(50)).toBe('bolt2');
    expect(out.labels.get(2)).toBe('bolt');
    expect([...out.mesh.runOriginalID]).toEqual([1, 2, 3, 50]);
    near(bbox(out.mesh, [50]).min, [20, 20, 0]);
    near(bbox(out.mesh, [2]).min, [20, 0, 0]);
    expect(out.mesh.triVerts.length).toBe(m.triVerts.length + 36);
    expect(volume(out.mesh, 50)).toBeCloseTo(48, 3);
    // the copy is its own part, so it can be edited afterwards
    const again = run(m, LABELS, [
      { kind: 'copy', part: 'bolt', as: 'bolt2', offset: [0, 20, 0] },
      { kind: 'move', part: 'bolt2', offset: [0, 0, 7] },
    ], 50);
    near(bbox(again.mesh, [50]).min, [20, 20, 7]);
    near(bbox(again.mesh, [2]).min, [20, 0, 0]);
  });

  it('copies a part as it is at that point in the op list', () => {
    const out = run(SCENE(), LABELS, [
      { kind: 'move', part: 'bolt', offset: [0, 0, 5] },
      { kind: 'copy', part: 'bolt', as: 'b2', offset: [10, 0, 0] },
    ], 60);
    near(bbox(out.mesh, [60]).min, [30, 0, 5]);
  });

  it('copies merge pairs among the part', () => {
    const m = boxes([{ id: 1, min: [0, 0, 0], max: [1, 1, 1] }]);
    m.mergeFromVert = Uint32Array.of(1);
    m.mergeToVert = Uint32Array.of(0);
    const out = run(m, [[1, 'a']], [{ kind: 'copy', part: 'a', as: 'b', offset: [5, 0, 0] }]);
    expect([...out.mesh.mergeFromVert]).toEqual([1, 9]);
    expect([...out.mesh.mergeToVert]).toEqual([0, 8]);
  });

  it('groups parts so one move shifts them all', () => {
    const out = run(SCENE(), LABELS, [
      { kind: 'group', parts: ['bolt', 'nut'], as: 'hardware' },
      { kind: 'move', part: 'hardware', offset: [0, 0, 9] },
    ]);
    expect(out.labels.get(2)).toBe('hardware');
    expect(out.labels.get(3)).toBe('hardware');
    near(bbox(out.mesh, [2]).min, [20, 0, 9]);
    near(bbox(out.mesh, [3]).min, [40, 0, 9]);
    expect(bbox(out.mesh, [1]).min[2]).toBe(0);
    // the old names are gone
    expect(() => run(SCENE(), LABELS, [
      { kind: 'group', parts: ['bolt', 'nut'], as: 'hardware' },
      { kind: 'move', part: 'bolt', offset: [1, 0, 0] },
    ])).toThrow(/No part named "bolt"/);
  });

  it('group needs two existing parts and a free name', () => {
    expect(() => run(SCENE(), LABELS, [{ kind: 'group', parts: ['bolt'], as: 'x' }])).toThrow(PartOpError);
    expect(() => run(SCENE(), LABELS, [{ kind: 'group', parts: ['bolt', 'bolt'], as: 'x' }])).toThrow(PartOpError);
    expect(() => run(SCENE(), LABELS, [{ kind: 'group', parts: ['bolt', 'ghost'], as: 'x' }])).toThrow(/ghost/);
    expect(() => run(SCENE(), LABELS, [{ kind: 'group', parts: ['bolt', 'nut'], as: 'body' }])).toThrow(/already exists/);
    // reusing one of the grouped names is fine
    expect(() => run(SCENE(), LABELS, [{ kind: 'group', parts: ['bolt', 'nut'], as: 'bolt' }])).not.toThrow();
  });

  it('a part is every id sharing its name', () => {
    const m = boxes([
      { id: 1, min: [0, 0, 0], max: [1, 1, 1] },
      { id: 2, min: [5, 0, 0], max: [6, 1, 1] },
    ]);
    const out = run(m, [[1, 'leg'], [2, 'leg']], [{ kind: 'move', part: 'leg', offset: [0, 0, 4] }]);
    expect(bbox(out.mesh).min[2]).toBe(4);
  });

  it('cut removes the part and returns it as a cutter', () => {
    const out = run(SCENE(), LABELS, [{ kind: 'cut', part: 'bolt' }]);
    expect([...out.mesh.runOriginalID]).toEqual([1, 3]);
    expect(out.mesh.triVerts.length).toBe(24 * 3);
    expect(out.mesh.vertProperties.length).toBe(16 * 3);
    expect(out.cutters).toHaveLength(1);
    const c = out.cutters[0];
    expect(c.numProp).toBe(3);
    expect(c.vertProperties.length).toBe(8 * 3);
    near(bbox(c).min, [20, 0, 0]);
    near(bbox(c).max, [24, 6, 2]);
    expect(volume(c, 2)).toBeCloseTo(48, 3);
  });

  it('cut applies earlier edits to the cutter', () => {
    const out = run(SCENE(), LABELS, [
      { kind: 'move', part: 'bolt', offset: [0, 0, 10] },
      { kind: 'cut', part: 'bolt' },
    ]);
    near(bbox(out.cutters[0]).min, [20, 0, 10]);
  });

  it('rejects a part that shares vertices with other geometry', () => {
    const m = boxes([
      { id: 1, min: [0, 0, 0], max: [10, 10, 10] },
      { id: 2, min: [20, 0, 0], max: [24, 6, 2] },
    ]);
    // Point one of the bolt's triangles at a body vertex.
    m.triVerts[12 * 3] = 0;
    const labels: [number, string][] = [[1, 'body'], [2, 'bolt']];
    expect(() => run(m, labels, [{ kind: 'move', part: 'bolt', offset: [1, 0, 0] }]))
      .toThrow(/Part "bolt" is joined to other geometry, so it can't be moved on its own/);
    const others: PartOp[] = [
      { kind: 'rotate', part: 'bolt', degrees: [0, 0, 1] },
      { kind: 'scale', part: 'bolt', factor: [1, 1, 1] },
      { kind: 'mirror', part: 'bolt', axis: 'x' },
      { kind: 'copy', part: 'bolt', as: 'b2', offset: [0, 0, 0] },
      { kind: 'cut', part: 'bolt' },
    ];
    for (const op of others) expect(() => run(m, labels, [op])).toThrow(PartOpError);
  });

  it('rejects a part joined only by a merge pair, and unlabelled neighbours', () => {
    const m = boxes([
      { id: 1, min: [0, 0, 0], max: [10, 10, 10] },
      { id: 2, min: [20, 0, 0], max: [24, 6, 2] },
    ]);
    m.mergeFromVert = Uint32Array.of(8);
    m.mergeToVert = Uint32Array.of(0);
    expect(() => run(m, [[1, 'body'], [2, 'bolt']], [{ kind: 'move', part: 'bolt', offset: [1, 0, 0] }])).toThrow(/joined/);
    // the body is unlabelled here; still other geometry
    expect(() => run(m, [[2, 'bolt']], [{ kind: 'move', part: 'bolt', offset: [1, 0, 0] }])).toThrow(/joined/);
  });

  it('names the part and lists existing ones when it is unknown', () => {
    try {
      run(SCENE(), LABELS, [{ kind: 'move', part: 'bol', offset: [0, 0, 0] }]);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PartOpError);
      expect((e as Error).message).toContain('"bol"');
      expect((e as Error).message).toContain('"bolt"');
      expect((e as Error).message).toContain('"body"');
    }
    expect(() => run(SCENE(), [], [{ kind: 'move', part: 'x', offset: [0, 0, 0] }])).toThrow(/no labelled parts/);
  });

  it('copy rejects a name that is another existing part', () => {
    expect(() => run(SCENE(), LABELS, [{ kind: 'copy', part: 'bolt', as: 'nut', offset: [0, 0, 0] }])).toThrow(/already exists/);
  });

  it('compacts vertices, rebuilds runs and remaps merge pairs', () => {
    const m = boxes([
      { id: 1, min: [0, 0, 0], max: [1, 1, 1] },
      { id: 2, min: [5, 0, 0], max: [6, 1, 1] },
      { id: 3, min: [9, 0, 0], max: [10, 1, 1] },
    ]);
    // Pairs inside box 3 (verts 16..23), plus one inside box 2.
    m.mergeFromVert = Uint32Array.of(17, 18, 9);
    m.mergeToVert = Uint32Array.of(16, 19, 8);
    const out = run(m, [[2, 'mid'], [3, 'end']], [{ kind: 'cut', part: 'mid' }]);
    // box 2's 8 vertices are gone; box 3's shift down by 8, its pairs follow, box 2's pair is dropped
    expect(out.mesh.vertProperties.length).toBe(16 * 3);
    expect([...out.mesh.mergeFromVert]).toEqual([9, 10]);
    expect([...out.mesh.mergeToVert]).toEqual([8, 11]);
    expect([...out.mesh.runIndex]).toEqual([0, 36, 72]);
    expect([...out.mesh.runOriginalID]).toEqual([1, 3]);
    expect(Math.max(...out.mesh.triVerts)).toBe(15);
  });

  it('regroups interleaved triangles of one id into a single run, in first-appearance order', () => {
    const m = boxes([
      { id: 7, min: [0, 0, 0], max: [1, 1, 1] },
      { id: 9, min: [5, 0, 0], max: [6, 1, 1] },
      { id: 7, min: [9, 0, 0], max: [10, 1, 1] },
    ]);
    const out = run(m, [[9, 'b']], [{ kind: 'move', part: 'b', offset: [0, 0, 1] }]);
    expect([...out.mesh.runOriginalID]).toEqual([7, 9]);
    expect([...out.mesh.runIndex]).toEqual([0, 72, 108]);
  });

  it('copies extra vertex properties through and moves only xyz', () => {
    const m = boxes([{ id: 1, min: [0, 0, 0], max: [1, 1, 1] }], 6);
    const out = run(m, [[1, 'a']], [
      { kind: 'move', part: 'a', offset: [1, 2, 3] },
      { kind: 'copy', part: 'a', as: 'b', offset: [5, 0, 0] },
    ]);
    expect(out.mesh.numProp).toBe(6);
    expect(out.mesh.vertProperties.length).toBe(16 * 6);
    for (let v = 0; v < 16; v++) {
      expect(out.mesh.vertProperties[v * 6 + 3]).toBe(103);
      expect(out.mesh.vertProperties[v * 6 + 5]).toBe(105);
    }
  });

  it('treats a mesh without runs as one run of id 0', () => {
    const m = boxes([{ id: 0, min: [0, 0, 0], max: [1, 1, 1] }]);
    delete m.runIndex;
    delete m.runOriginalID;
    const out = run(m, [[0, 'solo']], [{ kind: 'move', part: 'solo', offset: [0, 0, 2] }]);
    expect(bbox(out.mesh).min[2]).toBe(2);
    expect(run(m, [], []).mesh.runIndex).toEqual(Uint32Array.of(0, 36));
  });

  it('handles a million triangles in linear-ish time', () => {
    const count = 90000; // 1.08M triangles in 90k boxes
    const specs: BoxSpec[] = [];
    for (let i = 0; i < count; i++) specs.push({ id: i === 0 ? 1 : 2, min: [i, 0, 0], max: [i + 0.5, 1, 1] });
    const m = boxes(specs);
    expect(m.triVerts.length / 3).toBe(12 * count);
    const t0 = Date.now();
    const out = run(m, [[1, 'first']], [
      { kind: 'move', part: 'first', offset: [0, 0, 1] },
      { kind: 'copy', part: 'first', as: 'c', offset: [0, 5, 0] },
    ]);
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(out.mesh.triVerts.length).toBe(m.triVerts.length + 36);
  });
});
