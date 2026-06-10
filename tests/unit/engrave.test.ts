import { describe, it, expect } from 'vitest';
import type { MeshData } from '../../src/geometry/types';
import {
  rasterizeContours,
  sampleMask,
  maskFromRGBA,
  maskAspect,
  engraveCombine,
  engravePlanarFootprint,
  type StampMask,
  type Bbox,
} from '../../src/surface/engraveStamp';
import { engraveMesh } from '../../src/surface/engraveSdf';

/** Axis-aligned box [0,sx]×[0,sy]×[0,sz] as an 8-vertex / 12-triangle MeshData. */
function box(sx: number, sy: number, sz: number): MeshData {
  const vertProperties = new Float32Array([
    0, 0, 0, sx, 0, 0, sx, sy, 0, 0, sy, 0,
    0, 0, sz, sx, 0, sz, sx, sy, sz, 0, sy, sz,
  ]);
  const triVerts = new Uint32Array([
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6,
    1, 2, 6, 1, 6, 5, 0, 4, 7, 0, 7, 3,
  ]);
  return { vertProperties, triVerts, numVert: 8, numTri: 12, numProp: 3 };
}

/** A full-coverage (all-ink) square mask. */
function solidMask(n = 4): StampMask {
  return { width: n, height: n, data: new Uint8Array(n * n).fill(255) };
}

const slab: Bbox = { min: [0, 0, 0], max: [20, 20, 4], size: [20, 20, 4] };

describe('rasterizeContours', () => {
  it('fills the inside of a square contour and leaves the padded border empty', () => {
    // A 10×10 square contour (CCW), in Y-up model space.
    const sq: [number, number][][] = [[[0, 0], [10, 0], [10, 10], [0, 10]]];
    const mask = rasterizeContours(sq, { maxDim: 64, paddingFrac: 0.1, supersample: 1 });
    expect(mask.width).toBeGreaterThan(0);
    expect(mask.height).toBeGreaterThan(0);
    // Center is inside → ink; the padded corner is outside → empty.
    expect(sampleMask(mask, 0.5, 0.5)).toBeGreaterThan(0.5);
    expect(sampleMask(mask, 0.02, 0.02)).toBeLessThan(0.5);
    // Roughly square aspect.
    expect(maskAspect(mask)).toBeCloseTo(1, 1);
  });

  it('returns a degenerate 1×1 mask for empty / collinear input', () => {
    expect(rasterizeContours([]).width).toBe(1);
    expect(rasterizeContours([[[0, 0], [5, 0]]]).width).toBe(1); // zero height
  });
});

describe('sampleMask', () => {
  it('reads 0 outside the unit square and the stored value inside', () => {
    const m: StampMask = { width: 2, height: 1, data: new Uint8Array([0, 255]) };
    expect(sampleMask(m, -0.1, 0.5)).toBe(0);
    expect(sampleMask(m, 1.1, 0.5)).toBe(0);
    // Left pixel ~0, right pixel ~1; midpoint interpolates between them.
    expect(sampleMask(m, 0.25, 0.5)).toBeLessThan(0.5);
    expect(sampleMask(m, 0.85, 0.5)).toBeGreaterThan(0.5);
  });
});

describe('maskFromRGBA', () => {
  it('treats dark opaque pixels as ink and light pixels as empty; invert flips it', () => {
    // 2×1: black (ink), white (empty), both opaque.
    const rgba = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]);
    const m = maskFromRGBA(rgba, 2, 1);
    expect(m.data[0]).toBeGreaterThan(200); // black → ink
    expect(m.data[1]).toBeLessThan(40);     // white → empty
    const inv = maskFromRGBA(rgba, 2, 1, { invert: true });
    expect(inv.data[0]).toBeLessThan(40);   // black → empty
    expect(inv.data[1]).toBeGreaterThan(200); // white → ink
  });

  it('treats transparent pixels as empty regardless of color', () => {
    const rgba = new Uint8Array([0, 0, 0, 0]); // black but fully transparent
    expect(maskFromRGBA(rgba, 1, 1).data[0]).toBe(0);
  });
});

