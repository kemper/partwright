import { describe, expect, it } from 'vitest';
import {
  alignLayout, arrayOffsets, bedLayout, centerOnOrigin, distributeLayout, dropToPlate, gridArrayOffsets,
  freeOffset, gridLayout, layFlatRotation, packLayout, rotatedMinZ, shelfPack, snapToGrid, xyzPositions, type PartBox, type Vec3,
} from '../../src/insert/partLayout';

const box = (name: string, min: Vec3, max: Vec3): PartBox => ({ name, min, max });
const moved = (b: PartBox, m: Map<string, Vec3>): PartBox => {
  const d = m.get(b.name) ?? [0, 0, 0];
  return { name: b.name, min: [b.min[0] + d[0], b.min[1] + d[1], b.min[2] + d[2]], max: [b.max[0] + d[0], b.max[1] + d[1], b.max[2] + d[2]] };
};
const ZERO: Vec3 = [0, 0, 0];

/** No two footprints overlap (touching is fine). */
function expectDisjoint(boxes: PartBox[]) {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const w = Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]);
      const d = Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1]);
      expect(w > 1e-6 && d > 1e-6, `${a.name} overlaps ${b.name}`).toBe(false);
    }
  }
}

const SAMPLE = (): PartBox[] => [
  box('a', [0, 0, 5], [10, 6, 9]),
  box('b', [3, 3, 0], [5, 5, 2]),
  box('c', [-20, 4, 1], [-8, 20, 4]),
  box('d', [30, -9, 2], [38, -2, 3]),
  box('e', [1, 1, 1], [4, 2, 2]),
];

describe('gridLayout', () => {
  it('lays parts in uniform cells without overlap, on the plate', () => {
    const boxes = SAMPLE();
    const m = gridLayout(boxes, { gap: 2 });
    const out = boxes.map(b => moved(b, m));
    expectDisjoint(out);
    for (const b of out) expect(b.min[2]).toBeCloseTo(0, 6);
  });

  it('uses ceil(sqrt(n)) columns, reading order from the back row, centred on the original centre', () => {
    const boxes = [1, 2, 3, 4, 5].map(i => box(`p${i}`, [0, 0, 0], [4, 4, 4]));
    const out = boxes.map(b => moved(b, gridLayout(boxes, { gap: 2 })));
    // 3 columns, 2 rows; first row at +Y
    const cx = out.map(b => (b.min[0] + b.max[0]) / 2), cy = out.map(b => (b.min[1] + b.max[1]) / 2);
    expect(cx[0]).toBeLessThan(cx[1]); expect(cx[1]).toBeLessThan(cx[2]);
    expect(cx[3]).toBeCloseTo(cx[0], 6);
    expect(cy[0]).toBeGreaterThan(cy[3]);
    expect(cy[0]).toBeCloseTo(cy[2], 6);
    expect(cx[1] - cx[0]).toBeCloseTo(6, 6);
    expect(cy[0] - cy[3]).toBeCloseTo(6, 6);
    // the whole grid is centred on the input's combined centre (2, 2)
    expect((Math.min(...out.map(b => b.min[0])) + Math.max(...out.map(b => b.max[0]))) / 2).toBeCloseTo(2, 6);
  });

  it('is empty for no boxes', () => {
    expect(gridLayout([], { gap: 1 }).size).toBe(0);
  });
});

describe('packLayout', () => {
  it('packs without overlap and drops to the plate', () => {
    const boxes = SAMPLE();
    const m = packLayout(boxes, { gap: 1.5 });
    const out = boxes.map(b => moved(b, m));
    expectDisjoint(out);
    for (const b of out) expect(b.min[2]).toBeCloseTo(0, 6);
    // centred on the combined XY centre of the input
    const cx = (Math.min(...boxes.map(b => b.min[0])) + Math.max(...boxes.map(b => b.max[0]))) / 2;
    const ox = (Math.min(...out.map(b => b.min[0])) + Math.max(...out.map(b => b.max[0]))) / 2;
    expect(ox).toBeCloseTo(cx, 6);
  });

  it('is more compact than a spread-out start', () => {
    const boxes = [0, 1, 2, 3].map(i => box(`p${i}`, [i * 100, 0, 0], [i * 100 + 10, 10, 10]));
    const out = boxes.map(b => moved(b, packLayout(boxes, { gap: 2 })));
    const span = Math.max(...out.map(b => b.max[0])) - Math.min(...out.map(b => b.min[0]));
    expect(span).toBeLessThan(40);
  });
});

