// Unit tests for src/geometry/sdfFigure.ts — the deterministic rig math
// behind api.sdf.figure. Pure logic (no WASM): proportion scaling, pose
// forward-kinematics, left/right symmetry, the joint-overlap invariant that
// keeps a figure one component, and option validation. Meshing the parts is
// exercised headlessly via model:preview / the e2e tier.

import { describe, it, expect } from 'vitest';
import { __figureTestables__ } from '../../src/geometry/sdfFigure';
import { __testables__ as sdfT, partitionByLabel, type SdfNode } from '../../src/geometry/sdf';
import type { SdfApi } from '../../src/geometry/sdfFigure';

const { buildRig, buildMouthPart, buildMouthAccents, buildEyes, faceDetail, buildPants, buildHands, handDetail, buildHair } = __figureTestables__;

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

  it('elbow flexion curls a hanging forearm FORWARD (−Y), like a real elbow', () => {
    // Regression: the hinge sign once curled the forearm BACKWARD (+Y) — the
    // same sign-bug family as the knee. A hanging arm with a bent elbow must
    // bring the wrist forward of the body and raise it, on both sides.
    for (const side of ['L', 'R'] as const) {
      const straight = buildRig({ pose: { [`arm${side}`]: { abduct: 0, elbow: 0 } } });
      const bent = buildRig({ pose: { [`arm${side}`]: { abduct: 0, elbow: 70 } } });
      expect(bent.joints[`wrist${side}`][1]).toBeLessThan(straight.joints[`wrist${side}`][1] - 1);
      expect(bent.joints[`wrist${side}`][2]).toBeGreaterThan(straight.joints[`wrist${side}`][2] + 1);
    }
  });

  it('sitting pose (flex 90, knee 90) bends BOTH shanks down, symmetrically', () => {
    // Regression ×2: flex 90 makes the thigh (nearly) parallel to body-front.
    // The old cross(dir, fwd) knee hinge degenerated there — exactly parallel
    // bent the left knee UP ([side,0,0] fallback), and any nonzero abduct
    // swung the shins SIDEWAYS frog-style (the tiny abduct component
    // dominated the cross product). The frame-derived hinge must drop the
    // shins straight down in a chair sit, with or without stance width.
    for (const abduct of [0, 8]) {
      const rig = buildRig({ pose: { legs: { abduct, flex: 90, knee: 90 } } });
      for (const side of ['L', 'R'] as const) {
        const K = rig.joints[`knee${side}`], A = rig.joints[`ankle${side}`];
        expect(A[2]).toBeLessThan(K[2] - 1);     // shin drops below the knee
        // and stays under it, not swung out sideways (frog-sit regression).
        expect(Math.abs(A[0] - K[0])).toBeLessThan(2);
      }
      expect(rig.joints.ankleL[0]).toBeCloseTo(-rig.joints.ankleR[0], 5);
      expect(rig.joints.ankleL[2]).toBeCloseTo(rig.joints.ankleR[2], 5);
    }
  });

  it('knee flexion bends the shank BACKWARD (+Y), like a real knee', () => {
    // Regression: the hinge sign once swung the shank FORWARD, giving a
    // lunge a horizontal shin floating in front of the figure.
    const straight = buildRig({ pose: { legL: { abduct: 0, flex: 0, knee: 0 } } });
    const bent = buildRig({ pose: { legL: { abduct: 0, flex: 0, knee: 60 } } });
    expect(bent.joints.ankleL[1]).toBeGreaterThan(straight.joints.ankleL[1] + 1);
    // and the ankle rises (the shank shortens vertically when bent).
    expect(bent.joints.ankleL[2]).toBeGreaterThan(straight.joints.ankleL[2] + 1);
  });

  it('lunge: flex forward + matching knee bend puts the ankle under the knee', () => {
    const rig = buildRig({ pose: { legL: { abduct: 0, flex: 45, knee: 45 } } });
    const K = rig.joints.kneeL, A = rig.joints.ankleL;
    // shank vertical: ankle directly below the knee.
    expect(A[1]).toBeCloseTo(K[1], 4);
    expect(A[2]).toBeLessThan(K[2]);
  });

  it('head turn rotates the face anchors off the centreline', () => {
    const fwd = buildRig({ pose: { head: { turn: 0 } } });
    const turned = buildRig({ pose: { head: { turn: 40 } } });
    expect(dist(fwd.face.nose, turned.face.nose)).toBeGreaterThan(0.5);
  });

  it('twist rolls the forearm-curl plane so a raised arm can curl the fist up', () => {
    // With the arm out to the side, elbow alone curls forward; twist lifts the
    // fist UP (the double-biceps / ballet-fifth pose that needs the roll DOF).
    const noTwist = buildRig({ pose: { armL: { abduct: 90, elbow: 95, twist: 0 } } });
    const rolled = buildRig({ pose: { armL: { abduct: 90, elbow: 95, twist: 90 } } });
    // twist must move the wrist, and lift it above the no-twist wrist.
    expect(dist(noTwist.joints.wristL, rolled.joints.wristL)).toBeGreaterThan(2);
    expect(rolled.joints.wristL[2]).toBeGreaterThan(noTwist.joints.wristL[2]);
  });
});

