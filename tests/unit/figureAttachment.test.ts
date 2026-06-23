// Unit tests for the figure ACCESSORY ATTACHMENT layer added to
// src/geometry/sdfFigure.ts — the derived rig frames (ring/shoulder/back/
// forearm) and the placement verbs (ring/ringPoint/strap/hangFrom/onFace).
// Pure rig math (no WASM): meshing is exercised headlessly via model:preview.

import { describe, it, expect } from 'vitest';
import { __figureTestables__, createFigureNamespace } from '../../src/geometry/sdfFigure';
import { __testables__ as sdfT } from '../../src/geometry/sdf';
import type { SdfApi, Vec3 } from '../../src/geometry/sdfFigure';

const { buildRig, ringBand, buildBand, buildLayers, ringPoint, strap, hangFrom, onFace } = __figureTestables__;

const api: SdfApi = {
  sphere: sdfT.primSphere,
  ellipsoid: sdfT.primEllipsoid,
  box: sdfT.primBox,
  roundedBox: sdfT.primRoundedBox,
  cylinder: sdfT.primCylinder,
  roundedCylinder: sdfT.primRoundedCylinder,
  capsule: sdfT.primCapsule,
  union: (...nodes) => nodes.reduce((a, b) => sdfT.opUnion(a, b)),
  __fineHands: (node, regions) => sdfT.opFineHands(node, regions),
} as unknown as SdfApi;

const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('rig attachment frames', () => {
  it('exposes ring/shoulder/back/forearm frames with sane geometry', () => {
    const rig = buildRig({ height: 64, headsTall: 7 });
    // Ring frames: positive semi-axes, neck above the waist, world-down hang.
    expect(rig.ring.neck.rx).toBeGreaterThan(0);
    expect(rig.ring.waist.rx).toBeGreaterThan(0);
    expect(rig.ring.neck.center[2]).toBeGreaterThan(rig.ring.waist.center[2]);
    expect(rig.ring.waist.hang).toEqual([0, 0, -1]);
    // Neutral pose: axes are the world basis.
    expect(rig.ring.neck.axis[2]).toBeCloseTo(1, 6);
    expect(rig.ring.neck.xAxis[0]).toBeCloseTo(1, 6);
    expect(rig.ring.neck.yAxis[1]).toBeCloseTo(1, 6);
  });

  it('places shoulders symmetrically (L on +X, R on −X) above the waist', () => {
    const rig = buildRig({ height: 64 });
    expect(rig.shoulder.L[0]).toBeGreaterThan(0);
    expect(rig.shoulder.R[0]).toBeLessThan(0);
    expect(rig.shoulder.L[0]).toBeCloseTo(-rig.shoulder.R[0], 6);
    expect(rig.shoulder.L[2]).toBeGreaterThan(rig.ring.waist.center[2]);
  });

  it('puts the back point behind the body (+Y) with an outward +Y normal', () => {
    const rig = buildRig({ height: 64 });
    expect(rig.back.point[1]).toBeGreaterThan(0);
    expect(rig.back.normal[1]).toBeCloseTo(1, 6);
  });

  it('builds forearm frames matching the elbow→wrist joints', () => {
    const rig = buildRig({ height: 64 });
    expect(rig.forearm.L.a).toEqual(rig.joints.lowerArmL);
    expect(rig.forearm.L.b).toEqual(rig.joints.wristL);
    expect(rig.forearm.L.length).toBeCloseTo(dist(rig.joints.lowerArmL as Vec3, rig.joints.wristL as Vec3), 6);
    expect(Math.hypot(...rig.forearm.L.axis)).toBeCloseTo(1, 6);
    expect(rig.forearm.L.radius).toBeCloseTo(rig.r.lowerArm, 6);
  });

  it('carries the frames through a spine lean (they are not the rest pose)', () => {
    const upright = buildRig({ height: 64 });
    const leaned = buildRig({ height: 64, pose: { spine: { lean: 30, turn: 0, side: 0 } } });
    // A forward lean (about the waist) tips the neck ring forward (−Y) vs upright.
    expect(leaned.ring.neck.center[1]).toBeLessThan(upright.ring.neck.center[1] - 1e-3);
    // ...and tilts its up-axis away from world-Z.
    expect(leaned.ring.neck.axis[2]).toBeLessThan(0.999);
  });
});

