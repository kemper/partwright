// Unit tests for the figure ACCESSORY ATTACHMENT layer added to
// src/geometry/sdfFigure.ts — the derived rig frames (ring/shoulder/back/
// forearm) and the placement verbs (ring/ringPoint/strap/hangFrom/onFace).
// Pure rig math (no WASM): meshing is exercised headlessly via model:preview.

import { describe, it, expect } from 'vitest';
import { __figureTestables__, createFigureNamespace } from '../../src/geometry/sdfFigure';
import { __testables__ as sdfT } from '../../src/geometry/sdf';
import type { SdfApi, Vec3 } from '../../src/geometry/sdfFigure';

const { buildRig, ringBand, ringPoint, strap, hangFrom, onFace } = __figureTestables__;

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
    expect(typeof F.ringPoint).toBe('function');
    expect(typeof F.strap).toBe('function');
    expect(typeof F.hangFrom).toBe('function');
    expect(typeof F.onFace).toBe('function');
    // ring() returns a buildable node; onFace() returns the frame.
    expect(typeof F.ring(rig.ring.neck, { tube: 0.3 }).bounds).toBe('function');
    expect(F.onFace(rig).forward.length).toBe(3);
  });
});
