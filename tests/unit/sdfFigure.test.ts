// Unit tests for src/geometry/sdfFigure.ts — the deterministic rig math
// behind api.sdf.figure. Pure logic (no WASM): proportion scaling, pose
// forward-kinematics, left/right symmetry, the joint-overlap invariant that
// keeps a figure one component, and option validation. Meshing the parts is
// exercised headlessly via model:preview / the e2e tier.

import { describe, it, expect } from 'vitest';
import { __figureTestables__ } from '../../src/geometry/sdfFigure';
import { __testables__ as sdfT, partitionByLabel, type SdfNode } from '../../src/geometry/sdf';
import type { SdfApi } from '../../src/geometry/sdfFigure';

const { buildRig, buildMouthPart, buildMouthAccents, buildEyes, faceDetail } = __figureTestables__;

/** Minimal engine-free SdfApi over the raw primitive factories — enough for
 *  the part builders (only `.build()` needs the engine binding). */
const api: SdfApi = {
  sphere: sdfT.primSphere,
  ellipsoid: sdfT.primEllipsoid,
  box: sdfT.primBox,
  roundedBox: sdfT.primRoundedBox,
  cylinder: sdfT.primCylinder,
  roundedCylinder: sdfT.primRoundedCylinder,
  capsule: sdfT.primCapsule,
  union: (...nodes) => nodes.reduce((a, b) => sdfT.opUnion(a, b)),
} as unknown as SdfApi;

const dist = (a: number[], b: number[]): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('figure rig — proportions', () => {
  it('places the crown at z = height and sole landmarks near 0', () => {
    const rig = buildRig({ height: 80 });
    expect(rig.joints.crown[2]).toBeCloseTo(80, 6);
    // ankles sit just above the ground; feet bring it to z≈0.
    expect(rig.joints.ankleL[2]).toBeLessThan(80 * 0.1);
    expect(rig.joints.ankleL[2]).toBeGreaterThan(0);
  });

  it('lower headsTall yields a proportionally larger head', () => {
    const chibi = buildRig({ height: 60, headsTall: 3 });
    const adult = buildRig({ height: 60, headsTall: 8 });
    expect(chibi.r.head).toBeGreaterThan(adult.r.head);
  });

  it('scales every landmark linearly with height', () => {
    const a = buildRig({ height: 60 });
    const b = buildRig({ height: 120 });
    expect(b.joints.shoulderL[0]).toBeCloseTo(a.joints.shoulderL[0] * 2, 5);
    expect(b.joints.hipL[2]).toBeCloseTo(a.joints.hipL[2] * 2, 5);
  });

  it('stocky build widens limbs vs slim', () => {
    const slim = buildRig({ build: 'slim' });
    const stocky = buildRig({ build: 'stocky' });
    expect(stocky.r.upperArm).toBeGreaterThan(slim.r.upperArm);
    expect(stocky.r.chestX).toBeGreaterThan(slim.r.chestX);
  });

  it('never inverts the hip above the shoulders, even for an extreme head', () => {
    for (const headsTall of [2, 3, 5, 8, 12]) {
      const rig = buildRig({ headsTall });
      expect(rig.joints.hipL[2]).toBeLessThan(rig.joints.shoulderL[2]);
      expect(rig.joints.kneeL[2]).toBeLessThan(rig.joints.hipL[2]);
    }
  });
});

describe('figure rig — symmetry', () => {
  it('mirrors L/R joints across X for a symmetric pose', () => {
    const rig = buildRig({});
    for (const name of ['shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle']) {
      const L = rig.joints[`${name}L`];
      const R = rig.joints[`${name}R`];
      expect(L[0]).toBeCloseTo(-R[0], 5);  // opposite X
      expect(L[1]).toBeCloseTo(R[1], 5);   // same Y
      expect(L[2]).toBeCloseTo(R[2], 5);   // same Z
    }
  });

  it('puts the figure-left eye on +X and the right eye on −X (facing −Y)', () => {
    const rig = buildRig({});
    expect(rig.face.eyeL[0]).toBeGreaterThan(0);
    expect(rig.face.eyeR[0]).toBeLessThan(0);
    expect(rig.face.eyeL[0]).toBeCloseTo(-rig.face.eyeR[0], 5);
  });

  it('places the nose in front (−Y) of the head center', () => {
    const rig = buildRig({});
    expect(rig.face.nose[1]).toBeLessThan(rig.joints.headCenter[1]);
  });
});