describe('grip frame — palm side (held props seat in the palm, not the knuckles)', () => {
  it('palmNormal points to the hand palm: cross(foreDir, hinge), not its negative', () => {
    const rig = buildRig({ height: 64, pose: { armR: { raiseSide: 40, bend: 30 } } });
    const foreDir = rig.dir.lowerArmR as Vec3;
    const hinge = rig.dir.elbowHingeR as Vec3;
    // The hand builder (placedHand) maps the canonical palm (+Y) to cross(dir,
    // splay) = cross(foreDir, hinge); the grip frame MUST match that sign so a
    // held prop seats in the finger cup, not on the back of the hand.
    const cx = [
      foreDir[1] * hinge[2] - foreDir[2] * hinge[1],
      foreDir[2] * hinge[0] - foreDir[0] * hinge[2],
      foreDir[0] * hinge[1] - foreDir[1] * hinge[0],
    ];
    const l = Math.hypot(...cx) || 1;
    const expected: Vec3 = [cx[0] / l, cx[1] / l, cx[2] / l];
    const dot = rig.grip.R.palmNormal[0] * expected[0] + rig.grip.R.palmNormal[1] * expected[1] + rig.grip.R.palmNormal[2] * expected[2];
    expect(dot).toBeGreaterThan(0.99); // same direction (not flipped)
    // The grip point sits toward the palm: offset from the hand centre ALONG palmNormal.
    const off = [
      rig.grip.R.point[0] - rig.joints.handR[0],
      rig.grip.R.point[1] - rig.joints.handR[1],
      rig.grip.R.point[2] - rig.joints.handR[2],
    ];
    const offDot = off[0] * rig.grip.R.palmNormal[0] + off[1] * rig.grip.R.palmNormal[1] + off[2] * rig.grip.R.palmNormal[2];
    expect(offDot).toBeGreaterThan(0);
  });
});

describe('grip frame — thumb axis + `thumb` pose hint', () => {
  it('exposes a thumbAxis that curls over the front of the grip (≈ reach+palm)', () => {
    const rig = buildRig({ height: 64, pose: { armR: { raiseSide: 30, bend: 40 } } });
    const g = rig.grip.R;
    // The thumb is roughly along reach + palmNormal (it folds over the fingers),
    // so it has a strong positive projection onto their sum and is ⊥-ish to the
    // grip axis (the held bar).
    const sum = [g.reach[0] + g.palmNormal[0], g.reach[1] + g.palmNormal[1], g.reach[2] + g.palmNormal[2]];
    const sl = Math.hypot(...sum) || 1;
    const proj = (g.thumbAxis[0] * sum[0] + g.thumbAxis[1] * sum[1] + g.thumbAxis[2] * sum[2]) / sl;
    expect(proj).toBeGreaterThan(0.6);
    expect(Math.hypot(...g.thumbAxis)).toBeCloseTo(1, 6);
  });

  it("thumb:'in' turns the wrist so the thumb leans toward the body midline", () => {
    // Right arm: midline is +X. thumb:'in' should give a +X-leaning thumb; the
    // opposite target 'out' should flip that lateral lean negative.
    const inn = buildRig({ height: 64, pose: { armR: { raiseSide: 14, raiseFwd: 35, bend: 80, thumb: 'in' } } });
    const out = buildRig({ height: 64, pose: { armR: { raiseSide: 14, raiseFwd: 35, bend: 80, thumb: 'out' } } });
    expect(inn.grip.R.thumbAxis[0]).toBeGreaterThan(0);            // leans inward (+X) for the right hand
    expect(inn.grip.R.thumbAxis[0]).toBeGreaterThan(out.grip.R.thumbAxis[0]); // 'in' is more +X than 'out'
  });
});

describe('ringPoint', () => {
  it('maps azimuth to the right side of the body', () => {
    const rig = buildRig({ height: 64 });
    const w = rig.ring.waist;
    const front = ringPoint(w, 0);
    const left = ringPoint(w, 90);
    const right = ringPoint(w, -90);
    // 0° = front (−Y), in front of the centre.
    expect(front[1]).toBeLessThan(w.center[1]);
    // 90° = figure-left (+X); −90° = right (−X).
    expect(left[0]).toBeGreaterThan(w.center[0]);
    expect(right[0]).toBeLessThan(w.center[0]);
    // The left/right points sit ≈ rx out laterally.
    expect(left[0] - w.center[0]).toBeCloseTo(w.rx, 4);
  });

  it('clearance pushes the point further out', () => {
    const rig = buildRig({ height: 64 });
    const w = rig.ring.waist;
    const near = ringPoint(w, 90, {});
    const far = ringPoint(w, 90, { clearance: 5 });
    expect(far[0] - near[0]).toBeCloseTo(5, 4);
  });
});

