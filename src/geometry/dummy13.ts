/**
 * Dummy 13 — a parametric reimplementation of soozafone's Dummy 13 articulated
 * figure (https://www.printables.com/model/981111, CC-BY 4.0). Reverse-
 * engineered from the official STLs of the v1.0 frame parts to match its
 * geometric spec — the parametric output is interoperable with soozafone's
 * official parts (you can mix-and-match a parametric Partwright thigh with an
 * official chest, etc.) but the silhouettes here are simple primitives, not
 * copies of soozafone's specific armor/aesthetic shapes.
 *
 * THE UNIVERSAL JOINT SPEC. Every socket cavity in Dummy 13 is exactly 6.0 mm
 * diameter — that's the design genius. By standardising the joint, soozafone
 * makes "bridge" pieces interchangeable: the same `hip_and_shoulder` part fits
 * 4 positions (both hips and both shoulders); the same `knee_and_elbow` part
 * fits 4 more. Every body part is socket-only; the balls live exclusively on
 * small interchangeable bridge pieces.
 *
 *   Frame parts (per soozafone's official v1.0 file list):
 *     BODY (sockets only):
 *       1 head            (1 socket: neck)
 *       1 chest           (3 sockets: 2 clavicle/shoulder + 1 abdomen)
 *       1 abdomen         (2 sockets: chest + waist)
 *       1 waist           (2 sockets: abdomen + hips)
 *       1 hips            (3 sockets: 2 hip + 1 waist)
 *     BRIDGE PIECES (balls on both ends — universal connectors):
 *       1 neck            (head <-> chest)
 *       4 hip/shoulder    (universal — both hips AND both shoulders)
 *       4 knee/elbow      (universal — both knees AND both elbows)
 *       2 clavicle        (chest shoulder socket <-> shoulder bridge)
 *       2 ankle           (shin <-> foot)
 *     LIMB SEGMENTS (sockets at both ends):
 *       2 upper arm
 *       2 forearm
 *       2 thigh
 *       2 shin
 *     EXTREMITIES:
 *       2 hand            (1 socket each — wrist)
 *       2 foot            (1 socket each — ankle)
 *
 *   Total: 28 printable parts at 100 % scale (~170 mm figure height).
 *
 * The "13" in Dummy 13 is the model name (from Lucky 13 Toys), not a part count
 * or inch height. At 100 % scale the figure is ~13 cm tall; the popular 11"
 * (~280 mm) print is the figure at ~215 % scale.
 *
 * Attribution required (CC-BY 4.0):
 *   "Dummy 13" © soozafone (Lucky 13 Toys) — printables.com/model/981111
 *
 * Sibling of `src/geometry/joints.ts` — built on top of `joints.ballSocket`,
 * which encodes the friction-finger socket rim. Z-up, figure front = -Y.
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
// Standard spec — measured from soozafone's official v1.0 STLs
// ---------------------------------------------------------------------------

/** Dimensions extracted from the v1.0 frame STLs. All distances in millimeters.
 *  Don't hand-edit these — they come from direct measurement of the official
 *  geometry. */