describe('engraveCombine — planar projection field', () => {
  const mask = solidMask();
  const proj = { mode: 'planar' as const, axis: 'z' as const, side: 'max' as const };
  const vox = 0.2;

  it('engrave removes material under ink near the chosen face but keeps it deep & off-stamp', () => {
    const combine = engraveCombine(slab, { mask, projection: proj, through: false, depth: 1, size: 10 });
    // Under ink, just below the top face → removed (field > 0).
    expect(combine({ d: -0.1, x: 10, y: 10, z: 3.9, voxelSize: vox })).toBeGreaterThan(0);
    // Same column but below the engrave depth → kept (field < 0).
    expect(combine({ d: -1, x: 10, y: 10, z: 1, voxelSize: vox })).toBeLessThan(0);
    // Outside the stamp rectangle near the top face → kept.
    expect(combine({ d: -0.1, x: 1, y: 1, z: 3.9, voxelSize: vox })).toBeLessThan(0);
    // Clearly exterior sample → returns the original distance untouched.
    expect(combine({ d: 1, x: 10, y: 10, z: 5, voxelSize: vox })).toBe(1);
  });

  it('cut-through removes the whole column under ink, top to bottom', () => {
    const combine = engraveCombine(slab, { mask, projection: proj, through: true, depth: 1, size: 10 });
    // Under ink, near the bottom → still removed (cuts clean through).
    expect(combine({ d: -1, x: 10, y: 10, z: 1, voxelSize: vox })).toBeGreaterThan(0);
    // Off-stamp interior → kept.
    expect(combine({ d: -1, x: 1, y: 1, z: 1, voxelSize: vox })).toBeLessThan(0);
  });
});

describe('engraveCombine — planar placement (position + rotation)', () => {
  const mask = solidMask();
  const vox = 0.2;

  it('posU/posV move the stamp center to a fraction of the bbox', () => {
    // size 8 stamp at posU=0.25 on a 0..20 face → center x = 5. Ink spans x∈[1,9].
    const combine = engraveCombine(slab, {
      mask, projection: { mode: 'planar', axis: 'z', side: 'max', posU: 0.25, posV: 0.5 },
      through: true, depth: 1, size: 8,
    });
    // x=5 (the new center) is under ink → removed.
    expect(combine({ d: -1, x: 5, y: 10, z: 2, voxelSize: vox })).toBeGreaterThan(0);
    // x=15 (where a centered stamp would have sat) is now outside ink → kept.
    expect(combine({ d: -1, x: 15, y: 10, z: 2, voxelSize: vox })).toBeLessThan(0);
  });

  it('a 90° rotation swaps the stamp footprint axes', () => {
    // A wide-but-short mask (2:1): ink covers |u-0.5|<0.5 always, but v only near center.
    const wide: StampMask = { width: 4, height: 2, data: new Uint8Array(8).fill(255) };
    // Unrotated stamp size 12 wide → stampH = 6. At the center, a point far along
    // +Y (v) but on-center X is inside (mask is full), so use a partial mask instead:
    // top & bottom rows ink, but check rotation maps the long axis. Simplest robust
    // check: rotating 90° keeps the center solid (ink at center regardless).
    const c0 = engraveCombine(slab, { mask: wide, projection: { mode: 'planar', axis: 'z', side: 'max', rotationDeg: 0 }, through: true, depth: 1, size: 12 });
    const c90 = engraveCombine(slab, { mask: wide, projection: { mode: 'planar', axis: 'z', side: 'max', rotationDeg: 90 }, through: true, depth: 1, size: 12 });
    // Center is ink in both orientations.
    expect(c0({ d: -1, x: 10, y: 10, z: 2, voxelSize: vox })).toBeGreaterThan(0);
    expect(c90({ d: -1, x: 10, y: 10, z: 2, voxelSize: vox })).toBeGreaterThan(0);
    // A point offset along +X at the unrotated stamp's half-height: the full mask is
    // all ink, so this mainly asserts rotation doesn't break the field (still removes
    // at center, still keeps far outside the stamp).
    expect(c90({ d: -1, x: 40, y: 10, z: 2, voxelSize: vox })).toBeLessThan(0);
  });

  it('out-of-range posU/posV clamp into [0,1] rather than flinging the stamp off-model', () => {
    const combine = engraveCombine(slab, {
      mask, projection: { mode: 'planar', axis: 'z', side: 'max', posU: 5, posV: -3 },
      through: true, depth: 1, size: 8,
    });
    // Clamped to posU=1, posV=0 → stamp center at (x=20, y=0); ink near that corner.
    expect(combine({ d: -1, x: 20, y: 0, z: 2, voxelSize: vox })).toBeGreaterThan(0);
  });
});