describe('shelfPack', () => {
  it('centres the packed layout on the origin', () => {
    const { centers, width, depth } = shelfPack([[4, 2], [4, 2], [4, 2], [4, 2]], 1);
    const xs = centers.map(c => c[0]), ys = centers.map(c => c[1]);
    expect((Math.min(...xs) - 2 + Math.max(...xs) + 2) / 2).toBeCloseTo(0, 6);
    expect(width).toBeGreaterThan(0);
    expect(depth).toBeGreaterThan(0);
    expect(ys.some(y => y > 0)).toBe(true);
  });
});

describe('bedLayout', () => {
  it('fits everything on one plate when it can', () => {
    const boxes = [0, 1, 2, 3].map(i => box(`p${i}`, [0, 0, 3], [40, 40, 6]));
    const r = bedLayout(boxes, { gap: 5, bed: [100, 100] });
    expect(r.plates).toBe(1);
    expect(r.tooBig).toEqual([]);
    const out = boxes.map(b => moved(b, r.moves));
    expectDisjoint(out);
    for (const b of out) {
      expect(b.min[0]).toBeGreaterThanOrEqual(-50 - 1e-6); expect(b.max[0]).toBeLessThanOrEqual(50 + 1e-6);
      expect(b.min[1]).toBeGreaterThanOrEqual(-50 - 1e-6); expect(b.max[1]).toBeLessThanOrEqual(50 + 1e-6);
      expect(b.min[2]).toBeCloseTo(0, 6);
    }
  });

  it('spills onto plate 2 along +X when the bed is full', () => {
    const boxes = [0, 1, 2, 3, 4].map(i => box(`p${i}`, [0, 0, 0], [60, 60, 5]));
    const r = bedLayout(boxes, { gap: 2, bed: [100, 100] });
    expect(r.plates).toBe(5); // one 60x60 per 100x100 plate
    const out = boxes.map(b => moved(b, r.moves));
    expectDisjoint(out);
    const centres = out.map(b => (b.min[0] + b.max[0]) / 2).sort((a, b) => a - b);
    expect(centres[0]).toBeCloseTo(0, 6);
    expect(centres[1] - centres[0]).toBeCloseTo(110, 6);
    // 2 per plate would spill the third
    const small = [0, 1, 2, 3, 4].map(i => box(`s${i}`, [0, 0, 0], [45, 45, 5]));
    const s = bedLayout(small, { gap: 2, bed: [100, 100] });
    expect(s.plates).toBe(2);
    const sOut = small.map(b => moved(b, s.moves));
    expectDisjoint(sOut);
    const onPlate1 = sOut.filter(b => b.min[0] > 55);
    expect(onPlate1.length).toBe(1);
    expect(onPlate1[0].min[0]).toBeGreaterThanOrEqual(110 - 50 - 1e-6);
    expect(onPlate1[0].max[0]).toBeLessThanOrEqual(110 + 50 + 1e-6);
  });

  it('lists parts bigger than the bed in tooBig, on a plate of their own', () => {
    const boxes = [box('huge', [0, 0, 0], [300, 200, 10]), box('tiny', [0, 0, 0], [10, 10, 10])];
    const r = bedLayout(boxes, { gap: 2, bed: [100, 100] });
    expect(r.tooBig).toEqual(['huge']);
    expect(r.rotateToFit).toEqual([]);
    expect(r.plates).toBe(2);
    const huge = moved(boxes[0], r.moves), tiny = moved(boxes[1], r.moves);
    expect((huge.min[0] + huge.max[0]) / 2).toBeCloseTo(110, 6);
    expect((tiny.min[0] + tiny.max[0]) / 2).toBeCloseTo(0, 6);
  });

  it('flags a part that fits only turned a quarter turn (not tooBig)', () => {
    const r = bedLayout([box('long', [0, 0, 0], [150, 40, 5])], { gap: 2, bed: [200, 100] });
    expect(r.tooBig).toEqual([]);
    const r2 = bedLayout([box('long', [0, 0, 0], [150, 40, 5])], { gap: 2, bed: [100, 200] });
    expect(r2.tooBig).toEqual([]);
    expect(r2.rotateToFit).toEqual(['long']);
  });

  it('handles no boxes', () => {
    const r = bedLayout([], { gap: 1, bed: [10, 10] });
    expect(r.plates).toBe(0);
    expect(r.moves.size).toBe(0);
  });
});