export const DUMMY13_SPEC = Object.freeze({
  /** EVERY socket cavity in the figure is this diameter. Measured from
   *  frame_hips, frame_chest, frame_abdomen, frame_waist, frame_neck,
   *  frame_clavicle, frame_forearm, frame_shin — all sockets fit exactly. */
  socketCavityD: 6.0,
  /** Ball diameter. soozafone's stock balls measure ~5.0 mm (giving a loose
   *  0.5 mm radial clearance — the well-documented "loose Dummy 13 joints"
   *  complaint). Default ships at 5.7 mm for a tighter pose-holding grip;
   *  override to 5.0 if you want stock-spec parts to swap into. */
  ballD: 5.7,
  /** Wall thickness around each socket cavity. Measured: hips socket housing
   *  OD ≈ 12 mm with cavity ID 6 mm → wall = 3 mm. */
  socketWall: 3.0,
  /** Opening diameter of the socket mouth (smaller than cavity → ball is
   *  captive once snapped in). 0.7 · cavity = 4.2 mm. Friction fingers on the
   *  rim flex during insertion. */
  socketOpeningRatio: 0.7,
  /** Friction-finger relief slot count per socket rim. */
  socketSlots: 4,
  /** Body part Z thickness (everything in the frame is a flat-ish bar). The
   *  hips, waist, abdomen, chest, neck, clavicle all measure 5.5 mm thick. */
  bodyT: 5.5,
  /** Stem / bridge bar diameter. Bridge pieces (knee_and_elbow, hip_and_
   *  shoulder, ankle, clavicle, neck) are stems between two balls, ~2-3 mm
   *  thick. Default at the ball-end stem diameter. */
  stemD: 2.6,
  /** Length of the stem between the two ball centres on a bridge piece. The
   *  hip/shoulder bridge measured 9.9 mm long with balls at the extremes;
   *  the knee/elbow at ~9 mm. */
  bridgeStem: 7.0,
  /** Hip width — distance between left and right hip sockets in the hips piece.
   *  Measured 16 mm (sockets at x = ±8). */
  hipWidth: 16,
  /** Shoulder width — chest shoulder socket spacing. Measured 12 mm (x = ±6). */
  shoulderWidth: 12,
  /** Body segment lengths along Z (measured between socket centres / face). */
  headH: 11,        // head bbox Y
  neckLen: 10,      // neck bridge socket-to-socket
  chestH: 24,       // chest bbox Y
  abdomenH: 18,     // abdomen bbox Y
  waistH: 16,       // waist bbox Y
  hipsH: 6,         // hips bbox Y (thin bar)
  thighLen: 24,     // thigh bbox Y between socket centres
  shinLen: 33,      // shin bbox Y between socket centres
  upperArmLen: 16,  // upper arm bbox Y between socket centres
  forearmLen: 20,   // forearm bbox Y between socket centres
  handLen: 13,      // hand body length (palm)
  footLen: 17,      // foot footprint length (forward of ankle)
  footWidth: 10,    // foot footprint width
  /** Sphere/cylinder facet count. */
  segments: 48,
});

export type Dummy13Spec = typeof DUMMY13_SPEC;

/** Resolve a partial user spec against DUMMY13_SPEC into a fully-populated
 *  spec. Pure — no engine deps, unit-testable. */
