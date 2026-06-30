/**
 * Dummy 13 — a parametric, snap-together articulated figure skeleton.
 *
 * 13 printed parts whose ball/socket interfaces all use the existing
 * `joints.ballSocket` primitive (friction retention by default). Each part is
 * printed separately and the figure is assembled afterwards — every joint
 * snaps over a captive ball with the rim's springy fingers giving the
 * hold-the-pose grip.
 *
 *   Parts (count = 13):
 *     1 head            — socket bottom
 *     1 torsoUpper      — neck-ball top, two shoulder-balls, waist-socket bottom
 *     1 hips            — waist-ball top, two hip-balls
 *     2 upperArm L/R    — shoulder-socket top, elbow-ball bottom
 *     2 forearm L/R     — elbow-socket top, wrist-ball bottom
 *     2 hand L/R        — wrist-socket
 *     2 thigh L/R       — hip-socket top, knee-ball bottom
 *     2 shin L/R        — knee-socket top, foot integrated at bottom
 *
 * Sibling of `src/geometry/joints.ts` — every part is built on top of
 * `joints.ballSocket`, so tolerance tuning lives in one place. Z-up, figure
 * front = −Y, figure left = +X.
 *
 * Inspired by soozafone's Dummy 13 print-in-place figure system; this is a
 * compatible-spirit reimplementation (parametric, snap-together, not
 * print-in-place), not a copy of any specific part shape.
 */

import { ValidationError } from '../validation/apiValidation';

/* eslint-disable @typescript-eslint/no-explicit-any */

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'string') return `"${v}"`;
  return String(v);
}