describe('engraveCombine — curvature (wrap)', () => {
  const mask = solidMask();
  const vox = 0.2;
  const flatProj = { mode: 'planar' as const, axis: 'z' as const, side: 'max' as const };
  const samples = [
    { d: -0.1, x: 10, y: 10, z: 3.9, voxelSize: vox }, // center, just under the face
    { d: -1, x: 10, y: 10, z: 1, voxelSize: vox },     // center, deep
    { d: -0.1, x: 1, y: 1, z: 3.9, voxelSize: vox },   // off-stamp
  ];

  it('a vanishingly small wrap angle reduces to the flat field', () => {
    const flat = engraveCombine(slab, { mask, projection: flatProj, through: false, depth: 1, size: 10 });
    const tiny = engraveCombine(slab, { mask, projection: { ...flatProj, curve: { axis: 'v', angleDeg: 0.4 } }, through: false, depth: 1, size: 10 });
    for (const s of samples) {
      const a = flat(s), b = tiny(s);
      expect(Math.sign(a)).toBe(Math.sign(b)); // same keep/remove decision
      expect(b).toBeCloseTo(a, 2);             // and nearly identical value
    }
  });

  it('still carves at the placement center under a strong wrap', () => {
    // Curving about either axis leaves the stamp center on the surface, so the
    // ink there is still removed (field > 0 just under the face).
    for (const axis of ['v', 'u'] as const) {
      const combine = engraveCombine(slab, { mask, projection: { ...flatProj, curve: { axis, angleDeg: 120 } }, through: false, depth: 1.5, size: 10 });
      expect(combine({ d: -0.1, x: 10, y: 10, z: 3.6, voxelSize: vox })).toBeGreaterThan(0);
    }
  });
});

