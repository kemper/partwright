// Unit tests for src/geometry/sdfFigure.ts — the deterministic rig math
// behind api.sdf.figure. Pure logic (no WASM): proportion scaling, pose
// forward-kinematics, left/right symmetry, the joint-overlap invariant that
// keeps a figure one component, and option validation. Meshing the parts is
// exercised headlessly via model:preview / the e2e tier.

import { describe, it, expect } from 'vitest';
import { __figureTestables__, createFigureNamespace } from '../../src/geometry/sdfFigure';
import { __testables__ as sdfT, partitionByLabel, type SdfNode } from '../../src/geometry/sdf';
import type { SdfApi } from '../../src/geometry/sdfFigure';

const { buildRig, buildMouthPart, buildMouthAccents, buildEyes, buildEars, faceDetail, buildPants, buildShoes, buildBoots, buildBase, buildFeet, standOn, groundRig, buildHands, handDetail, buildHair } = __figureTestables__;

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
    expect(rig.joints.footL[2]).toBeLessThan(80 * 0.1);
    expect(rig.joints.footL[2]).toBeGreaterThan(0);
  });

  it('lower headsTall yields a proportionally larger head', () => {
    const chibi = buildRig({ height: 60, headsTall: 3 });
    const adult = buildRig({ height: 60, headsTall: 8 });
    expect(chibi.r.head).toBeGreaterThan(adult.r.head);
  });

  it('scales every landmark linearly with height', () => {
    const a = buildRig({ height: 60 });
    const b = buildRig({ height: 120 });
    expect(b.joints.upperArmL[0]).toBeCloseTo(a.joints.upperArmL[0] * 2, 5);
    expect(b.joints.upperLegL[2]).toBeCloseTo(a.joints.upperLegL[2] * 2, 5);
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
      expect(rig.joints.upperLegL[2]).toBeLessThan(rig.joints.upperArmL[2]);
      expect(rig.joints.lowerLegL[2]).toBeLessThan(rig.joints.upperLegL[2]);
    }
  });
});

describe('figure rig — head-unit proportions & sex (Loomis canon)', () => {
  it('keeps shoulder width a CONSTANT multiple of head size across headsTall', () => {
    // The old fixed-fraction-of-height widths let this ratio drift with
    // headsTall (pin-narrow chibi shoulders, broad-shouldered tall figures);
    // head-unit widths hold it steady, so every headsTall stays coherent.
    const ratio = (n: number) => {
      const rig = buildRig({ height: 60, headsTall: n });
      return Math.abs(rig.joints.upperArmL[0]) / rig.r.head;
    };
    expect(ratio(3)).toBeCloseTo(ratio(8), 5);
    expect(ratio(6)).toBeCloseTo(ratio(8), 5);
  });
  it('still scales every width linearly with height', () => {
    const a = buildRig({ height: 60 });
    const b = buildRig({ height: 120 });
    expect(b.r.chestX).toBeCloseTo(a.r.chestX * 2, 5);
    expect(Math.abs(b.joints.upperArmL[0])).toBeCloseTo(Math.abs(a.joints.upperArmL[0]) * 2, 5);
  });
  it("defaults to 'neutral' and preserves the previous headsTall:6 silhouette", () => {
    // Calibration anchor: at the default headsTall, neutral widths equal the
    // historical fractions-of-height, so existing figures/catalog are unchanged.
    const rig = buildRig({ height: 60, headsTall: 6 });
    expect(Math.abs(rig.joints.upperArmL[0])).toBeCloseTo(60 * 0.108, 4);
    expect(rig.r.chestX).toBeCloseTo(60 * 0.105, 4);
    expect(rig.r.upperLeg).toBeCloseTo(60 * 0.048, 4);
  });
  it('sex shifts the shoulder/hip balance and waist-to-hip ratio', () => {
    const male = buildRig({ sex: 'male' });
    const female = buildRig({ sex: 'female' });
    const neutral = buildRig({});
    // male: wider shoulders; female: narrower shoulders.
    expect(Math.abs(male.joints.upperArmL[0])).toBeGreaterThan(Math.abs(neutral.joints.upperArmL[0]));
    expect(Math.abs(female.joints.upperArmL[0])).toBeLessThan(Math.abs(neutral.joints.upperArmL[0]));
    // female: wider hips than male.
    expect(female.r.hipsX).toBeGreaterThan(male.r.hipsX);
    // female: smaller waist-to-hip ratio (the hourglass signal).
    expect(female.r.waist / female.r.hipsX).toBeLessThan(male.r.waist / male.r.hipsX);
    // female bust: chest girth above neutral.
    expect(female.r.chestX).toBeGreaterThan(neutral.r.chestX);
  });
});

describe('figure rig — age & weight axes (MakeHuman CC0 mined)', () => {
  it('defaults (age 25, weight 0.5) leave the calibration anchor untouched', () => {
    const def = buildRig({ height: 60, headsTall: 6 });
    const explicit = buildRig({ height: 60, headsTall: 6, sex: 'neutral', age: 25, weight: 0.5 });
    expect(explicit.r.chestX).toBeCloseTo(def.r.chestX, 9);
    expect(explicit.r.waist).toBeCloseTo(def.r.waist, 9);
    expect(explicit.r.hipsX).toBeCloseTo(def.r.hipsX, 9);
    expect(explicit.r.hipsY).toBeCloseTo(def.r.hipsY, 9);
    // and equal to the historical fractions-of-height calibration values
    expect(def.r.chestX).toBeCloseTo(60 * 0.105, 4);
  });

  it('weight widens the waist and hips and adds torso depth, monotonically', () => {
    const lean = buildRig({ weight: 0 });
    const avg = buildRig({ weight: 0.5 });
    const heavy = buildRig({ weight: 1 });
    expect(heavy.r.waist).toBeGreaterThan(avg.r.waist);
    expect(avg.r.waist).toBeGreaterThan(lean.r.waist);
    expect(heavy.r.hipsX).toBeGreaterThan(lean.r.hipsX);
    // weight adds 3D bulk, not just width — torso DEPTH grows too.
    expect(heavy.r.hipsY).toBeGreaterThan(avg.r.hipsY);
    expect(avg.r.hipsY).toBeCloseTo(buildRig({}).r.hipsY, 9); // average = baseline depth
  });

  it('age shifts torso girth (baby narrower waist/hip than young) without touching headsTall', () => {
    const baby = buildRig({ age: 1 });
    const young = buildRig({ age: 25 });
    expect(baby.r.waist).toBeLessThan(young.r.waist);
    expect(baby.r.hipsX).toBeLessThan(young.r.hipsX);
    // age is a girth axis only — the head-to-body ratio (headsTall) is unchanged.
    expect(baby.r.head).toBeCloseTo(young.r.head, 9);
  });

  it('age & weight compose with sex multiplicatively', () => {
    const base = buildRig({ sex: 'female' });
    const heavy = buildRig({ sex: 'female', weight: 1 });
    expect(heavy.r.waist).toBeGreaterThan(base.r.waist);
  });

  it('validates age (1..90) and weight (0..1) ranges', () => {
    expect(() => buildRig({ age: 0 })).toThrow(/age/);
    expect(() => buildRig({ age: 200 })).toThrow(/age/);
    expect(() => buildRig({ weight: -0.1 })).toThrow(/weight/);
    expect(() => buildRig({ weight: 1.5 })).toThrow(/weight/);
    expect(() => buildRig({ girth: 2 } as never)).toThrow();
  });

  it('records age & weight on rig.opts', () => {
    const rig = buildRig({ age: 40, weight: 0.7 });
    expect(rig.opts.age).toBe(40);
    expect(rig.opts.weight).toBe(0.7);
  });
});

describe('figure rig — canonical pose & joint vocabulary', () => {
  it('drives arm & leg DOFs with raiseSide/raiseFwd/bend/twist', () => {
    const a = buildRig({ pose: { armL: { raiseSide: 90, raiseFwd: 20, bend: 100, twist: 30 } } });
    expect(a.joints.wristL).toBeDefined();
    const c = buildRig({ pose: { legL: { raiseSide: 15, raiseFwd: 30, bend: 60, twist: 10 } } });
    expect(c.joints.footL).toBeDefined();
  });
  it('drives the head with yaw/pitch/roll', () => {
    const a = buildRig({ pose: { head: { yaw: 20, pitch: 10, roll: 5 } } });
    expect(a.dir.headForward).toBeDefined();
  });
  it('rejects the retired legacy DOF names (abduct/flex/elbow/knee/turn/nod/tilt)', () => {
    expect(() => buildRig({ pose: { armL: { abduct: 90 } as never } })).toThrow();
    expect(() => buildRig({ pose: { armL: { flex: 20 } as never } })).toThrow();
    expect(() => buildRig({ pose: { armL: { elbow: 100 } as never } })).toThrow();
    expect(() => buildRig({ pose: { legL: { knee: 60 } as never } })).toThrow();
    expect(() => buildRig({ pose: { head: { turn: 20 } as never } })).toThrow();
    expect(() => buildRig({ pose: { head: { nod: 10 } as never } })).toThrow();
    expect(() => buildRig({ pose: { head: { tilt: 5 } as never } })).toThrow();
  });
  it('exposes VRM/Unity humanoid joint names (hips, upperArm*, lowerArm*, upperLeg*, lowerLeg*, foot*)', () => {
    const rig = buildRig({});
    for (const k of ['hips', 'spine', 'chest', 'neck', 'head',
      'upperArmL', 'upperArmR', 'lowerArmL', 'lowerArmR', 'wristL', 'handL',
      'upperLegL', 'upperLegR', 'lowerLegL', 'lowerLegR', 'footL', 'footR']) {
      expect(rig.joints[k], k).toBeDefined();
    }
    // The retired names are gone, not silently aliased.
    expect(rig.joints.pelvis).toBeUndefined();
    expect(rig.joints.shoulderL).toBeUndefined();
    expect(rig.joints.ankleL).toBeUndefined();
  });
});