describe('figure rig — documented pose recipes (public/ai/figure.md)', () => {
  // The recipes figure.md hands to modeling agents, asserted verbatim as rig
  // math. An FK change that breaks a documented recipe must fail HERE, in
  // vitest, not in a sculpt agent's render loop. If one of these fails after
  // an intentional FK change, update figure.md's recipe in the same commit.
  // (Chair-sit `legs: {flex: 90, knee: 90}` is pinned by the sitting-pose
  // test above; this block covers the remaining documented recipes.)

  it('double-biceps `arms: {abduct: 95, elbow: 95, twist: 90}` puts both fists up by the head', () => {
    const rig = buildRig({ height: 60, pose: { arms: { abduct: 95, elbow: 95, twist: 90 } } });
    for (const side of ['L', 'R'] as const) {
      const S = rig.joints[`shoulder${side}`], W = rig.joints[`wrist${side}`], H = rig.joints[`hand${side}`];
      // fist raised well above the shoulder, up beside the head…
      expect(W[2]).toBeGreaterThan(S[2] + rig.r.head);
      expect(H[2]).toBeGreaterThan(rig.joints.headCenter[2]);
      // …and OUT to the side (a flex pose, not hands clasped at the chest).
      expect(Math.abs(W[0])).toBeGreaterThan(Math.abs(S[0]) * 1.5);
    }
    expect(rig.joints.handL[0]).toBeCloseTo(-rig.joints.handR[0], 5);
    expect(rig.joints.handL[2]).toBeCloseTo(rig.joints.handR[2], 5);
  });

  it('ballet fifth `arms: {abduct: 150, elbow: 70, twist: 90}` rounds an "O" overhead', () => {
    const rig = buildRig({ height: 60, pose: { arms: { abduct: 150, elbow: 70, twist: 90 } } });
    for (const side of ['L', 'R'] as const) {
      const E = rig.joints[`elbow${side}`], H = rig.joints[`hand${side}`];
      // hands above the crown…
      expect(H[2]).toBeGreaterThan(rig.joints.crown[2]);
      // …curling inward toward the midline (the rounded "O") without crossing it.
      expect(Math.abs(H[0])).toBeLessThan(Math.abs(E[0]) * 0.6);
      expect(H[0] * E[0]).toBeGreaterThan(0); // same side of the midline
    }
    // the hands approach each other to close the "O" (gap under ~a head width).
    expect(dist(rig.joints.handL, rig.joints.handR)).toBeLessThan(rig.r.head * 2.2);
  });

  it('matched flex+knee keeps the shin vertical at any lunge depth', () => {
    // The generalized lunge rule behind figure.md's flex/knee guidance: a
    // forward step with knee bend equal to hip flex lands the ankle directly
    // under the knee. This is the configuration the old cross-product hinge
    // distorted as flex grew — sweep it well past the 45° case.
    for (const a of [20, 45, 70, 85]) {
      const rig = buildRig({ pose: { legL: { abduct: 0, flex: a, knee: a } } });
      const K = rig.joints.kneeL, A = rig.joints.ankleL;
      expect(A[0]).toBeCloseTo(K[0], 4);
      expect(A[1]).toBeCloseTo(K[1], 4);
      expect(A[2]).toBeLessThan(K[2]);
    }
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

describe('figure pants — posed-leg coverage', () => {
  it('pant cuffs stay ON the bone for a posed (lunge) leg', () => {
    // Regression: a fixed world-Z cuff endpoint pulled the pant shank off a
    // diagonal lunge shank entirely. The garment interior must contain the
    // shank-bone midpoint of BOTH legs.
    const rig = buildRig({ pose: { legL: { flex: 45, knee: 45 }, legR: { flex: -30, knee: 5 } } });
    const pants = buildPants(api, rig) as SdfNode;
    for (const side of ['L', 'R'] as const) {
      const K = rig.joints[`knee${side}`], A = rig.joints[`ankle${side}`];
      const mid = [(K[0] + A[0]) / 2, (K[1] + A[1]) / 2, (K[2] + A[2]) / 2];
      expect(pants.evaluate(mid[0], mid[1], mid[2])).toBeLessThan(0);
    }
  });

  it('a deeply bent knee stays covered (knee pad)', () => {
    const rig = buildRig({ pose: { legL: { flex: 45, knee: 70 } } });
    const pants = buildPants(api, rig) as SdfNode;
    const K = rig.joints.kneeL;
    // A point one skin-bulge radius FORWARD of the knee joint (where the
    // skin's weld bulge peaks) must still be inside the garment.
    const probe = [K[0], K[1] - rig.r.shank * 1.2, K[2]];
    expect(pants.evaluate(probe[0], probe[1], probe[2])).toBeLessThan(0);
  });

  it("length: 'briefs' skips the leg sleeves", () => {
    const rig = buildRig({});
    const briefs = buildPants(api, rig, { length: 'briefs' }) as SdfNode;
    const full = buildPants(api, rig) as SdfNode;
    const K = rig.joints.kneeL;
    // knee is bare in briefs, covered by full pants.
    expect(briefs.evaluate(K[0], K[1], K[2])).toBeGreaterThan(0);
    expect(full.evaluate(K[0], K[1], K[2])).toBeLessThan(0);
    // pelvis is covered by both.
    const P = rig.joints.pelvis;
    expect(briefs.evaluate(P[0], P[1], P[2] - rig.r.pelvisY * 0.3)).toBeLessThan(0);
  });

  it('rejects unknown length values', () => {
    const rig = buildRig({});
    expect(() => buildPants(api, rig, { length: 'capri' })).toThrow(/length/);
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

describe('figure hands — sculpted fingers', () => {
  const rig = buildRig({ height: 60, headsTall: 6 });

  it('sculpted open fingers reach past the legacy paddle hand', () => {
    // Straight fingers extend beyond the old flat paddle along the forearm.
    const blob = (buildHands(api, rig, { grip: 'open', fingers: false }) as SdfNode).bounds();
    const sculpted = (buildHands(api, rig, { grip: 'open' }) as SdfNode).bounds();
    expect(sculpted.min[2]).toBeLessThan(blob.min[2] - 0.5); // hanging arms: fingers point down
  });

  it('every grip contains the hand-centre joint (welds to the arm)', () => {
    for (const grip of ['fist', 'open', 'relaxed'] as const) {
      const hands = buildHands(api, rig, { grip }) as SdfNode;
      for (const side of ['L', 'R'] as const) {
        const c = rig.joints[`hand${side}`];
        expect(hands.evaluate(c[0], c[1], c[2])).toBeLessThan(0);
      }
    }
  });

  it('open fingers splay symmetrically L/R', () => {
    const hands = buildHands(api, rig, { grip: 'open' }) as SdfNode;
    const b = hands.bounds();
    expect(b.max[0]).toBeCloseTo(-b.min[0], 1);
  });

  it('rejects unknown grips and keys', () => {
    expect(() => buildHands(api, rig, { grip: 'claw' })).toThrow(/grip/);
    expect(() => buildHands(api, rig, { claws: true })).toThrow();
  });
});

describe('figure hair — styles and hairline', () => {
  const rig = buildRig({ height: 60, headsTall: 5 });
  const browPoint = (): number[] => {
    // a point just above the brow line on the forehead surface
    const b = rig.face.browL;
    return [0, b[1], b[2] + rig.r.headZ * 0.12];
  };

  it('bangs bring the hairline down over the forehead (short does not)', () => {
    const p = browPoint();
    const short = buildHair(api, rig, { style: 'short' }) as SdfNode;
    const bangs = buildHair(api, rig, { style: 'bangs' }) as SdfNode;
    expect(short.evaluate(p[0], p[1], p[2])).toBeGreaterThan(0);  // forehead bare
    expect(bangs.evaluate(p[0], p[1], p[2])).toBeLessThan(0);     // fringe covers it
  });

  it('hairline option moves the face-window top edge', () => {
    // A point near the MID window's top edge: carved away at 'mid'
    // (inside the window), kept at 'low' (window dropped below it).
    const c = rig.joints.headCenter;
    const p = [c[0], c[1] - rig.r.headZ * 0.7, c[2] + rig.r.headZ * 0.55];
    const mid = buildHair(api, rig, { style: 'short', hairline: 'mid' }) as SdfNode;
    const low = buildHair(api, rig, { style: 'short', hairline: 'low' }) as SdfNode;
    expect(mid.evaluate(p[0], p[1], p[2])).toBeGreaterThan(0);
    expect(low.evaluate(p[0], p[1], p[2])).toBeLessThan(0);
  });

  it('ponytail adds a tail down the back of the skull', () => {
    // Midpoint of the tail's mid→tip segment: outside the enlarged cap,
    // inside the swinging tail capsule.
    const c = rig.joints.headCenter, R = rig.r.head, hz = rig.r.headZ;
    const p = [
      c[0],
      c[1] + hz * 0.7 + R * 0.28 - R * 0.04,
      c[2] + hz * 0.55 - R * 0.85 - R * 0.475,
    ];
    const short = buildHair(api, rig, { style: 'short' }) as SdfNode;
    const tail = buildHair(api, rig, { style: 'ponytail' }) as SdfNode;
    expect(short.evaluate(p[0], p[1], p[2])).toBeGreaterThan(0);
    expect(tail.evaluate(p[0], p[1], p[2])).toBeLessThan(0);
  });

  it('rejects unknown style / hairline / keys', () => {
    expect(() => buildHair(api, rig, { style: 'mohawk' })).toThrow(/style/);
    expect(() => buildHair(api, rig, { hairline: 'widow' })).toThrow(/hairline/);
    expect(() => buildHair(api, rig, { volume: 2 })).toThrow();
  });
});

describe('figure handDetail — detail-region helper', () => {
  const rig = buildRig({ height: 60, headsTall: 6 });

  it('returns one sphere per hand, centred on the hand joints, finer than the figure grid', () => {
    const [L, R] = handDetail(rig);
    expect(L.center).toEqual(rig.joints.handL);
    expect(R.center).toEqual(rig.joints.handR);
    expect(L.edgeLength).toBeLessThan(0.4);          // finer than the 0.4–0.6 figure grid
    expect(L.radius).toBeGreaterThan(rig.r.hand * 2); // covers the fingers
  });

  it('follows posed hands and honours overrides', () => {
    const posed = buildRig({ pose: { armL: { abduct: 150, elbow: 40 } } });
    const [L] = handDetail(posed);
    expect(L.center).toEqual(posed.joints.handL);
    const [o] = handDetail(rig, { radius: 9, edgeLength: 0.11 });
    expect(o.radius).toBe(9);
    expect(o.edgeLength).toBe(0.11);
    expect(() => handDetail(rig, { density: 1 })).toThrow();
  });
});

describe('figure faceDetail — detail-region helper', () => {
  const rig = buildRig({ height: 60, headsTall: 5 });

  it('returns a head sphere covering every face anchor plus a finer mouth sphere', () => {
    const [head, mouth] = faceDetail(rig);
    expect(head.center).toEqual(rig.joints.headCenter);
    for (const a of Object.values(rig.face)) {
      const dist = Math.hypot(a[0] - head.center[0], a[1] - head.center[1], a[2] - head.center[2]);
      expect(dist).toBeLessThan(head.radius);
    }
    expect(mouth.center).toEqual(rig.face.mouth);
    expect(mouth.edgeLength).toBeLessThan(head.edgeLength);
    expect(mouth.radius).toBeLessThan(head.radius);
  });

  it('scales the target edges with head size and stays fine', () => {
    const [chibi] = faceDetail(buildRig({ height: 60, headsTall: 3 }));
    const [adult] = faceDetail(buildRig({ height: 60, headsTall: 8 }));
    expect(chibi.edgeLength).toBeGreaterThan(adult.edgeLength);
    expect(adult.edgeLength).toBeLessThan(adult.radius * 0.1);
  });

  it('honours overrides and rejects unknown keys', () => {
    const [head, mouth] = faceDetail(rig, { radius: 12, edgeLength: 0.1, mouthEdgeLength: 0.05 });
    expect(head.radius).toBe(12);
    expect(head.edgeLength).toBe(0.1);
    expect(mouth.edgeLength).toBe(0.05);
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
