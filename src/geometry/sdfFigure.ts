// Stylized figurine API — `api.sdf.figure`.
//
// A pure composition layer on top of the public SDF namespace (sphere,
// ellipsoid, capsule, smoothUnion, …). It exists to kill the three reliable
// failure modes when an LLM hand-builds an organic figure from raw primitives:
//
//   1. Coordinate guessing — every joint and facial landmark here comes from a
//      deterministic RIG, never a hand-typed `[-4.5, 0, 42]`.
//   2. Floating-part component splits — limbs span jointA→jointB, so parts
//      always overlap; the "componentCount 2" failure is structurally gone.
//   3. Uniform blend k — soft body joins (figure.weld) vs sharp face creases
//      (figure.face.assemble) localize blend by *which* welder runs where.
//
// Aesthetic target: a STYLIZED FIGURINE (art-toy / smooth posable mannequin),
// not photoreal humans. Modest forward-kinematics posing.
//
// Layering: this file imports NOTHING from ./sdf — it receives the namespace
// structurally (`SdfApi`) and defines its own node type (`Node`). `sdf.ts`
// imports `createFigureNamespace` + the public types from here, one-directional,
// keeping the module graph acyclic (madge gate).

import {
  assertNumber,
  assertNumberTuple,
  assertEnum,
  assertObject,
  assertNoUnknownKeys,
  ValidationError,
} from '../validation/apiValidation';

export type Vec3 = [number, number, number];

const DEG = Math.PI / 180;

// --- Structural view of the SDF namespace this layer consumes -------------
// SdfNode (the real class) is structurally assignable to `Node`; the real
// SdfNamespace is assignable to `SdfApi`. Declaring them here (rather than
// importing from ./sdf) avoids a dependency cycle.

export interface Node {
  union(o: Node): Node;
  add(o: Node): Node;
  subtract(o: Node): Node;
  intersect(o: Node): Node;
  smoothUnion(o: Node, k: number): Node;
  smoothSubtract(o: Node, k: number): Node;
  smoothIntersect(o: Node, k: number): Node;
  translate(t: Vec3 | number, ty?: number, tz?: number): Node;
  rotate(r: Vec3 | number, ry?: number, rz?: number): Node;
  scale(s: number): Node;
  mirror(axis: 'x' | 'y' | 'z'): Node;
  shell(thickness: number): Node;
  round(r: number): Node;
  taper(rate: number, axis?: 'x' | 'y' | 'z'): Node;
  label(name: string): Node;
  bounds(): { min: Vec3; max: Vec3 };
}

export interface SdfApi {
  sphere(radius: number): Node;
  ellipsoid(rx: number, ry: number, rz: number): Node;
  box(size: Vec3 | number): Node;
  roundedBox(size: Vec3 | number, radius: number): Node;
  cylinder(radius: number, height: number): Node;
  roundedCylinder(radius: number, height: number, edgeRadius: number): Node;
  capsule(a: Vec3, b: Vec3, radius: number): Node;
  union(...nodes: Node[]): Node;
}

// --- Small vector math ----------------------------------------------------