describe('ring / strap / hangFrom geometry', () => {
  it('ringBand wraps the body cross-section (bounds ≈ ±(rx+off))', () => {
    const rig = buildRig({ height: 64 });
    const w = rig.ring.waist;
    const tube = 0.4;
    const band = ringBand(api, w, { tube, clearance: 0, segments: 32 });
    const b = band.bounds();
    // The band centre-line rides at rx+clearance+tube, so its inner edge touches
    // the surface (+clearance) and its outer edge is rx+clearance+2·tube.
    expect(b.max[0]).toBeCloseTo(w.rx + 2 * tube, 1);
    expect(b.min[0]).toBeCloseTo(-(w.rx + 2 * tube), 1);
    // It's a thin band in Z (a wrap, not a tube along the body).
    expect(b.max[2] - b.min[2]).toBeLessThan(2 * tube + 0.2);
  });

  it('ringBand drape dips the front of the loop below the plain ring', () => {
    const rig = buildRig({ height: 64 });
    const plain = ringBand(api, rig.ring.neck, { tube: 0.3, segments: 32 });
    const draped = ringBand(api, rig.ring.neck, { tube: 0.3, segments: 32, drape: 6 });
    // The draped necklace reaches lower (front dips down the chest).
    expect(draped.bounds().min[2]).toBeLessThan(plain.bounds().min[2] - 3);
  });

  it('ringBand occlude carves the band where an occluder covers it', () => {
    const rig = buildRig({ height: 64 });
    const w = rig.ring.waist;
    const tube = 0.4;
    const full = ringBand(api, w, { tube, segments: 48 });
    // A big slab across the +X side should remove that side of the band.
    const slab = api.box([w.rx * 4, w.ry * 4, 4]).translate([w.rx * 2, 0, w.center[2]]);
    const carved = ringBand(api, w, { tube, segments: 48, occlude: slab });
    // The band's +X centre-line point is solid in the full ring, carved away in
    // the occluded one (subtract doesn't shrink analytic bounds — test the field).
    const px = w.center[0] + w.rx + tube, pz = w.center[2];
    expect(full.evaluate(px, 0, pz)).toBeLessThan(0);
    expect(carved.evaluate(px, 0, pz)).toBeGreaterThan(0);
  });

  it('buildBand makes a FLUSH band that hugs the surface and clips to height', () => {
    const rig = buildRig({ height: 64 });
    const w = rig.ring.waist;
    const R = w.rx;
    // A torso-ish cylinder centred on the waist frame (tall, so it spans the band).
    const surface = api.cylinder(R, 40).translate([w.center[0], w.center[1], w.center[2]]);
    const thickness = 0.5, height = 4;
    const band = buildBand(api, w, { surface, thickness, height });
    const z = w.center[2];
    // Flush: a point right AT the body surface (radius R) at band height is INSIDE
    // the band (the band is a slice of the surface grown outward), while a point
    // beyond the proud face (R + thickness + margin) is OUTSIDE.
    expect(band.evaluate(w.center[0] + R, w.center[1], z)).toBeLessThan(0);
    expect(band.evaluate(w.center[0] + R + thickness + 0.4, w.center[1], z)).toBeGreaterThan(0);
    // Clipped to a height band: well above the slice is empty even at the surface.
    expect(band.evaluate(w.center[0] + R, w.center[1], z + height)).toBeGreaterThan(0);
  });

  it('buildBand occlude carves the band where an occluder covers it', () => {
    const rig = buildRig({ height: 64 });
    const w = rig.ring.waist;
    const R = w.rx;
    const surface = api.cylinder(R, 40).translate([w.center[0], w.center[1], w.center[2]]);
    const z = w.center[2];
    const px = w.center[0] + R;   // a point on the +X surface, inside a plain band
    const full = buildBand(api, w, { surface, thickness: 0.5, height: 4 });
    expect(full.evaluate(px, w.center[1], z)).toBeLessThan(0);
    // A slab across the +X side removes that side of the band.
    const slab = api.box([R * 4, R * 4, 8]).translate([R * 2, 0, z]);
    const carved = buildBand(api, w, { surface, thickness: 0.5, height: 4, occlude: slab });
    expect(carved.evaluate(px, w.center[1], z)).toBeGreaterThan(0);
  });

  it('strap spans both anchors', () => {
    const rig = buildRig({ height: 64 });
    const a = rig.shoulder.L;
    const bPt = ringPoint(rig.ring.waist, -90); // opposite (right) hip
    const band = strap(api, a, bPt, { tube: 0.5, bow: 1, segments: 12 });
    const bb = band.bounds();
    // Bounds enclose both endpoints (within the tube radius).
    expect(bb.min[2]).toBeLessThanOrEqual(Math.min(a[2], bPt[2]) + 0.5);
    expect(bb.max[2]).toBeGreaterThanOrEqual(Math.max(a[2], bPt[2]) - 0.5);
  });

  it('hangFrom drops a node so its top sits at point − drop', () => {
    const node = api.box([2, 2, 6]); // centred: z ∈ [−3, 3]
    const hung = hangFrom(node, [0, 0, 20], { anchor: 'top', drop: 2 });
    const b = hung.bounds();
    expect(b.max[2]).toBeCloseTo(18, 4);     // top at 20 − 2
    expect(b.min[2]).toBeCloseTo(12, 4);     // 6 tall below it
  });
});