describe('alignLayout', () => {
  it('aligns to the selection min / centre / max', () => {
    const boxes = [box('a', [0, 0, 0], [10, 10, 10]), box('b', [4, 20, 0], [6, 24, 2])];
    expect(alignLayout(boxes, 'x', 'min').get('b')).toEqual([-4, 0, 0]);
    expect(alignLayout(boxes, 'x', 'min').has('a')).toBe(false);
    expect(alignLayout(boxes, 'x', 'max').get('b')).toEqual([4, 0, 0]);
    expect(alignLayout(boxes, 'y', 'center').get('a')).toEqual([0, 7, 0]);
    expect(alignLayout(boxes, 'y', 'center').get('b')![1]).toBeCloseTo(-10, 6);
  });
});

describe('distributeLayout', () => {
  it('keeps the ends and equalises the gaps', () => {
    const boxes = [
      box('c', [50, 0, 0], [60, 1, 1]),
      box('a', [0, 0, 0], [10, 1, 1]),
      box('b', [12, 0, 0], [20, 1, 1]),
      box('d', [100, 0, 0], [104, 1, 1]),
    ];
    const m = distributeLayout(boxes, 'x');
    const out = boxes.map(b => moved(b, m)).sort((p, q) => p.min[0] - q.min[0]);
    expect(out[0].min[0]).toBe(0);
    expect(out[3].max[0]).toBe(104);
    const gaps = [1, 2, 3].map(i => out[i].min[0] - out[i - 1].max[0]);
    expect(gaps[0]).toBeCloseTo(gaps[1], 6);
    expect(gaps[1]).toBeCloseTo(gaps[2], 6);
    expect(m.has('a')).toBe(false);
    expect(m.has('d')).toBe(false);
  });

  it('needs three boxes', () => {
    expect(distributeLayout([box('a', ZERO, [1, 1, 1]), box('b', [5, 0, 0], [6, 1, 1])], 'x').size).toBe(0);
  });
});

describe('simple moves', () => {
  it('dropToPlate puts each part on z = 0', () => {
    const m = dropToPlate([box('a', [0, 0, 5], [1, 1, 8]), box('b', [0, 0, 0], [1, 1, 1]), box('c', [0, 0, -3], [1, 1, 1])]);
    expect(m.get('a')).toEqual([0, 0, -5]);
    expect(m.has('b')).toBe(false);
    expect(m.get('c')).toEqual([0, 0, 3]);
  });

  it('centerOnOrigin moves the group, keeping relative positions', () => {
    const boxes = [box('a', [10, 10, 4], [20, 20, 8]), box('b', [30, 10, 5], [40, 20, 9])];
    const m = centerOnOrigin(boxes);
    expect(m.get('a')).toEqual(m.get('b'));
    const out = boxes.map(b => moved(b, m));
    expect((Math.min(...out.map(b => b.min[0])) + Math.max(...out.map(b => b.max[0]))) / 2).toBeCloseTo(0, 6);
    expect((Math.min(...out.map(b => b.min[1])) + Math.max(...out.map(b => b.max[1]))) / 2).toBeCloseTo(0, 6);
    expect(Math.min(...out.map(b => b.min[2]))).toBeCloseTo(0, 6);
    expect(out[1].min[0] - out[0].min[0]).toBeCloseTo(20, 6);
    expect(out[1].min[2] - out[0].min[2]).toBeCloseTo(1, 6);
  });

  it('snapToGrid snaps min x / y to the step and leaves z alone', () => {
    const m = snapToGrid([box('a', [1.4, 2.6, 3.3], [5, 5, 5]), box('b', [10, 5, 0], [12, 7, 1])], 5);
    const a = m.get('a')!;
    expect(a[0]).toBeCloseTo(-1.4, 6);
    expect(a[1]).toBeCloseTo(2.4, 6);
    expect(a[2]).toBe(0);
    expect(m.has('b')).toBe(false);
    expect(snapToGrid([box('a', [1, 1, 1], [2, 2, 2])], 0).size).toBe(0);
  });
});