function add3(a: Vec3, b: Vec3): Vec3 { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function sub3(a: Vec3, b: Vec3): Vec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function scale3(a: Vec3, s: number): Vec3 { return [a[0] * s, a[1] * s, a[2] * s]; }
function len3(a: Vec3): number { return Math.hypot(a[0], a[1], a[2]); }
function norm3(a: Vec3): Vec3 { const l = len3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
function cross3(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function mix(a: number, b: number, t: number): number { return a + (b - a) * t; }

function rotX(v: Vec3, deg: number): Vec3 {
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
}
function rotY(v: Vec3, deg: number): Vec3 {
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}
function rotZ(v: Vec3, deg: number): Vec3 {
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
}
/** Rotate vector `v` about unit axis `k` by `deg` (Rodrigues). */
function rotAxis(v: Vec3, k: Vec3, deg: number): Vec3 {
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
  const kv = cross3(k, v);
  const kk = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  return [
    v[0] * c + kv[0] * s + k[0] * kk * (1 - c),
    v[1] * c + kv[1] * s + k[1] * kk * (1 - c),
    v[2] * c + kv[2] * s + k[2] * kk * (1 - c),
  ];
}

// --- Option parsing -------------------------------------------------------

function num(v: unknown, def: number, name: string, min?: number, max?: number): number {
  if (v === undefined) return def;
  return assertNumber(v, name, { min, max }) as number;
}

/** Optional-object accessor: undefined → {}, else a validated plain object. */
function obj(v: unknown, name: string): Record<string, unknown> {
  return (assertObject(v, name, { optional: true }) ?? {}) as Record<string, unknown>;
}

interface JointPose { raiseSide: number; raiseFwd: number; bend?: number; twist: number }
interface HeadPose { yaw: number; pitch: number; roll: number }
interface SpinePose { lean: number; turn: number; side: number }

interface ResolvedPose {
  armL: JointPose; armR: JointPose;
  legL: JointPose; legR: JointPose;
  head: HeadPose; spine: SpinePose;
}

// The figure's pose vocabulary (the single, canonical name set — see the
// "Naming policy" in public/ai/figure.md). Limbs: raiseSide (lift sideways),
// raiseFwd (swing forward/back), bend (elbow/knee flexion), twist (axial roll).
// Head: yaw / pitch / roll. There are no legacy aliases — these are the names.
const ARM_FIELDS = ['raiseSide', 'raiseFwd', 'bend', 'twist'];
const LEG_FIELDS = ['raiseSide', 'raiseFwd', 'bend', 'twist'];
const HEAD_FIELDS = ['yaw', 'pitch', 'roll'];
const SPINE_FIELDS = ['lean', 'turn', 'side'];
const RIG_FIELDS = ['height', 'headsTall', 'build', 'sex', 'pose'];
const POSE_FIELDS = ['arms', 'legs', 'armL', 'armR', 'legL', 'legR', 'head', 'spine'];

function parseArm(v: unknown, name: string, defRaiseSide: number): JointPose {
  const o = obj(v, name);
  assertNoUnknownKeys(o, ARM_FIELDS, name);
  return {
    raiseSide: num(o.raiseSide, defRaiseSide, `${name}.raiseSide`),
    raiseFwd: num(o.raiseFwd, 0, `${name}.raiseFwd`),
    bend: num(o.bend, 0, `${name}.bend`, 0, 160),
    twist: num(o.twist, 0, `${name}.twist`),
  };
}
function parseLeg(v: unknown, name: string): JointPose {
  const o = obj(v, name);
  assertNoUnknownKeys(o, LEG_FIELDS, name);
  return {
    raiseSide: num(o.raiseSide, 6, `${name}.raiseSide`),
    raiseFwd: num(o.raiseFwd, 0, `${name}.raiseFwd`),
    bend: num(o.bend, 0, `${name}.bend`, 0, 150),
    twist: num(o.twist, 0, `${name}.twist`),
  };
}

/** Master proportion + pose object. Every part and landmark derives from it. */
export interface RigOptions {
  height?: number;
  headsTall?: number;
  build?: 'slim' | 'average' | 'stocky';
  /** Silhouette balance along the Loomis canon (default 'neutral'). 'male'
   *  widens the shoulders and narrows the waist/hips; 'female' does the
   *  reverse. Independent of `build` (overall thickness). */
  sex?: 'neutral' | 'male' | 'female';
  pose?: {
    armL?: object; armR?: object; legL?: object; legR?: object;
    head?: object; spine?: object;
  };
}

export interface FaceAnchors {
  eyeL: Vec3; eyeR: Vec3; browL: Vec3; browR: Vec3;
  nose: Vec3; mouth: Vec3; earL: Vec3; earR: Vec3; chinTip: Vec3;
}

/** A hand's grip as a full coordinate frame — the missing piece for connecting
 *  held props (guitar neck, sword, staff, mug) to a hand. Unlike `joints.handL`
 *  (the hand's *centre*), `point` is the grip *cup* where a held cylinder's axis
 *  rests, so a prop seated here sits IN the closed hand instead of passing
 *  THROUGH its centre. The three unit axes orient the prop. */
export interface GripFrame {
  /** World point at the centre of the grip cup — offset from the hand centre
   *  toward the palm. Aim a held prop's contact line here. */
  point: Vec3;
  /** Unit normal the palm faces (the fingers curl toward this). */
  palmNormal: Vec3;
  /** Unit axis a gripped bar/handle lies ALONG (the finger-splay axis, pinky→
   *  index). A guitar neck, staff, or sword grip runs parallel to this. */
  gripAxis: Vec3;
  /** Unit forearm / finger-reach direction (the way the fingers point). */
  reach: Vec3;
}

/** The two-anchor analog of {@link GripFrame}: the geometry of the line spanning
 *  TWO grips (or any two points). Returned by `figure.spanGrips(a, b)` for
 *  building props that run between both hands — a guitar neck, a barbell, a
 *  bow stave, a broom, a rifle. `holdAt` only orients to one hand; this gives
 *  the inter-grip axis the prop should lie along plus the endpoints and length
 *  so a `sdf.capsule(span.a, span.b, r)` is a one-liner. */
export interface SpanFrame {
  /** World point of the first grip (the `a` end). */
  a: Vec3;
  /** World point of the second grip (the `b` end). */
  b: Vec3;
  /** Unit direction from `a` toward `b` — the axis a spanning bar lies along. */
  axis: Vec3;
  /** Distance between `a` and `b` — the length a spanning bar must reach. */
  length: number;
  /** Midpoint of `a` and `b` — centre a symmetric prop here. */
  mid: Vec3;
}

/** The foot analog of {@link GripFrame}: the canonical ground-contact frame of
 *  one foot. Where grip frames stop a held prop passing through the hand, sole
 *  frames stop footwear / skates / platforms / a base from guessing at where the
 *  foot meets the ground. `buildFeet`, `buildFootwear` and `buildBase` all derive
 *  from these, so they can't drift apart (the drift that let footwear clip
 *  through the base). Returned per side as `rig.sole.L` / `rig.sole.R`. */
export interface SoleFrame {
  /** World point at the centre of the footprint, on the ground-contact plane —
   *  drop anything that attaches under the foot here (see `figure.standOn`). */
  point: Vec3;
  /** Unit ground-up normal (`[0,0,1]`). */
  normal: Vec3;
  /** Unit toe direction (== `rig.dir.footL/R`), so attachments track turnout. */
  heading: Vec3;
  /** Footprint length, heel→toe. */
  length: number;
  /** Footprint width, side→side. */
  width: number;
  /** Z of the ground-contact plane (the underside of the bare sole). The lowest
   *  of the two is where a base/floor sits. */
  groundZ: number;
}

export interface Rig {
  joints: Record<string, Vec3>;
  /** Canonical radii / half-extents, in world units. */
  r: Record<string, number>;
  /** Unit directions for orienting parts. */
  dir: Record<string, Vec3>;
  /** Per-hand grip frames for connecting held props — see {@link GripFrame}. */
  grip: { L: GripFrame; R: GripFrame };
  /** Per-foot sole frames for connecting things under the feet — see
   *  {@link SoleFrame}. */
  sole: { L: SoleFrame; R: SoleFrame };
  /** Facial landmark world positions (derived; never hand-typed). */
  face: FaceAnchors;
  opts: { height: number; headsTall: number; build: string; sex: string; pose: ResolvedPose };
}

const BUILD_MUL: Record<string, number> = { slim: 0.82, average: 1, stocky: 1.22 };

function buildRig(rawOpts: unknown): Rig {
  const o = obj(rawOpts, 'rig(opts)');
  assertNoUnknownKeys(o, RIG_FIELDS, 'rig(opts)');

  const H = num(o.height, 60, 'rig.height', 1);
  const N = num(o.headsTall, 6, 'rig.headsTall', 2, 12);
  const build = o.build === undefined ? 'average'
    : assertEnum(o.build, ['slim', 'average', 'stocky'] as const, 'rig.build');
  const bw = BUILD_MUL[build];
  const sex = o.sex === undefined ? 'neutral'
    : assertEnum(o.sex, ['neutral', 'male', 'female'] as const, 'rig.sex');

  const poseRaw = obj(o.pose, 'rig.pose');
  assertNoUnknownKeys(poseRaw, POSE_FIELDS, 'rig.pose');
  const headRaw = obj(poseRaw.head, 'rig.pose.head');
  assertNoUnknownKeys(headRaw, HEAD_FIELDS, 'rig.pose.head');
  const spineRaw = obj(poseRaw.spine, 'rig.pose.spine');
  assertNoUnknownKeys(spineRaw, SPINE_FIELDS, 'rig.pose.spine');

  // `arms` / `legs` are symmetric shorthands: they seed BOTH sides, with the
  // per-side armL/armR (legL/legR) keys overriding. Saves copy-pasting the
  // same pose to both sides (and the asymmetry bugs that invites).
  const armsBase = obj(poseRaw.arms, 'rig.pose.arms');
  assertNoUnknownKeys(armsBase, ARM_FIELDS, 'rig.pose.arms');
  const legsBase = obj(poseRaw.legs, 'rig.pose.legs');
  assertNoUnknownKeys(legsBase, LEG_FIELDS, 'rig.pose.legs');
  const mergeArm = (side: unknown) => ({ ...armsBase, ...obj(side, 'rig.pose.arm*') });
  const mergeLeg = (side: unknown) => ({ ...legsBase, ...obj(side, 'rig.pose.leg*') });

  const pose: ResolvedPose = {
    armL: parseArm(mergeArm(poseRaw.armL), 'rig.pose.armL', 8),
    armR: parseArm(mergeArm(poseRaw.armR), 'rig.pose.armR', 8),
    legL: parseLeg(mergeLeg(poseRaw.legL), 'rig.pose.legL'),
    legR: parseLeg(mergeLeg(poseRaw.legR), 'rig.pose.legR'),
    head: {
      yaw: num(headRaw.yaw, 0, 'rig.pose.head.yaw'),
      pitch: num(headRaw.pitch, 0, 'rig.pose.head.pitch'),
      roll: num(headRaw.roll, 0, 'rig.pose.head.roll'),
    },
    spine: {
      lean: num(spineRaw.lean, 0, 'rig.pose.spine.lean'),
      turn: num(spineRaw.turn, 0, 'rig.pose.spine.turn'),
      side: num(spineRaw.side, 0, 'rig.pose.spine.side'),
    },
  };

  // --- Vertical landmarks (sole = 0, crown = H) --------------------------
  const headH = H / N;                  // bare head height
  const rzHead = headH * 0.5;
  const rxHead = headH * 0.40 * (build === 'stocky' ? 1.05 : 1);
  const ryHead = headH * 0.46;
  const headCenterZ = H - rzHead;
  const chinZ = H - headH;
  const neckLen = headH * 0.34;
  const shoulderZ = chinZ - neckLen;

  // Body below the shoulders. Legs are a fraction of SHOULDER height (not of
  // total height) so a small headsTall enlarges the head (the cute look) and
  // hipZ can never invert above the shoulders.
  const hipZ = shoulderZ * 0.54;        // crotch line
  const kneeZ = hipZ * 0.48;
  const ankleZ = H * 0.045;
  const chestZ = mix(hipZ, shoulderZ, 0.74);
  const navelZ = mix(hipZ, shoulderZ, 0.28);
  const pelvisZ = mix(hipZ, shoulderZ, 0.06);

  // --- Widths / radii — all in HEAD-UNITS (× headH) ----------------------
  // Girth scales with the HEAD, not with total height. The old code sized every
  // width as a fixed fraction of H, so only the head responded to `headsTall`
  // while the body stayed a constant width — a low headsTall got pin-narrow
  // shoulders under a huge head, a high one got broad shoulders under a small
  // head (the artistic "head-unit" canon, e.g. Loomis, measures EVERYTHING in
  // head-counts for exactly this reason). The ratios below are calibrated so the
  // default headsTall:6 silhouette is unchanged, but now every headsTall stays
  // proportionally coherent — chibis get chunky, heroes get lean, automatically.
  //
  // `sex` shifts the shoulder/chest/waist/hip balance along the same canon
  // (male: wider shoulders + narrower waist/hips; female: the reverse). These
  // are the anthropometric shape deltas MakeHuman's CC0 targets encode, written
  // as head-unit ratio multipliers rather than mesh morphs. `build` (overall
  // thickness) multiplies on top, so the two axes compose.
  const SEX_MUL: Record<string, { shoulder: number; chest: number; waist: number; hip: number }> = {
    neutral: { shoulder: 1, chest: 1, waist: 1, hip: 1 },
    male: { shoulder: 1.16, chest: 1.06, waist: 0.92, hip: 0.9 },
    female: { shoulder: 0.9, chest: 0.98, waist: 0.86, hip: 1.14 },
  };
  const sm = SEX_MUL[sex];
  const hu = (ratio: number) => headH * ratio * bw;   // head-unit girth (× build)
  const shoulderHalfX = hu(0.648) * sm.shoulder;
  const hipHalfX = hu(0.432) * sm.hip;
  const r = {
    head: ryHead, headX: rxHead, headZ: rzHead,
    neck: hu(0.204),
    chestX: hu(0.630) * sm.chest, chestY: hu(0.396),
    hipsX: hu(0.516) * sm.hip, hipsY: hu(0.360),
    // The garment-fitting radius at the natural waist (rig.joints.spine) — use
    // this, not hipsX (a leg-insertion radius), to size belts/skirts/tutus.
    waist: hu(0.492) * sm.waist,
    upperArm: hu(0.204), lowerArm: hu(0.168), hand: hu(0.252),
    upperLeg: hu(0.288), lowerLeg: hu(0.216), foot: hu(0.240),
  };

  // --- Arm FK ------------------------------------------------------------
  const upperArmLen = H * 0.165;
  const foreArmLen = H * 0.150;

  function armChain(side: number, p: JointPose) {
    const S: Vec3 = [side * shoulderHalfX, 0, shoulderZ];
    // raiseSide: 0 = hanging down, 90 = straight out to the side, 180 = up.
    let dir: Vec3 = [side * Math.sin(p.raiseSide * DEG), 0, -Math.cos(p.raiseSide * DEG)];
    // raiseFwd: + brings the arm forward (−Y).
    dir = rotX(dir, -p.raiseFwd);
    dir = norm3(dir);
    const E = add3(S, scale3(dir, upperArmLen));
    // Elbow flexion curls the forearm about a hinge ⟂ to the upper-arm axis.
    // The hinge is FRAME-DERIVED — the rest axis [−1,0,0] carried through the
    // bone's own raiseSide/raiseFwd rotations — exactly like the knee. This equals the
    // old `cross(dir, fwd)` form wherever raiseSide OR raiseFwd is ~0 (every neutral,
    // side-raised, hanging, forward, or overhead pose), but stays a clean
    // lateral hinge when BOTH are large. The cross form degenerated there: as
    // raiseFwd → ±90 its magnitude collapsed and its direction swung through the
    // pole, so a forward-reaching bent arm (karate punch, reading pose) curled
    // in a pose-dependent wrong plane — the knee-sign instability, arm edition.
    let hinge = norm3(rotX(rotY([-1, 0, 0], -side * p.raiseSide), -p.raiseFwd));
    // `twist` (shoulder/forearm roll) rolls that curl plane about the upper-arm
    // axis — the DOF that lets a RAISED arm curl the fist UP (double-biceps) or
    // inward (ballet fifth) instead of only forward. The roll sign pairs with
    // the forward curl so `twist: 90` lifts a side-raised fist UP; multiplying
    // by `side` keeps a symmetric `arms:{twist}` lifting both fists the same way.
    if (p.twist) hinge = norm3(rotAxis(hinge, dir, -p.twist * side));
    const foreDir = norm3(rotAxis(dir, hinge, p.bend ?? 0));
    const W = add3(E, scale3(foreDir, foreArmLen));
    const handC = add3(W, scale3(foreDir, r.hand * 0.9));
    return { S, E, W, handC, dir, foreDir, hinge };
  }
  const aL = armChain(+1, pose.armL);
  const aR = armChain(-1, pose.armR);

  // --- Leg FK ------------------------------------------------------------
  const thighLen = hipZ - kneeZ;
  const shankLen = kneeZ - ankleZ;
  function legChain(side: number, p: JointPose) {
    const Hj: Vec3 = [side * hipHalfX, 0, hipZ];
    let dir: Vec3 = [side * Math.sin(p.raiseSide * DEG), 0, -Math.cos(p.raiseSide * DEG)];
    dir = rotX(dir, -p.raiseFwd);
    dir = norm3(dir);
    const K = add3(Hj, scale3(dir, thighLen));
    // Knee bends the shank backward (+Y) relative to the thigh, about the
    // thigh's LATERAL axis: the rest hinge [−1,0,0] carried through the same
    // raiseSide/raiseFwd rotations as the bone. (It was cross(dir, fwd) before,
    // which degenerates toward a VERTICAL axis as raiseFwd → 90 with any nonzero
    // raiseSide — the documented chair-sit pose then swung the shins sideways,
    // frog-style, because the tiny raiseSide component dominated the cross
    // product. The frame-derived hinge equals the old one wherever raiseSide or
    // raiseFwd is ~0 — every catalog pose — and stays lateral when both are not.)
    // The BACKWARD bend needs the negative angle (positive swings forward —
    // that sign error once gave lunges a horizontal shin floating mid-air).
    let hinge = norm3(rotX(rotY([-1, 0, 0], -side * p.raiseSide), -p.raiseFwd));
    // twist = hip turnout: roll the knee-bend plane about the thigh axis so a
    // bent knee turns outward (plié, ballet positions), pairing `side` so a
    // symmetric `legs:{twist}` turns BOTH legs out the same way. 0 = neutral.
    if (p.twist) hinge = norm3(rotAxis(hinge, dir, -p.twist * side));
    const shankDir = norm3(rotAxis(dir, hinge, -(p.bend ?? 0)));
    const A = add3(K, scale3(shankDir, shankLen));
    // Foot heading: front (−Y) yawed about world-up by the turnout, OUTWARD
    // (+X for the left foot, −X for the right). A straight, turned-out leg
    // (knee 0 — ballet first/fifth) shows the turnout only here, since the
    // shank stays vertical; buildFeet orients the foot along this.
    const footFwd = norm3(rotZ([0, -1, 0], side * p.twist));
    return { Hj, K, A, dir, shankDir, footFwd };
  }
  const lL = legChain(+1, pose.legL);
  const lR = legChain(-1, pose.legR);

  // --- Head frame + face anchors ----------------------------------------
  const headCenter: Vec3 = [0, 0, headCenterZ];
  // Head local frame: forward points −Y, rotated by head pose. `headLeft` is
  // the lateral axis pointing to the figure's LEFT (+X when facing −Y), so the
  // `L` anchors land on +X, matching the body's L/R convention.
  let hf: Vec3 = [0, -1, 0];
  hf = rotZ(hf, pose.head.yaw);    // yaw
  hf = rotX(hf, pose.head.pitch);     // nod
  hf = norm3(hf);
  const up: Vec3 = [0, 0, 1];
  let headLeft = norm3(cross3(up, hf));   // +X when facing −Y (figure's left)
  let headUp = norm3(cross3(hf, headLeft)); // +Z when upright
  // `tilt` rolls the head toward a shoulder — a rotation of the up/left axes
  // ABOUT the forward axis. It must be applied here, not to `hf`: rolling `hf`
  // about itself is a no-op, and the cross-product frame above discards any
  // roll component, so the old `rotY(hf, tilt)` did literally nothing. Positive
  // tilt drops the crown toward the figure's LEFT shoulder (+X), matching the
  // `turn`-left-positive convention.
  if (pose.head.roll) {
    headLeft = norm3(rotAxis(headLeft, hf, -pose.head.roll));
    headUp = norm3(rotAxis(headUp, hf, -pose.head.roll));
  }

  const fAnchor = (f: number, u: number, s: number): Vec3 =>
    add3(headCenter, add3(add3(scale3(hf, f), scale3(headUp, u)), scale3(headLeft, s)));

  const face: FaceAnchors = {
    eyeL: fAnchor(r.headZ * 0.86, headH * 0.07, headH * 0.18),
    eyeR: fAnchor(r.headZ * 0.86, headH * 0.07, -headH * 0.18),
    browL: fAnchor(r.headZ * 0.88, headH * 0.20, headH * 0.18),
    browR: fAnchor(r.headZ * 0.88, headH * 0.20, -headH * 0.18),
    nose: fAnchor(r.headZ * 1.02, -headH * 0.02, 0),
    mouth: fAnchor(r.headZ * 0.90, -headH * 0.26, 0),
    earL: fAnchor(-r.headZ * 0.10, 0, r.headX * 0.98),
    earR: fAnchor(-r.headZ * 0.10, 0, -r.headX * 0.98),
    chinTip: fAnchor(r.headZ * 0.55, -headH * 0.46, 0),
  };

  // --- Spine: rigid-rotate the above-waist mass about the navel ----------
  // `spine.{lean,turn,side}` were parsed and validated but never applied.
  // Model the spine as a single waist pivot: rotate every above-navel joint and
  // direction (chest, neck, head, BOTH arms, and the face anchors) about the
  // navel line. lean = forward(+)/back(−) bend (about the lateral X axis);
  // side = lean toward the figure's LEFT(+)/right(−) shoulder (about the
  // forward Y axis); turn = twist the shoulders toward figure-left(+) (about
  // the vertical Z axis) — matching the head.turn/side sign conventions. The
  // pelvis, hips, legs and feet stay planted: the figure bends at the waist.
  // A rigid rotation about the pivot preserves every limb's internal shape, so
  // transforming each point/direction individually keeps the arms attached.
  // Zero spine ⇒ identity, so every existing pose (incl. the documented
  // double-biceps / ballet / lunge recipes) is byte-for-byte unchanged.
  const sp = pose.spine;
  const spineActive = sp.lean !== 0 || sp.turn !== 0 || sp.side !== 0;
  const spinePivot: Vec3 = [0, 0, navelZ];
  const spineRot = (v: Vec3): Vec3 => rotY(rotX(rotZ(v, sp.turn), sp.lean), sp.side);
  const sPt = (p: Vec3): Vec3 => spineActive ? add3(spinePivot, spineRot(sub3(p, spinePivot))) : p;
  const sDir = (v: Vec3): Vec3 => spineActive ? spineRot(v) : v;
  const sFace: FaceAnchors = spineActive ? {
    eyeL: sPt(face.eyeL), eyeR: sPt(face.eyeR), browL: sPt(face.browL), browR: sPt(face.browR),
    nose: sPt(face.nose), mouth: sPt(face.mouth), earL: sPt(face.earL), earR: sPt(face.earR),
    chinTip: sPt(face.chinTip),
  } : face;

  // Grip frames: a held cylinder rests in the cup of the curled fingers, offset
  // from the hand centre toward the palm by GRIP_REACH × r.hand, and lies along
  // the splay (elbow-hinge) axis. palmN matches the curl direction the hand
  // builder uses (cross(hinge, foreDir)). All spine-transformed like the joints.
  const GRIP_REACH = 0.72;
  const gripFrame = (a: { handC: Vec3; foreDir: Vec3; hinge: Vec3 }): GripFrame => {
    const palmN = norm3(cross3(a.hinge, a.foreDir));
    return {
      point: add3(sPt(a.handC), scale3(sDir(palmN), r.hand * GRIP_REACH)),
      palmNormal: sDir(palmN),
      gripAxis: sDir(a.hinge),
      reach: sDir(a.foreDir),
    };
  };

  return {
    // Joint POINTS named in the VRM/Unity humanoid scheme (the single canonical
    // vocabulary — see public/ai/figure.md). A joint is the bone's ROOT point:
    // `upperArmL` is the glenohumeral joint where the upper-arm bone starts (NOT
    // the clavicle, which VRM confusingly calls the "shoulder" bone). `wristL`
    // is the forearm end; `handL` is the hand-mass centre (the prop/grip point).
    joints: {
      hips: [0, 0, pelvisZ], spine: [0, -r.chestY * 0.4, navelZ], chest: sPt([0, -r.chestY * 0.2, chestZ]),
      neck: sPt([0, 0, shoulderZ + neckLen * 0.2]), head: sPt(headCenter), crown: sPt([headCenter[0], headCenter[1], H]), chin: sPt([0, 0, chinZ]),
      upperArmL: sPt(aL.S), lowerArmL: sPt(aL.E), wristL: sPt(aL.W), handL: sPt(aL.handC),
      upperArmR: sPt(aR.S), lowerArmR: sPt(aR.E), wristR: sPt(aR.W), handR: sPt(aR.handC),
      upperLegL: lL.Hj, lowerLegL: lL.K, footL: lL.A, upperLegR: lR.Hj, lowerLegR: lR.K, footR: lR.A,
    },
    r,
    dir: {
      upperArmL: sDir(aL.dir), lowerArmL: sDir(aL.foreDir), upperArmR: sDir(aR.dir), lowerArmR: sDir(aR.foreDir),
      // The elbow-hinge axis (post-twist) — ⟂ to the forearm-curl plane. The
      // hand frame derives from it: fingers splay along the hinge, the palm
      // faces hinge × lowerArm (the curl direction).
      elbowHingeL: sDir(aL.hinge), elbowHingeR: sDir(aR.hinge),
      upperLegL: lL.dir, lowerLegL: lL.shankDir, upperLegR: lR.dir, lowerLegR: lR.shankDir,
      // Foot heading per side (front −Y yawed by hip turnout) — buildFeet
      // orients toe/heel along it, so leg twist turns the feet out.
      footL: lL.footFwd, footR: lR.footFwd,
      headForward: sDir(hf), headUp: sDir(headUp), headLeft: sDir(headLeft),
    },
    grip: { L: gripFrame(aL), R: gripFrame(aR) },
    sole: { L: makeSoleFrame(lL.A, lL.footFwd, r), R: makeSoleFrame(lR.A, lR.footFwd, r) },
    face: sFace,
    opts: { height: H, headsTall: N, build, sex, pose },
  };
}

// --- Part builders --------------------------------------------------------
// Each takes the rig first and returns an unlabeled Node (the caller composes
// regions and labels the result, matching the paintByLabel flow).

function buildTorso(sdf: SdfApi, rig: Rig): Node {
  const j = rig.joints, r = rig.r;
  // Cap the chest mass at the shoulder line — the neck capsule provides the
  // neck. An uncapped tall ellipsoid climbs past the chin on stocky / few-
  // heads-tall rigs and buries the lower face inside the torso (the carved
  // mouth then lands in solid chest and teeth/lips labels resolve to zero).
  const chestSemiZ = Math.min(
    (j.chest[2] - j.spine[2]) * 1.15 + r.chestY,
    j.upperArmL[2] + r.neck * 0.8 - j.chest[2],
  );
  const chest = sdf.ellipsoid(r.chestX, r.chestY, chestSemiZ)
    .translate(j.chest);
  const belly = sdf.ellipsoid(r.chestX * 0.92, r.chestY * 0.94, (j.spine[2] - j.hips[2]) * 0.9 + r.chestY * 0.6)
    .translate([0, -r.chestY * 0.1, mix(j.spine[2], j.hips[2], 0.4)]);
  const pelvis = sdf.ellipsoid(r.hipsX, r.hipsY, r.hipsY * 1.25).translate(j.hips);
  const k = r.chestY * 0.6;
  return chest.smoothUnion(belly, k).smoothUnion(pelvis, k);
}

function buildNeck(sdf: SdfApi, rig: Rig): Node {
  const j = rig.joints, r = rig.r;
  return sdf.capsule(j.chest as Vec3, add3(j.head as Vec3, [0, 0, -r.headZ * 0.5]), r.neck);
}

function tapered(sdf: SdfApi, a: Vec3, b: Vec3, ra: number, rb: number, k: number): Node {
  // A two-radius limb: a thicker capsule near `a` and a thinner one toward `b`,
  // OVERLAPPING past the midpoint (0.4–0.6) and welded with a generous k so the
  // taper reads as one smooth muscle, not a balloon-animal seam at the middle.
  const thick = sdf.capsule(a, lerp3(a, b, 0.62), ra);
  const thin = sdf.capsule(lerp3(a, b, 0.38), b, rb);
  return thick.smoothUnion(thin, Math.max(k, Math.min(ra, rb) * 1.4));
}

function buildArms(sdf: SdfApi, rig: Rig): Node {
  const j = rig.joints, r = rig.r;
  const k = r.lowerArm * 1.3;             // elbow weld — soft, no kink
  function arm(S: Vec3, E: Vec3, W: Vec3): Node {
    const upper = tapered(sdf, S, E, r.upperArm, r.lowerArm * 1.05, k);
    const fore = tapered(sdf, E, W, r.lowerArm * 1.02, r.lowerArm * 0.8, k);
    // Deltoid cap so the shoulder reads as a rounded mass, not a tube stub.
    const deltoid = sdf.sphere(r.upperArm * 1.15).translate(S);
    return upper.smoothUnion(fore, k).smoothUnion(deltoid, r.upperArm * 0.9);
  }
  const armL = arm(j.upperArmL as Vec3, j.lowerArmL as Vec3, j.wristL as Vec3);
  const armR = arm(j.upperArmR as Vec3, j.lowerArmR as Vec3, j.wristR as Vec3);
  return armL.union(armR);
}

function buildHands(sdf: SdfApi, rig: Rig, opts?: unknown): Node {
  const o = obj(opts, 'hands(opts)');
  assertNoUnknownKeys(o, ['grip', 'fingers'], 'hands(opts)');
  const grip = o.grip === undefined ? 'relaxed'
    : assertEnum(o.grip, ['fist', 'open', 'relaxed'] as const, 'hands.grip');
  // Sculpted three-finger + thumb hands (the art-toy convention — three fat
  // fingers keep the inter-finger gaps printable where four go sub-cell at
  // figure scale). Pass `fingers: false` for the legacy blob/paddle hands.
  // Fingers are ADDITIVE capsules (no carving → no aliasing trap), but they
  // are finer than the global figure grid — pair with
  // `detail: F.handDetail(rig)` so the march resolves them.
  const fingers = o.fingers !== false;
  const j = rig.joints, r = rig.r;

  function hand(c: Vec3, dir: Vec3, hinge: Vec3, side: number): Node {
    // Hand frame: fingers extend along the forearm `dir`, splay across the
    // elbow-hinge axis, palm faces the curl direction (hinge × dir).
    const splay = hinge;
    const palmN = norm3(cross3(splay, dir));
    const inner = scale3(splay, side);     // toward the body for a neutral pose
    const fr = r.hand * 0.24;              // finger radius
    const at = (base: Vec3, ...offs: Vec3[]): Vec3 => offs.reduce(add3, base);

    if (!fingers) {
      if (grip === 'fist') return sdf.sphere(r.hand * 1.05).translate(c);
      if (grip === 'open') {
        return sdf.ellipsoid(r.hand * 0.55, r.hand * 1.2, r.hand * 0.9).translate(c);
      }
      const tip = add3(c, scale3(dir, r.hand * 1.1));
      return tapered(sdf, c, tip, r.hand * 0.95, r.hand * 0.6, r.hand * 0.5);
    }

    if (grip === 'fist') {
      // Ball fist + three chunky folded-finger ridges on the dir face + a
      // thumb capsule folded across the palm side. The ridges are short
      // capsules (not spheres) with a tight weld so the knuckle creases
      // survive the union instead of melting into the ball.
      const ball = sdf.ellipsoid(r.hand * 0.95, r.hand * 0.95, r.hand * 0.88).translate(c);
      let out = ball;
      for (const s of [-0.62, 0, 0.62]) {
        const kc = at(c, scale3(dir, r.hand * 0.62), scale3(splay, s * r.hand * 0.85));
        const ridge = sdf.capsule(
          at(kc, scale3(palmN, -r.hand * 0.25)),
          at(kc, scale3(palmN, r.hand * 0.45)),
          r.hand * 0.3,
        );
        out = out.smoothUnion(ridge, r.hand * 0.16);
      }
      const thumb = sdf.capsule(
        at(c, scale3(inner, r.hand * 0.8), scale3(palmN, r.hand * 0.35)),
        at(c, scale3(palmN, r.hand * 0.95), scale3(dir, r.hand * 0.25)),
        fr * 1.25,
      );
      return out.smoothUnion(thumb, r.hand * 0.18);
    }

    // Palm: a squashed knuckle-block oriented along the forearm — wider
    // across the splay axis than front-to-back, so the hand reads flat.
    const palm = sdf.capsule(
      add3(c, scale3(dir, -r.hand * 0.55)),
      add3(c, scale3(dir, r.hand * 0.1)),
      r.hand * 0.72,
    ).smoothUnion(
      sdf.capsule(
        at(c, scale3(dir, r.hand * 0.15), scale3(splay, -r.hand * 0.45)),
        at(c, scale3(dir, r.hand * 0.15), scale3(splay, r.hand * 0.45)),
        r.hand * 0.5,
      ), r.hand * 0.5,
    );

    // Three fingers, middle longest, fanned slightly. `relaxed` curls them
    // toward the palm; `open` keeps them straight.
    const curl = grip === 'relaxed' ? 0.45 : 0;
    const lens = [1.0, 1.18, 0.92];
    let out = palm;
    [-1, 0, 1].forEach((t, i) => {
      const len = r.hand * lens[i];
      const s = t * r.hand * 0.62;
      const base = at(c, scale3(dir, r.hand * 0.38), scale3(splay, s * 0.85));
      const reach = norm3(add3(scale3(dir, 1 - curl * 0.45), scale3(palmN, curl)));
      const tip = at(base, scale3(reach, len), scale3(splay, s * 0.25));
      out = out.smoothUnion(sdf.capsule(base, tip, fr), fr * 1.05);
    });
    // Thumb: from the inner palm edge, angled out and slightly palm-ward.
    const thumbBase = at(c, scale3(dir, -r.hand * 0.25), scale3(inner, r.hand * 0.55));
    const thumbDir = norm3(add3(add3(scale3(inner, 0.8), scale3(dir, 0.55)), scale3(palmN, 0.35)));
    const thumb = sdf.capsule(thumbBase, at(thumbBase, scale3(thumbDir, r.hand * 0.85)), fr * 1.08);
    return out.smoothUnion(thumb, fr * 1.1);
  }

  return hand(j.handL as Vec3, rig.dir.lowerArmL, rig.dir.elbowHingeL, +1)
    .union(hand(j.handR as Vec3, rig.dir.lowerArmR, rig.dir.elbowHingeR, -1));
}

/** Detail-region spheres for the hands, mirroring `faceDetail` — fingers are
 *  finer than the recommended 0.4–0.6 figure grid, so sculpted hands need a
 *  local fine march to resolve (an under-marched finger aliases away). */
function handDetail(rig: Rig, opts?: unknown): Array<{ center: Vec3; radius: number; edgeLength: number }> {
  const o = obj(opts, 'handDetail(opts)');
  assertNoUnknownKeys(o, ['radius', 'edgeLength'], 'handDetail(opts)');
  const r = rig.r;
  const radius = num(o.radius, r.hand * 2.6, 'handDetail.radius', 1e-3);
  const edgeLength = num(o.edgeLength, Math.max(r.hand * 0.085, 0.08), 'handDetail.edgeLength', 1e-4);
  return [
    { center: [...(rig.joints.handL as Vec3)] as Vec3, radius, edgeLength },
    { center: [...(rig.joints.handR as Vec3)] as Vec3, radius, edgeLength },
  ];
}

function buildLegs(sdf: SdfApi, rig: Rig): Node {
  const j = rig.joints, r = rig.r;
  const k = r.lowerLeg * 1.3;               // knee weld — soft, no kink
  function leg(Hj: Vec3, K: Vec3, A: Vec3): Node {
    const thigh = tapered(sdf, Hj, K, r.upperLeg, r.lowerLeg * 1.1, k);
    const shank = tapered(sdf, K, A, r.lowerLeg * 1.05, r.lowerLeg * 0.78, k);
    return thigh.smoothUnion(shank, k);
  }
  return leg(j.upperLegL as Vec3, j.lowerLegL as Vec3, j.footL as Vec3)
    .union(leg(j.upperLegR as Vec3, j.lowerLegR as Vec3, j.footR as Vec3));
}

/** The sole-plane Z of a foot (centre of the sole capsule), derived from its
 *  ankle. The foot FOLLOWS the ankle (one foot-radius below it) instead of being
 *  pinned to z=0, so a posed/elevated ankle (lunge, tiptoe) keeps the foot
 *  attached to the leg — no detached component. For a normal standing ankle this
 *  lands near z≈0. The {@link SoleFrame} shares this basis, so feet, footwear and
 *  the base agree on where the ground is. */
function footSoleZ(rig: Rig, ankle: Vec3): number {
  return ankle[2] - rig.r.foot;
}

/** Build the canonical {@link SoleFrame} for one foot from its ankle + heading.
 *  Single source of truth for the footprint + ground plane that `buildFeet`,
 *  `buildFootwear` and `buildBase` (and `figure.standOn`) all read. */
function makeSoleFrame(ankle: Vec3, heading: Vec3, r: Record<string, number>): SoleFrame {
  const footLen = r.foot * 2.4;
  const soleCenterZ = ankle[2] - r.foot;          // == footSoleZ
  // The bare foot's real underside sits ~0.79·foot below the sole centre (the
  // sole⊔instep⊔ankle smoothUnion bulges well past the analytic instep). groundZ
  // sits clearly below THAT (− 0.95·foot, measured empirically), so footwear —
  // which clips flat at groundZ — extends past the whole skin foot and fully
  // encloses it: no bare-skin patch can poke through the sole. A base rests below.
  const groundZ = soleCenterZ - r.foot * 0.95;
  // Footprint centre: the ankle sits ~40% from the heel, so the centre is a
  // little forward of the ankle along the heading.
  const cx = ankle[0] + heading[0] * footLen * 0.12;
  const cy = ankle[1] + heading[1] * footLen * 0.12;
  return {
    point: [cx, cy, groundZ],
    normal: [0, 0, 1],
    heading: [heading[0], heading[1], heading[2]],
    length: footLen,
    width: r.foot * 1.24,
    groundZ,
  };
}

function buildFeet(sdf: SdfApi, rig: Rig): Node {
  const j = rig.joints, r = rig.r;
  function foot(A: Vec3, s: SoleFrame, side: number): Node {
    const footLen = s.length;
    const fwd = s.heading;
    const sz = footSoleZ(rig, A);                 // sole capsule centre
    // Toe forward along the foot heading (default −Y, yawed by hip turnout),
    // heel back, ankle ~40% from the heel so the foot sits UNDER the body
    // instead of jutting forward (which reads as leaning back). The toe gets a
    // small outward (`side`·lateral) splay across the heading.
    const lat: Vec3 = [-fwd[1], fwd[0], 0];        // heading yawed +90° in XY
    const onGround = (p: Vec3): Vec3 => [p[0], p[1], sz];
    const toe = onGround(add3(A, add3(scale3(fwd, footLen * 0.62), scale3(lat, side * r.foot * 0.12))));
    const heel = onGround(add3(A, scale3(fwd, -footLen * 0.38)));
    const instepC = onGround(add3(A, scale3(fwd, footLen * 0.35)));
    const sole = sdf.capsule(heel, toe, r.foot * 0.62);
    const instep = sdf.ellipsoid(r.foot * 0.8, footLen * 0.5, r.foot * 0.8)
      .translate([instepC[0], instepC[1], sz + r.foot * 0.15]);
    // A short ankle column bridges the (possibly elevated) ankle to the sole so
    // the foot stays welded to the leg in any pose.
    const ankleCol = sdf.capsule(A, [A[0], A[1], sz + r.foot * 0.2], r.lowerLeg * 0.8);
    return sole.smoothUnion(instep, r.foot * 0.6).smoothUnion(ankleCol, r.foot * 0.6);
  }
  return foot(j.footL as Vec3, rig.sole.L, +1)
    .union(foot(j.footR as Vec3, rig.sole.R, -1));
}

/** Shoes and boots — footwear that wraps each foot, following the foot heading
 *  (`rig.dir.footL/R`) so it tracks `leg*.twist` turnout exactly like
 *  {@link buildFeet}. A shoe is the foot's sole + upper inflated by `thickness`;
 *  a boot adds a shaft up the lower-leg bone. `kind` selects which.
 *
 *  Coverage follows the {@link buildPants} pattern: a shaped overlay (the visible
 *  silhouette) plus a guaranteed-coverage underlayer — the body's own foot mass
 *  (and, for boots, the lower-leg shank) offset outward by `t` and clipped to the
 *  footwear zone, unioned UNDER the overlay so it only ADDS coverage and the skin
 *  can never poke through. Footwear overlaps the foot/shank skin, so the
 *  top-level union keeps the figure one component in any pose. */
function buildFootwear(sdf: SdfApi, rig: Rig, opts: unknown, kind: 'shoes' | 'boots'): Node {
  const name = `clothing.${kind}(opts)`;
  const o = obj(opts, name);
  const keys = kind === 'boots' ? ['size', 'shaftZ', 'thickness', 'label', 'sole'] : ['size', 'thickness', 'label', 'sole'];
  assertNoUnknownKeys(o, keys, name);
  const j = rig.joints, r = rig.r;
  // Footprint scale (chunkier/daintier footwear) and shell offset over the foot.
  const size = num(o.size, 1, `${kind}.size`, 0.1);
  const t = num(o.thickness, r.foot * 0.18, `${kind}.thickness`, 0.001);
  // This builder OWNS its paint regions (like F.face.eyes): the upper carries
  // `label` and the sole its own `sole.label`, so don't add `.label()` on top —
  // an outer label would swallow the sole region (the outermost label wins).
  if (o.label !== undefined && typeof o.label !== 'string') throw new ValidationError(`${kind}.label must be a string`);
  const upperLabel = (o.label as string | undefined) ?? kind;
  // Sole = a distinct, slightly-wider, flat region by default (paints separately
  // — a real shoe/boot sole). `sole: false` folds it into the upper (one colour).
  const soleOn = o.sole !== false;
  const so = soleOn && typeof o.sole === 'object' && o.sole !== null ? o.sole as Record<string, unknown> : {};
  assertNoUnknownKeys(so, ['label', 'thickness', 'overhang'], `${kind}.sole`);
  if (so.label !== undefined && typeof so.label !== 'string') throw new ValidationError(`${kind}.sole.label must be a string`);
  const soleLabel = (so.label as string | undefined) ?? 'sole';
  const soleThick = num(so.thickness, r.foot * 0.5, `${kind}.sole.thickness`, 0.001);
  const overhang = num(so.overhang, r.foot * 0.12, `${kind}.sole.overhang`, 0);

  const shaftZ = o.shaftZ === undefined ? undefined : num(o.shaftZ, 0, `${kind}.shaftZ`);
  function shaftTop(A: Vec3, K: Vec3): Vec3 {
    if (shaftZ === undefined) return lerp3(A, K, 0.55);
    const segZ = K[2] - A[2];
    if (Math.abs(segZ) < 1e-6) return lerp3(A, K, 0.55); // near-horizontal shank: height is meaningless
    const frac = (shaftZ - A[2]) / segZ;
    return lerp3(A, K, Math.min(0.95, Math.max(0.1, frac)));
  }

  // Build one foot's two regions: the upper (boot body, clipped to sit ABOVE the
  // sole) and the sole slab (a wide flat footprint from groundZ up). They overlap
  // a little so the union welds into one component.
  function foot(A: Vec3, K: Vec3, sole0: SoleFrame, side: number): { upper: Node; sole: Node | null } {
    const footLen = sole0.length * size;
    const fwd = sole0.heading;
    const groundZ = sole0.groundZ;
    const sz = footSoleZ(rig, A);                  // sole capsule centre
    const lat: Vec3 = [-fwd[1], fwd[0], 0];        // heading yawed +90° in XY
    const onGround = (p: Vec3): Vec3 => [p[0], p[1], sz];
    const toe = onGround(add3(A, add3(scale3(fwd, footLen * 0.62), scale3(lat, side * r.foot * 0.12))));
    const heel = onGround(add3(A, scale3(fwd, -footLen * 0.38)));
    const instepC = onGround(add3(A, scale3(fwd, footLen * 0.35)));
    const soleCap = sdf.capsule(heel, toe, r.foot * 0.62 + t);
    const instep = sdf.ellipsoid((r.foot * 0.8 + t) * size, footLen * 0.5, r.foot * 0.8 + t)
      .translate([instepC[0], instepC[1], sz + r.foot * 0.15 + t * 0.4]);
    const collar = sdf.capsule(A, [A[0], A[1], sz + r.foot * 0.2], r.lowerLeg * 0.85 + t);
    let upper = soleCap.smoothUnion(instep, r.foot * 0.6).smoothUnion(collar, r.foot * 0.6);
    if (kind === 'boots') {
      const shaft = sdf.capsule(A, shaftTop(A, K), r.lowerLeg + t);
      upper = upper.smoothUnion(shaft, r.lowerLeg * 0.9);
    }
    // Guaranteed-coverage underlayer: the body's foot/shank mass offset by `t`
    // and clipped to the footwear zone, so the skin can't poke through.
    const footMass = (() => {
      const s = sdf.capsule(heel, toe, r.foot * 0.62);
      const inst = sdf.ellipsoid(r.foot * 0.8 * size, footLen * 0.5, r.foot * 0.8)
        .translate([instepC[0], instepC[1], sz + r.foot * 0.15]);
      const col = sdf.capsule(A, [A[0], A[1], sz + r.foot * 0.2], r.lowerLeg * 0.8);
      let m = s.smoothUnion(inst, r.foot * 0.6).smoothUnion(col, r.foot * 0.6);
      if (kind === 'boots') m = m.union(sdf.capsule(A, shaftTop(A, K), r.lowerLeg));
      return m.round(t);
    })();
    const big = Math.max(footLen, r.lowerLeg) * 8;
    const topZ = kind === 'boots' ? shaftTop(A, K)[2] : sz + r.foot * 1.2 + t;
    const zone = sdf.box([big, big, big]).translate([A[0], A[1], topZ - big / 2]); // z ≤ topZ
    let upperFull = upper.union(footMass.intersect(zone));

    const soleTopZ = soleOn ? groundZ + soleThick : groundZ;
    // The upper sits ON the sole: clip it to z ≥ (soleTopZ − small weld overlap)
    // when there's a sole, else flat at the ground plane.
    const clipZ = soleOn ? soleTopZ - r.foot * 0.18 : groundZ;
    const upperFloor = sdf.box([big, big, big]).translate([A[0], A[1], clipZ + big / 2]); // z ≥ clipZ
    upperFull = upperFull.intersect(upperFloor);

    let soleNode: Node | null = null;
    if (soleOn) {
      // A flat, footprint-shaped slab, wider than the upper (overhang lip) and
      // yawed to the foot heading — reads as a real sole and fully covers the
      // skin underside. Flat bottom at groundZ.
      const yaw = Math.atan2(fwd[0], fwd[1]) / DEG;  // local +Y → heading
      const slabH = soleTopZ - groundZ;
      soleNode = sdf.roundedBox(
        [sole0.width * size + 2 * (t + overhang), footLen * 0.98 + 2 * overhang, slabH],
        Math.min(r.foot * 0.16, slabH * 0.45),
      ).rotate([0, 0, yaw]).translate([sole0.point[0], sole0.point[1], (groundZ + soleTopZ) / 2]);
    }
    return { upper: upperFull, sole: soleNode };
  }

  const L = foot(j.footL as Vec3, j.lowerLegL as Vec3, rig.sole.L, +1);
  const R = foot(j.footR as Vec3, j.lowerLegR as Vec3, rig.sole.R, -1);
  const parts: Node[] = [L.upper.label(upperLabel), R.upper.label(upperLabel)];
  if (L.sole && R.sole) parts.push(L.sole.label(soleLabel), R.sole.label(soleLabel));
  return parts.reduce((a, b) => a.union(b));
}

function buildShoes(sdf: SdfApi, rig: Rig, opts?: unknown): Node {
  return buildFootwear(sdf, rig, opts, 'shoes');
}

function buildBoots(sdf: SdfApi, rig: Rig, opts?: unknown): Node {
  return buildFootwear(sdf, rig, opts, 'boots');
}

function buildHead(sdf: SdfApi, rig: Rig): Node {
  const r = rig.r, c = rig.joints.head as Vec3;
  const f = rig.dir.headForward, u = rig.dir.headUp;
  const skull = sdf.ellipsoid(r.headX, r.head, r.headZ).translate(c);
  // Jaw: a smaller ellipsoid pulled down + forward, welded for a soft chin.
  const jawC = add3(c, add3(scale3(f, r.headZ * 0.28), scale3(u, -r.headZ * 0.42)));
  const jaw = sdf.ellipsoid(r.headX * 0.74, r.head * 0.66, r.headZ * 0.5).translate(jawC);
  // Cheek fullness for the stylized look.
  const cheekL = sdf.sphere(r.headX * 0.5).translate(add3(c, add3(scale3(f, r.headZ * 0.55), scale3(rig.dir.headLeft, r.headX * 0.45))));
  const cheekR = sdf.sphere(r.headX * 0.5).translate(add3(c, add3(scale3(f, r.headZ * 0.55), scale3(rig.dir.headLeft, -r.headX * 0.45))));
  const kk = r.headZ * 0.5;
  return skull.smoothUnion(jaw, kk).smoothUnion(cheekL, kk).smoothUnion(cheekR, kk);
}

function buildBase(sdf: SdfApi, rig: Rig, opts?: unknown): Node {
  const o = obj(opts, 'base(opts)');
  assertNoUnknownKeys(o, ['radius', 'thickness'], 'base(opts)');
  const H = rig.opts.height, r = rig.r;
  const aL = rig.joints.footL, aR = rig.joints.footR;
  const footLen = r.foot * 2.4;
  // Auto-size: cover the stance footprint (so a wide/lunge stance isn't off the
  // edge) and rise to meet the LOWEST foot (so at least one foot always merges
  // with the base, keeping the whole figure one component in any pose).
  const reach = Math.max(Math.abs(aL[0]), Math.abs(aR[0])) + footLen * 0.6
    + Math.max(Math.abs(aL[1]), Math.abs(aR[1]));
  const radius = num(o.radius, Math.max(H * 0.22, reach), 'base.radius', 1);
  // A pedestal the figure stands ON: its TOP rises just into the lowest foot to
  // weld it (the whole figure is one component through the body, so welding one
  // foot anchors the base), and it extends DOWN by `thickness`. Crucially the
  // disc BOTTOM sits below the lowest sole, so no foot/boot hangs through the
  // underside. The lowest foot is embedded a little; a lifted foot stays free.
  const lowestGroundZ = Math.min(rig.sole.L.groundZ, rig.sole.R.groundZ);
  // Rise just enough to weld the lowest sole, but LESS than a footwear sole's
  // height (~0.5·foot) so a coloured sole still shows above the disc rim instead
  // of being swallowed — the figure reads as standing ON the base.
  const topZ = lowestGroundZ + r.foot * 0.32;
  const thickness = num(o.thickness, Math.max(H * 0.03, r.foot * 0.9), 'base.thickness', 0.1);
  const botZ = Math.min(topZ - thickness, lowestGroundZ - r.foot * 0.12); // always below the soles
  const h = topZ - botZ;
  return sdf.roundedCylinder(radius, h, Math.min(h * 0.35, r.foot * 0.5))
    .translate([0, 0, (topZ + botZ) / 2]);
}

/** Two-bone IK: place the knee so the leg (fixed hip, fixed bone lengths) reaches
 *  `target` with the ankle. Keeps the original bend direction (so a knee that bent
 *  forward stays forward). If `target` is out of reach, the leg straightens toward
 *  it and the ankle is clamped to full extension. */
function legIK(hip: Vec3, knee: Vec3, ankle: Vec3, target: Vec3): { knee: Vec3; ankle: Vec3 } {
  const Lt = len3(sub3(knee, hip));
  const Ls = len3(sub3(ankle, knee));
  const d = sub3(target, hip);
  const dist = len3(d);
  if (dist < 1e-6) return { knee, ankle };
  const u = scale3(d, 1 / dist);                 // hip → target unit
  if (dist >= Lt + Ls) {                          // unreachable: straighten + clamp
    return { knee: add3(hip, scale3(u, Lt)), ankle: add3(hip, scale3(u, Lt + Ls)) };
  }
  // Preserve the original bend plane: the component of (knee − hip) ⟂ to u.
  const kh = sub3(knee, hip);
  const along = kh[0] * u[0] + kh[1] * u[1] + kh[2] * u[2];
  let bend = sub3(kh, scale3(u, along));
  const bl = len3(bend);
  bend = bl > 1e-6 ? scale3(bend, 1 / bl) : norm3(cross3(u, Math.abs(u[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
  // Law of cosines: knee lies `a` along u from the hip, `h` off the axis.
  const a = (Lt * Lt - Ls * Ls + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, Lt * Lt - a * a));
  return { knee: add3(add3(hip, scale3(u, a)), scale3(bend, h)), ankle: target };
}

/** Ground a figure so its feet stand on one plane — the "connection" between
 *  footwear soles and a surface. Returns a NEW rig; build feet / footwear / base
 *  from it and they share the plane (footwear soles come out coplanar, the base
 *  meets them). `mode`:
 *   - `'plant'` (default): feet within `tolerance` of the plane are leveled ONTO
 *     it (their footwear sole thickens to reach it); feet beyond tolerance stay
 *     lifted (off the ground). No re-posing — keeps the pose exactly.
 *   - `'drop'`: re-poses each leg (2-bone IK, hips fixed) so every foot's sole
 *     lands on the plane. Physically grounds all feet at the cost of changing the
 *     leg geometry.
 *  The plane is `z`, else the top of `surface` (an SDF node), else the lowest
 *  foot's ground plane. */
function groundRig(rig: Rig, opts?: unknown): Rig {
  const o = obj(opts, 'ground(opts)');
  assertNoUnknownKeys(o, ['mode', 'surface', 'z', 'tolerance'], 'ground(opts)');
  const mode = o.mode === undefined ? 'plant' : assertEnum(o.mode, ['plant', 'drop'] as const, 'ground.mode');
  let plane: number;
  if (o.z !== undefined) {
    plane = num(o.z, 0, 'ground.z');
  } else if (o.surface !== undefined) {
    const s = o.surface as { bounds?: () => { max: Vec3 } };
    if (!s || typeof s.bounds !== 'function') throw new ValidationError('ground.surface must be an SDF node');
    plane = s.bounds().max[2];
  } else {
    plane = Math.min(rig.sole.L.groundZ, rig.sole.R.groundZ);
  }
  const tol = num(o.tolerance, rig.r.foot * 1.5, 'ground.tolerance', 0);

  if (mode === 'plant') {
    const plant = (sf: SoleFrame): SoleFrame =>
      Math.abs(sf.groundZ - plane) <= tol
        ? { ...sf, groundZ: plane, point: [sf.point[0], sf.point[1], plane] }
        : sf;
    return { ...rig, sole: { L: plant(rig.sole.L), R: plant(rig.sole.R) } };
  }

  // drop: re-pose each leg so the foot's ground plane lands on `plane`.
  const joints: Record<string, Vec3> = { ...rig.joints };
  const dir: Record<string, Vec3> = { ...rig.dir };
  const sole = { L: rig.sole.L, R: rig.sole.R };
  for (const side of ['L', 'R'] as const) {
    const hip = rig.joints[`upperLeg${side}`];
    const knee = rig.joints[`lowerLeg${side}`];
    const ankle = rig.joints[`foot${side}`];
    // groundZ = ankle.z − 1.95·foot (see makeSoleFrame), so the ankle that lands
    // the sole on `plane` is plane + 1.95·foot, directly under the current foot.
    const target: Vec3 = [ankle[0], ankle[1], plane + rig.r.foot * 1.95];
    const ik = legIK(hip, knee, ankle, target);
    joints[`lowerLeg${side}`] = ik.knee;
    joints[`foot${side}`] = ik.ankle;
    dir[`upperLeg${side}`] = norm3(sub3(ik.knee, hip));
    dir[`lowerLeg${side}`] = norm3(sub3(ik.ankle, ik.knee));
    sole[side] = makeSoleFrame(ik.ankle, rig.dir[`foot${side}`], rig.r);
  }
  return { ...rig, joints, dir, sole };
}

// --- Face features (read rig.face anchors) --------------------------------

function buildEyes(sdf: SdfApi, rig: Rig, opts?: unknown): Node {
  const o = obj(opts, 'eyes(opts)');
  assertNoUnknownKeys(o, ['radius', 'style'], 'eyes(opts)');
  const rad = num(o.radius, rig.r.head * 0.16, 'eyes.radius', 0.01);
  const style = o.style === undefined ? 'iris'
    : assertEnum(o.style, ['solid', 'iris'] as const, 'eyes.style');
  const f = rig.dir.headForward;
  // Push the eyeballs out so a dome reliably protrudes past the cheek welds —
  // an eye centred ON the anchor can be fully swallowed, leaving a paintable
  // label with zero triangles. `rad * 0.28` alone is ~1 face-detail march cell
  // (faceDetail's head edge ≈ r.head * 0.045) and shrinks toward zero as the
  // head is posed/enlarged, so the eye/iris/pupil labels collapse to 0 tris on
  // many figures. Floor the push at ~2 cells (r.head * 0.09) — the same
  // cell-count discipline the mouth cavity (`cavH`) already uses — while
  // staying shallow enough that the eye reads as sitting IN the face.
  const push = Math.max(rad * 0.28, rig.r.head * 0.09);
  const cL = add3(rig.face.eyeL, scale3(f, push));
  const cR = add3(rig.face.eyeR, scale3(f, push));
  const pair = (r: number, forwardOff: number): Node => {
    const off = scale3(f, forwardOff);
    return sdf.sphere(r).translate(add3(cL, off)).union(sdf.sphere(r).translate(add3(cR, off)));
  };
  if (style === 'solid') return pair(rad, 0);
  // 'iris' (default): white eyeball + coloured iris LENS + black pupil LENS,
  // each its own pre-labelled hard-union region so paintByLabels can colour
  // them independently. Don't wrap the result in another .label() — the
  // outer label would win and flatten the eye back to one colour.
  //
  // The lenses are flat ellipsoid caps proud of the eyeball by only a few
  // hundredths of the eye radius — they read as painted-on circles rather
  // than stacked beads. (Thin reliefs survive the union because booleans are
  // exact on the meshed surfaces; only each region's own march needs to
  // resolve its solid, and a lens is a chunky ellipsoid.)
  const lensPair = (rxz: number, ry: number, frontAt: number): Node => {
    const d = scale3(f, frontAt - ry); // lens centre so its front face sits at `frontAt`
    const one = (c: Vec3): Node =>
      orientToHeadPose(sdf.ellipsoid(rxz, ry, rxz), rig).translate(add3(c, d));
    return one(cL).union(one(cR));
  };
  // Lens depth (the `ry` term) is set ≥ ~1.5 cells thick so each lens resolves
  // even when the build forgets the recommended `detail: F.faceDetail(rig)` and
  // marches the whole figure on the coarse global grid — a thinner cap aliased
  // the pupil away to 0 triangles there. It only deepens the lens INTO the
  // eyeball; the front face (and thus the painted-on-circle read) is unchanged.
  const sclera = pair(rad, 0).label('eyes');
  const iris = lensPair(rad * 0.52, rad * 0.24, rad * 1.08).label('iris');
  const pupil = lensPair(rad * 0.3, rad * 0.18, rad * 1.15).label('pupil');
  return sclera.union(iris).union(pupil);
}

function buildNose(sdf: SdfApi, rig: Rig, opts?: unknown): Node {
  const o = obj(opts, 'nose(opts)');
  assertNoUnknownKeys(o, ['tipRadius', 'length'], 'nose(opts)');
  const tipR = num(o.tipRadius, rig.r.head * 0.12, 'nose.tipRadius', 0.01);
  const f = rig.dir.headForward, u = rig.dir.headUp;
  const tip = rig.face.nose;
  const bridge = add3(tip, add3(scale3(u, rig.r.head * 0.34), scale3(f, -rig.r.head * 0.18)));
  return tapered(sdf, bridge, tip, tipR * 0.7, tipR, tipR * 0.6);
}

type MouthStyle = 'smile' | 'lips' | 'open';

/** How the mouth combines with the head: protruding lips are ADDED
 *  (smoothUnion), while smile lines and open mouths are CARVED
 *  (smoothSubtract). assembleFace dispatches on this. */
interface MouthPart { node: Node; mode: 'add' | 'carve' }

const MOUTH_FIELDS = ['width', 'smirk', 'open', 'style', 'teeth', 'lips'];

/** Orient an origin-built node into the posed head frame, so axis-aligned
 *  mouth/eye parts follow the head pose. `tilt` is a ROLL about the (canonical)
 *  forward axis, so it is applied FIRST (innermost) — carrying it through the
 *  yaw/nod rotation is equivalent to rolling about the posed forward axis last,
 *  which is exactly how the head frame applies tilt. (The old form applied tilt
 *  as an outer `rotY`, which disagreed with the frame once tilt actually did
 *  anything.) */
function orientToHeadPose(node: Node, rig: Rig): Node {
  const p = rig.opts.pose.head;
  return node.rotate([0, p.roll, 0]).rotate([0, 0, p.yaw]).rotate([p.pitch, 0, 0]);
}

/** Shared geometry of the open-mouth cavity, used by both the carve and the
 *  teeth / lip-ring accents so they always agree. */
function mouthCavityFrame(rig: Rig, width: number, open: number): { halfW: number; cavH: number; center: Vec3 } {
  const f = rig.dir.headForward, u = rig.dir.headUp;
  const gape = open > 0 ? open : 0.55;
  const halfW = width * 0.5;
  // Floor of 0.1·R: at the documented figure build edge (0.4–0.6 for a
  // 60-unit figure, R ≈ 4–6) that keeps the slot ≥ ~2 march cells tall. A
  // thinner slot is a sub-cell feature of the (coarse-marched) skin region —
  // it aliases into half-sealed debris and dozens of micro-handles that
  // refine-and-project can sharpen but never topologically fix.
  const cavH = Math.max(width * 0.32 * gape, rig.r.head * 0.1);
  const center = add3(add3(rig.face.mouth, scale3(f, -rig.r.head * 0.06)), scale3(u, -cavH * 0.25));
  return { halfW, cavH, center };
}

function buildMouthPart(sdf: SdfApi, rig: Rig, opts?: unknown): MouthPart {
  const o = obj(opts, 'mouth(opts)');
  assertNoUnknownKeys(o, MOUTH_FIELDS, 'mouth(opts)');
  const width = num(o.width, rig.r.head * 0.5, 'mouth.width', 0.01);
  const smirk = num(o.smirk, 0, 'mouth.smirk', -1, 1);
  const open = num(o.open, 0, 'mouth.open', 0, 1);
  // `open > 0` implies the open style unless the caller said otherwise.
  const style: MouthStyle = o.style !== undefined
    ? assertEnum(o.style, ['smile', 'lips', 'open'] as const, 'mouth.style')
    : open > 0 ? 'open' : 'smile';
  const u = rig.dir.headUp, right = rig.dir.headLeft;
  const m = rig.face.mouth;
  const halfW = width * 0.5;

  if (style === 'lips') {
    // A protruding lip ridge, pushed forward of the anchor so it clearly
    // stands proud of the face (an on-surface capsule reads as nothing when
    // it isn't smooth-welded). Smirk tips one corner up.
    const lipR = rig.r.head * 0.085;
    const fwd = scale3(rig.dir.headForward, lipR * 0.6);
    const a = add3(add3(add3(m, fwd), scale3(right, halfW)), scale3(u, smirk * width * 0.25));
    const b = add3(add3(add3(m, fwd), scale3(right, -halfW)), scale3(u, -smirk * width * 0.25));
    return { node: sdf.capsule(a, b, lipR), mode: 'add' };
  }

  if (style === 'open') {
    // A carved mouth cavity — the cartoon "laughing / talking" mouth. The
    // ellipsoid straddles the surface and reaches inward so the opening reads
    // as a dark interior, not a shallow dent.
    const { halfW: hw, cavH, center } = mouthCavityFrame(rig, width, open);
    const cavity = orientToHeadPose(sdf.ellipsoid(hw, rig.r.head * 0.38, cavH), rig)
      .translate(center);
    return { node: cavity, mode: 'carve' };
  }

  // 'smile' (default): a carved smile LINE — an arc of capsules through the
  // mouth anchor, corners curling up, carved into the face as a groove.
  // Cartoon faces read a carved line far better than a protruding ridge.
  const curl = rig.r.head * 0.14;          // corner lift at t = ±1
  const grooveR = rig.r.head * 0.07;
  const SEGS = 6;
  const pt = (t: number): Vec3 => add3(
    add3(m, scale3(right, halfW * t)),
    // t² curl dips the middle 30% of `curl` below the anchor and lifts the
    // corners 70% above it; smirk skews the whole line.
    scale3(u, curl * (t * t - 0.3) + smirk * halfW * 0.35 * t),
  );
  let arc: Node | undefined;
  for (let i = 0; i < SEGS; i++) {
    const t0 = -1 + (2 * i) / SEGS, t1 = -1 + (2 * (i + 1)) / SEGS;
    const seg = sdf.capsule(pt(t0), pt(t1), grooveR);
    arc = arc === undefined ? seg : arc.union(seg);
  }
  return { node: arc!, mode: 'carve' };
}

/** Public `F.face.mouth(rig, opts)` — returns the mouth geometry node. For
 *  the carved styles ('smile', 'open') this is the CUTTER: subtract it from
 *  the head yourself, or let `face.assemble` do it. */
function buildMouth(sdf: SdfApi, rig: Rig, opts?: unknown): Node {
  return buildMouthPart(sdf, rig, opts).node;
}

/** Paintable mouth accents — PRE-LABELLED solid parts that hard-union at the
 *  TOP level of the figure (next to the eyes), complementing the carve that
 *  `face.assemble` applies. Pass the SAME options object you gave `mouth`.
 *
 *  - style 'open': a 'teeth' band hanging from the cavity ceiling (skip with
 *    `teeth: false`) and a 'lips' ring around the opening (skip with
 *    `lips: false`).
 *  - style 'lips': the lip ridge labelled 'lips' — pass `mouth: false` to
 *    `face.assemble` in this case so the ridge isn't ALSO smooth-welded
 *    (a welded copy would swallow the labelled one).
 *  - style 'smile' has no accents (the carved line needs no paint). */
function buildMouthAccents(sdf: SdfApi, rig: Rig, opts?: unknown): Node {
  const o = obj(opts, 'mouthAccents(opts)');
  assertNoUnknownKeys(o, MOUTH_FIELDS, 'mouthAccents(opts)');
  const width = num(o.width, rig.r.head * 0.5, 'mouthAccents.width', 0.01);
  const open = num(o.open, 0, 'mouthAccents.open', 0, 1);
  const style: MouthStyle = o.style !== undefined
    ? assertEnum(o.style, ['smile', 'lips', 'open'] as const, 'mouthAccents.style')
    : open > 0 ? 'open' : 'smile';
  const f = rig.dir.headForward, u = rig.dir.headUp;
  const R = rig.r.head;

  if (style === 'lips') {
    return buildMouthPart(sdf, rig, { ...o, style: 'lips' }).node.label('lips');
  }
  if (style !== 'open') {
    throw new ValidationError(
      "face.mouthAccents: only the 'open' and 'lips' mouth styles have paintable accents — "
      + "the carved 'smile' line is shading, not a part. See /ai/figure.md#mouth-styles.",
    );
  }

  const { halfW, cavH, center } = mouthCavityFrame(rig, width, open);
  const parts: Node[] = [];
  if (o.teeth !== false) {
    // A white band hanging from the cavity ceiling: top edge buried in the
    // head above the opening (fuses into one component), front face recessed
    // just behind the face surface. The recess scales with the cavity so a
    // slim gritted-teeth mouth (small `open`) still shows the band — a fixed
    // recess deeper than the opening buries it entirely.
    // Slightly NARROWER than the opening with a cavity-proportional recess:
    // a band wider than the opening (or flush with the rim) grazes the
    // carved skin and sheds zero-volume boolean slivers, while a recess
    // deeper than the cavity buries the band entirely (body welds can
    // inflate the face surface past any fixed offset).
    const td = R * 0.5;
    // Every face of the band must clear (or decisively cross) the cavity
    // surfaces by a couple of MARCH CELLS, not by a proportion of cavH — on
    // a slim gritted mouth the proportional margins drop below one cell and
    // the near-tangent surfaces shred into dozens of micro-handles (genus
    // explosion). fineEdge mirrors faceDetail's mouth-region march edge.
    const fineEdge = Math.max(R * 0.02, 0.03);
    // Front face: recessed behind the carved rim by at least ~1.5 cells.
    const recess = Math.max(cavH * 0.18, fineEdge * 1.5);
    // roundedBox takes FULL sizes (not half-extents). Width spans most of
    // the opening but stays NARROWER than it, so the flat front face lies
    // inside the aperture and meets only air — a band wider than the slot
    // grazes the curved rim at a shallow angle all around it (a ring of
    // near-tangent boolean crossings → micro-handles).
    const bandW = halfW * 1.7;
    // Height: hang the band above the floor (dark gap under the teeth — the
    // open-laugh look); when that gap would be sub-cell, close it instead:
    // run the band through the floor into the jaw — a transversal weld, and
    // the right look for gritted teeth.
    const hangGap = cavH * 0.7; // bottom edge at 0.45·cavH − 0.75·cavH
    const bandH = hangGap < fineEdge * 2.5 ? cavH * 2.9 + fineEdge * 3 : cavH * 1.5;
    const teeth = orientToHeadPose(
      sdf.roundedBox([bandW, td, bandH], Math.min(cavH, halfW) * 0.18), rig,
    ).translate(add3(center, add3(scale3(u, cavH * 0.45), scale3(f, -recess - td * 0.5))));
    parts.push(teeth.label('teeth'));
  }
  if (o.lips !== false) {
    // A lip ring: a chain of capsules around the opening ellipse. (A thin
    // ellipsoid-minus-tunnel shell fragments into dozens of shards when
    // marched — capsule chains are unconditionally robust.)
    const right = rig.dir.headLeft;
    const lipR = Math.min(R * 0.10, cavH * 0.55);
    // Ring centre: the cavity opening projected onto the face. Centred ON
    // the surface — half the capsule is buried, so the lips read as part of
    // the face instead of a donut stuck onto it.
    const cc = add3(rig.face.mouth, scale3(u, -cavH * 0.25));
    const SEGS = 14;
    const ringPt = (theta: number): Vec3 => add3(cc, add3(
      scale3(right, halfW * 1.02 * Math.cos(theta)),
      scale3(u, cavH * 1.08 * Math.sin(theta)),
    ));
    let ring: Node | undefined;
    for (let i = 0; i < SEGS; i++) {
      const t0 = (2 * Math.PI * i) / SEGS, t1 = (2 * Math.PI * (i + 1)) / SEGS;
      const seg = sdf.capsule(ringPt(t0), ringPt(t1), lipR);
      ring = ring === undefined ? seg : ring.union(seg);
    }
    parts.push(ring!.label('lips'));
  }
  if (parts.length === 0) {
    throw new ValidationError('face.mouthAccents: both teeth and lips are disabled — nothing to build.');
  }
  return parts.length === 1 ? parts[0] : parts[0].union(parts[1]);
}

function buildEars(sdf: SdfApi, rig: Rig, opts?: unknown): Node {
  const o = obj(opts, 'ears(opts)');
  assertNoUnknownKeys(o, ['size'], 'ears(opts)');
  const s = num(o.size, rig.r.head * 0.3, 'ears.size', 0.01);
  const earL = sdf.ellipsoid(s * 0.4, s * 0.8, s).translate(rig.face.earL);
  const earR = sdf.ellipsoid(s * 0.4, s * 0.8, s).translate(rig.face.earR);
  return earL.union(earR);
}

function buildBrows(sdf: SdfApi, rig: Rig, opts?: unknown): Node {
  // Arched ridges that HUG the skull. A straight capsule chord between two
  // points on a curved surface leaves its middle proud (the "shelf brow"
  // look), so each brow is an arc whose points (a) curve up toward the
  // middle and (b) pull BACK following the skull's lateral curvature, and
  // the whole ridge is sunk by part of its radius.
  const o = obj(opts, 'brows(opts)');
  assertNoUnknownKeys(o, ['thickness', 'lift'], 'brows(opts)');
  const thickness = num(o.thickness, 1, 'brows.thickness', 0.1, 5); // ridge weight
  const lift = num(o.lift, 1, 'brows.lift', 0, 5);                   // mid-brow arch
  const f = rig.dir.headForward, u = rig.dir.headUp, right = rig.dir.headLeft;
  const w = rig.r.head * 0.24;                  // half-span of one brow
  const browRad = rig.r.head * 0.045 * thickness;
  const arch = rig.r.head * 0.06 * lift;        // mid-brow lift
  const sink = browRad * 0.5;
  const SEGS = 4;
  const browArc = (anchor: Vec3): Node => {
    const pt = (t: number): Vec3 => {
      const s = w * t;
      // Pull back by the circular sagitta at lateral offset s so the arc
      // follows the skull instead of chording across it.
      const drop = (s * s) / (2 * Math.max(rig.r.headX, 1e-3)) + sink;
      return add3(anchor, add3(
        add3(scale3(right, s), scale3(u, arch * (1 - t * t))),
        scale3(f, -drop),
      ));
    };
    let arc: Node | undefined;
    for (let i = 0; i < SEGS; i++) {
      const seg = sdf.capsule(pt(-1 + (2 * i) / SEGS), pt(-1 + (2 * (i + 1)) / SEGS), browRad);
      arc = arc === undefined ? seg : arc.union(seg);
    }
    return arc!;
  };
  return browArc(rig.face.browL).union(browArc(rig.face.browR));
}

/** Weld nose/mouth/ears/brows onto a head with SHARP creases (small k), vs
 *  the soft body weld. Carved mouth styles ('smile'/'open') are subtracted
 *  instead. Pass `false` for any feature to skip it.
 *
 *  Eyes default to OFF here. The recommended flow welds the assembled face into
 *  the body and labels the whole thing `.label('skin')` — which would FLATTEN
 *  in-face eyes into the skin region (their `eyes`/`iris`/`pupil` labels resolve
 *  to 0 paintable triangles). So build eyes at the top level instead:
 *  `sdf.union(skin, F.face.eyes(rig), …)`. Pass `eyes: true` (or an options
 *  object) only when you are NOT re-labelling the result. (See /ai/figure.md.) */
function assembleFace(sdf: SdfApi, head: Node, rig: Rig, opts?: unknown): Node {
  const o = obj(opts, 'face.assemble(opts)');
  assertNoUnknownKeys(o, ['eyes', 'nose', 'mouth', 'ears', 'brows'], 'face.assemble(opts)');
  const crease = rig.r.head * 0.12;
  let result = head;
  if (o.nose !== false) result = result.smoothUnion(buildNose(sdf, rig, o.nose === true ? undefined : o.nose), crease);
  if (o.brows !== false && o.brows !== undefined) result = result.smoothUnion(buildBrows(sdf, rig, o.brows === true ? undefined : o.brows), crease);
  if (o.ears !== false) result = result.smoothUnion(buildEars(sdf, rig, o.ears === true ? undefined : o.ears), crease * 1.5);
  if (o.mouth !== false) {
    const mouth = buildMouthPart(sdf, rig, o.mouth === true ? undefined : o.mouth);
    result = mouth.mode === 'add'
      ? result.smoothUnion(mouth.node, crease * 0.7)
      : result.smoothSubtract(mouth.node, crease * 0.5);
  }
  // Eyes default OFF (see docstring): only build them when explicitly opted in,
  // so the canonical weld-then-`.label('skin')` flow can't silently flatten the
  // eye paint labels. `eyes: true` or `eyes: { … }` opts in.
  if (o.eyes !== undefined && o.eyes !== false) {
    result = result.union(buildEyes(sdf, rig, o.eyes === true ? undefined : o.eyes));
  }
  return result;
}

/** The face's detail spheres for `build({ detail: F.faceDetail(rig) })` —
 *  returns an ARRAY: a head sphere (features, ears, chin, hairline) at an
 *  edge length scaled to the head, plus a much finer MOUTH sphere — the
 *  carved smile groove / mouth opening is the smallest face feature and
 *  reads pixelated at the head-wide target. The body keeps the cheap global
 *  grid either way. */
function faceDetail(rig: Rig, opts?: unknown): Array<{ center: Vec3; radius: number; edgeLength: number }> {
  const o = obj(opts, 'faceDetail(opts)');
  assertNoUnknownKeys(o, ['radius', 'edgeLength', 'mouthEdgeLength'], 'faceDetail(opts)');
  const r = rig.r;
  const radius = num(o.radius, Math.max(r.headX, r.head, r.headZ) * 1.5, 'faceDetail.radius', 1e-3);
  // ~4.5% of the head radius ≈ one subdivision round below the recommended
  // 0.4–0.6 figure grid — smooth features at ~3-4× the head's coarse triangle
  // count. Halve it (e.g. r.head * 0.02) for a final extra-fine pass.
  const edgeLength = num(o.edgeLength, Math.max(r.head * 0.045, 0.05), 'faceDetail.edgeLength', 1e-4);
  const mouthEdgeLength = num(o.mouthEdgeLength, Math.max(r.head * 0.02, 0.03), 'faceDetail.mouthEdgeLength', 1e-4);
  return [
    { center: [...(rig.joints.head as Vec3)] as Vec3, radius, edgeLength },
    { center: [...(rig.face.mouth as Vec3)] as Vec3, radius: r.head * 0.55, edgeLength: mouthEdgeLength },
  ];
}

// --- Hair -----------------------------------------------------------------

function buildHair(sdf: SdfApi, rig: Rig, opts?: unknown): Node {
  const o = obj(opts, 'hair(opts)');
  assertNoUnknownKeys(o, ['style', 'thickness', 'hairline'], 'hair(opts)');
  const style = o.style === undefined ? 'short'
    : assertEnum(o.style, ['short', 'long', 'bun', 'bald', 'bangs', 'ponytail'] as const, 'hair.style');
  // bald = no hair. Return a sub-cell sphere AT the head centre (not parked at
  // z ≈ −1e6): it meshes to nothing on any real grid and is swallowed inside
  // the skull in a figure union, but its `bounds()` stays at the head — so
  // `F.placeAt(baldHair, …)` and any bbox-driven composition still work,
  // instead of snapping to a point a million units below the model.
  if (style === 'bald') return sdf.sphere(1e-3).translate(rig.joints.head as Vec3);
  // Hairline height = where the face window's top edge sits. 'low' brings the
  // hair down to the brows (the bangs default), 'high' shows more forehead.
  const hairline = o.hairline === undefined ? (style === 'bangs' ? 'low' : 'mid')
    : assertEnum(o.hairline, ['high', 'mid', 'low'] as const, 'hair.hairline');
  const r = rig.r, c = rig.joints.head as Vec3;
  const f = rig.dir.headForward, u = rig.dir.headUp, right = rig.dir.headLeft;
  const t = num(o.thickness, r.head * 0.12, 'hair.thickness', 0.01);
  // Skull cap: a slightly enlarged ellipsoid pushed back, covering all but
  // the face front.
  let cap = sdf.ellipsoid(r.headX + t, r.head + t, r.headZ + t)
    .translate(add3(c, add3(scale3(f, -t * 0.6), scale3(u, t * 0.4))));
  if (style === 'long') {
    const back = add3(c, add3(scale3(f, -r.headZ * 0.4), scale3(u, -r.head * 1.6)));
    const mane = sdf.ellipsoid(r.headX * 1.05, r.head * 0.7, r.head * 1.7).translate(back);
    cap = cap.smoothUnion(mane, r.head * 0.5);
  } else if (style === 'bun') {
    const bun = sdf.sphere(r.head * 0.55).translate(add3(c, add3(scale3(f, -r.headZ * 0.7), scale3(u, r.head * 0.9))));
    cap = cap.smoothUnion(bun, r.head * 0.3);
  } else if (style === 'bangs') {
    // A straight fringe: a wide slab rooted in the cap, hanging over the
    // forehead. The face window (lowered to the brows by the 'low' hairline
    // default) trims its bottom edge into a clean straight-ish line.
    const fringe = sdf.ellipsoid(r.headX * 0.85, r.headZ * 0.5, r.headZ * 0.42)
      .translate(add3(c, add3(scale3(f, r.headZ * 0.55), scale3(u, r.headZ * 0.6))));
    cap = cap.smoothUnion(fringe, r.head * 0.25);
  } else if (style === 'ponytail') {
    // Gathered anchor high on the back of the skull + a tapered tail swinging
    // down. Segments chain anchor→mid→tip so the tail curves, and each
    // segment shares its joint point — always one welded piece.
    const anchor = add3(c, add3(scale3(f, -r.headZ * 0.7), scale3(u, r.headZ * 0.55)));
    const mid = add3(anchor, add3(scale3(f, -r.head * 0.28), scale3(u, -r.head * 0.85)));
    const tip = add3(mid, add3(scale3(f, r.head * 0.08), scale3(u, -r.head * 0.95)));
    const tail = sdf.sphere(r.head * 0.4).translate(anchor)
      .smoothUnion(sdf.capsule(anchor, mid, r.head * 0.3), r.head * 0.25)
      .smoothUnion(sdf.capsule(mid, tip, r.head * 0.2), r.head * 0.22);
    cap = cap.smoothUnion(tail, r.head * 0.25);
  }
  void right;
  // Face window: the cap overlaps the face INTERIOR, and since hair is its
  // own labelled region it survives the skin's mouth/feature carves — a
  // carved smile then exposes pale hair volume inside its corners ("nub
  // teeth"). Carve the face zone out of the hair so only skin lives there.
  // The hairline option slides the window's top edge: 'mid' sits above the
  // brows (the cartoon hairline), 'low' lands ON the brow line (bangs),
  // 'high' opens the forehead. Sides keep the temples framed.
  const drop = hairline === 'low' ? -r.headZ * 0.25 : hairline === 'high' ? r.headZ * 0.15 : 0;
  const windowC = add3(c, add3(scale3(f, r.headZ * 0.9), scale3(u, -r.headZ * 0.2 + drop)));
  const faceWindow = orientToHeadPose(
    sdf.ellipsoid(r.headX * 0.72, r.headZ * 0.75, r.headZ * 0.85), rig,
  ).translate(windowC);
  return cap.subtract(faceWindow);
}

// --- Clothing (derived from body regions → always fits) -------------------

function buildPants(sdf: SdfApi, rig: Rig, opts?: unknown): Node {
  const o = obj(opts, 'pants(opts)');
  assertNoUnknownKeys(o, ['rise', 'leg', 'cuffZ', 'thickness', 'length'], 'pants(opts)');
  const leg = o.leg === undefined ? 'slim' : assertEnum(o.leg, ['slim', 'cargo'] as const, 'pants.leg');
  const rise = o.rise === undefined ? 'mid' : assertEnum(o.rise, ['low', 'mid', 'high'] as const, 'pants.rise');
  const length = o.length === undefined ? 'full' : assertEnum(o.length, ['full', 'briefs'] as const, 'pants.length');
  const j = rig.joints, r = rig.r;
  // Generous default: the knee weld bulge exceeds a thin shell and pokes
  // through as a bare-skin patch on bent legs.
  const t = num(o.thickness, r.upperLeg * 0.3, 'pants.thickness', 0.01);
  const cuffZ = o.cuffZ === undefined ? undefined : num(o.cuffZ, 0, 'pants.cuffZ');
  const flare = leg === 'cargo' ? 1.35 : 1.08;
  const waistZ = rise === 'high' ? j.spine[2] : rise === 'low' ? j.hips[2] : mix(j.hips[2], j.spine[2], 0.5);

  // The cuff must sit ON the knee→ankle bone — a fixed world-Z endpoint pulls
  // the pant shank off a posed leg (a lunge's diagonal shank ends up wearing a
  // capsule that points somewhere else entirely). `cuffZ` is interpreted as a
  // target height projected onto each leg's own bone.
  function cuffPoint(K: Vec3, A: Vec3): Vec3 {
    if (cuffZ === undefined) {
      // Default: cuff ends 1.5 shank-radii above the ankle, along the bone.
      const len = len3([A[0] - K[0], A[1] - K[1], A[2] - K[2]]);
      return lerp3(K, A, len > 1e-6 ? Math.max(0.3, 1 - (r.lowerLeg * 1.5) / len) : 1);
    }
    const segZ = K[2] - A[2];
    if (Math.abs(segZ) < 1e-6) return lerp3(K, A, 0.85); // near-horizontal shank: height is meaningless
    const frac = (K[2] - cuffZ) / segZ;
    return lerp3(K, A, Math.min(1, Math.max(0.15, frac)));
  }

  function legSleeve(Hj: Vec3, K: Vec3, A: Vec3): Node {
    // Trim the leg above the cuff: build inflated capsules from waist height
    // down to the cuff.
    const top: Vec3 = [Hj[0], Hj[1], waistZ];
    const thighS = sdf.capsule(top, K, (r.upperLeg + t) * flare);
    const shankS = sdf.capsule(K, cuffPoint(K, A), (r.lowerLeg + t) * flare);
    // Knee pad: the skin's knee weld (k = r.lowerLeg*1.3) bulges past both
    // capsule radii on a bent knee — a sphere at the joint guarantees cover
    // at any bend angle.
    const knee = sdf.sphere((r.lowerLeg * 1.1 + t) * 1.18).translate(K);
    return thighS.smoothUnion(shankS, r.lowerLeg * 1.4).smoothUnion(knee, r.lowerLeg * 0.9);
  }
  // Seat: tall enough to reach DOWN past the crotch line (a short seat leaves
  // a bare wedge of groin between the leg sleeves), plus an explicit hip-to-
  // hip gusset filling the inner-thigh wedge in any stance.
  const seat = sdf.ellipsoid((r.hipsX + t) * 1.05, (r.hipsY + t) * 1.05, r.hipsY * 1.8)
    .translate([0, 0, mix(j.hips[2], waistZ, 0.4)]);
  const gusset = sdf.capsule(j.upperLegL as Vec3, j.upperLegR as Vec3, (r.upperLeg + t) * 0.85);
  // Hip pads: a flexed hip's skin weld bulge (thigh⊔pelvis) escapes between
  // the seat and the leaning thigh sleeve. The bulge zone runs from the hip
  // joint down the upper thigh, so cover it with a capsule along the bone.
  const hipPad = (Hj: Vec3, K: Vec3): Node =>
    sdf.capsule(Hj, lerp3(Hj, K, length === 'briefs' ? 0.3 : 0.45), (r.upperLeg + t) * 1.22);

  // --- Guaranteed-coverage underlayer (additive, never subtractive) ------
  // "Clothing = the body region inflated and trimmed": the actual body masses,
  // offset outward by `t` and clipped to the garment zone. A body cannot poke
  // through its OWN offset, so wherever the zone overlaps skin is covered — the
  // structural fix for the bare-skin patches the shaped capsules above only
  // *approximate* (flexed-hip and knee weld bulges most of all). It is unioned
  // UNDER the shape, so it only ADDS coverage: the shaped capsules stay the
  // visible silhouette and keep the clean bone-aligned cuff. The zone stops
  // above the lower shank, so the shaped cuff — not a fat offset cap reaching
  // the foot — defines the hem.
  const body = buildTorso(sdf, rig).union(buildLegs(sdf, rig)).round(t);
  const big = Math.max(r.hipsX, r.chestX, r.upperLeg) * 8;
  const underWaist = sdf.box([big, big, big]).translate([0, 0, waistZ - big / 2]); // z ≤ waistZ
  const seatBot = j.upperLegL[2] - r.upperLeg;
  const seatZone = sdf.box([big, big, waistZ - seatBot]).translate([0, 0, (waistZ + seatBot) / 2]);
  const legZone = (Hj: Vec3, K: Vec3): Node =>
    sdf.capsule(Hj, K, (r.upperLeg + t) * 1.8).union(sdf.sphere((r.lowerLeg + t) * 1.9).translate(K));
  let zone = seatZone;
  if (length !== 'briefs') {
    zone = zone.union(legZone(j.upperLegL as Vec3, j.lowerLegL as Vec3)).union(legZone(j.upperLegR as Vec3, j.lowerLegR as Vec3));
  }
  const coverage = body.intersect(zone.intersect(underWaist));

  // briefs: seat + gusset + hip pads only — leotard bottoms, swimwear.
  if (length === 'briefs') {
    return seat
      .smoothUnion(gusset, r.upperLeg * 0.8)
      .smoothUnion(hipPad(j.upperLegL as Vec3, j.lowerLegL as Vec3), r.upperLeg * 0.8)
      .smoothUnion(hipPad(j.upperLegR as Vec3, j.lowerLegR as Vec3), r.upperLeg * 0.8)
      .union(coverage);
  }
  // Seat↔sleeve welds must be at least as soft as the body's hip weld — a
  // flexed hip's skin bulge pokes through a tighter garment weld.
  let pants = seat
    .smoothUnion(gusset, r.upperLeg * 0.8)
    .smoothUnion(hipPad(j.upperLegL as Vec3, j.lowerLegL as Vec3), r.upperLeg * 0.8)
    .smoothUnion(hipPad(j.upperLegR as Vec3, j.lowerLegR as Vec3), r.upperLeg * 0.8)
    .smoothUnion(legSleeve(j.upperLegL as Vec3, j.lowerLegL as Vec3, j.footL as Vec3), r.upperLeg * 1.2)
    .smoothUnion(legSleeve(j.upperLegR as Vec3, j.lowerLegR as Vec3, j.footR as Vec3), r.upperLeg * 1.2);
  if (leg === 'cargo') {
    const pkt = (side: number): Node => sdf.roundedBox([r.upperLeg * 0.9, r.upperLeg * 0.4, r.upperLeg * 1.4], r.upperLeg * 0.18)
      .translate([side * (r.upperLeg + t) * 1.15, -r.upperLeg * 0.2, mix(j.lowerLegL[2], j.upperLegL[2], 0.5)]);
    pants = pants.smoothUnion(pkt(+1), r.upperLeg * 0.25).smoothUnion(pkt(-1), r.upperLeg * 0.25);
  }
  return pants.union(coverage);
}

function buildTop(sdf: SdfApi, rig: Rig, opts?: unknown): Node {
  const o = obj(opts, 'top(opts)');
  assertNoUnknownKeys(o, ['sleeve', 'hemZ', 'thickness'], 'top(opts)');
  const sleeve = o.sleeve === undefined ? 'short' : assertEnum(o.sleeve, ['none', 'short', 'long'] as const, 'top.sleeve');
  const j = rig.joints, r = rig.r;
  // Generous default: body weld bulges (belly/pelvis joins) exceed a thin
  // shell on slim builds and poke through as bare-skin patches.
  const t = num(o.thickness, r.chestY * 0.3, 'top(thickness)', 0.01);
  // Default hem reaches BELOW the navel so it overlaps a mid-rise waistband —
  // the old navel-height hem left a bare midriff strip above the pants.
  const hemZ = num(o.hemZ, mix(j.hips[2], j.spine[2], 0.3), 'top.hemZ');
  // Torso shell from shoulders to hem, centred on the body's actual chest
  // line (the chest mass sits FORWARD of x/z axis at j.chest[1]; a garment
  // centred at y=0 lets the chest bulge straight through its front).
  const chest = sdf.ellipsoid(r.chestX + t, (r.chestY + t) * 1.05, (j.chest[2] - hemZ) * 0.62 + r.chestY)
    .translate([0, j.chest[1], mix(hemZ, j.chest[2] + r.chestY, 0.5)]);
  let top = chest;
  // A hem below the pelvis means a robe/dress — the chest ELLIPSOID recedes
  // toward its bottom tip, so legs poke out of its lower front. Add a flared
  // cone skirt from the waist down to the hem.
  if (hemZ < j.hips[2] - r.hipsY * 0.6) {
    const skirtH = j.spine[2] - hemZ;
    const r0 = Math.max(r.hipsX, r.chestX) + t;
    const skirt = sdf.cylinder(r0, skirtH)
      .taper(-0.8 / skirtH)
      .translate([0, 0, hemZ + skirtH / 2]);
    top = top.smoothUnion(skirt, r.chestY * 0.8);
  }
  if (sleeve !== 'none') {
    // Sleeves FOLLOW the arm chain: a straight shoulder→forearm capsule cuts
    // the corner on a bent elbow and the elbow pokes through the sleeve.
    function sl(S: Vec3, E: Vec3, W: Vec3): Node {
      const rad = (r.upperArm + t) * 1.05;
      if (sleeve === 'short') {
        return sdf.capsule(S, lerp3(S, E, 0.85), rad);
      }
      // long: upper-arm segment + forearm segment, welded at the elbow.
      return sdf.capsule(S, E, rad)
        .smoothUnion(sdf.capsule(E, lerp3(E, W, 0.9), rad * 0.95), r.lowerArm * 0.8);
    }
    // Shoulder yokes: spheres over the shoulder joints bridging the chest
    // shell and the sleeve tops. Without them a wedge of skin shows at the
    // armpit/collar where the shell's side ends inboard of the shoulder.
    const yoke = (S: Vec3): Node => sdf.sphere((r.upperArm + t) * 1.2).translate(S);
    top = top
      .smoothUnion(sl(j.upperArmL as Vec3, j.lowerArmL as Vec3, j.wristL as Vec3), r.upperArm * 0.7)
      .smoothUnion(sl(j.upperArmR as Vec3, j.lowerArmR as Vec3, j.wristR as Vec3), r.upperArm * 0.7)
      .smoothUnion(yoke(j.upperArmL as Vec3), r.upperArm * 0.8)
      .smoothUnion(yoke(j.upperArmR as Vec3), r.upperArm * 0.8);
  }
  // Clavicle bar: the chest ellipsoid's front-top slopes away below the
  // collarbones, leaving a deep bare V at the sternum. A shoulder-to-shoulder
  // capsule on the chest line closes the neckline into a crew collar.
  const S_L = j.upperArmL as Vec3, S_R = j.upperArmR as Vec3;
  const clav = sdf.capsule(
    [S_L[0] * 0.92, j.chest[1], S_L[2]],
    [S_R[0] * 0.92, j.chest[1], S_R[2]],
    (r.neck + t) * 0.85,
  );

  // --- Guaranteed-coverage underlayer (additive — see buildPants) --------
  // The torso (+ arms when sleeved), offset by `t` and clipped to the garment
  // zone, unioned UNDER the shaped shell. It fills the spots the shaped
  // ellipsoid/sleeves only approximate — the sternum V, the armpit wedge, and
  // belly/pelvis weld bulges on slim builds — with a body offset that can't be
  // poked through. No legs in the masses, so a dress hem stays the cone skirt's
  // job; a sleeveless top excludes the arms so it stays bare-shouldered.
  const masses = sleeve === 'none' ? buildTorso(sdf, rig) : buildTorso(sdf, rig).union(buildArms(sdf, rig));
  const body = masses.round(t);
  const big = Math.max(r.chestX, r.upperArm) * 8;
  const torsoTop = j.upperArmL[2] + r.upperArm;
  let zone = sdf.box([big, big, torsoTop - hemZ]).translate([0, 0, (torsoTop + hemZ) / 2]);
  if (sleeve !== 'none') {
    const slZone = (S: Vec3, E: Vec3, W: Vec3): Node => {
      const rad = (r.upperArm + t) * 1.8;
      if (sleeve === 'short') return sdf.capsule(S, lerp3(S, E, 0.85), rad);
      return sdf.capsule(S, E, rad).union(sdf.capsule(E, lerp3(E, W, 0.9), rad));
    };
    zone = zone
      .union(slZone(j.upperArmL as Vec3, j.lowerArmL as Vec3, j.wristL as Vec3))
      .union(slZone(j.upperArmR as Vec3, j.lowerArmR as Vec3, j.wristR as Vec3));
  }
  return top.smoothUnion(clav, r.neck * 0.9).union(body.intersect(zone));
}

// --- Body weld ------------------------------------------------------------

/** Smooth-weld the major body masses with one rig-derived soft k. Face
 *  features keep their crisp creases (they were welded in assembleFace). */
function weldBody(rig: Rig, parts: unknown, opts?: unknown): Node {
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new ValidationError('figure.weld(rig, parts): `parts` must be a non-empty array of SDF nodes.');
  }
  const o = obj(opts, 'weld(opts)');
  assertNoUnknownKeys(o, ['k'], 'weld(opts)');
  const k = num(o.k, Math.min(rig.r.lowerArm, rig.r.neck) * 0.85, 'weld.k', 1e-4);
  let acc = parts[0] as Node;
  for (let i = 1; i < parts.length; i++) acc = acc.smoothUnion(parts[i] as Node, k);
  return acc;
}

// --- Public namespace -----------------------------------------------------

export interface FigureNamespace {
  rig(opts?: RigOptions): Rig;
  torso(rig: Rig, opts?: object): Node;
  neck(rig: Rig, opts?: object): Node;
  arms(rig: Rig, opts?: object): Node;
  hands(rig: Rig, opts?: object): Node;
  legs(rig: Rig, opts?: object): Node;
  feet(rig: Rig, opts?: object): Node;
  head(rig: Rig, opts?: object): Node;
  base(rig: Rig, opts?: object): Node;
  /** Ground a figure so its feet stand on one plane (the footwear-sole ↔ surface
   *  connection). Returns a NEW rig — build feet/footwear/base from it. `mode`:
   *  `'plant'` levels near-plane feet onto it (lifts the rest); `'drop'` re-poses
   *  legs (2-bone IK) so every foot lands. Plane = `z`, else top of `surface`,
   *  else the lowest foot. */
  ground(rig: Rig, opts?: object): Rig;
  hair(rig: Rig, opts?: object): Node;
  weld(rig: Rig, parts: Node[], opts?: object): Node;
  /** Snap an accessory node to a rig joint by its bbox anchor (no offset math).
   *  `joint` is a Vec3 like `rig.joints.crown`; `opts.anchor` ∈ center|bottom|top. */
  placeAt(node: Node, joint: Vec3, opts?: object): Node;
  /** Seat + orient a held prop into a hand grip frame (`rig.grip.L`/`.R`).
   *  Aligns the prop's local long axis (`opts.along`, default 'z') to the grip
   *  axis and drops its origin on the grip point. `opts.flip` reverses it. */
  holdAt(node: Node, grip: GripFrame, opts?: object): Node;
  /** The line spanning TWO grips (or two points) for a prop held in both hands
   *  — guitar, barbell, bow, broom. Returns the {@link SpanFrame} (endpoints,
   *  unit axis, length, midpoint) so `sdf.capsule(s.a, s.b, r)` is one line. */
  spanGrips(a: GripFrame | Vec3, b: GripFrame | Vec3): SpanFrame;
  /** Seat a node UNDER a foot at its {@link SoleFrame} (`rig.sole.L`/`.R`) — a
   *  skate, platform, ski, snowshoe, or a per-foot base. The foot analog of
   *  `holdAt`: drops the node's bbox anchor on the sole's ground-contact point
   *  (`opts.anchor` ∈ top|center|bottom, default 'top' so the prop hangs below
   *  the foot). Accepts a sole frame or a raw `[x,y,z]` point. */
  standOn(node: Node, sole: SoleFrame | Vec3, opts?: object): Node;
  /** Deterministic world-coordinate dump of the rig's joints, grip frames, and
   *  directions (rounded) plus a `.text` summary — use instead of hand-rolled
   *  JSON scratch probes when authoring a pose. */
  poseProbe(rig: Rig): { height: number; headsTall: number; build: string; sex: string; joints: Record<string, Vec3>; grips: { L: GripFrame; R: GripFrame }; soles: { L: SoleFrame; R: SoleFrame }; dir: Record<string, Vec3>; text: string };
  /** The face's detail-region spheres (head + finer mouth) for
   *  `build({ detail: F.faceDetail(rig) })`. */
  faceDetail(rig: Rig, opts?: object): Array<{ center: Vec3; radius: number; edgeLength: number }>;
  /** Detail spheres over both hands — required for sculpted fingers:
   *  `build({ detail: [...F.faceDetail(rig), ...F.handDetail(rig)] })`. */
  handDetail(rig: Rig, opts?: object): Array<{ center: Vec3; radius: number; edgeLength: number }>;
  face: {
    eyes(rig: Rig, opts?: object): Node;
    nose(rig: Rig, opts?: object): Node;
    mouth(rig: Rig, opts?: object): Node;
    /** Pre-labelled paintable mouth parts (teeth band, lip ring / ridge)
     *  to hard-union at the figure's top level. */
    mouthAccents(rig: Rig, opts?: object): Node;
    ears(rig: Rig, opts?: object): Node;
    brows(rig: Rig, opts?: object): Node;
    assemble(head: Node, rig: Rig, opts?: object): Node;
  };
  clothing: {
    pants(rig: Rig, opts?: object): Node;
    top(rig: Rig, opts?: object): Node;
    shoes(rig: Rig, opts?: object): Node;
    boots(rig: Rig, opts?: object): Node;
  };
}

/** Translate an SDF node so its bounding-box anchor lands at `joint`. Removes
 *  the center-vs-base offset guesswork when snapping accessories (hat, staff,
 *  tutu, sword) to a rig landmark like `rig.joints.crown` or `rig.joints.handR`.
 *  `anchor` selects which point of the node maps to the joint: 'bottom' (min Z,
 *  e.g. a hat resting on the crown), 'top' (max Z), or 'center' (default). */
function placeAt(node: Node, joint: Vec3, opts?: unknown): Node {
  const o = obj(opts, 'placeAt(opts)');
  assertNoUnknownKeys(o, ['anchor'], 'placeAt(opts)');
  const anchor = o.anchor === undefined ? 'center'
    : assertEnum(o.anchor, ['center', 'bottom', 'top'] as const, 'placeAt.anchor');
  const j = (assertNumberTuple(joint, 3, 'placeAt(joint)')) as Vec3;
  const b = node.bounds();
  const cx = (b.min[0] + b.max[0]) / 2;
  const cy = (b.min[1] + b.max[1]) / 2;
  const cz = anchor === 'bottom' ? b.min[2] : anchor === 'top' ? b.max[2] : (b.min[2] + b.max[2]) / 2;
  return node.translate([j[0] - cx, j[1] - cy, j[2] - cz]);
}

/** Seat a node under a foot at its {@link SoleFrame} ground-contact point — the
 *  foot analog of `holdAt`. Drops the node's bbox anchor on `sole.point` so an
 *  agent never guesses the sole Z: `anchor: 'top'` (default) lands the node's TOP
 *  on the sole, hanging it below the foot (skate, platform, ski); 'bottom' rests
 *  the node ON the sole point; 'center' centres it. Accepts a sole frame
 *  (`rig.sole.L/R`) or a raw `[x,y,z]`. */
function standOn(node: Node, sole: unknown, opts?: unknown): Node {
  const o = obj(opts, 'standOn(opts)');
  assertNoUnknownKeys(o, ['anchor'], 'standOn(opts)');
  const anchor = o.anchor === undefined ? 'top'
    : assertEnum(o.anchor, ['center', 'bottom', 'top'] as const, 'standOn.anchor');
  const p = asPoint3(sole, 'standOn(sole)');
  const b = node.bounds();
  const cx = (b.min[0] + b.max[0]) / 2;
  const cy = (b.min[1] + b.max[1]) / 2;
  const cz = anchor === 'bottom' ? b.min[2] : anchor === 'top' ? b.max[2] : (b.min[2] + b.max[2]) / 2;
  return node.translate([p[0] - cx, p[1] - cy, p[2] - cz]);
}

/** Euler [rx, ry, 0] (degrees) that rotates the local +Z axis onto unit `t`,
 *  given the engine's Rz·Ry·Rx convention (see opRotate in sdf.ts). Derived:
 *  with rz=0, R·[0,0,1] = [cx·sy, −sx, cx·cy], so sx=−ty and (sy,cy)∝(tx,tz). */
function eulerAlignZ(t: Vec3): Vec3 {
  const ty = Math.max(-1, Math.min(1, t[1]));
  return [-Math.asin(ty) / DEG, Math.atan2(t[0], t[2]) / DEG, 0];
}

/** Seat and orient a held prop into a hand's grip frame. Aligns the prop's local
 *  long axis (`opts.along`, default +Z) to `grip.gripAxis`, then drops its local
 *  origin onto `grip.point`. Build the prop centred at the origin along its axis
 *  and holdAt lays it across the closed fingers — fixing the "passes through the
 *  hand" / "crooked" failure of aiming a prop at the hand centre by hand. Pass
 *  `flip: true` to reverse the axis direction. */
function holdAt(node: Node, grip: unknown, opts?: unknown): Node {
  const g = obj(grip, 'holdAt(grip)');
  const point = assertNumberTuple(g.point, 3, 'holdAt(grip.point)') as Vec3;
  let axis = norm3(assertNumberTuple(g.gripAxis, 3, 'holdAt(grip.gripAxis)') as Vec3);
  const o = obj(opts, 'holdAt(opts)');
  assertNoUnknownKeys(o, ['along', 'flip'], 'holdAt(opts)');
  const along = o.along === undefined ? 'z'
    : assertEnum(o.along, ['x', 'y', 'z'] as const, 'holdAt.along');
  if (o.flip !== undefined && typeof o.flip !== 'boolean') {
    throw new ValidationError('holdAt.flip must be a boolean');
  }
  if (o.flip === true) axis = scale3(axis, -1);
  // Bring the chosen local axis onto +Z first, then align +Z to the grip axis.
  let n = node;
  if (along === 'x') n = n.rotate([0, -90, 0]);      // local +X → +Z
  else if (along === 'y') n = n.rotate([90, 0, 0]);   // local +Y → +Z
  return n.rotate(eulerAlignZ(axis)).translate(point);
}

/** Coerce a grip frame ({@link GripFrame}, uses `.point`) or a raw `[x,y,z]`
 *  point into a world Vec3 — so `spanGrips` accepts both `rig.grip.L` and any
 *  joint like `rig.joints.handR`. */
function asPoint3(v: unknown, name: string): Vec3 {
  if (v && typeof v === 'object' && !Array.isArray(v) && 'point' in (v as object)) {
    return assertNumberTuple((v as { point: unknown }).point, 3, `${name}.point`) as Vec3;
  }
  return assertNumberTuple(v, 3, name) as Vec3;
}

/** The two-anchor place helper: the line spanning two grips (or two points).
 *  `holdAt` orients a prop to ONE hand; a guitar / barbell / bow / broom runs
 *  between BOTH, which until now meant hand-deriving the axis and length from
 *  `grip.L.point` / `grip.R.point`. `spanGrips(a, b)` returns that {@link
 *  SpanFrame} — endpoints, unit axis, length, midpoint — so the spanning bar is
 *  `sdf.capsule(span.a, span.b, r)` and anything growing off an end (a guitar
 *  body at `a`, a headstock past `b`) keys off the same frame. Accepts grip
 *  frames or raw `[x,y,z]` points on either side. */
function spanGrips(a: unknown, b: unknown): SpanFrame {
  const pa = asPoint3(a, 'spanGrips(a)');
  const pb = asPoint3(b, 'spanGrips(b)');
  const d = sub3(pb, pa);
  const length = len3(d);
  return {
    a: pa,
    b: pb,
    axis: length > 0 ? scale3(d, 1 / length) : [0, 0, 1],
    length,
    mid: scale3(add3(pa, pb), 0.5),
  };
}

/** Round a Vec3 to `p` decimals for a readable probe dump. */
function round3(v: Vec3, p = 2): Vec3 {
  const m = 10 ** p;
  return [Math.round(v[0] * m) / m, Math.round(v[1] * m) / m, Math.round(v[2] * m) / m];
}

/** Deterministic world-coordinate dump of a rig's joints, grip frames, and key
 *  directions — the first-class replacement for hand-rolled
 *  `throw new Error(JSON.stringify(...))` scratch probes when authoring a pose.
 *  Returns a structured object (rounded for readability) plus a `.text`
 *  multi-line summary; `throw new Error(F.poseProbe(rig).text)` (or
 *  `console.log`) surfaces every joint + grip without forgetting one. */
function poseProbe(rig: Rig): {
  height: number; headsTall: number; build: string; sex: string;
  joints: Record<string, Vec3>; grips: { L: GripFrame; R: GripFrame };
  soles: { L: SoleFrame; R: SoleFrame }; dir: Record<string, Vec3>; text: string;
} {
  const joints: Record<string, Vec3> = {};
  for (const k of Object.keys(rig.joints)) joints[k] = round3(rig.joints[k]);
  const dir: Record<string, Vec3> = {};
  for (const k of Object.keys(rig.dir)) dir[k] = round3(rig.dir[k]);
  const grip = (g: GripFrame): GripFrame => ({
    point: round3(g.point), palmNormal: round3(g.palmNormal),
    gripAxis: round3(g.gripAxis), reach: round3(g.reach),
  });
  const grips = { L: grip(rig.grip.L), R: grip(rig.grip.R) };
  const soleR = (s: SoleFrame): SoleFrame => ({
    point: round3(s.point), normal: round3(s.normal), heading: round3(s.heading),
    length: Math.round(s.length * 100) / 100, width: Math.round(s.width * 100) / 100,
    groundZ: Math.round(s.groundZ * 100) / 100,
  });
  const soles = { L: soleR(rig.sole.L), R: soleR(rig.sole.R) };
  const o = rig.opts;
  const lines: string[] = [
    `figure poseProbe — height ${o.height}, headsTall ${o.headsTall}, build ${o.build}, sex ${o.sex}`,
    'joints:',
    ...Object.keys(joints).map(k => `  ${k}: [${joints[k].join(', ')}]`),
    'grips:',
    `  L.point [${grips.L.point.join(', ')}]  gripAxis [${grips.L.gripAxis.join(', ')}]`,
    `  R.point [${grips.R.point.join(', ')}]  gripAxis [${grips.R.gripAxis.join(', ')}]`,
    'soles:',
    `  L.point [${soles.L.point.join(', ')}]  heading [${soles.L.heading.join(', ')}]  groundZ ${soles.L.groundZ}`,
    `  R.point [${soles.R.point.join(', ')}]  heading [${soles.R.heading.join(', ')}]  groundZ ${soles.R.groundZ}`,
  ];
  return { height: o.height, headsTall: o.headsTall, build: o.build, sex: o.sex, joints, grips, soles, dir, text: lines.join('\n') };
}

function assertRig(rig: unknown, name: string): Rig {
  if (!rig || typeof rig !== 'object' || !('joints' in rig) || !('face' in rig)) {
    throw new ValidationError(`${name} must be a rig from api.sdf.figure.rig(...). See /ai/figure.md`);
  }
  return rig as Rig;
}

/** Build the `api.sdf.figure` namespace over a bound SDF namespace. */
export function createFigureNamespace(sdf: SdfApi): FigureNamespace {
  return {
    rig: (opts) => buildRig(opts),
    torso: (rig) => buildTorso(sdf, assertRig(rig, 'torso(rig)')),
    neck: (rig) => buildNeck(sdf, assertRig(rig, 'neck(rig)')),
    arms: (rig) => buildArms(sdf, assertRig(rig, 'arms(rig)')),
    hands: (rig, opts) => buildHands(sdf, assertRig(rig, 'hands(rig)'), opts),
    legs: (rig) => buildLegs(sdf, assertRig(rig, 'legs(rig)')),
    feet: (rig) => buildFeet(sdf, assertRig(rig, 'feet(rig)')),
    head: (rig) => buildHead(sdf, assertRig(rig, 'head(rig)')),
    base: (rig, opts) => buildBase(sdf, assertRig(rig, 'base(rig)'), opts),
    ground: (rig, opts) => groundRig(assertRig(rig, 'ground(rig)'), opts),
    hair: (rig, opts) => buildHair(sdf, assertRig(rig, 'hair(rig)'), opts),
    weld: (rig, parts, opts) => weldBody(assertRig(rig, 'weld(rig)'), parts, opts),
    placeAt: (node, joint, opts) => placeAt(node as Node, joint, opts),
    holdAt: (node, grip, opts) => holdAt(node as Node, grip, opts),
    spanGrips: (a, b) => spanGrips(a, b),
    standOn: (node, sole, opts) => standOn(node as Node, sole, opts),
    poseProbe: (rig) => poseProbe(assertRig(rig, 'poseProbe(rig)')),
    faceDetail: (rig, opts) => faceDetail(assertRig(rig, 'faceDetail(rig)'), opts),
    handDetail: (rig, opts) => handDetail(assertRig(rig, 'handDetail(rig)'), opts),
    face: {
      eyes: (rig, opts) => buildEyes(sdf, assertRig(rig, 'face.eyes(rig)'), opts),
      nose: (rig, opts) => buildNose(sdf, assertRig(rig, 'face.nose(rig)'), opts),
      mouth: (rig, opts) => buildMouth(sdf, assertRig(rig, 'face.mouth(rig)'), opts),
      mouthAccents: (rig, opts) => buildMouthAccents(sdf, assertRig(rig, 'face.mouthAccents(rig)'), opts),
      ears: (rig, opts) => buildEars(sdf, assertRig(rig, 'face.ears(rig)'), opts),
      brows: (rig, opts) => buildBrows(sdf, assertRig(rig, 'face.brows(rig)'), opts),
      assemble: (head, rig, opts) => assembleFace(sdf, head as Node, assertRig(rig, 'face.assemble(rig)'), opts),
    },
    clothing: {
      pants: (rig, opts) => buildPants(sdf, assertRig(rig, 'clothing.pants(rig)'), opts),
      top: (rig, opts) => buildTop(sdf, assertRig(rig, 'clothing.top(rig)'), opts),
      shoes: (rig, opts) => buildShoes(sdf, assertRig(rig, 'clothing.shoes(rig)'), opts),
      boots: (rig, opts) => buildBoots(sdf, assertRig(rig, 'clothing.boots(rig)'), opts),
    },
  };
}

/** @internal Exposed for unit tests. */
export const __figureTestables__ = { buildRig, buildMouthPart, buildMouthAccents, buildEyes, faceDetail, buildPants, buildShoes, buildBoots, buildBase, buildFeet, standOn, groundRig, buildHands, handDetail, buildHair };