describe('figure rig — pose forward kinematics', () => {
  it('abduct 90 swings the upper arm straight out to the side', () => {
    const rig = buildRig({ height: 60, pose: { armL: { abduct: 90 } } });
    const S = rig.joints.shoulderL, E = rig.joints.elbowL;
    // elbow moves out in +X at (near) the shoulder height.
    expect(E[0]).toBeGreaterThan(S[0]);
    expect(E[2]).toBeCloseTo(S[2], 4);
  });

  it('abduct 0 hangs the upper arm straight down', () => {
    const rig = buildRig({ pose: { armL: { abduct: 0 } } });
    const S = rig.joints.shoulderL, E = rig.joints.elbowL;
    expect(E[2]).toBeLessThan(S[2]);
    expect(E[0]).toBeCloseTo(S[0], 4);
  });

  it('elbow flexion moves the wrist (curls the forearm)', () => {
    const straight = buildRig({ pose: { armL: { abduct: 90, elbow: 0 } } });
    const curled = buildRig({ pose: { armL: { abduct: 90, elbow: 120 } } });
    expect(dist(straight.joints.wristL, curled.joints.wristL)).toBeGreaterThan(1);
  });

  it('head turn rotates the face anchors off the centreline', () => {
    const fwd = buildRig({ pose: { head: { turn: 0 } } });
    const turned = buildRig({ pose: { head: { turn: 40 } } });
    expect(dist(fwd.face.nose, turned.face.nose)).toBeGreaterThan(0.5);
  });

  it('twist rolls the forearm-curl plane so a raised arm can curl the fist up', () => {
    // With the arm out to the side, elbow alone curls backward; twist lifts the
    // fist UP (the double-biceps / ballet-fifth pose that needs the roll DOF).
    const noTwist = buildRig({ pose: { armL: { abduct: 90, elbow: 95, twist: 0 } } });
    const rolled = buildRig({ pose: { armL: { abduct: 90, elbow: 95, twist: 90 } } });
    // twist must move the wrist, and lift it above the no-twist wrist.
    expect(dist(noTwist.joints.wristL, rolled.joints.wristL)).toBeGreaterThan(2);
    expect(rolled.joints.wristL[2]).toBeGreaterThan(noTwist.joints.wristL[2]);
  });
});

describe('figure rig — symmetric pose shorthand', () => {
  it('`arms` / `legs` seed both sides symmetrically', () => {
    const rig = buildRig({ pose: { arms: { abduct: 90 }, legs: { abduct: 25 } } });
    // both elbows swing out (abduct 90); symmetric in X.
    expect(rig.joints.elbowL[0]).toBeGreaterThan(rig.joints.shoulderL[0]);
    expect(rig.joints.elbowR[0]).toBeLessThan(rig.joints.shoulderR[0]);
    expect(rig.joints.elbowL[0]).toBeCloseTo(-rig.joints.elbowR[0], 5);
    expect(rig.joints.kneeL[0]).toBeCloseTo(-rig.joints.kneeR[0], 5);
  });
  it('per-side keys override the shorthand', () => {
    const rig = buildRig({ pose: { arms: { abduct: 90 }, armL: { abduct: 0 } } });
    // left arm hangs down (abduct 0), right stays out (abduct 90).
    expect(rig.joints.elbowL[2]).toBeLessThan(rig.joints.shoulderL[2]);
    expect(rig.joints.elbowR[0]).toBeLessThan(rig.joints.shoulderR[0]);
  });
});