describe('figure rig — symmetry', () => {
  it('mirrors L/R joints across X for a symmetric pose', () => {
    const rig = buildRig({});
    for (const name of ['upperArm', 'lowerArm', 'wrist', 'upperLeg', 'lowerLeg', 'foot']) {
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
    expect(rig.face.nose[1]).toBeLessThan(rig.joints.head[1]);
  });
});

describe('figure rig — pose forward kinematics', () => {
  it('abduct 90 swings the upper arm straight out to the side', () => {
    const rig = buildRig({ height: 60, pose: { armL: { raiseSide: 90 } } });
    const S = rig.joints.upperArmL, E = rig.joints.lowerArmL;
    // elbow moves out in +X at (near) the shoulder height.
    expect(E[0]).toBeGreaterThan(S[0]);
    expect(E[2]).toBeCloseTo(S[2], 4);
  });

  it('abduct 0 hangs the upper arm straight down', () => {
    const rig = buildRig({ pose: { armL: { raiseSide: 0 } } });
    const S = rig.joints.upperArmL, E = rig.joints.lowerArmL;
    expect(E[2]).toBeLessThan(S[2]);
    expect(E[0]).toBeCloseTo(S[0], 4);
  });

  it('elbow flexion moves the wrist (curls the forearm)', () => {
    const straight = buildRig({ pose: { armL: { raiseSide: 90, bend: 0 } } });
    const curled = buildRig({ pose: { armL: { raiseSide: 90, bend: 120 } } });
    expect(dist(straight.joints.wristL, curled.joints.wristL)).toBeGreaterThan(1);
  });

  it('elbow flexion curls a hanging forearm FORWARD (−Y), like a real elbow', () => {
    // Regression: the hinge sign once curled the forearm BACKWARD (+Y) — the
    // same sign-bug family as the knee. A hanging arm with a bent elbow must
    // bring the wrist forward of the body and raise it, on both sides.
    for (const side of ['L', 'R'] as const) {
      const straight = buildRig({ pose: { [`arm${side}`]: { raiseSide: 0, bend: 0 } } });
      const bent = buildRig({ pose: { [`arm${side}`]: { raiseSide: 0, bend: 70 } } });
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
    for (const raiseSide of [0, 8]) {
      const rig = buildRig({ pose: { legs: { raiseSide, raiseFwd: 90, bend: 90 } } });
      for (const side of ['L', 'R'] as const) {
        const K = rig.joints[`lowerLeg${side}`], A = rig.joints[`foot${side}`];
        expect(A[2]).toBeLessThan(K[2] - 1);     // shin drops below the knee
        // and stays under it, not swung out sideways (frog-sit regression).
        expect(Math.abs(A[0] - K[0])).toBeLessThan(2);
      }
      expect(rig.joints.footL[0]).toBeCloseTo(-rig.joints.footR[0], 5);
      expect(rig.joints.footL[2]).toBeCloseTo(rig.joints.footR[2], 5);
    }
  });

  it('knee flexion bends the shank BACKWARD (+Y), like a real knee', () => {
    // Regression: the hinge sign once swung the shank FORWARD, giving a
    // lunge a horizontal shin floating in front of the figure.
    const straight = buildRig({ pose: { legL: { raiseSide: 0, raiseFwd: 0, bend: 0 } } });
    const bent = buildRig({ pose: { legL: { raiseSide: 0, raiseFwd: 0, bend: 60 } } });
    expect(bent.joints.footL[1]).toBeGreaterThan(straight.joints.footL[1] + 1);
    // and the ankle rises (the shank shortens vertically when bent).
    expect(bent.joints.footL[2]).toBeGreaterThan(straight.joints.footL[2] + 1);
  });

  it('lunge: flex forward + matching knee bend puts the ankle under the knee', () => {
    const rig = buildRig({ pose: { legL: { raiseSide: 0, raiseFwd: 45, bend: 45 } } });
    const K = rig.joints.lowerLegL, A = rig.joints.footL;
    // shank vertical: ankle directly below the knee.
    expect(A[1]).toBeCloseTo(K[1], 4);
    expect(A[2]).toBeLessThan(K[2]);
  });

  it('head yaw rotates the face anchors off the centreline', () => {
    const fwd = buildRig({ pose: { head: { yaw: 0 } } });
    const turned = buildRig({ pose: { head: { yaw: 40 } } });
    expect(dist(fwd.face.nose, turned.face.nose)).toBeGreaterThan(0.5);
  });

  it('elbow hinge stays a stable lateral plane across flex 90 (no pole flip)', () => {
    // Regression: the old cross(dir, fwd) elbow hinge collapsed in magnitude
    // and SWUNG THROUGH the pole as a forward-reaching arm crossed horizontal
    // (flex → 90) with small abduct — its X-component flipped sign 85→95, so a
    // bent forward-punch curled in a pose-dependent wrong plane. The frame-
    // derived hinge keeps a near-constant lateral axis: a forward-reaching bent
    // arm curls the wrist UP (above the elbow) continuously, on both sides.
    for (const side of ['L', 'R'] as const) {
      let prevHingeX: number | undefined;
      for (const raiseFwd of [85, 90, 95]) {
        const rig = buildRig({ pose: { [`arm${side}`]: { raiseSide: 10, raiseFwd, bend: 90 } } });
        const h = rig.dir[`elbowHinge${side}`];
        const W = rig.joints[`wrist${side}`], E = rig.joints[`lowerArm${side}`];
        expect(W[2]).toBeGreaterThan(E[2] + 1);        // forearm curls UP, not sideways
        if (prevHingeX !== undefined) {
          expect(Math.sign(h[0])).toBe(Math.sign(prevHingeX)); // no sign flip across 90
          expect(Math.abs(h[0] - prevHingeX)).toBeLessThan(0.1); // and barely moves
        }
        prevHingeX = h[0];
      }
    }
  });

  it('leg twist turns the foot out (and is no longer a silent no-op)', () => {
    // Regression: leg twist was parsed + validated but never read by the leg
    // chain. It now yaws the foot heading OUTWARD (toe toward +X on the left,
    // −X on the right) and rolls a bent-knee turnout, symmetrically.
    const neutral = buildRig({ pose: { legL: { raiseSide: 6 } } });
    expect(neutral.dir.footL[0]).toBeCloseTo(0, 4);     // toe straight ahead at rest
    const turned = buildRig({ pose: { legs: { raiseSide: 6, twist: 30 } } });
    expect(turned.dir.footL[0]).toBeGreaterThan(0.3);   // left toe yaws to +X (out)
    expect(turned.dir.footR[0]).toBeLessThan(-0.3);     // right toe yaws to −X (out)
    expect(turned.dir.footL[0]).toBeCloseTo(-turned.dir.footR[0], 5); // symmetric
    // A bent knee with turnout moves the shank/ankle vs no twist.
    const bent0 = buildRig({ pose: { legL: { raiseFwd: 20, bend: 60, twist: 0 } } });
    const bentT = buildRig({ pose: { legL: { raiseFwd: 20, bend: 60, twist: 40 } } });
    expect(dist(bent0.joints.footL, bentT.joints.footL)).toBeGreaterThan(1);
  });

  it('twist rolls the forearm-curl plane so a raised arm can curl the fist up', () => {
    // With the arm out to the side, elbow alone curls forward; twist lifts the
    // fist UP (the double-biceps / ballet-fifth pose that needs the roll DOF).
    const noTwist = buildRig({ pose: { armL: { raiseSide: 90, bend: 95, twist: 0 } } });
    const rolled = buildRig({ pose: { armL: { raiseSide: 90, bend: 95, twist: 90 } } });
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
  // (Chair-sit `legs: {raiseFwd: 90, bend: 90}` is pinned by the sitting-pose
  // test above; this block covers the remaining documented recipes.)

  it('double-biceps `arms: {raiseSide: 95, bend: 95, twist: 90}` puts both fists up by the head', () => {
    const rig = buildRig({ height: 60, pose: { arms: { raiseSide: 95, bend: 95, twist: 90 } } });
    for (const side of ['L', 'R'] as const) {
      const S = rig.joints[`upperArm${side}`], W = rig.joints[`wrist${side}`], H = rig.joints[`hand${side}`];
      // fist raised well above the shoulder, up beside the head…
      expect(W[2]).toBeGreaterThan(S[2] + rig.r.head);
      expect(H[2]).toBeGreaterThan(rig.joints.head[2]);
      // …and OUT to the side (a flex pose, not hands clasped at the chest).
      expect(Math.abs(W[0])).toBeGreaterThan(Math.abs(S[0]) * 1.5);
    }
    expect(rig.joints.handL[0]).toBeCloseTo(-rig.joints.handR[0], 5);
    expect(rig.joints.handL[2]).toBeCloseTo(rig.joints.handR[2], 5);
  });

  it('ballet fifth `arms: {raiseSide: 150, bend: 70, twist: 90}` rounds an "O" overhead', () => {
    const rig = buildRig({ height: 60, pose: { arms: { raiseSide: 150, bend: 70, twist: 90 } } });
    for (const side of ['L', 'R'] as const) {
      const E = rig.joints[`lowerArm${side}`], H = rig.joints[`hand${side}`];
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
      const rig = buildRig({ pose: { legL: { raiseSide: 0, raiseFwd: a, bend: a } } });
      const K = rig.joints.lowerLegL, A = rig.joints.footL;
      expect(A[0]).toBeCloseTo(K[0], 4);
      expect(A[1]).toBeCloseTo(K[1], 4);
      expect(A[2]).toBeLessThan(K[2]);
    }
  });
});

describe('figure rig — symmetric pose shorthand', () => {
  it('`arms` / `legs` seed both sides symmetrically', () => {
    const rig = buildRig({ pose: { arms: { raiseSide: 90 }, legs: { raiseSide: 25 } } });
    // both elbows swing out (abduct 90); symmetric in X.
    expect(rig.joints.lowerArmL[0]).toBeGreaterThan(rig.joints.upperArmL[0]);
    expect(rig.joints.lowerArmR[0]).toBeLessThan(rig.joints.upperArmR[0]);
    expect(rig.joints.lowerArmL[0]).toBeCloseTo(-rig.joints.lowerArmR[0], 5);
    expect(rig.joints.lowerLegL[0]).toBeCloseTo(-rig.joints.lowerLegR[0], 5);
  });
  it('per-side keys override the shorthand', () => {
    const rig = buildRig({ pose: { arms: { raiseSide: 90 }, armL: { raiseSide: 0 } } });
    // left arm hangs down (abduct 0), right stays out (abduct 90).
    expect(rig.joints.lowerArmL[2]).toBeLessThan(rig.joints.upperArmL[2]);
    expect(rig.joints.lowerArmR[0]).toBeLessThan(rig.joints.upperArmR[0]);
  });
});

describe('figure rig — one-component invariants', () => {
  // The welded figure stays a single component because (a) adjacent bones in a
  // chain share their joint endpoint exactly, so the capsules always overlap at
  // the joint, and (b) the chain roots (shoulder, hip) sit inside the torso
  // masses they weld into. Both hold regardless of pose.
  it('keeps every bone non-degenerate across a range of poses', () => {
    for (const bend of [0, 60, 120]) {
      for (const raiseSide of [0, 45, 90, 140]) {
        const rig = buildRig({ pose: { armL: { raiseSide, bend }, legL: { raiseSide: 20, bend: 60 } } });
        expect(dist(rig.joints.upperArmL, rig.joints.lowerArmL)).toBeGreaterThan(1);
        expect(dist(rig.joints.lowerArmL, rig.joints.wristL)).toBeGreaterThan(1);
        expect(dist(rig.joints.upperLegL, rig.joints.lowerLegL)).toBeGreaterThan(1);
        expect(dist(rig.joints.lowerLegL, rig.joints.footL)).toBeGreaterThan(1);
      }
    }
  });
  it('roots the arm at the chest and the leg at the pelvis (limbs attach)', () => {
    const rig = buildRig({});
    // shoulder X within chest half-width + the deltoid cap that bridges it.
    expect(Math.abs(rig.joints.upperArmL[0])).toBeLessThan(rig.r.chestX + rig.r.upperArm * 1.15);
    // hip X within the pelvis mass + thigh radius.
    expect(Math.abs(rig.joints.upperLegL[0])).toBeLessThan(rig.r.hipsX + rig.r.upperLeg);
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
    [...new Set(partitionByLabel(node as SdfNode).map(p => p.labelName).filter((n): n is string => !!n))].sort();

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

  it('iris and pupil are concentric discs smaller than the eyeball (white sclera shows)', () => {
    // The eye reads as eye — not a flat coloured bead — only when the iris is
    // clearly smaller than the visible eyeball cap so a white sclera ring shows
    // around it, and the pupil clearly smaller than the iris. Both eyes sit at
    // the same height under a neutral pose, so each region's vertical (Z) extent
    // equals its in-plane diameter — a clean concentric-size comparison.
    const parts = partitionByLabel(buildEyes(api, rig) as SdfNode);
    const zExtent = (name: string): number => {
      const p = parts.find((p) => p.labelName === name);
      if (!p) throw new Error(`no ${name} region`);
      const b = p.node.bounds();
      return b.max[2] - b.min[2];
    };
    const sclera = zExtent('eyes'), iris = zExtent('iris'), pupil = zExtent('pupil');
    expect(iris).toBeLessThan(sclera);   // white sclera ring shows around the iris
    expect(pupil).toBeLessThan(iris);    // pupil dot nests inside the iris
    // Guard the specific regression (iris ≈ eyeball swallowed the white): the
    // iris must leave a generous white margin, not span the whole eyeball front.
    expect(iris).toBeLessThan(sclera * 0.6);
  });

  it('rejects unknown style and keys', () => {
    expect(() => buildEyes(api, rig, { style: 'laser' })).toThrow(/style/);
    expect(() => buildEyes(api, rig, { glow: true })).toThrow();
  });
});

describe('figure eyes — eyelids', () => {
  const rig = buildRig({ height: 60, headsTall: 5 });
  const labelsOf = (node: unknown): string[] =>
    [...new Set(partitionByLabel(node as SdfNode).map(p => p.labelName).filter((n): n is string => !!n))].sort();

  it("no lids by default — bare eyeball, no 'lids' region", () => {
    expect(labelsOf(buildEyes(api, rig))).not.toContain('lids');
  });

  it("iris + lids adds a paintable 'lids' region alongside the eye", () => {
    expect(labelsOf(buildEyes(api, rig, { lids: 'upper' }))).toEqual(['eyes', 'iris', 'lids', 'pupil']);
  });

  for (const lids of ['upper', 'hooded', 'half', 'closed', 'almond', 'tapered'] as const) {
    it(`lids: '${lids}' builds a labelled 'lids' fold`, () => {
      expect(labelsOf(buildEyes(api, rig, { lids }))).toContain('lids');
    });
  }

  it("solid + lids self-labels ('eyes' + 'lids'), unlike bare solid", () => {
    // bare solid is unlabelled; adding lids forces self-labelling so the two
    // regions stay paintable independently.
    expect(labelsOf(buildEyes(api, rig, { style: 'solid' }))).toEqual([]);
    expect(labelsOf(buildEyes(api, rig, { style: 'solid', lids: 'upper' }))).toEqual(['eyes', 'lids']);
  });

  it('accepts an explicit { upper, lower } pair', () => {
    expect(labelsOf(buildEyes(api, rig, { lids: { upper: 0.3, lower: 0.1 } }))).toContain('lids');
    // a single lid (only upper, or only lower) still builds a 'lids' region
    expect(labelsOf(buildEyes(api, rig, { lids: { upper: 0.4 } }))).toContain('lids');
    expect(labelsOf(buildEyes(api, rig, { lids: { lower: 0.4 } }))).toContain('lids');
  });

  it("{ upper: 0, lower: 0 } is the same as no lids", () => {
    expect(labelsOf(buildEyes(api, rig, { lids: { upper: 0, lower: 0 } }))).not.toContain('lids');
  });

  it('rejects an unknown lids style, out-of-range fractions, and unknown keys', () => {
    expect(() => buildEyes(api, rig, { lids: 'winged' })).toThrow(/lids/);
    expect(() => buildEyes(api, rig, { lids: { upper: 1.5 } })).toThrow();
    expect(() => buildEyes(api, rig, { lids: { upper: -0.2 } })).toThrow();
    expect(() => buildEyes(api, rig, { lids: { top: 0.3 } })).toThrow();
  });
});

describe('figure eyes — gaze (where the iris/pupil point)', () => {
  const rig = buildRig({ height: 60, headsTall: 5 });
  const labelsOf = (node: unknown): string[] =>
    [...new Set(partitionByLabel(node as SdfNode).map(p => p.labelName).filter((n): n is string => !!n))].sort();
  // partitionByLabel keeps the two eyes' iris regions separate (one per eye, in
  // build order [left eye = +X, right eye = −X]); resolveLabelMap merges them by
  // name later. So we read each eye's iris-disc centroid (its AABB centre)
  // independently — exactly what per-eye gaze needs to verify.
  const irises = (opts?: unknown): { L: { x: number; z: number }; R: { x: number; z: number } } => {
    const ps = partitionByLabel(buildEyes(api, rig, opts) as SdfNode).filter(p => p.labelName === 'iris');
    if (ps.length !== 2) throw new Error(`expected 2 iris regions, got ${ps.length}`);
    const ctr = (i: number): { x: number; z: number } => {
      const b = ps[i].node.bounds();
      return { x: (b.min[0] + b.max[0]) / 2, z: (b.min[2] + b.max[2]) / 2 };
    };
    return { L: ctr(0), R: ctr(1) };
  };
  const gap = (e: { L: { x: number }; R: { x: number } }): number => e.L.x - e.R.x;  // L is +X, R is −X

  it("default ('middle'/'center') gaze is symmetric, with the usual labels", () => {
    expect(labelsOf(buildEyes(api, rig, { gaze: 'middle' }))).toEqual(['eyes', 'iris', 'pupil']);
    expect(labelsOf(buildEyes(api, rig, { gaze: 'center' }))).toEqual(['eyes', 'iris', 'pupil']);
    const d = irises(), m = irises({ gaze: 'middle' });
    expect(d.L.x).toBeGreaterThan(0);          // left eye sits on +X
    expect(d.R.x).toBeLessThan(0);             // right eye on −X
    expect(d.L.x + d.R.x).toBeCloseTo(0, 1);   // mirror-symmetric ⇒ no net X bias
    expect(m.L.x).toBeCloseTo(d.L.x, 5);       // 'middle' === default
  });

  it("'left' turns BOTH irises toward the figure's own left (+X); 'right' the other way", () => {
    const d = irises();
    const l = irises({ gaze: 'left' });
    expect(l.L.x).toBeGreaterThan(d.L.x + 0.1);
    expect(l.R.x).toBeGreaterThan(d.R.x + 0.1);
    const r = irises({ gaze: 'right' });
    expect(r.L.x).toBeLessThan(d.L.x - 0.1);
    expect(r.R.x).toBeLessThan(d.R.x - 0.1);
  });

  it("'up' raises both irises, 'down' lowers them", () => {
    const d = irises();
    expect(irises({ gaze: 'up' }).L.z).toBeGreaterThan(d.L.z + 0.1);
    expect(irises({ gaze: 'down' }).L.z).toBeLessThan(d.L.z - 0.1);
  });

  it('the corner presets move on both axes', () => {
    const d = irises();
    const ul = irises({ gaze: 'upper-left' });
    expect(ul.L.x).toBeGreaterThan(d.L.x + 0.05);
    expect(ul.L.z).toBeGreaterThan(d.L.z + 0.05);
    const lr = irises({ gaze: 'lower-right' });
    expect(lr.L.x).toBeLessThan(d.L.x - 0.05);
    expect(lr.L.z).toBeLessThan(d.L.z - 0.05);
  });

  it('a { yaw, pitch } pair aims at an explicit angle (figure-left / up positive)', () => {
    const d = irises();
    expect(irises({ gaze: { yaw: 20 } }).L.x).toBeGreaterThan(d.L.x + 0.1);
    expect(irises({ gaze: { pitch: 20 } }).L.z).toBeGreaterThan(d.L.z + 0.1);
  });

  it('per-eye gazeL/gazeR aim eyes independently — cross-eyed converges, wall-eyed diverges', () => {
    const d = gap(irises());
    expect(gap(irises({ gazeL: 'right', gazeR: 'left' }))).toBeLessThan(d - 0.1);    // turn inward
    expect(gap(irises({ gazeL: 'left', gazeR: 'right' }))).toBeGreaterThan(d + 0.1); // turn outward
  });

  it('gazeL overrides only the left eye; gaze seeds both', () => {
    const d = irises();
    const one = irises({ gazeL: 'left' });
    expect(one.L.x).toBeGreaterThan(d.L.x + 0.1);  // left eye turned
    expect(one.R.x).toBeCloseTo(d.R.x, 5);         // right eye untouched
    const both = irises({ gaze: 'left' });
    expect(both.R.x).toBeGreaterThan(d.R.x + 0.1); // gaze moves the right eye too
  });

  it('rejects an unknown preset, out-of-range angles, and unknown keys', () => {
    expect(() => buildEyes(api, rig, { gaze: 'sideways' })).toThrow(/gaze/);
    expect(() => buildEyes(api, rig, { gaze: { yaw: 90 } })).toThrow();
    expect(() => buildEyes(api, rig, { gaze: { roll: 10 } })).toThrow();
    expect(() => buildEyes(api, rig, { gazeR: 'nope' })).toThrow(/gazeR/);
  });
});

describe('figure pants — posed-leg coverage', () => {
  it('pant cuffs stay ON the bone for a posed (lunge) leg', () => {
    // Regression: a fixed world-Z cuff endpoint pulled the pant shank off a
    // diagonal lunge shank entirely. The garment interior must contain the
    // shank-bone midpoint of BOTH legs.
    const rig = buildRig({ pose: { legL: { raiseFwd: 45, bend: 45 }, legR: { raiseFwd: -30, bend: 5 } } });
    const pants = buildPants(api, rig) as SdfNode;
    for (const side of ['L', 'R'] as const) {
      const K = rig.joints[`lowerLeg${side}`], A = rig.joints[`foot${side}`];
      const mid = [(K[0] + A[0]) / 2, (K[1] + A[1]) / 2, (K[2] + A[2]) / 2];
      expect(pants.evaluate(mid[0], mid[1], mid[2])).toBeLessThan(0);
    }
  });

  it('a deeply bent knee stays covered (knee pad)', () => {
    const rig = buildRig({ pose: { legL: { raiseFwd: 45, bend: 70 } } });
    const pants = buildPants(api, rig) as SdfNode;
    const K = rig.joints.lowerLegL;
    // A point one skin-bulge radius FORWARD of the knee joint (where the
    // skin's weld bulge peaks) must still be inside the garment.
    const probe = [K[0], K[1] - rig.r.lowerLeg * 1.2, K[2]];
    expect(pants.evaluate(probe[0], probe[1], probe[2])).toBeLessThan(0);
  });

  it("length: 'briefs' skips the leg sleeves", () => {
    const rig = buildRig({});
    const briefs = buildPants(api, rig, { length: 'briefs' }) as SdfNode;
    const full = buildPants(api, rig) as SdfNode;
    const K = rig.joints.lowerLegL;
    // knee is bare in briefs, covered by full pants.
    expect(briefs.evaluate(K[0], K[1], K[2])).toBeGreaterThan(0);
    expect(full.evaluate(K[0], K[1], K[2])).toBeLessThan(0);
    // pelvis is covered by both.
    const P = rig.joints.hips;
    expect(briefs.evaluate(P[0], P[1], P[2] - rig.r.hipsY * 0.3)).toBeLessThan(0);
  });

  it('rejects unknown length values', () => {
    const rig = buildRig({});
    expect(() => buildPants(api, rig, { length: 'capri' })).toThrow(/length/);
  });
});

describe('figure footwear — shoes & boots', () => {
  it('shoes wrap each foot (sole point is inside)', () => {
    const rig = buildRig({});
    const shoes = buildShoes(api, rig) as SdfNode;
    for (const side of ['L', 'R'] as const) {
      const A = rig.joints[`foot${side}`];
      // The sole sits one foot-radius below the ankle; a point there is shod.
      const sole = [A[0], A[1], A[2] - rig.r.foot];
      expect(shoes.evaluate(sole[0], sole[1], sole[2])).toBeLessThan(0);
    }
  });

  it("boots add a shaft up the shank that shoes leave bare", () => {
    const rig = buildRig({});
    const shoes = buildShoes(api, rig) as SdfNode;
    const boots = buildBoots(api, rig) as SdfNode;
    const A = rig.joints.footL, K = rig.joints.lowerLegL;
    // A point ~mid-calf along the ankle→knee bone: covered by the boot shaft,
    // bare on a low shoe.
    const calf = [A[0] * 0.5 + K[0] * 0.5, A[1] * 0.5 + K[1] * 0.5, A[2] * 0.5 + K[2] * 0.5];
    expect(boots.evaluate(calf[0], calf[1], calf[2])).toBeLessThan(0);
    expect(shoes.evaluate(calf[0], calf[1], calf[2])).toBeGreaterThan(0);
  });

  it('footwear follows the foot heading under leg twist (turnout)', () => {
    // A turned-out foot points its toe outward; the toe of the shoe must move
    // with it (the builder reads rig.dir.foot*, like F.feet).
    const rig = buildRig({ pose: { legL: { twist: 40 } } });
    const shoes = buildShoes(api, rig) as SdfNode;
    const A = rig.joints.footL, fwd = rig.dir.footL;
    const sz = A[2] - rig.r.foot;
    const footLen = rig.r.foot * 2.4;
    // A point out along the heading at sole height (under the toe) is shod.
    const toe = [A[0] + fwd[0] * footLen * 0.5, A[1] + fwd[1] * footLen * 0.5, sz];
    expect(shoes.evaluate(toe[0], toe[1], toe[2])).toBeLessThan(0);
  });

  it("boots' shaftZ projects onto a posed (lunge) shank bone", () => {
    // Regression guard mirroring pants' cuffPoint: a world-Z shaft target must
    // ride the diagonal shank, not a fixed world point off the leg.
    const rig = buildRig({ pose: { legL: { raiseFwd: 45, bend: 45 } } });
    const A = rig.joints.footL, K = rig.joints.lowerLegL;
    const shaftZ = A[2] * 0.4 + K[2] * 0.6;
    const boots = buildBoots(api, rig, { shaftZ }) as SdfNode;
    // The shank-bone point at that height projection is inside the boot.
    const frac = (shaftZ - A[2]) / (K[2] - A[2]);
    const p = [A[0] + (K[0] - A[0]) * frac, A[1] + (K[1] - A[1]) * frac, A[2] + (K[2] - A[2]) * frac];
    expect(boots.evaluate(p[0], p[1], p[2])).toBeLessThan(0);
  });

  it('rejects unknown footwear options', () => {
    const rig = buildRig({});
    expect(() => buildShoes(api, rig, { shaftZ: 5 })).toThrow(/shaftZ/);
    expect(() => buildBoots(api, rig, { bogus: 1 })).toThrow(/bogus/);
  });

  it('boots have a flat bottom clipped at the ground plane', () => {
    const rig = buildRig({});
    const boots = buildBoots(api, rig) as SdfNode;
    const s = rig.sole.L;
    // inside just above the ground plane, empty just below it (flat cut, not a
    // rounded capsule underside).
    expect(boots.evaluate(s.point[0], s.point[1], s.groundZ + 0.3)).toBeLessThan(0);
    expect(boots.evaluate(s.point[0], s.point[1], s.groundZ - 0.4)).toBeGreaterThan(0);
  });

  it('the boot encloses the foot underside (no bare-skin patch shows through)', () => {
    const rig = buildRig({});
    const boots = buildBoots(api, rig) as SdfNode;
    const feet = buildFeet(api, rig) as SdfNode;
    const s = rig.sole.L;
    // The boot extends BELOW the skin: at the ground plane the boot is solid but
    // the bare foot is not, so the boot (not skin) forms the underside.
    expect(boots.evaluate(s.point[0], s.point[1], s.groundZ + 0.05)).toBeLessThan(0);
    expect(feet.evaluate(s.point[0], s.point[1], s.groundZ + 0.05)).toBeGreaterThan(0);
    // Higher up, where the skin sole is solid, the boot is solid too (covers it).
    const z = s.groundZ + rig.r.foot * 0.4;
    expect(feet.evaluate(s.point[0], s.point[1], z)).toBeLessThan(0);
    expect(boots.evaluate(s.point[0], s.point[1], z)).toBeLessThan(0);
  });

  it('the base descends to contain a posed/shod sole (no poke-through)', () => {
    const rig = buildRig({ pose: { legR: { raiseFwd: 12, bend: 28 }, legL: { raiseSide: 6 } } });
    const base = buildBase(api, rig) as SdfNode;
    const boots = buildBoots(api, rig) as SdfNode;
    // the base bottom is at or below the lowest boot sole, so the boot can't
    // hang below the disc and punch through its underside.
    expect(base.bounds().min[2]).toBeLessThanOrEqual(boots.bounds().min[2] + 1e-6);
  });
});

describe('figure sole frames — the ground-contact anchor (foot analog of grips)', () => {
  it('exposes a sole frame per foot derived from the ankle', () => {
    const rig = buildRig({});
    for (const side of ['L', 'R'] as const) {
      const s = rig.sole[side];
      const A = rig.joints[`foot${side}`];
      expect(s.groundZ).toBeLessThan(A[2]);          // ground is below the ankle
      expect(s.point[2]).toBeCloseTo(s.groundZ);     // footprint point sits on the plane
      expect(s.length).toBeGreaterThan(0);
      expect(s.width).toBeGreaterThan(0);
      expect(s.normal).toEqual([0, 0, 1]);
    }
  });

  it('sole heading equals dir.foot, so it tracks turnout', () => {
    const rig = buildRig({ pose: { legL: { twist: 40 } } });
    expect(rig.sole.L.heading).toEqual(rig.dir.footL);
  });

  it('the sole frame plane sits at/below the bare foot underside', () => {
    const rig = buildRig({});
    const feet = buildFeet(api, rig) as SdfNode;
    const s = rig.sole.L;
    // groundZ is below the whole foot (footwear clips here to enclose the skin)…
    expect(feet.evaluate(s.point[0], s.point[1], s.groundZ + 0.05)).toBeGreaterThan(0);
    // …and rising into the foot reaches solid skin.
    expect(feet.evaluate(s.point[0], s.point[1], s.groundZ + rig.r.foot * 0.6)).toBeLessThan(0);
  });

  it('poseProbe reports the sole frames', () => {
    const rig = buildRig({});
    const probe = createFigureNamespace(api).poseProbe(rig);
    expect(probe.soles.L.groundZ).toBeCloseTo(rig.sole.L.groundZ);
    expect(probe.text).toMatch(/soles:/);
  });
});

describe('figure standOn — seat a prop under a foot', () => {
  const boxN = () => sdfT.primBox([4, 4, 4]) as unknown as SdfNode;

  it("drops a node's top onto the sole point by default", () => {
    const rig = buildRig({});
    const s = rig.sole.L;
    const placed = standOn(boxN(), s) as SdfNode;
    const b = placed.bounds();
    expect(b.max[2]).toBeCloseTo(s.point[2]);                  // top meets the sole
    expect((b.min[0] + b.max[0]) / 2).toBeCloseTo(s.point[0]); // centred under the foot
    expect((b.min[1] + b.max[1]) / 2).toBeCloseTo(s.point[1]);
  });

  it("anchor 'bottom' rests the node ON the sole point", () => {
    const rig = buildRig({});
    const s = rig.sole.L;
    const placed = standOn(boxN(), s, { anchor: 'bottom' }) as SdfNode;
    expect(placed.bounds().min[2]).toBeCloseTo(s.point[2]);
  });

  it('accepts a raw point and rejects unknown options', () => {
    const rig = buildRig({});
    expect(() => (standOn(boxN(), [0, 0, 0]) as SdfNode).bounds()).not.toThrow();
    expect(() => standOn(boxN(), rig.sole.L, { foo: 1 })).toThrow();
  });
});

describe('figure footwear — separate sole region', () => {
  it('emits a distinct sole region plus the upper, by default', () => {
    const rig = buildRig({});
    const names = partitionByLabel(buildBoots(api, rig) as SdfNode).map(r => r.labelName);
    expect(names).toContain('boots');
    expect(names).toContain('sole');
  });

  it("sole: false folds the sole into the upper (one region name)", () => {
    const rig = buildRig({});
    const names = partitionByLabel(buildBoots(api, rig, { sole: false }) as SdfNode).map(r => r.labelName);
    expect(names).toContain('boots');
    expect(names).not.toContain('sole');
  });

  it('custom upper + sole labels', () => {
    const rig = buildRig({});
    const names = partitionByLabel(buildBoots(api, rig, { label: 'kicks', sole: { label: 'tread' } }) as SdfNode).map(r => r.labelName);
    expect(names).toContain('kicks');
    expect(names).toContain('tread');
  });

  it('shoes default their upper label to "shoes"', () => {
    const rig = buildRig({});
    const names = partitionByLabel(buildShoes(api, rig) as SdfNode).map(r => r.labelName);
    expect(names).toContain('shoes');
  });

  it("sole style 'welt' (default) overhangs 'flush' laterally", () => {
    const rig = buildRig({});
    const r = rig.r, s = rig.sole.L;
    const welt = buildBoots(api, rig, { sole: { style: 'welt', lip: r.foot * 0.2 } }) as SdfNode;
    const flush = buildBoots(api, rig, { sole: { style: 'flush' } }) as SdfNode;
    // A point just outside the flush sole edge, at sole height, is empty for flush
    // but inside the welt (its lip is proud of the upper).
    const x = s.point[0] + r.foot * 1.08, y = s.point[1], z = s.groundZ + 0.1;
    expect(flush.evaluate(x, y, z)).toBeGreaterThan(0);
    expect(welt.evaluate(x, y, z)).toBeLessThan(0);
  });

  it('rejects an unknown sole style', () => {
    expect(() => buildBoots(api, buildRig({}), { sole: { style: 'platform' } })).toThrow(/style/);
  });
});

describe('figure ground — stand feet on one plane', () => {
  it('plant levels near-plane feet to a common groundZ', () => {
    const rig = buildRig({ pose: { legR: { bend: 28, raiseFwd: 10 } } });
    const g = groundRig(rig, { mode: 'plant' });
    expect(g.sole.L.groundZ).toBeCloseTo(g.sole.R.groundZ);
  });

  it('plant lifts a foot that is beyond tolerance', () => {
    const rig = buildRig({ pose: { legR: { raiseFwd: 80, bend: 80 } } });
    const g = groundRig(rig, { mode: 'plant', tolerance: 0.5 });
    expect(Math.abs(g.sole.L.groundZ - g.sole.R.groundZ)).toBeGreaterThan(0.5);
  });

  it('drop re-poses the legs so both feet reach the plane, preserving bone lengths', () => {
    const rig = buildRig({ pose: { legR: { bend: 28, raiseFwd: 10 } } });
    const g = groundRig(rig, { mode: 'drop' });
    expect(g.sole.L.groundZ).toBeCloseTo(g.sole.R.groundZ);
    // thigh + shank lengths are preserved by the 2-bone IK.
    for (const side of ['L', 'R'] as const) {
      const t0 = dist(rig.joints[`upperLeg${side}`], rig.joints[`lowerLeg${side}`]);
      const t1 = dist(g.joints[`upperLeg${side}`], g.joints[`lowerLeg${side}`]);
      const s0 = dist(rig.joints[`lowerLeg${side}`], rig.joints[`foot${side}`]);
      const s1 = dist(g.joints[`lowerLeg${side}`], g.joints[`foot${side}`]);
      expect(t1).toBeCloseTo(t0, 2);
      expect(s1).toBeCloseTo(s0, 2);
    }
  });

  it('grounds to an explicit z', () => {
    const g = groundRig(buildRig({}), { mode: 'plant', z: -5 });
    expect(g.sole.L.groundZ).toBeCloseTo(-5);
    expect(g.sole.R.groundZ).toBeCloseTo(-5);
  });

  it('rejects unknown options and bad modes', () => {
    expect(() => groundRig(buildRig({}), { foo: 1 })).toThrow();
    expect(() => groundRig(buildRig({}), { mode: 'hover' })).toThrow(/mode/);
  });
});

describe('figure mouthAccents — paintable teeth and lips', () => {
  const rig = buildRig({ height: 60, headsTall: 5 });
  const labelsOf = (node: unknown): string[] =>
    [...new Set(partitionByLabel(node as SdfNode).map(p => p.labelName).filter((n): n is string => !!n))].sort();

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
    const c = rig.joints.head;
    const p = [c[0], c[1] - rig.r.headZ * 0.7, c[2] + rig.r.headZ * 0.55];
    const mid = buildHair(api, rig, { style: 'short', hairline: 'mid' }) as SdfNode;
    const low = buildHair(api, rig, { style: 'short', hairline: 'low' }) as SdfNode;
    expect(mid.evaluate(p[0], p[1], p[2])).toBeGreaterThan(0);
    expect(low.evaluate(p[0], p[1], p[2])).toBeLessThan(0);
  });

  it('ponytail adds a tail down the back of the skull', () => {
    // Midpoint of the tail's mid→tip segment: outside the enlarged cap,
    // inside the swinging tail capsule.
    const c = rig.joints.head, R = rig.r.head, hz = rig.r.headZ;
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

  it('rejects unknown style / hairline / texture / part / keys', () => {
    expect(() => buildHair(api, rig, { style: 'mohawk' })).toThrow(/style/);
    expect(() => buildHair(api, rig, { hairline: 'widow' })).toThrow(/hairline/);
    expect(() => buildHair(api, rig, { texture: 'glitter' })).toThrow(/texture/);
    expect(() => buildHair(api, rig, { part: 'mullet' })).toThrow(/part/);
    expect(() => buildHair(api, rig, { volume: 9 })).toThrow(/volume/);   // out of 0.3..4
    expect(() => buildHair(api, rig, { frizz: 2 })).toThrow();            // unknown key
  });

  it('accepts the new styles and the length/volume/part/texture options', () => {
    for (const style of ['bob', 'afro', 'braids', 'spiked', 'locs', 'cornrows', 'boxBraids'] as const) {
      expect(buildHair(api, rig, { style }).bounds).toBeTypeOf('function');
    }
    expect(() => buildHair(api, rig, { style: 'long', length: 'long', volume: 1.6 })).not.toThrow();
    expect(() => buildHair(api, rig, { style: 'afro', texture: 'curls', part: 'left' })).not.toThrow();
    // 'coils' is the new 4c texture — usable on any style.
    expect(() => buildHair(api, rig, { style: 'short', texture: 'coils' })).not.toThrow();
  });

  it('locs / boxBraids hang strands below the head; cornrows lay tight to the scalp', () => {
    const head = buildHair(api, rig, { style: 'short' }) as SdfNode;
    const locs = buildHair(api, rig, { style: 'locs' }) as SdfNode;
    const box = buildHair(api, rig, { style: 'boxBraids' }) as SdfNode;
    const corn = buildHair(api, rig, { style: 'cornrows' }) as SdfNode;
    // Hanging styles reach well below a plain short cap.
    expect(locs.bounds().min[2]).toBeLessThan(head.bounds().min[2]);
    expect(box.bounds().min[2]).toBeLessThan(head.bounds().min[2]);
    // Cornrows stay near the head — they don't hang past the short cap's nape.
    expect(corn.bounds().min[2]).toBeGreaterThan(locs.bounds().min[2]);
  });

  it('new options are neutral at their defaults — classic styles are byte-identical', () => {
    // length:'mid', volume:1, texture:'none', part:'none' must reproduce the
    // pre-existing geometry exactly, so existing catalog bakes never drift.
    const probes = [
      [0, 0, rig.joints.head[2]],
      [rig.r.headX * 0.5, -rig.r.head, rig.joints.head[2] + rig.r.headZ * 0.4],
      [0, rig.r.head, rig.joints.head[2] - rig.r.head * 1.5],
    ];
    for (const style of ['short', 'long', 'bun', 'bangs', 'ponytail'] as const) {
      const bare = buildHair(api, rig, { style }) as SdfNode;
      const explicit = buildHair(api, rig, { style, length: 'mid', volume: 1, texture: 'none', part: 'none', ears: 'cover' }) as SdfNode;
      for (const p of probes) {
        expect(explicit.evaluate(p[0], p[1], p[2])).toBeCloseTo(bare.evaluate(p[0], p[1], p[2]), 9);
      }
    }
  });

  it('length:long drops a ponytail lower than the default', () => {
    const mid = buildHair(api, rig, { style: 'ponytail' }) as SdfNode;
    const long = buildHair(api, rig, { style: 'ponytail', length: 'long' }) as SdfNode;
    // A longer tail reaches farther below the head along −Z.
    expect(long.bounds().min[2]).toBeLessThan(mid.bounds().min[2]);
  });

  it("ears:'behind' carves an ear-clearance pocket that 'cover' leaves filled", () => {
    // A point just outboard of the ear anchor, where the bob's side wing sits:
    // 'cover' keeps hair there (inside the cap), 'behind' scoops it away so the
    // skin ear protrudes in front of the hair.
    const ear = rig.face.earL;
    const p = [ear[0] + rig.r.headX * 0.12, ear[1], ear[2]];
    const cover = buildHair(api, rig, { style: 'bob', ears: 'cover' }) as SdfNode;
    const behind = buildHair(api, rig, { style: 'bob', ears: 'behind' }) as SdfNode;
    expect(cover.evaluate(p[0], p[1], p[2])).toBeLessThan(0);    // hair covers the ear zone
    expect(behind.evaluate(p[0], p[1], p[2])).toBeGreaterThan(0); // pocket carved → ear exposed
  });

  it("ears:'behind' leaves the crown untouched (localized pocket)", () => {
    const c = rig.joints.head;
    const top = [c[0], c[1], c[2] + rig.r.headZ * 0.9];   // crown of the cap
    const cover = buildHair(api, rig, { style: 'short', ears: 'cover' }) as SdfNode;
    const behind = buildHair(api, rig, { style: 'short', ears: 'behind' }) as SdfNode;
    expect(behind.evaluate(top[0], top[1], top[2])).toBeCloseTo(cover.evaluate(top[0], top[1], top[2]), 9);
  });

  it('rejects an unknown hair.ears value', () => {
    expect(() => buildHair(api, rig, { ears: 'tuck' })).toThrow(/ears/);
  });
});

describe('figure ears — types', () => {
  const rig = buildRig({ height: 60, headsTall: 5 });

  it('builds a default ear and rejects an unknown type / key', () => {
    expect(buildEars(api, rig).bounds).toBeTypeOf('function');
    expect(() => buildEars(api, rig, { type: 'goblin' })).toThrow(/type/);
    expect(() => buildEars(api, rig, { wiggle: 1 })).toThrow();
  });

  it('builds all three types as valid nodes spanning both ear anchors', () => {
    for (const type of ['round', 'pointed', 'detailed'] as const) {
      const ears = buildEars(api, rig, { type }) as SdfNode;
      const b = ears.bounds();
      // Spans from the −X (right) anchor to the +X (left) anchor.
      expect(b.min[0]).toBeLessThan(0);
      expect(b.max[0]).toBeGreaterThan(0);
    }
  });

  it('pointed ears reach higher than round ears (the elf point)', () => {
    const round = buildEars(api, rig, { type: 'round' }) as SdfNode;
    const pointed = buildEars(api, rig, { type: 'pointed' }) as SdfNode;
    expect(pointed.bounds().max[2]).toBeGreaterThan(round.bounds().max[2]);
  });

  it('ears stand proud of the skull (extend past the lateral radius)', () => {
    // The ear's outer edge must reach beyond the bare skull's lateral half-width
    // (r.headX), so it protrudes instead of sitting flush like the old blob.
    const ears = buildEars(api, rig, { type: 'round' }) as SdfNode;
    expect(ears.bounds().max[0]).toBeGreaterThan(rig.r.headX);
  });
});

describe('figure skin palette — F.skin', () => {
  const F = createFigureNamespace(api);
  const lum = (hex: string): number =>
    parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);

  it('returns a hex string for a known tone', () => {
    expect(F.skin('umber')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(F.skin('porcelain')).not.toBe(F.skin('ebony'));
  });

  it('returns the full {name: hex} map with no argument, spanning light → deep', () => {
    const all = F.skin() as Record<string, string>;
    expect(Object.keys(all).length).toBeGreaterThanOrEqual(12);
    for (const hex of Object.values(all)) expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
    // The ramp must actually cover the range AND be strictly monotonic light →
    // deep (insertion order = the documented porcelain…ebony order), so a future
    // mis-ordered palette edit is caught rather than passing on the endpoints.
    const lums = Object.values(all).map(lum);
    for (let i = 1; i < lums.length; i++) expect(lums[i]).toBeLessThan(lums[i - 1]);
  });

  it('throws naming the option on an unknown tone', () => {
    expect(() => F.skin('beige2')).toThrow(/skin/);
  });
});

describe('figure head — face shape & jaw/chin/cheek axes', () => {
  const F = createFigureNamespace(api);
  const rig = buildRig({ height: 60, headsTall: 6 });
  const span = (n: SdfNode, ax: number): number => n.bounds().max[ax] - n.bounds().min[ax];

  it('default (no opts) is byte-identical to faceShape:oval at default knobs', () => {
    const bare = F.head(rig) as unknown as SdfNode;
    const oval = F.head(rig, { faceShape: 'oval', jaw: 1, chin: 1, cheek: 1 }) as unknown as SdfNode;
    const probes = [
      [0, -rig.r.head, rig.joints.head[2]],
      [rig.r.headX, 0, rig.joints.head[2]],
      [0, 0, rig.joints.head[2] - rig.r.headZ],
    ];
    for (const p of probes) {
      expect(oval.evaluate(p[0], p[1], p[2])).toBeCloseTo(bare.evaluate(p[0], p[1], p[2]), 9);
    }
  });

  it('a wider jaw widens the head laterally', () => {
    const narrow = F.head(rig, { jaw: 0.6 }) as unknown as SdfNode;
    const wide = F.head(rig, { jaw: 1.5 }) as unknown as SdfNode;
    expect(span(wide, 0)).toBeGreaterThan(span(narrow, 0));
  });

  it('a longer chin extends the head downward', () => {
    const shortChin = F.head(rig, { chin: 0.6 }) as unknown as SdfNode;
    const longChin = F.head(rig, { chin: 1.5 }) as unknown as SdfNode;
    expect(longChin.bounds().min[2]).toBeLessThan(shortChin.bounds().min[2]);
  });

  it('rejects unknown faceShape, out-of-range knobs, and unknown keys', () => {
    expect(() => F.head(rig, { faceShape: 'potato' })).toThrow(/faceShape/);
    expect(() => F.head(rig, { jaw: 9 })).toThrow(/jaw/);
    expect(() => F.head(rig, { wat: 1 })).toThrow();
  });
});

describe('figure nose & lips — variation axes', () => {
  const F = createFigureNamespace(api);
  const rig = buildRig({ height: 60, headsTall: 6 });
  const span = (n: SdfNode, ax: number): number => n.bounds().max[ax] - n.bounds().min[ax];

  it('default nose (width:1, flare:0) matches the bare nose', () => {
    const bare = F.face.nose(rig) as unknown as SdfNode;
    const def = F.face.nose(rig, { width: 1, flare: 0, bridge: 1, length: 1 }) as unknown as SdfNode;
    const p = rig.face.nose;
    expect(def.evaluate(p[0], p[1], p[2])).toBeCloseTo(bare.evaluate(p[0], p[1], p[2]), 9);
  });

  it('a wider, flared nose has a larger lateral extent than a narrow one', () => {
    const narrow = F.face.nose(rig, { width: 0.6, flare: 0 }) as unknown as SdfNode;
    const wide = F.face.nose(rig, { width: 2.0, flare: 1.2 }) as unknown as SdfNode;
    expect(span(wide, 0)).toBeGreaterThan(span(narrow, 0));
  });

  it('fuller lips thicken the lip ridge', () => {
    const thin = F.face.mouth(rig, { style: 'lips', fullness: 0.5 }) as unknown as SdfNode;
    const full = F.face.mouth(rig, { style: 'lips', fullness: 2.0 }) as unknown as SdfNode;
    expect(span(full, 2)).toBeGreaterThan(span(thin, 2));
  });

  it('rejects out-of-range nose params and bad mouth fullness', () => {
    expect(() => F.face.nose(rig, { bridge: 5 })).toThrow(/bridge/);
    expect(() => F.face.nose(rig, { width: 9 })).toThrow(/width/);
    expect(() => F.face.mouth(rig, { style: 'lips', fullness: 9 })).toThrow(/fullness/);
  });
});

describe('figure placeOnHead — seat headwear on the hair', () => {
  const F = createFigureNamespace(api);
  const rig = buildRig({ height: 60, headsTall: 6 });
  const hat = (): SdfNode => api.box([2, 2, 2]) as unknown as SdfNode;

  it('rests an accessory bottom on the hair TOP, centred on the head', () => {
    const hair = F.hair(rig, { style: 'short' }) as unknown as SdfNode;
    const hairTop = hair.bounds().max[2];
    const placed = F.placeOnHead(hat() as object, rig, { rest: hair }) as unknown as SdfNode;
    const b = placed.bounds();
    expect(b.min[2]).toBeCloseTo(hairTop, 5);                               // bottom on hair top
    expect((b.min[0] + b.max[0]) / 2).toBeCloseTo(rig.joints.head[0], 5);   // centred X
    expect((b.min[1] + b.max[1]) / 2).toBeCloseTo(rig.joints.head[1], 5);   // centred Y
  });

  it('embed sinks it into the hair; clearance lifts it off', () => {
    const hair = F.hair(rig, { style: 'short' }) as unknown as SdfNode;
    const top = hair.bounds().max[2];
    const sunk = F.placeOnHead(hat() as object, rig, { rest: hair, embed: 1 }) as unknown as SdfNode;
    const lifted = F.placeOnHead(hat() as object, rig, { rest: hair, clearance: 1 }) as unknown as SdfNode;
    expect(sunk.bounds().min[2]).toBeCloseTo(top - 1, 5);
    expect(lifted.bounds().min[2]).toBeCloseTo(top + 1, 5);
  });

  it('falls back to the crown joint without rest, and validates inputs', () => {
    const placed = F.placeOnHead(hat() as object, rig) as unknown as SdfNode;
    expect(placed.bounds().min[2]).toBeCloseTo(rig.joints.crown[2], 5);
    expect(() => F.placeOnHead(hat() as object, rig, { rest: 5 })).toThrow(/rest/);
    expect(() => F.placeOnHead(hat() as object, rig, { wig: true })).toThrow();
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
    const posed = buildRig({ pose: { armL: { raiseSide: 150, bend: 40 } } });
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
    expect(head.center).toEqual(rig.joints.head);
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

  it('adds nested eye detail spheres (eyelid + finer iris/pupil) so the eye meshes smoothly', () => {
    const regions = faceDetail(rig);
    const [head] = regions;
    // Two spheres PER eye (a medium eyelid/eyeball one + a finer iris/pupil one),
    // all finer than the head grid and near an eye anchor → four in total.
    const nearEye = (c: number[], a: number[]): boolean =>
      Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]) < rig.r.head * 0.4;
    const eyeRegions = regions.filter((d) => d.edgeLength < head.edgeLength
      && (nearEye(d.center, rig.face.eyeL) || nearEye(d.center, rig.face.eyeR)));
    expect(eyeRegions.length).toBe(4);
    // All finer than the head grid; the finest (iris/pupil) is finer still.
    for (const e of eyeRegions) expect(e.edgeLength).toBeLessThanOrEqual(rig.r.head * 0.05 + 0.03);
    const finest = Math.min(...eyeRegions.map((e) => e.edgeLength));
    expect(finest).toBeLessThanOrEqual(rig.r.head * 0.02);
    expect(() => faceDetail(rig, { eyeEdgeLength: 0.03, irisEdgeLength: 0.015 })).not.toThrow();
  });
});

describe('figure rig — head tilt (was a silent no-op)', () => {
  // Regression: tilt was applied as `rotY(hf, tilt)` to the forward vector and
  // then discarded by the cross-product frame rebuild, so it did nothing. It is
  // now a roll of the up/left axes about the forward axis.
  it('rolls the head toward a shoulder — headUp leans laterally', () => {
    const neutral = buildRig({});
    const tilted = buildRig({ pose: { head: { roll: 20 } } });
    // Positive tilt drops the crown toward the figure's LEFT shoulder (+X).
    expect(neutral.dir.headUp[0]).toBeCloseTo(0, 6);
    expect(tilted.dir.headUp[0]).toBeGreaterThan(0.2);
    // It is a pure roll: the forward direction is unchanged.
    expect(dist(tilted.dir.headForward, neutral.dir.headForward)).toBeLessThan(1e-9);
  });

  it('moves the face anchors (eyes follow the roll)', () => {
    const neutral = buildRig({});
    const tilted = buildRig({ pose: { head: { roll: 20 } } });
    expect(dist(tilted.face.eyeL, neutral.face.eyeL)).toBeGreaterThan(0.1);
  });

  it('roll: 0 is byte-identical to no head pose', () => {
    const a = buildRig({});
    const b = buildRig({ pose: { head: { roll: 0 } } });
    expect(b.dir.headUp).toEqual(a.dir.headUp);
    expect(b.face.eyeL).toEqual(a.face.eyeL);
  });
});

describe('figure rig — spine (was parsed but never applied)', () => {
  // Regression: spine.{lean,turn,side} were validated and stored but no FK ever
  // read them. They now rigidly rotate the above-waist mass about the navel.
  const neutral = buildRig({});

  it('lean bends the upper body forward (−Y) at the waist', () => {
    const leaned = buildRig({ pose: { spine: { lean: 25 } } });
    expect(leaned.joints.chest[1]).toBeLessThan(neutral.joints.chest[1] - 0.5);
    expect(leaned.joints.head[1]).toBeLessThan(neutral.joints.head[1] - 1);
    // legs stay planted — the figure bends at the waist, not the ankles.
    expect(leaned.joints.footL).toEqual(neutral.joints.footL);
    expect(leaned.joints.hips).toEqual(neutral.joints.hips);
  });

  it('side leans toward the figure-left shoulder (+X); turn twists the shoulders', () => {
    const sided = buildRig({ pose: { spine: { side: 25 } } });
    expect(sided.joints.head[0]).toBeGreaterThan(neutral.joints.head[0] + 0.5);
    const turned = buildRig({ pose: { spine: { turn: 30 } } });
    // the shoulder line rotates about Z — shoulders are no longer purely ±X.
    expect(Math.abs(turned.joints.upperArmL[1])).toBeGreaterThan(0.5);
  });

  it('is a rigid rotation: arms ride the spine but keep their bone lengths', () => {
    const leaned = buildRig({ pose: { spine: { lean: 25 }, armL: { raiseSide: 40, bend: 60 } } });
    const upright = buildRig({ pose: { armL: { raiseSide: 40, bend: 60 } } });
    // the whole arm moved with the torso…
    expect(dist(leaned.joints.handL, upright.joints.handL)).toBeGreaterThan(0.5);
    // …but the upper-arm bone length is preserved (rigid, still attached).
    const boneLen = (rig: typeof leaned) => dist(rig.joints.upperArmL, rig.joints.lowerArmL);
    expect(boneLen(leaned)).toBeCloseTo(boneLen(upright), 5);
  });

  it('zero spine is byte-identical to no spine (every existing pose unchanged)', () => {
    const z = buildRig({ pose: { spine: { lean: 0, turn: 0, side: 0 } } });
    for (const j of ['chest', 'head', 'upperArmL', 'handR', 'crown'] as const) {
      expect(z.joints[j]).toEqual(neutral.joints[j]);
    }
    expect(z.dir.headForward).toEqual(neutral.dir.headForward);
  });
});

describe('figure eyes — protrusion floor', () => {
  it('floors the eyeball push at ~2 face-detail cells so labels never bury', () => {
    // Regression: a `rad * 0.28` push was ~1 march cell and shrank to 0 on many
    // figures, collapsing the eye/iris/pupil labels. Now floored at r.head*0.09.
    const rig = buildRig({ height: 60, headsTall: 6 });
    const rad = rig.r.head * 0.16;            // the default eyes radius
    const solid = buildEyes(api, rig, { style: 'solid' }) as SdfNode;
    // forward (−Y) reach of the eyeball front past the eye anchor plane.
    const reach = -solid.bounds().min[1];
    expect(reach).toBeGreaterThan(-rig.face.eyeL[1] + rig.r.head * 0.09 + rad - 1e-6);
  });
});

describe('figure face.assemble — eyes default OFF', () => {
  const F = createFigureNamespace(api);
  const rig = buildRig({ height: 60, headsTall: 5 });
  const labelsOf = (node: unknown): string[] =>
    [...new Set(partitionByLabel(node as SdfNode).map(p => p.labelName).filter((n): n is string => !!n))].sort();

  it('omits eyes by default (so a later .label("skin") cannot flatten them)', () => {
    const face = F.face.assemble(F.head(rig), rig);
    expect(labelsOf(face)).not.toContain('iris');
    expect(labelsOf(face)).not.toContain('pupil');
  });

  it('eyes: true opts the in-face eyes back in', () => {
    const face = F.face.assemble(F.head(rig), rig, { eyes: true });
    expect(labelsOf(face)).toEqual(expect.arrayContaining(['eyes', 'iris', 'pupil']));
  });
});

describe('figure brows — validated options (were silently ignored)', () => {
  const F = createFigureNamespace(api);
  const rig = buildRig({});
  it('accepts thickness / lift and rejects unknown keys', () => {
    expect(() => F.face.brows(rig, { thickness: 2, lift: 1.5 })).not.toThrow();
    expect(() => F.face.brows(rig, { bogus: 1 })).toThrow();
  });
  it('thickness actually changes the ridge (no longer a no-op payload)', () => {
    const thin = (F.face.brows(rig, { thickness: 1 }) as SdfNode).bounds();
    const thick = (F.face.brows(rig, { thickness: 3 }) as SdfNode).bounds();
    // a heavier ridge has a larger bbox than a slim one.
    const span = (b: { min: number[]; max: number[] }) => b.max[2] - b.min[2];
    expect(span(thick)).toBeGreaterThan(span(thin));
  });
});

describe('figure hair — bald does not poison bounds()', () => {
  it('bald returns an empty node bounded at the head, not at z ≈ −1e6', () => {
    // Regression: bald returned sphere(1e-3) parked at z=−1e6, which broke
    // bounds()/placeAt (snapped a million units down).
    const rig = buildRig({ height: 60 });
    const b = (buildHair(api, rig, { style: 'bald' }) as SdfNode).bounds();
    const cz = (b.min[2] + b.max[2]) / 2;
    expect(cz).toBeCloseTo(rig.joints.head[2], 2);
    expect(cz).toBeGreaterThan(0);
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
    expect(() => buildRig({ pose: { armL: { flap: 90 } } })).toThrow();
    expect(() => buildRig({ pose: { wings: {} } })).toThrow();
  });
  it('accepts an empty / omitted opts object', () => {
    expect(() => buildRig(undefined)).not.toThrow();
    expect(() => buildRig({})).not.toThrow();
  });
});

describe('figure grip frames — connecting held props to the palm', () => {
  const unit = (v: number[]) => Math.hypot(v[0], v[1], v[2]);
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  it('exposes a grip frame per hand with orthonormal-ish axes', () => {
    const rig = buildRig({ height: 64 });
    for (const g of [rig.grip.L, rig.grip.R]) {
      expect(g.point).toHaveLength(3);
      // Axes are unit length.
      expect(unit(g.palmNormal)).toBeCloseTo(1, 6);
      expect(unit(g.gripAxis)).toBeCloseTo(1, 6);
      expect(unit(g.reach)).toBeCloseTo(1, 6);
      // palmNormal ⟂ gripAxis and ⟂ reach (it's their cross product).
      expect(dot(g.palmNormal, g.gripAxis)).toBeCloseTo(0, 5);
      expect(dot(g.palmNormal, g.reach)).toBeCloseTo(0, 5);
    }
  });

  it('offsets the grip point off the hand centre toward the palm', () => {
    const rig = buildRig({ height: 64 });
    // The cup is NOT the hand centre — that's the whole point (props seated at
    // the centre pass through the hand). It sits along +palmNormal from handL.
    const offL = [
      rig.grip.L.point[0] - rig.joints.handL[0],
      rig.grip.L.point[1] - rig.joints.handL[1],
      rig.grip.L.point[2] - rig.joints.handL[2],
    ];
    const offLen = unit(offL);
    expect(offLen).toBeGreaterThan(0.2);
    // The offset points purely along +palmNormal.
    expect(dot(offL.map((c) => c / offLen), rig.grip.L.palmNormal)).toBeCloseTo(1, 4);
  });

  it('tracks the pose — raising the arm moves the grip with the hand', () => {
    const down = buildRig({ height: 64, pose: { armL: { raiseSide: 0 } } });
    const up = buildRig({ height: 64, pose: { armL: { raiseSide: 150 } } });
    expect(up.grip.L.point[2]).toBeGreaterThan(down.grip.L.point[2]);
  });

  it('spine bend transforms the grip frame with the upper body', () => {
    const straight = buildRig({ height: 64 });
    const leaned = buildRig({ height: 64, pose: { spine: { lean: 30 } } });
    // The grip frame rides the spine rotation: both its point and its axes move.
    const movedPoint = dist(leaned.grip.L.point, straight.grip.L.point);
    expect(movedPoint).toBeGreaterThan(1);
    const axisDot = dot(leaned.grip.L.gripAxis, straight.grip.L.gripAxis);
    expect(axisDot).toBeLessThan(0.999); // the grip axis rotated, not identical
  });
});

describe('figure holdAt — orient + seat a prop into a grip', () => {
  const F = createFigureNamespace(api);

  it('aligns the prop long axis to the grip axis and seats it at the point', () => {
    // A capsule along local +Z, centred at the origin, length 6, radius 0.5.
    const bar = api.capsule([0, 0, -3], [0, 0, 3], 0.5);
    const grip = { point: [10, 2, 5], palmNormal: [0, 0, 1], gripAxis: [1, 0, 0], reach: [0, 1, 0] };
    const held = (F.holdAt(bar as unknown as SdfNode, grip as never) as SdfNode).bounds();
    // Long axis is now world X (extent = length 6 + 2×radius = 7); the other two
    // are the diameter (≈1).
    expect(held.max[0] - held.min[0]).toBeCloseTo(7, 4);
    expect(held.max[1] - held.min[1]).toBeCloseTo(1, 4);
    expect(held.max[2] - held.min[2]).toBeCloseTo(1, 4);
    // Centred on the grip point.
    expect((held.min[0] + held.max[0]) / 2).toBeCloseTo(10, 4);
    expect((held.min[1] + held.max[1]) / 2).toBeCloseTo(2, 4);
    expect((held.min[2] + held.max[2]) / 2).toBeCloseTo(5, 4);
  });

  it('honours along: a +X-axis prop aligns the same way', () => {
    const bar = api.capsule([-3, 0, 0], [3, 0, 0], 0.5);  // along local +X
    const grip = { point: [0, 0, 0], palmNormal: [1, 0, 0], gripAxis: [0, 0, 1], reach: [0, 1, 0] };
    const held = (F.holdAt(bar as unknown as SdfNode, grip as never, { along: 'x' }) as SdfNode).bounds();
    // gripAxis is world +Z, so the long extent (6 + 2×radius = 7) is now Z.
    expect(held.max[2] - held.min[2]).toBeCloseTo(7, 4);
    expect(held.max[0] - held.min[0]).toBeCloseTo(1, 4);
  });

  it('rejects unknown opts and non-boolean flip', () => {
    const bar = api.capsule([0, 0, -1], [0, 0, 1], 0.5);
    const grip = { point: [0, 0, 0], palmNormal: [0, 0, 1], gripAxis: [1, 0, 0], reach: [0, 1, 0] };
    expect(() => F.holdAt(bar as unknown as SdfNode, grip as never, { roll: 5 } as never)).toThrow();
    expect(() => F.holdAt(bar as unknown as SdfNode, grip as never, { flip: 'yes' } as never)).toThrow();
  });
});

describe('figure spanGrips — the two-anchor (two-hand prop) frame', () => {
  const F = createFigureNamespace(api);

  it('returns endpoints, unit axis, length, and midpoint between two grips', () => {
    const a = { point: [0, 0, 0], palmNormal: [0, 0, 1], gripAxis: [1, 0, 0], reach: [0, 1, 0] };
    const b = { point: [6, 0, 8], palmNormal: [0, 0, 1], gripAxis: [1, 0, 0], reach: [0, 1, 0] };
    const s = F.spanGrips(a as never, b as never);
    expect(s.a).toEqual([0, 0, 0]);
    expect(s.b).toEqual([6, 0, 8]);
    expect(s.length).toBeCloseTo(10, 6);           // 6-8-10 triangle
    expect(s.axis[0]).toBeCloseTo(0.6, 6);
    expect(s.axis[2]).toBeCloseTo(0.8, 6);
    expect(Math.hypot(...s.axis)).toBeCloseTo(1, 6); // unit
    expect(s.mid).toEqual([3, 0, 4]);
  });

  it('accepts raw [x,y,z] points on either side (joint ↔ grip)', () => {
    const grip = { point: [10, 0, 0], palmNormal: [0, 0, 1], gripAxis: [1, 0, 0], reach: [0, 1, 0] };
    const s = F.spanGrips([0, 0, 0] as never, grip as never);
    expect(s.b).toEqual([10, 0, 0]);
    expect(s.length).toBeCloseTo(10, 6);
    expect(s.axis).toEqual([1, 0, 0]);
  });

  it('a real rig spans hand-to-hand and the axis points L→R', () => {
    const rig = buildRig({ height: 64 });
    const s = F.spanGrips(rig.grip.L, rig.grip.R);
    expect(s.length).toBeGreaterThan(0);
    // L is +X side, R is −X side, so the span axis runs in −X.
    expect(s.axis[0]).toBeLessThan(0);
    // The capsule a/b end exactly on the two grip cups.
    expect(s.a).toEqual(rig.grip.L.point);
    expect(s.b).toEqual(rig.grip.R.point);
  });

  it('degenerate span (a == b) yields a safe unit axis, not NaN', () => {
    const s = F.spanGrips([1, 2, 3] as never, [1, 2, 3] as never);
    expect(s.length).toBe(0);
    expect(s.axis).toEqual([0, 0, 1]);
    expect(s.mid).toEqual([1, 2, 3]);
  });
});

describe('figure poseProbe — deterministic joint/grip dump', () => {
  const F = createFigureNamespace(api);

  it('reports rig opts, every joint, both grips, and a text summary', () => {
    const rig = buildRig({ height: 64, headsTall: 7, build: 'slim' });
    const p = F.poseProbe(rig);
    expect(p.height).toBe(64);
    expect(p.headsTall).toBe(7);
    expect(p.build).toBe('slim');
    // Every joint in the rig is present in the probe.
    expect(Object.keys(p.joints).sort()).toEqual(Object.keys(rig.joints).sort());
    // Grips carry the four frame vectors.
    expect(p.grips.L.point).toHaveLength(3);
    expect(p.grips.R.gripAxis).toHaveLength(3);
    // Values are rounded to 2 decimals (no long floats in the readout).
    for (const k of Object.keys(p.joints)) {
      for (const c of p.joints[k]) expect(Math.round(c * 100) / 100).toBe(c);
    }
    // The text summary names the joints and grips.
    expect(p.text).toContain('poseProbe');
    expect(p.text).toContain('handL');
    expect(p.text).toContain('grips:');
  });

  it('tracks the pose: a leaned spine moves the probed grip point', () => {
    const straight = F.poseProbe(buildRig({ height: 64 }));
    const leaned = F.poseProbe(buildRig({ height: 64, pose: { spine: { lean: 30 } } }));
    expect(leaned.grips.L.point).not.toEqual(straight.grips.L.point);
  });
});