describe('array offsets', () => {
  it('arrayOffsets excludes the original', () => {
    expect(arrayOffsets(3, [10, 0, 2])).toEqual([[10, 0, 2], [20, 0, 4], [30, 0, 6]]);
    expect(arrayOffsets(0, [1, 1, 1])).toEqual([]);
  });

  it('gridArrayOffsets returns cols*rows-1 offsets, skipping cell (0,0)', () => {
    const o = gridArrayOffsets(3, 2, [10, 20]);
    expect(o).toHaveLength(5);
    expect(o).toContainEqual([20, 20, 0]);
    expect(o).toContainEqual([0, 20, 0]);
    expect(o).not.toContainEqual([0, 0, 0]);
  });
});

// Rz·Ry·Rx applied to a point.
function rotate(p: Vec3, deg: Vec3): Vec3 {
  const [ax, ay, az] = deg.map(d => d * Math.PI / 180);
  let [x, y, z] = p;
  [y, z] = [y * Math.cos(ax) - z * Math.sin(ax), y * Math.sin(ax) + z * Math.cos(ax)];
  [x, z] = [x * Math.cos(ay) + z * Math.sin(ay), -x * Math.sin(ay) + z * Math.cos(ay)];
  [x, y] = [x * Math.cos(az) - y * Math.sin(az), x * Math.sin(az) + y * Math.cos(az)];
  return [x, y, z];
}

const BOX_TRIS = [
  [0, 2, 3], [0, 3, 1], [4, 5, 7], [4, 7, 6], [0, 1, 5], [0, 5, 4],
  [2, 6, 7], [2, 7, 3], [0, 4, 6], [0, 6, 2], [1, 3, 7], [1, 7, 5],
];
function boxMesh(w: number, d: number, h: number, tilt: Vec3) {
  const pos: number[] = [];
  for (let v = 0; v < 8; v++) {
    const p = rotate([(v & 1 ? 1 : -1) * w / 2, (v & 2 ? 1 : -1) * d / 2, (v & 4 ? 1 : -1) * h / 2], tilt);
    pos.push(...p);
  }
  return { positions: Float32Array.from(pos), triVerts: Uint32Array.from(BOX_TRIS.flat()), tris: BOX_TRIS.map((_, i) => i) };
}
function zExtent(positions: Float32Array, deg: Vec3): number {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const z = rotate([positions[i], positions[i + 1], positions[i + 2]], deg)[2];
    lo = Math.min(lo, z); hi = Math.max(hi, z);
  }
  return hi - lo;
}