describe('figure rig — one-component invariants', () => {
  // The welded figure stays a single component because (a) adjacent bones in a
  // chain share their joint endpoint exactly, so the capsules always overlap at
  // the joint, and (b) the chain roots (shoulder, hip) sit inside the torso
  // masses they weld into. Both hold regardless of pose.
  it('keeps every bone non-degenerate across a range of poses', () => {
    for (const elbow of [0, 60, 120]) {
      for (const abduct of [0, 45, 90, 140]) {
        const rig = buildRig({ pose: { armL: { abduct, elbow }, legL: { abduct: 20, knee: 60 } } });
        expect(dist(rig.joints.shoulderL, rig.joints.elbowL)).toBeGreaterThan(1);
        expect(dist(rig.joints.elbowL, rig.joints.wristL)).toBeGreaterThan(1);
        expect(dist(rig.joints.hipL, rig.joints.kneeL)).toBeGreaterThan(1);
        expect(dist(rig.joints.kneeL, rig.joints.ankleL)).toBeGreaterThan(1);
      }
    }
  });
  it('roots the arm at the chest and the leg at the pelvis (limbs attach)', () => {
    const rig = buildRig({});
    // shoulder X within chest half-width + the deltoid cap that bridges it.
    expect(Math.abs(rig.joints.shoulderL[0])).toBeLessThan(rig.r.chestX + rig.r.upperArm * 1.15);
    // hip X within the pelvis mass + thigh radius.
    expect(Math.abs(rig.joints.hipL[0])).toBeLessThan(rig.r.pelvisX + rig.r.thigh);
  });
});

describe('figure mouth — styles', () => {
  const rig = buildRig({ height: 60, headsTall: 5 });

  it('defaults to a carved smile line', () => {
    const mouth = buildMouthPart(api, rig);
    expect(mouth.mode).toBe('carve');
    // The arc passes through (just below) the mouth anchor, so the anchor
    // point lies INSIDE the cutter.
    const m = rig.face.mouth;
    expect(mouth.node.evaluate(m[0], m[1], m[2])).toBeLessThan(0);
  });

  it('spans roughly the requested width', () => {
    const width = rig.r.head * 0.6;
    const mouth = buildMouthPart(api, rig, { width });
    const b = mouth.node.bounds();
    expect(b.max[0] - b.min[0]).toBeGreaterThan(width * 0.9);
  });

  it('`open` implies the open-cavity style and carves', () => {
    const mouth = buildMouthPart(api, rig, { open: 0.7 });
    expect(mouth.mode).toBe('carve');
    const m = rig.face.mouth;
    // The cavity straddles the anchor.
    expect(mouth.node.evaluate(m[0], m[1], m[2])).toBeLessThan(0);
  });

  it("style 'lips' keeps the protruding additive ridge", () => {
    const mouth = buildMouthPart(api, rig, { style: 'lips', smirk: 0.4 });
    expect(mouth.mode).toBe('add');
  });

  it('an open mouth gapes wider with larger `open`', () => {
    const small = buildMouthPart(api, rig, { open: 0.2 }).node.bounds();
    const big = buildMouthPart(api, rig, { open: 1 }).node.bounds();
    expect(big.max[2] - big.min[2]).toBeGreaterThan(small.max[2] - small.min[2]);
  });

  it('rejects bad style / out-of-range open / unknown keys', () => {
    expect(() => buildMouthPart(api, rig, { style: 'frown' })).toThrow(/style/);
    expect(() => buildMouthPart(api, rig, { open: 2 })).toThrow();
    expect(() => buildMouthPart(api, rig, { fangs: true })).toThrow();
  });
});

describe('figure eyes — styles and labels', () => {
  const rig = buildRig({ height: 60, headsTall: 5 });
  const labelsOf = (node: unknown): string[] =>
    partitionByLabel(node as SdfNode).map(p => p.labelName).filter((n): n is string => !!n).sort();

  it("iris style (the default) pre-labels eyes / iris / pupil regions", () => {
    expect(labelsOf(buildEyes(api, rig))).toEqual(['eyes', 'iris', 'pupil']);
  });

  it('solid style returns one unlabelled pair for the caller to label', () => {
    expect(labelsOf(buildEyes(api, rig, { style: 'solid' }))).toEqual([]);
  });

  it('pupil protrudes beyond the iris, iris beyond the eyeball', () => {
    const f = rig.dir.headForward;
    const reach = (node: unknown): number => {
      // farthest extent along the forward (−Y) axis
      const b = (node as SdfNode).bounds();
      return f[1] < 0 ? -b.min[1] : b.max[1];
    };
    const sclera = buildEyes(api, rig, { style: 'solid' });
    const all = buildEyes(api, rig);
    expect(reach(all)).toBeGreaterThan(reach(sclera) + 1e-6);
  });

  it('rejects unknown style and keys', () => {
    expect(() => buildEyes(api, rig, { style: 'laser' })).toThrow(/style/);
    expect(() => buildEyes(api, rig, { glow: true })).toThrow();
  });
});