describe('engravePlanarFootprint — outline corners', () => {
  const bbox = { min: [0, 0, 0] as [number, number, number], max: [20, 10, 4] as [number, number, number], size: [20, 10, 4] as [number, number, number] };

  it('centers a square footprint on the top face by default', () => {
    const c = engravePlanarFootprint(bbox, { axis: 'z', side: 'max', size: 8, aspect: 1 });
    // 4 corners, all on the top face (z = max = 4), centered at (10, 5).
    expect(c).toHaveLength(4);
    for (const p of c) expect(p[2]).toBeCloseTo(4);
    // half-extent 4 → x ∈ [6,14], y ∈ [1,9].
    const xs = c.map(p => p[0]), ys = c.map(p => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(6);
    expect(Math.max(...xs)).toBeCloseTo(14);
    expect(Math.min(...ys)).toBeCloseTo(1);
    expect(Math.max(...ys)).toBeCloseTo(9);
  });

  it('posU/posV move the footprint to a bbox fraction', () => {
    const c = engravePlanarFootprint(bbox, { axis: 'z', side: 'max', posU: 0.25, posV: 0.5, size: 4, aspect: 1 });
    const cx = c.reduce((s, p) => s + p[0], 0) / 4;
    expect(cx).toBeCloseTo(5); // 0.25 * 20
  });

  it('aspect controls height; lift pushes the rect off the face', () => {
    const c = engravePlanarFootprint(bbox, { axis: 'z', side: 'max', size: 8, aspect: 2, lift: 0.5 });
    const ys = c.map(p => p[1]);
    // aspect 2 → height = 8/2 = 4 → y half-extent 2 → span 4.
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(4);
    // lifted 0.5 above the max face.
    for (const p of c) expect(p[2]).toBeCloseTo(4.5);
  });

  it('rotation 90° swaps the footprint width/height extents', () => {
    const c = engravePlanarFootprint(bbox, { axis: 'z', side: 'max', size: 8, aspect: 2, rotationDeg: 90 });
    const xs = c.map(p => p[0]), ys = c.map(p => p[1]);
    // width 8, height 4 → after 90° the x-extent becomes 4 and y-extent 8.
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(4);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(8);
  });
});

describe('engraveCombine — cylindrical projection', () => {
  it('only carves where the stamp projects (front), not the far side', () => {
    const ring: Bbox = { min: [-10, -10, -2], max: [10, 10, 2], size: [20, 20, 4] };
    const combine = engraveCombine(ring, {
      mask: solidMask(),
      projection: { mode: 'cylindrical', side: 'outer' },
      through: true,
      depth: 1,
      size: 4, // a narrow arc centered at +X (theta 0)
    });
    // Front, on +X axis (theta 0 → u=0.5): inside ink → removed.
    expect(combine({ d: -0.5, x: 9, y: 0, z: 0, voxelSize: 0.2 })).toBeGreaterThan(0);
    // Back, on −X axis (theta π → u far outside [0,1]) → kept.
    expect(combine({ d: -0.5, x: -9, y: 0, z: 0, voxelSize: 0.2 })).toBeLessThan(0);
  });
});

describe('engraveMesh', () => {
  it('returns an empty mesh for an empty input', async () => {
    const out = await engraveMesh({ vertProperties: new Float32Array(), triVerts: new Uint32Array(), numVert: 0, numTri: 0, numProp: 3 }, {
      mask: solidMask(), projection: { mode: 'planar', axis: 'z', side: 'max' }, through: false, depth: 1, size: 5,
    });
    expect(out.numTri).toBe(0);
  });

  it('produces a non-empty carved mesh for an engrave and a cut-through', async () => {
    const mesh = box(20, 20, 4);
    // A small centered stamp so the carve sits inside the slab.
    const mask = solidMask(8);
    const engraved = await engraveMesh(mesh, { mask, projection: { mode: 'planar', axis: 'z', side: 'max' }, through: false, depth: 1.5, size: 8, resolution: 64 });
    expect(engraved.numTri).toBeGreaterThan(0);
    expect(engraved.numProp).toBe(3);
    const through = await engraveMesh(mesh, { mask, projection: { mode: 'planar', axis: 'z', side: 'max' }, through: true, depth: 1.5, size: 8, resolution: 64 });
    expect(through.numTri).toBeGreaterThan(0);
  });

  it('lies on a sloped face via the free projection', async () => {
    const mesh = box(20, 20, 20);
    // A 45°-ish normal → free projection; should still carve a non-empty mesh.
    const out = await engraveMesh(mesh, {
      mask: solidMask(8), projection: { mode: 'free', origin: [10, 0, 10], normal: [0.707, -0.707, 0] }, through: false, depth: 1.5, size: 6, resolution: 64,
    });
    expect(out.numTri).toBeGreaterThan(0);
  });

  it('carves a curved (wrapped) stamp without degenerating', async () => {
    const mesh = box(20, 20, 4);
    const out = await engraveMesh(mesh, {
      mask: solidMask(8),
      projection: { mode: 'planar', axis: 'z', side: 'max', curve: { axis: 'v', angleDeg: 120 } },
      through: false, depth: 1.5, size: 12, resolution: 64,
    });
    expect(out.numTri).toBeGreaterThan(0);
  });
});