function pickOpts(val: unknown, name: string): Record<string, unknown> {
  if (val === undefined || val === null) return {};
  if (typeof val !== 'object' || Array.isArray(val)) {
    throw new ValidationError(`dummy13.${name}: options must be a plain object, got ${describe(val)}.`);
  }
  return val as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Standard spec — one source of truth for joint sizes & proportions
// ---------------------------------------------------------------------------

/** Standard joint diameters (mm) for the default ~135mm-tall skeleton. Sized
 *  for a typical 0.4mm-nozzle FDM printer; the friction-fingered socket rim
 *  (`joints.ballSocket` retention='friction') holds a snapped-in ball without
 *  the impossible tolerance window a captive print-in-place joint demands. */
export const DUMMY13_DEFAULTS = Object.freeze({
  /** Total skeleton height, head crown to heel (mm). Proportions scale with it. */
  height: 135,
  jointShoulderBallD: 8.0,
  jointHipBallD: 9.0,
  jointNeckBallD: 6.0,
  jointElbowBallD: 5.5,
  jointKneeBallD: 6.0,
  jointWristBallD: 4.5,
  clearance: 0.18,
  openingRatio: 0.85,
  slots: 4,
  segments: 48,
});

export type Dummy13Defaults = typeof DUMMY13_DEFAULTS;

/** Proportional segment lengths as fractions of total `height`. */
export const DUMMY13_PROPORTIONS = Object.freeze({
  head: 0.125,
  neck: 0.04,
  torsoUpper: 0.255,
  hips: 0.095,
  thigh: 0.235,
  shin: 0.25,
  shoulderWidth: 0.26,
  hipWidth: 0.20,
  upperArm: 0.19,
  forearm: 0.16,
  hand: 0.10,
});

export type Dummy13Proportions = typeof DUMMY13_PROPORTIONS;

export interface Dummy13Spec {
  height: number;
  shoulderBallD: number;
  hipBallD: number;
  neckBallD: number;
  elbowBallD: number;
  kneeBallD: number;
  wristBallD: number;
  clearance: number;
  openingRatio: number;
  slots: number;
  segments: number;
  prop: Dummy13Proportions;
}

/** Resolve a partial user spec against DUMMY13_DEFAULTS into a fully-populated
 *  spec. Pure — no engine deps, unit-testable. */
export function resolveSpec(input: Partial<Dummy13Spec> = {}): Dummy13Spec {
  const d = DUMMY13_DEFAULTS;
  return {
    height: input.height ?? d.height,
    shoulderBallD: input.shoulderBallD ?? d.jointShoulderBallD,
    hipBallD: input.hipBallD ?? d.jointHipBallD,
    neckBallD: input.neckBallD ?? d.jointNeckBallD,
    elbowBallD: input.elbowBallD ?? d.jointElbowBallD,
    kneeBallD: input.kneeBallD ?? d.jointKneeBallD,
    wristBallD: input.wristBallD ?? d.jointWristBallD,
    clearance: input.clearance ?? d.clearance,
    openingRatio: input.openingRatio ?? d.openingRatio,
    slots: input.slots ?? d.slots,
    segments: input.segments ?? d.segments,
    prop: input.prop ?? DUMMY13_PROPORTIONS,
  };
}

/** Segment lengths in mm, derived from `height` and the proportion table. */
export interface Dummy13Lengths {
  head: number;
  neck: number;
  torsoUpper: number;
  hips: number;
  thigh: number;
  shin: number;
  shoulderWidth: number;
  hipWidth: number;
  upperArm: number;
  forearm: number;
  hand: number;
}

export function segmentLengths(spec: Dummy13Spec): Dummy13Lengths {
  const h = spec.height;
  const p = spec.prop;
  return {
    head: h * p.head,
    neck: h * p.neck,
    torsoUpper: h * p.torsoUpper,
    hips: h * p.hips,
    thigh: h * p.thigh,
    shin: h * p.shin,
    shoulderWidth: h * p.shoulderWidth,
    hipWidth: h * p.hipWidth,
    upperArm: h * p.upperArm,
    forearm: h * p.forearm,
    hand: h * p.hand,
  };
}

// Geometry helpers used by socketCupHeight / ballEndHeight + the builders.
// Match the layout joints.ballSocket builds internally so the parts hand off
// cleanly without poking through each other.
function cupGeometry(ballD: number, spec: Dummy13Spec) {
  const ballR = ballD / 2;
  const cavityR = ballR + spec.clearance;
  const openingR = (spec.openingRatio * ballD) / 2;
  const lipH = Math.sqrt(cavityR * cavityR - openingR * openingR);
  const wall = Math.max(1.6, ballD * 0.16);
  const floor = Math.max(1.2, wall);
  const housingR = cavityR + wall;
  const totalH = floor + cavityR + lipH;
  return { ballR, cavityR, openingR, lipH, wall, floor, housingR, totalH };
}

function ballEndStemL(ballD: number): number {
  return Math.max(2, ballD * 0.45);
}

function ballEndHeight(ballD: number, baseT = 1.6): number {
  // baseDisc + stem + (sphere centre offset baked into joints.ballSocket).
  // The sphere is centered at ballC = baseT + stemL + ballR - min(1.5, ballR*0.3)
  // and the topmost point is ballC + ballR. We need an upper bound.
  return baseT + ballEndStemL(ballD) + ballD;
}

// ---------------------------------------------------------------------------
// Namespace factory — needs the manifold module + the joints namespace
// ---------------------------------------------------------------------------

export interface JointsNamespaceShape {
  ballSocket(o: unknown): { ball: any; socket: any };
}

export function createDummy13Namespace(module: any, deps: { joints: JointsNamespaceShape }) {
  const { Manifold } = module;
  const { joints } = deps;

  function ballPair(ballD: number, spec: Dummy13Spec, opt: { stemL?: number; stemD?: number; baseT?: number; baseD?: number } = {}) {
    return joints.ballSocket({
      ballD,
      clearance: spec.clearance,
      openingRatio: spec.openingRatio,
      retention: 'friction',
      slots: spec.slots,
      segments: spec.segments,
      stemL: opt.stemL ?? ballEndStemL(ballD),
      stemD: opt.stemD ?? Math.max(2.5, ballD * 0.55),
      baseT: opt.baseT ?? 1.6,
      baseD: opt.baseD ?? ballD * 1.4,
    });
  }

  function ballEnd(ballD: number, spec: Dummy13Spec, opt: { stemL?: number; stemD?: number; baseT?: number; baseD?: number } = {}) {
    return ballPair(ballD, spec, opt).ball;
  }

  function socketCup(ballD: number, spec: Dummy13Spec) {
    return ballPair(ballD, spec).socket;
  }

  function capsule(length: number, r: number, segments: number) {
    // Capsule along ±Z, centred on origin. cylinder + two end hemispheres.
    const cyl = Manifold.cylinder(length, r, r, segments).translate([0, 0, -length / 2]);
    const top = Manifold.sphere(r, segments).translate([0, 0, length / 2]);
    const bot = Manifold.sphere(r, segments).translate([0, 0, -length / 2]);
    return cyl.add(top).add(bot);
  }

  /**
   * HEAD — a rounded head with a socket cup underneath. Z=0 is the bottom of
   * the socket housing; the head rises above it. The cup mouth faces −Z (so
   * the neck ball inserts upward into it).
   *
   * opts: { spec?, style? }  style: 'box' (default) | 'sphere'
   */
  function headPart(o0: unknown = {}) {
    const o = pickOpts(o0, 'headPart');
    const spec = resolveSpec(o.spec as Partial<Dummy13Spec> | undefined);
    const lens = segmentLengths(spec);
    const style = (o.style ?? 'box') as 'box' | 'sphere';

    const cupG = cupGeometry(spec.neckBallD, spec);
    const cup = socketCup(spec.neckBallD, spec)
      .rotate([180, 0, 0])
      .translate([0, 0, cupG.totalH]);

    const headH = lens.head;
    const headW = headH * 0.9;
    const headD = headH * 0.75;
    // Sink the bottom of the head 0.6mm into the top of the cup so the union
    // is volumetric.
    const headZ0 = cupG.totalH - 0.6;
    const head =
      style === 'sphere'
        ? Manifold.sphere(headH / 2, spec.segments)
            .scale([headW / headH, headD / headH, 1])
            .translate([0, 0, headZ0 + headH / 2])
        : Manifold.cube([headW, headD, headH], false).translate([-headW / 2, -headD / 2, headZ0]);

    return cup.add(head);
  }

  /**
   * UPPER TORSO — chest box with a waist socket at the bottom, a neck ball
   * rising from the top centre, and a shoulder ball on each side. Z=0 is the
   * bottom of the waist socket housing.
   */
  function torsoUpperPart(o0: unknown = {}) {
    const o = pickOpts(o0, 'torsoUpperPart');
    const spec = resolveSpec(o.spec as Partial<Dummy13Spec> | undefined);
    const lens = segmentLengths(spec);
    const waistCup = cupGeometry(spec.hipBallD, spec);

    // Waist socket — opens downward; housing base on z=0, mouth at z=0.
    const waist = socketCup(spec.hipBallD, spec)
      .rotate([180, 0, 0])
      .translate([0, 0, waistCup.totalH]);

    // Body box rises from z = waistCup.totalH - 0.6 upward by torsoH.
    const torsoH = lens.torsoUpper;
    const torsoW = lens.shoulderWidth * 0.92;
    const torsoD = lens.shoulderWidth * 0.55;
    const bodyZ0 = waistCup.totalH - 0.6;
    let body = Manifold.cube([torsoW, torsoD, torsoH], false).translate([-torsoW / 2, -torsoD / 2, bodyZ0]);

    // Carve a slight V-taper at the top so the silhouette reads as shoulders +
    // pinched waist line — pinch ~10% from each side at the upper-back corners.
    const taperW = torsoW * 0.14;
    const taperH = torsoH * 0.4;
    const taperR = Manifold.cube([taperW, torsoD + 2, taperH], false)
      .translate([torsoW / 2 - taperW * 0.7, -torsoD / 2 - 1, bodyZ0 + torsoH - taperH]);
    body = body.subtract(taperR).subtract(taperR.mirror([1, 0, 0]));

    // Neck ball — sticks up from the top centre.
    const neckBallH = ballEndHeight(spec.neckBallD);
    const neckBall = ballEnd(spec.neckBallD, spec, { stemL: lens.neck })
      .translate([0, 0, bodyZ0 + torsoH - 1]);
    void neckBallH; // kept for clarity; not needed numerically

    // Shoulder balls — face ±X. Build ball in +Z then rotate 90° about Y.
    const shoulderZ = bodyZ0 + torsoH - spec.shoulderBallD * 1.1;
    const shoulderX = torsoW / 2 - 0.6;
    const shoulderR = ballEnd(spec.shoulderBallD, spec, { stemL: spec.shoulderBallD * 0.5 })
      .rotate([0, 90, 0])
      .translate([shoulderX, 0, shoulderZ]);
    const shoulderL = ballEnd(spec.shoulderBallD, spec, { stemL: spec.shoulderBallD * 0.5 })
      .rotate([0, -90, 0])
      .translate([-shoulderX, 0, shoulderZ]);

    return body.add(waist).add(neckBall).add(shoulderR).add(shoulderL);
  }

  /**
   * HIPS — pelvis box with a waist ball on top and a hip ball on each side.
   * Z=0 is the bottom of the pelvis box.
   */
  function hipsPart(o0: unknown = {}) {
    const o = pickOpts(o0, 'hipsPart');
    const spec = resolveSpec(o.spec as Partial<Dummy13Spec> | undefined);
    const lens = segmentLengths(spec);
    const hipsH = lens.hips;
    const hipsW = lens.hipWidth;
    const hipsD = hipsW * 0.7;

    const body = Manifold.cube([hipsW, hipsD, hipsH], false).translate([-hipsW / 2, -hipsD / 2, 0]);
    const waistBall = ballEnd(spec.hipBallD, spec, { stemL: lens.neck * 0.6 })
      .translate([0, 0, hipsH - 1]);
    const hipR = ballEnd(spec.hipBallD, spec, { stemL: spec.hipBallD * 0.45 })
      .rotate([0, 90, 0])
      .translate([hipsW / 2 - 0.6, 0, hipsH * 0.45]);
    const hipL = ballEnd(spec.hipBallD, spec, { stemL: spec.hipBallD * 0.45 })
      .rotate([0, -90, 0])
      .translate([-(hipsW / 2 - 0.6), 0, hipsH * 0.45]);

    return body.add(waistBall).add(hipR).add(hipL);
  }

  /** Limb segment shared by upperArm/forearm/thigh: cup at z=0 (mouth +Z),
   *  capsule body extending up from the cup top, ball-end on top sticking +Z.
   *  Returned standing vertical: snap a mating ball into the cup from above
   *  for the joint above this limb, and the upper ball plugs into the cup of
   *  the limb below. */
  function buildLimb(spec: Dummy13Spec, cupBallD: number, topBallD: number, bodyLen: number, bodyR: number) {
    const cupG = cupGeometry(cupBallD, spec);
    const cup = socketCup(cupBallD, spec);
    const bodyZ0 = cupG.totalH - 0.5; // sink cup 0.5mm into capsule end
    const bodyZ1 = bodyZ0 + bodyLen;
    const body = capsule(bodyLen, bodyR, spec.segments).translate([0, 0, (bodyZ0 + bodyZ1) / 2]);
    const ball = ballEnd(topBallD, spec, { stemL: Math.max(topBallD * 0.4, 2) })
      .translate([0, 0, bodyZ1 - 1]);
    return cup.add(body).add(ball);
  }

  function upperArmPart(o0: unknown = {}) {
    const o = pickOpts(o0, 'upperArmPart');
    const spec = resolveSpec(o.spec as Partial<Dummy13Spec> | undefined);
    const lens = segmentLengths(spec);
    const bodyR = spec.shoulderBallD * 0.55;
    return buildLimb(spec, spec.shoulderBallD, spec.elbowBallD, lens.upperArm, bodyR);
  }

  function forearmPart(o0: unknown = {}) {
    const o = pickOpts(o0, 'forearmPart');
    const spec = resolveSpec(o.spec as Partial<Dummy13Spec> | undefined);
    const lens = segmentLengths(spec);
    const bodyR = spec.elbowBallD * 0.6;
    return buildLimb(spec, spec.elbowBallD, spec.wristBallD, lens.forearm, bodyR);
  }

  function thighPart(o0: unknown = {}) {
    const o = pickOpts(o0, 'thighPart');
    const spec = resolveSpec(o.spec as Partial<Dummy13Spec> | undefined);
    const lens = segmentLengths(spec);
    const bodyR = spec.hipBallD * 0.55;
    return buildLimb(spec, spec.hipBallD, spec.kneeBallD, lens.thigh, bodyR);
  }

  /** HAND — wrist socket at z=0 (mouth +Z), a flat paddle below it acting as
   *  the hand. The cup is upright so the wrist ball can insert from above. */
  function handPart(o0: unknown = {}) {
    const o = pickOpts(o0, 'handPart');
    const spec = resolveSpec(o.spec as Partial<Dummy13Spec> | undefined);
    const lens = segmentLengths(spec);
    const cup = socketCup(spec.wristBallD, spec);
    const cupG = cupGeometry(spec.wristBallD, spec);

    const handLen = lens.hand;
    const handW = lens.hand * 0.6;
    const handT = Math.max(2.5, lens.hand * 0.3);
    // Hand body sits ABOVE the cup (rising +Z from the cup top) so the part
    // can be read at a glance; in assembly the cup is flipped/rotated to face
    // the forearm wrist ball.
    const palmZ0 = cupG.totalH - 0.5;
    const palm = Manifold.cube([handW, handT, handLen], false).translate([-handW / 2, -handT / 2, palmZ0]);
    return cup.add(palm);
  }

  /** SHIN with integrated FOOT — foot footprint at z=0, calf rising upward,
   *  knee socket cup at the top (mouth facing +Z so the knee ball drops in). */
  function shinPart(o0: unknown = {}) {
    const o = pickOpts(o0, 'shinPart');
    const spec = resolveSpec(o.spec as Partial<Dummy13Spec> | undefined);
    const lens = segmentLengths(spec);
    const cupG = cupGeometry(spec.kneeBallD, spec);
    const calfR = spec.kneeBallD * 0.55;

    // Layout: foot z=0..footT; calf z=footT..(footT+calfLen); cup z=calfTop-0.5..calfTop-0.5+cupH.
    const footT = Math.max(2.5, lens.shin * 0.06);
    const footL = lens.shin * 0.42;
    const footW = calfR * 2.4;
    const foot = Manifold.cube([footW, footL, footT], false).translate([-footW / 2, -footL * 0.7, 0]);

    const calfLen = lens.shin - footT - cupG.totalH * 0.5; // leave room at the top for the cup
    const calfZ0 = footT;
    const calfZ1 = calfZ0 + calfLen;
    const calf = capsule(calfLen, calfR, spec.segments).translate([0, 0, (calfZ0 + calfZ1) / 2]);

    // Cup at the top — mouth facing +Z.
    const cup = socketCup(spec.kneeBallD, spec).translate([0, 0, calfZ1 - 0.5]);

    return foot.add(calf).add(cup);
  }

  // ---- Full assembled skeleton, for a single visual check ----

  function fullSkeleton(o0: unknown = {}) {
    const o = pickOpts(o0, 'fullSkeleton');
    const spec = resolveSpec(o.spec as Partial<Dummy13Spec> | undefined);
    const lens = segmentLengths(spec);

    // Stand the figure with feet on z=0.
    // shin + thigh + hips + torso + head along Z, with arms hanging from the
    // shoulders. We re-orient each part so it points the right way.
    const halfHip = lens.hipWidth / 2;
    const halfShoulder = lens.shoulderWidth / 2;

    // Right leg: shin built foot-down, knee-cup-up — perfect as-is. Translate to +X.
    const shinR = shinPart({ spec }).translate([halfHip, 0, 0]);
    const shinL = shinPart({ spec }).translate([-halfHip, 0, 0]);

    // Thigh: built cup-down/ball-up. Flip to ball-down (knee ball plugs into
    // shin knee cup) by rotating 180° about Y. After the flip, cup faces -Z;
    // we want hip-cup facing +Z (to receive the hips hip-ball from above).
    // So flip 180° about Y: ball now points -Z, cup points +Z. ✓
    // The flip moves the part above/below z=0 — translate up so the bottom ball
    // tip lands at z = lens.shin (the top of the shin's knee cup, give or take
    // the cup's 'lipH' depth that the ball must reach into).
    // Build the limb, get its bbox, then translate so bottom ball is at the knee-cup mouth.
    const thighRaw = thighPart({ spec });
    // bbox computation through Manifold isn't free here — use known layout:
    // limb cup at z=0..cupG.totalH, body cupG.totalH-0.5..cupG.totalH-0.5+bodyLen,
    // top ball ends at cupG.totalH-0.5+bodyLen + ballEndHeight(elbow).
    const thighCupG = cupGeometry(spec.hipBallD, spec);
    const thighTopBallTip =
      thighCupG.totalH - 0.5 + lens.thigh + ballEndHeight(spec.kneeBallD);
    // After 180° rotation about Y, original z = z' inverted (rotation about Y axis).
    // Actually rotate([0,180,0]) flips x and z signs. So original (x,y,z) -> (-x, y, -z).
    // The part now spans z = -thighTopBallTip..0. To stand it with the bottom ball
    // tip at z = lens.shin - smallOverlap, translate up by lens.shin - 1 + thighTopBallTip.
    const knee_z = lens.shin - 1; // sink ball 1mm into the cup
    const thighR = thighRaw
      .rotate([0, 180, 0])
      .translate([halfHip, 0, knee_z + thighTopBallTip]);
    const thighL = thighPart({ spec })
      .rotate([0, 180, 0])
      .translate([-halfHip, 0, knee_z + thighTopBallTip]);

    // Hips: waist-ball points +Z; hip-balls point ±X. Sits on top of thighs.
    // The thigh cups (now facing +Z after the flip) sit at the top of the
    // re-oriented thigh — translate the hips so its hip-balls plug into the thigh cups.
    // After the 180° Y flip, the thigh's "cup mouth" (originally at z=0) is now at z=0
    // of the rotated-and-translated piece — i.e. at world z = knee_z + thighTopBallTip.
    // Hip-ball points ±X at the hip joint location (hipsW wide). Place hips so
    // its hip-ball is at the same Z as the thigh cup mouth.
    const hipsBaseZ = knee_z + thighTopBallTip - 0.5; // sit pelvis above thigh cups
    const hips = hipsPart({ spec }).translate([0, 0, hipsBaseZ]);

    // Torso: waist socket on bottom faces -Z. Sit it on the hips waist-ball.
    // Torso's z=0 is the bottom of its waist socket housing — translate so that
    // sits on top of the pelvis.
    const torsoZ0 = hipsBaseZ + lens.hips - 1; // sink torso into pelvis 1mm
    const torso = torsoUpperPart({ spec }).translate([0, 0, torsoZ0]);

    // Where the torso top is (approx) — needed for head + arm placement.
    const waistCupG = cupGeometry(spec.hipBallD, spec);
    const torsoTop = torsoZ0 + waistCupG.totalH - 0.6 + lens.torsoUpper;

    // Head: built cup-down. Sit it on the neck ball (the torso's neck ball
    // protrudes upward from torsoTop with a stemL≈lens.neck).
    const head = headPart({ spec }).translate([0, 0, torsoTop + lens.neck - 1]);

    // Arms: each upper-arm has cup-down (after rotation), ball pointing into
    // the body. Torso shoulder balls face ±X. To plug an upper-arm cup onto a
    // ±X-facing shoulder ball, rotate the upper-arm so its cup mouth faces -X
    // (right arm) / +X (left arm). The arm body then hangs downward (-Z).
    // Building axis is +Z (cup at 0, body up, ball at top). After rotating
    // 90° about +Y, the original +Z axis becomes +X. We then want the cup at
    // the shoulder (so the cup-base side, originally at z=0, lands at the
    // shoulder x position). Continue: build the arm in its own frame, then
    // translate so the cup centre is at (shoulderX, 0, shoulderZ).
    const shoulderZ = torsoTop - spec.shoulderBallD * 1.1;

    // Right arm chain: upper arm cup at shoulder, elbow ball pointing outward
    // (+X) at distance lens.upperArm.
    // We rotate the upper-arm so cup-mouth faces -X (i.e. inward toward body).
    // rotate([0, -90, 0]): +Z -> +X. So cup at orig z=0 is at x=0; body extends +X.
    // For RIGHT arm we want body extending +X, cup mouth facing -X — that's what we get.
    const upperArmR = upperArmPart({ spec })
      .rotate([0, -90, 0])
      .translate([halfShoulder - 0.6, 0, shoulderZ]);
    const upperArmL = upperArmPart({ spec })
      .rotate([0, 90, 0])
      .translate([-(halfShoulder - 0.6), 0, shoulderZ]);

    const elbowR_x = halfShoulder - 0.6 + lens.upperArm;
    const elbowL_x = -(halfShoulder - 0.6) - lens.upperArm;
    const forearmR = forearmPart({ spec }).rotate([0, -90, 0]).translate([elbowR_x, 0, shoulderZ]);
    const forearmL = forearmPart({ spec }).rotate([0, 90, 0]).translate([elbowL_x, 0, shoulderZ]);

    const wristR_x = elbowR_x + lens.forearm;
    const wristL_x = elbowL_x - lens.forearm;
    const handR = handPart({ spec }).rotate([0, -90, 0]).translate([wristR_x, 0, shoulderZ]);
    const handL = handPart({ spec }).rotate([0, 90, 0]).translate([wristL_x, 0, shoulderZ]);

    return shinR
      .add(shinL)
      .add(thighR)
      .add(thighL)
      .add(hips)
      .add(torso)
      .add(upperArmR)
      .add(upperArmL)
      .add(forearmR)
      .add(forearmL)
      .add(handR)
      .add(handL)
      .add(head);
  }

  return {
    DEFAULTS: DUMMY13_DEFAULTS,
    PROPORTIONS: DUMMY13_PROPORTIONS,
    resolveSpec,
    segmentLengths,
    headPart,
    torsoUpperPart,
    hipsPart,
    upperArmPart,
    forearmPart,
    handPart,
    thighPart,
    shinPart,
    fullSkeleton,
  };
}

/** Pure helpers exposed for unit testing without the WASM module. */
export const __testables__ = {
  resolveSpec,
  segmentLengths,
  cupGeometry,
  ballEndHeight,
};