export function resolveSpec(input: Partial<Dummy13Spec> = {}): Dummy13Spec {
  return Object.freeze({ ...DUMMY13_SPEC, ...input });
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

  /** Build the "socket half" of `joints.ballSocket` sized to fit a Dummy 13 ball.
   *  Returns the socket cup with its base on z = 0 and mouth facing +Z. */
  function socketCup(spec: Dummy13Spec) {
    return joints.ballSocket({
      ballD: spec.socketCavityD, // cavity exactly = official 6.0 mm
      clearance: 0,              // cavity diameter is the literal opening — the
                                 // ball is undersized via spec.ballD instead
      openingRatio: spec.socketOpeningRatio,
      retention: 'friction',
      slots: spec.socketSlots,
      segments: spec.segments,
      stemL: 1, // unused (we only take .socket)
      stemD: 2,
      baseT: 0.8,
      baseD: spec.socketCavityD + 2 * spec.socketWall,
    }).socket;
  }

  /** Build a ball-on-stem positioned standing in +Z (disc base on z=0, ball
   *  pointing up). Returns just the ball/stem (no full ballSocket pair). */
  function ballOnStem(spec: Dummy13Spec, stemLen = 1.5) {
    return joints.ballSocket({
      ballD: spec.ballD,
      clearance: 0,
      openingRatio: spec.socketOpeningRatio,
      retention: 'friction',
      slots: spec.socketSlots,
      segments: spec.segments,
      stemL: stemLen,
      stemD: spec.stemD,
      baseT: 0.8,
      baseD: spec.stemD * 1.4,
    }).ball;
  }

  /** Approximate cup total height: floor (1.2) + cavity radius + lipH. */
  function cupHeight(spec: Dummy13Spec): number {
    const cavityR = spec.socketCavityD / 2;
    const openingR = (spec.socketOpeningRatio * spec.socketCavityD) / 2;
    const lipH = Math.sqrt(cavityR * cavityR - openingR * openingR);
    return Math.max(1.2, spec.socketWall) + cavityR + lipH;
  }

  /** Approximate ball-on-stem total height. */
  function ballOnStemHeight(spec: Dummy13Spec, stemLen: number): number {
    return 0.8 + stemLen + spec.ballD;
  }

  /** A horizontal socket: cup base sits on the part body, mouth points OUT
   *  along +X (so a mating ball can be inserted from +X). Builds the cup
   *  pointing +Z then rotates 90° about Y. */
  function horizontalSocket(spec: Dummy13Spec, mouthDir: 'plusX' | 'minusX' | 'plusY' | 'minusY' | 'plusZ' | 'minusZ') {
    const cup = socketCup(spec);
    switch (mouthDir) {
      case 'plusZ': return cup;
      case 'minusZ': return cup.rotate([180, 0, 0]);
      case 'plusX': return cup.rotate([0, 90, 0]);
      case 'minusX': return cup.rotate([0, -90, 0]);
      case 'plusY': return cup.rotate([-90, 0, 0]);
      case 'minusY': return cup.rotate([90, 0, 0]);
    }
  }

  // -------------------------------------------------------------------------
  // BODY PARTS — flat bars with sockets only (no balls)
  // -------------------------------------------------------------------------

  /** HEAD — a rounded box with a downward-facing socket cup at its base.
   *  Z = 0 is the bottom of the socket housing.
   *  opts: { spec?, style? }  style: 'box' | 'sphere' */
  function headPart(o0: unknown = {}) {
    const o = pickOpts(o0, 'headPart');
    const spec = resolveSpec(o.spec as Partial<Dummy13Spec> | undefined);
    const style = (o.style ?? 'box') as 'box' | 'sphere';

    const cupH = cupHeight(spec);
    const cup = socketCup(spec).rotate([180, 0, 0]).translate([0, 0, cupH]);

    const h = spec.headH;
    const w = h * 0.9;
    const d = h * 0.75;
    const headZ0 = cupH - 0.6;
    const head = style === 'sphere'
      ? Manifold.sphere(h / 2, spec.segments).scale([w / h, d / h, 1]).translate([0, 0, headZ0 + h / 2])
      : Manifold.cube([w, d, h], false).translate([-w / 2, -d / 2, headZ0]);
    return cup.add(head);
  }

  /** CHEST — flat bar with 2 sockets on top (clavicles → shoulders, at ±X)
   *  and 1 socket on the bottom face (abdomen). Z = 0 is the bottom of the
   *  abdomen socket cup. */
  function chestPart(o0: unknown = {}) {
    const o = pickOpts(o0, 'chestPart');
    const spec = resolveSpec(o.spec as Partial<Dummy13Spec> | undefined);
    const cupH = cupHeight(spec);
    // The bottom socket spans z = 0..0.5 (mouth) + ...; the body bar starts at z = cupH-0.5 + bar bottom.
    // Layout: bottom cup pointing -Z (housing base at z=cupH, mouth at z=0).
    const bottomCup = socketCup(spec).rotate([180, 0, 0]).translate([0, 0, cupH]);
    const barZ0 = cupH - 0.5;
    const bar = Manifold.cube([spec.shoulderWidth + 2 * spec.socketWall, spec.bodyT, spec.chestH], false)
      .translate([-(spec.shoulderWidth + 2 * spec.socketWall) / 2, -spec.bodyT / 2, barZ0]);
    // Top sockets at ±shoulderWidth/2
    const topL = socketCup(spec).translate([-spec.shoulderWidth / 2, 0, barZ0 + spec.chestH - 0.5]);
    const topR = socketCup(spec).translate([spec.shoulderWidth / 2, 0, barZ0 + spec.chestH - 0.5]);
    return bottomCup.add(bar).add(topL).add(topR);
  }

  /** Build a body segment that's just a flat bar with one socket cup on each
   *  end (top + bottom). Used for ABDOMEN and WAIST. Z = 0 is the bottom of
   *  the bottom socket. */
  function inlineSegment(spec: Dummy13Spec, height: number) {
    const cupH = cupHeight(spec);
    const bottomCup = socketCup(spec).rotate([180, 0, 0]).translate([0, 0, cupH]);
    const barZ0 = cupH - 0.5;
    const barW = spec.socketCavityD + 2 * spec.socketWall;
    const bar = Manifold.cube([barW, spec.bodyT, height], false)
      .translate([-barW / 2, -spec.bodyT / 2, barZ0]);
    const topCup = socketCup(spec).translate([0, 0, barZ0 + height - 0.5]);
    return bottomCup.add(bar).add(topCup);
  }

  function abdomenPart(o0: unknown = {}) {
    const o = pickOpts(o0, 'abdomenPart');
    const spec = resolveSpec(o.spec as Partial<Dummy13Spec> | undefined);
    return inlineSegment(spec, spec.abdomenH);
  }

  function waistPart(o0: unknown = {}) {
    const o = pickOpts(o0, 'waistPart');
    const spec = resolveSpec(o.spec as Partial<Dummy13Spec> | undefined);
    return inlineSegment(spec, spec.waistH);
  }

  /** HIPS — flat horizontal bar with 3 sockets in the top face: hip(-X), waist,
   *  hip(+X). Z = 0 is the bottom of the bar. */
  function hipsPart(o0: unknown = {}) {
    const o = pickOpts(o0, 'hipsPart');
    const spec = resolveSpec(o.spec as Partial<Dummy13Spec> | undefined);
    const barW = spec.hipWidth + 2 * spec.socketWall * 2;
    const bar = Manifold.cube([barW, spec.bodyT, spec.hipsH], false)
      .translate([-barW / 2, -spec.bodyT / 2, 0]);
    const cupZ = spec.hipsH - 0.5;
    const cups = [
      socketCup(spec).translate([-spec.hipWidth / 2, 0, cupZ]),
      socketCup(spec).translate([0, 0, cupZ]),
      socketCup(spec).translate([spec.hipWidth / 2, 0, cupZ]),
    ];
    return cups.reduce((acc, c) => acc.add(c), bar);
  }

  // -------------------------------------------------------------------------
  // BRIDGE PIECES — balls on both ends
  // -------------------------------------------------------------------------

  /** Build a bridge piece: a stem with a ball on each end. The stem runs along
   *  the Z axis, centered on origin. The lower ball is at z = -bridgeStem/2 -
   *  ballR, the upper at +bridgeStem/2 + ballR. */
  function doubleBallBridge(spec: Dummy13Spec, stemLen: number = spec.bridgeStem) {
    const ballR = spec.ballD / 2;
    const stem = Manifold.cylinder(stemLen, spec.stemD / 2, spec.stemD / 2, spec.segments)
      .translate([0, 0, -stemLen / 2]);
    const topBall = Manifold.sphere(ballR, spec.segments).translate([0, 0, stemLen / 2 + ballR * 0.85]);
    const botBall = Manifold.sphere(ballR, spec.segments).translate([0, 0, -stemLen / 2 - ballR * 0.85]);
    return stem.add(topBall).add(botBall);
  }

  /** Universal HIP/SHOULDER bridge piece. Same part is used in 4 positions
   *  (both hips, both shoulders). Returned standing vertical along Z. */
  function hipShoulderBridge(o0: unknown = {}) {
    const o = pickOpts(o0, 'hipShoulderBridge');
    const spec = resolveSpec(o.spec as Partial<Dummy13Spec> | undefined);
    return doubleBallBridge(spec);
  }

  /** Universal KNEE/ELBOW bridge piece. Same part used 4× (both knees + both
   *  elbows). Shorter stem than hip/shoulder. */
  function kneeElbowBridge(o0: unknown = {}) {
    const o = pickOpts(o0, 'kneeElbowBridge');
    const spec = resolveSpec(o.spec as Partial<Dummy13Spec> | undefined);
    return doubleBallBridge(spec, Math.max(4, spec.bridgeStem * 0.7));
  }

  /** NECK bridge — connects head to chest. Slightly longer stem so the head
   *  clears the chest top. */
  function neckBridge(o0: unknown = {}) {
    const o = pickOpts(o0, 'neckBridge');
    const spec = resolveSpec(o.spec as Partial<Dummy13Spec> | undefined);
    return doubleBallBridge(spec, spec.neckLen);
  }

  /** ANKLE bridge — connects shin to foot. */
  function ankleBridge(o0: unknown = {}) {
    const o = pickOpts(o0, 'ankleBridge');
    const spec = resolveSpec(o.spec as Partial<Dummy13Spec> | undefined);
    return doubleBallBridge(spec, Math.max(4, spec.bridgeStem * 0.7));
  }

  /** CLAVICLE bridge — connects chest's shoulder socket out to the shoulder
   *  joint position. Slightly longer than other bridges to project the shoulder
   *  out from the chest. */
  function claviclePart(o0: unknown = {}) {
    const o = pickOpts(o0, 'claviclePart');
    const spec = resolveSpec(o.spec as Partial<Dummy13Spec> | undefined);
    return doubleBallBridge(spec, spec.bridgeStem * 1.1);
  }

  // -------------------------------------------------------------------------
  // LIMB SEGMENTS — capsule body with sockets at each end
  // -------------------------------------------------------------------------

  /** Build a limb segment: capsule along Z with a socket cup at each end.
   *  Cups face outward (+Z at top, -Z at bottom). The segment_length is the
   *  distance between the two socket-cavity centres along Z. */
  function limbSegment(spec: Dummy13Spec, segmentLength: number, bodyR: number) {
    const cupH = cupHeight(spec);
    // Cavity centres at z = floor + cavityR (above the bar bottom). For a
    // segment with the cups at TOP and BOTTOM (mouths facing out), we have:
    //   top cup mouth at z = topZ, cavity centre at topZ - lipH
    //   bottom cup mouth at z = botZ (negative), cavity centre at botZ + lipH
    // We want the two cavity centres distance = segmentLength.
    // Simpler: just stack cup_bottom + body + cup_top, where body fills the gap.
    const bodyLen = segmentLength - 2 * (cupHeight(spec) - 1);
    // Bottom cup: mouth points -Z, base on z = cupH (top of cup is base).
    const bottomCup = socketCup(spec).rotate([180, 0, 0]).translate([0, 0, cupH]);
    // Body capsule
    const body = (() => {
      const cyl = Manifold.cylinder(bodyLen, bodyR, bodyR, spec.segments).translate([0, 0, cupH - 0.5]);
      return cyl;
    })();
    // Top cup: mouth +Z, base at z = cupH + bodyLen - 0.5 (sunk into capsule top)
    const topCup = socketCup(spec).translate([0, 0, cupH + bodyLen - 0.5 - 0.5]);
    return bottomCup.add(body).add(topCup);
  }

  function upperArmPart(o0: unknown = {}) {
    const o = pickOpts(o0, 'upperArmPart');
    const spec = resolveSpec(o.spec as Partial<Dummy13Spec> | undefined);
    return limbSegment(spec, spec.upperArmLen, 3);
  }

  function forearmPart(o0: unknown = {}) {
    const o = pickOpts(o0, 'forearmPart');
    const spec = resolveSpec(o.spec as Partial<Dummy13Spec> | undefined);
    return limbSegment(spec, spec.forearmLen, 2.8);
  }

  function thighPart(o0: unknown = {}) {
    const o = pickOpts(o0, 'thighPart');
    const spec = resolveSpec(o.spec as Partial<Dummy13Spec> | undefined);
    return limbSegment(spec, spec.thighLen, 3.5);
  }

  function shinPart(o0: unknown = {}) {
    const o = pickOpts(o0, 'shinPart');
    const spec = resolveSpec(o.spec as Partial<Dummy13Spec> | undefined);
    return limbSegment(spec, spec.shinLen, 3);
  }

  // -------------------------------------------------------------------------
  // EXTREMITIES — hand + foot (1 socket each)
  // -------------------------------------------------------------------------

  /** HAND — flat paddle with a wrist socket on top (mouth +Z). The hand body
   *  is a simple slab below the socket; users can build fancier hand variants
   *  (open/grip/fist) on top of the same socket spec. */
  function handPart(o0: unknown = {}) {
    const o = pickOpts(o0, 'handPart');
    const spec = resolveSpec(o.spec as Partial<Dummy13Spec> | undefined);
    const cupH = cupHeight(spec);
    const cup = socketCup(spec).rotate([180, 0, 0]).translate([0, 0, cupH]);
    const palmW = spec.socketCavityD * 1.6;
    const palmT = 4;
    const palmL = spec.handLen;
    // Palm hangs DOWN from the cup base (negative Y, since the wrist socket
    // is the "top" of the hand when worn).
    const palm = Manifold.cube([palmW, palmL, palmT], false)
      .translate([-palmW / 2, -palmL, 0]);
    // Round the fingertip end by chamfering the corner closest to -Y, -X / +X.
    return cup.add(palm);
  }

  /** FOOT — flat foot pad with an ankle socket on top. The foot extends -Y
   *  (forward of the figure) to give standing stability. */
  function footPart(o0: unknown = {}) {
    const o = pickOpts(o0, 'footPart');
    const spec = resolveSpec(o.spec as Partial<Dummy13Spec> | undefined);
    const cupH = cupHeight(spec);
    const cup = socketCup(spec).rotate([180, 0, 0]).translate([0, 0, cupH]);
    const footT = 4;
    const footL = spec.footLen;
    const footW = spec.footWidth;
    const foot = Manifold.cube([footW, footL, footT], false)
      .translate([-footW / 2, -footL * 0.7, 0]);
    return cup.add(foot);
  }

  // -------------------------------------------------------------------------
  // FULL ASSEMBLED SKELETON — viz only
  // -------------------------------------------------------------------------

  function fullSkeleton(o0: unknown = {}) {
    const o = pickOpts(o0, 'fullSkeleton');
    const spec = resolveSpec(o.spec as Partial<Dummy13Spec> | undefined);
    const cupH = cupHeight(spec);

    // Build the body axis bottom-up:
    //   foot (z=0..footT~4) -> ankle bridge -> shin -> knee bridge -> thigh -> hip bridge -> hips -> waist -> abdomen -> chest -> neck bridge -> head
    let z = 0;
    const parts = [];
    const footT = 4;
    parts.push(footPart({ spec }).translate([spec.hipWidth / 2, 0, z]));
    parts.push(footPart({ spec }).translate([-spec.hipWidth / 2, 0, z]));
    z += footT + cupH * 0.5; // foot socket plus ankle bridge approximate
    // Stack the legs symmetrically — each leg has shin + knee bridge + thigh
    const legZ0 = z;
    const shinZ0 = legZ0;
    const shinTop = shinZ0 + spec.shinLen;
    parts.push(limbSegment(spec, spec.shinLen, 3).translate([spec.hipWidth / 2, 0, shinZ0]));
    parts.push(limbSegment(spec, spec.shinLen, 3).translate([-spec.hipWidth / 2, 0, shinZ0]));
    const thighZ0 = shinTop + cupH * 0.3;
    const thighTop = thighZ0 + spec.thighLen;
    parts.push(limbSegment(spec, spec.thighLen, 3.5).translate([spec.hipWidth / 2, 0, thighZ0]));
    parts.push(limbSegment(spec, spec.thighLen, 3.5).translate([-spec.hipWidth / 2, 0, thighZ0]));

    const hipsZ0 = thighTop + cupH * 0.3;
    parts.push(hipsPart({ spec }).translate([0, 0, hipsZ0]));
    const waistZ0 = hipsZ0 + spec.hipsH + cupH * 0.6;
    parts.push(waistPart({ spec }).translate([0, 0, waistZ0]));
    const abdomenZ0 = waistZ0 + spec.waistH + cupH * 1.2;
    parts.push(abdomenPart({ spec }).translate([0, 0, abdomenZ0]));
    const chestZ0 = abdomenZ0 + spec.abdomenH + cupH * 1.2;
    parts.push(chestPart({ spec }).translate([0, 0, chestZ0]));

    // Arms: from each shoulder (top of chest, at ±shoulderWidth/2), out and down
    const shoulderZ = chestZ0 + cupH + spec.chestH - cupH * 0.5;
    for (const sign of [+1, -1]) {
      const shoulderX = sign * spec.shoulderWidth / 2;
      // Upper arm hangs vertically from shoulder down by upperArmLen
      const armZ0 = shoulderZ - cupH - spec.upperArmLen;
      parts.push(limbSegment(spec, spec.upperArmLen, 3).translate([shoulderX, 0, armZ0]));
      // Forearm below
      const forearmZ0 = armZ0 - spec.forearmLen - cupH * 0.5;
      parts.push(limbSegment(spec, spec.forearmLen, 2.8).translate([shoulderX, 0, forearmZ0]));
      // Hand below
      parts.push(handPart({ spec }).translate([shoulderX, 0, forearmZ0 - cupH * 0.5]));
    }

    // Head on top of chest via neck bridge
    const headZ0 = chestZ0 + spec.chestH + spec.neckLen;
    parts.push(headPart({ spec }).translate([0, 0, headZ0]));

    return parts.reduce((acc, p) => acc.add(p));
  }

  // -------------------------------------------------------------------------
  // Print-plate helpers — lay N instances of a part side-by-side along Y
  // for a single catalog tile representing "print N of these."
  // -------------------------------------------------------------------------
  function plateOf(part: any, count: number, gap: number) {
    if (count === 1) return part;
    let out = part;
    for (let i = 1; i < count; i++) {
      out = out.add(part.translate([0, gap * i, 0]));
    }
    // Recentre on Y
    return out.translate([0, -gap * (count - 1) / 2, 0]);
  }

  return {
    SPEC: DUMMY13_SPEC,
    resolveSpec,
    cupHeight,
    ballOnStemHeight,
    headPart,
    chestPart,
    abdomenPart,
    waistPart,
    hipsPart,
    neckBridge,
    hipShoulderBridge,
    kneeElbowBridge,
    ankleBridge,
    claviclePart,
    upperArmPart,
    forearmPart,
    thighPart,
    shinPart,
    handPart,
    footPart,
    fullSkeleton,
    plateOf,
    socketCup,
    ballOnStem,
    horizontalSocket,
  };
}

/** Pure helpers exposed for unit testing without the WASM module. */
export const __testables__ = {
  resolveSpec,
};