describe('layFlatRotation', () => {
  it('returns zero for a part already lying on its largest face', () => {
    const m = boxMesh(10, 8, 2, [0, 0, 0]);
    expect(layFlatRotation(m.positions, m.triVerts, m.tris)).toEqual([0, 0, 0]);
  });

  it('lays a box tilted 30 degrees about x flat on its large face', () => {
    const m = boxMesh(10, 10, 2, [30, 0, 0]);
    expect(zExtent(m.positions, ZERO)).toBeGreaterThan(5);
    const r = layFlatRotation(m.positions, m.triVerts, m.tris);
    expect(zExtent(m.positions, r)).toBeCloseTo(2, 3);
  });

  it('handles a compound tilt and a part lying face-up or on its side', () => {
    for (const tilt of [[30, 20, 70], [180, 0, 0], [90, 0, 0], [0, 90, 0], [0, 0, 45], [-40, 15, 0]] as Vec3[]) {
      const m = boxMesh(12, 9, 2, tilt);
      const r = layFlatRotation(m.positions, m.triVerts, m.tris);
      expect(zExtent(m.positions, r)).toBeCloseTo(2, 3);
    }
  });

  it('lays a tetrahedron on its largest face', () => {
    // Right-corner tetrahedron: the slanted face is the largest. Wind it outward.
    const positions = Float32Array.from([0, 0, 0, 4, 0, 0, 0, 4, 0, 0, 0, 4]);
    const triVerts = Uint32Array.from([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]);
    const r = layFlatRotation(positions, triVerts, [0, 1, 2, 3]);
    // The slanted face (1,2,3) has outward normal (1,1,1)/sqrt(3); it must end up pointing straight down.
    const n = rotate([1, 1, 1].map(v => v / Math.sqrt(3)) as Vec3, r);
    expect(n[2]).toBeCloseTo(-1, 4);
    // ...so that face is flat on the bottom and the apex (vertex 0) is above it.
    const zs = [0, 1, 2, 3].map(i => rotate([positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]], r)[2]);
    expect(zs[1]).toBeCloseTo(zs[2], 4);
    expect(zs[2]).toBeCloseTo(zs[3], 4);
    expect(zs[0]).toBeGreaterThan(zs[1] + 1);
  });

  it('only considers the given triangles, and survives an empty list', () => {
    const m = boxMesh(10, 10, 2, [0, 0, 0]);
    expect(layFlatRotation(m.positions, m.triVerts, [])).toEqual([0, 0, 0]);
  });
});

describe('rotatedMinZ / xyzPositions', () => {
  // A 2×2×4 box standing on the plate (z 0..4), centred on x/y.
  const pos = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0, -1, -1, 4, 1, -1, 4, 1, 1, 4, -1, 1, 4]);
  const tv = new Uint32Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5]);
  const all = Array.from({ length: 12 }, (_, i) => i);
  it('finds the bottom after a turn about the box centre', () => {
    expect(rotatedMinZ(pos, tv, all, [0, 0, 0])).toBeCloseTo(0);
    // Tipped onto its side: 2 tall about centre z = 2 → bottom at 1.
    expect(rotatedMinZ(pos, tv, all, [90, 0, 0])).toBeCloseTo(1);
    expect(rotatedMinZ(pos, tv, all, [0, 90, 0])).toBeCloseTo(1);
    // A z turn never changes the bottom.
    expect(rotatedMinZ(pos, tv, all, [0, 0, 37])).toBeCloseTo(0);
  });
  it('strips extra vertex properties', () => {
    expect(Array.from(xyzPositions(new Float32Array([1, 2, 3, 9, 4, 5, 6, 9]), 4))).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('freeOffset', () => {
  const box = (name: string, x0: number, x1: number, y0 = 0, y1 = 10): PartBox => ({ name, min: [x0, y0, 0], max: [x1, y1, 10] });
  it('steps right past neighbours', () => {
    const a = box('a', 0, 10);
    expect(freeOffset(a, [a], 2)).toEqual([12, 0, 0]);
    // b sits where the first slot would be → next slot.
    expect(freeOffset(a, [a, box('b', 15, 25)], 2)).toEqual([36, 0, 0]);
  });
  it('falls back to a row behind when the row is full', () => {
    const a = box('a', 0, 10);
    const wall = box('wall', 11, 2000);
    expect(freeOffset(a, [a, wall], 2, 4)).toEqual([0, 12, 0]);
  });
});