describe('buildLayers — priority composite + limb occlusion', () => {
  it('NO-HOLE: carves a lower layer by the higher layer\'s OCCLUDED solid, not the raw one', () => {
    const rig = buildRig({ height: 64 });
    const A = api.box([10, 2, 2]);                       // bar along X, x∈[−5,5]
    const B = api.box([2, 2, 2]).translate([3, 0, 0]);   // sits inside A at x∈[2,4]
    const occ = api.box([3, 3, 3]).translate([3, 0, 0]); // fully covers B → B occludes to nothing
    const out = buildLayers(api, rig, [
      { node: A, priority: 0, carve: true },
      { node: B, priority: 1, carve: true, occlude: occ },
    ]);
    // B is entirely occluded away, so it must NOT punch a hole in A where it was:
    // A is carved by B's OCCLUDED (empty) solid, not raw B. (A naive raw-B subtract
    // would leave (3,0,0) empty since B is gone — the bug this algorithm prevents.)
    expect(out.evaluate(3, 0, 0)).toBeLessThan(0);
  });

  it('leaves a carve:false base fully intact', () => {
    const rig = buildRig({ height: 64 });
    const base = api.box([6, 6, 6]);
    const over = api.box([6, 6, 6]).translate([3, 0, 0]); // overlaps base's +X half
    const out = buildLayers(api, rig, [
      { node: base, priority: 0, carve: false },          // never trimmed
      { node: over, priority: 1, carve: true },
    ]);
    // The base center is solid, and so is the contested +X region (base not carved).
    expect(out.evaluate(0, 0, 0)).toBeLessThan(0);
    expect(out.evaluate(2.4, 0, 0)).toBeLessThan(0);
  });

  it('occludeArms carves the (dilated) rig arms from a torso layer without throwing', () => {
    const rig = buildRig({ height: 64, pose: { armR: { raiseSide: 8 }, armL: { raiseSide: 8 } } });
    const w = rig.ring.waist;
    // A torso band that would otherwise wrap the arms; occludeArms should trim them.
    const band = buildBand(api, w, { surface: api.cylinder(w.rx, 40).translate([w.center[0], w.center[1], w.center[2]]), thickness: 0.5, height: 4 });
    const out = buildLayers(api, rig, [{ node: band, label: 'belt', priority: 1, occludeArms: 0.5 }]);
    expect(typeof out.bounds).toBe('function');
    expect(typeof out.evaluate).toBe('function');
  });
});

describe('onFace frame', () => {
  it('returns a right-handed face frame (forward ≈ −Y, up ≈ +Z, lateral ≈ +X)', () => {
    const rig = buildRig({ height: 64 });
    const f = onFace(rig);
    expect(f.forward[1]).toBeLessThan(0);
    expect(f.up[2]).toBeGreaterThan(0);
    expect(f.lateral[0]).toBeGreaterThan(0);
    // Bridge sits between the two eyes.
    expect(f.bridge[0]).toBeCloseTo((rig.face.eyeL[0] + rig.face.eyeR[0]) / 2, 6);
    // Temples are the ear anchors.
    expect(f.templeL).toEqual(rig.face.earL);
  });
});

describe('figure namespace wiring', () => {
  it('exposes the new verbs on the figure namespace', () => {
    const F = createFigureNamespace(api);
    const rig = F.rig({ height: 64 });
    expect(typeof F.ring).toBe('function');
    expect(typeof F.band).toBe('function');
    expect(typeof F.ringPoint).toBe('function');
    expect(typeof F.strap).toBe('function');
    expect(typeof F.hangFrom).toBe('function');
    expect(typeof F.onFace).toBe('function');
    // ring() returns a buildable node; onFace() returns the frame.
    expect(typeof F.ring(rig.ring.neck, { tube: 0.3 }).bounds).toBe('function');
    expect(F.onFace(rig).forward.length).toBe(3);
  });
});