describe('figure mouthAccents — paintable teeth and lips', () => {
  const rig = buildRig({ height: 60, headsTall: 5 });
  const labelsOf = (node: unknown): string[] =>
    partitionByLabel(node as SdfNode).map(p => p.labelName).filter((n): n is string => !!n).sort();

  it('open style yields teeth + lips regions by default', () => {
    expect(labelsOf(buildMouthAccents(api, rig, { style: 'open', open: 0.6 })))
      .toEqual(['lips', 'teeth']);
  });

  it('teeth/lips can be disabled individually', () => {
    expect(labelsOf(buildMouthAccents(api, rig, { open: 0.6, teeth: false }))).toEqual(['lips']);
    expect(labelsOf(buildMouthAccents(api, rig, { open: 0.6, lips: false }))).toEqual(['teeth']);
  });

  it("lips style yields the labelled ridge", () => {
    expect(labelsOf(buildMouthAccents(api, rig, { style: 'lips' }))).toEqual(['lips']);
  });

  it("smile style and fully-disabled accents throw with guidance", () => {
    expect(() => buildMouthAccents(api, rig, { style: 'smile' })).toThrow(/smile/);
    expect(() => buildMouthAccents(api, rig, { open: 0.6, teeth: false, lips: false })).toThrow(/nothing/);
  });

  it('accents straddle the mouth anchor (they will fuse into the face)', () => {
    const node = buildMouthAccents(api, rig, { open: 0.6 }) as SdfNode;
    const m = rig.face.mouth;
    const b = node.bounds();
    expect(m[0]).toBeGreaterThan(b.min[0]);
    expect(m[0]).toBeLessThan(b.max[0]);
    expect(m[2]).toBeGreaterThan(b.min[2]);
    expect(m[2]).toBeLessThan(b.max[2]);
  });
});

describe('figure faceDetail — detail-region helper', () => {
  const rig = buildRig({ height: 60, headsTall: 5 });

  it('centres on the head and covers every face anchor', () => {
    const d = faceDetail(rig);
    expect(d.center).toEqual(rig.joints.headCenter);
    for (const a of Object.values(rig.face)) {
      const dist = Math.hypot(a[0] - d.center[0], a[1] - d.center[1], a[2] - d.center[2]);
      expect(dist).toBeLessThan(d.radius);
    }
  });

  it('scales the target edge with head size and stays fine', () => {
    const chibi = faceDetail(buildRig({ height: 60, headsTall: 3 }));
    const adult = faceDetail(buildRig({ height: 60, headsTall: 8 }));
    expect(chibi.edgeLength).toBeGreaterThan(adult.edgeLength);
    expect(adult.edgeLength).toBeLessThan(adult.radius * 0.1);
  });

  it('honours overrides and rejects unknown keys', () => {
    const d = faceDetail(rig, { radius: 12, edgeLength: 0.1 });
    expect(d.radius).toBe(12);
    expect(d.edgeLength).toBe(0.1);
    expect(() => faceDetail(rig, { density: 2 })).toThrow();
  });
});

describe('figure rig — validation', () => {
  it('rejects unknown top-level keys', () => {
    expect(() => buildRig({ heigth: 60 })).toThrow();
  });
  it('rejects an unknown build preset', () => {
    expect(() => buildRig({ build: 'huge' })).toThrow(/build/);
  });
  it('rejects out-of-range headsTall', () => {
    expect(() => buildRig({ headsTall: 1 })).toThrow();
    expect(() => buildRig({ headsTall: 20 })).toThrow();
  });
  it('rejects unknown pose joint keys', () => {
    expect(() => buildRig({ pose: { armL: { bend: 90 } } })).toThrow();
    expect(() => buildRig({ pose: { wings: {} } })).toThrow();
  });
  it('accepts an empty / omitted opts object', () => {
    expect(() => buildRig(undefined)).not.toThrow();
    expect(() => buildRig({})).not.toThrow();
  });
});
