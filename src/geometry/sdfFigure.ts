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

interface JointPose { abduct: number; flex: number; elbow?: number; knee?: number; twist: number }
interface HeadPose { turn: number; tilt: number; nod: number }
interface SpinePose { lean: number; turn: number; side: number }

interface ResolvedPose {
  armL: JointPose; armR: JointPose;
  legL: JointPose; legR: JointPose;
  head: HeadPose; spine: SpinePose;
}

const ARM_FIELDS = ['abduct', 'flex', 'elbow', 'twist'];
const LEG_FIELDS = ['abduct', 'flex', 'knee', 'twist'];
const HEAD_FIELDS = ['turn', 'tilt', 'nod'];
const SPINE_FIELDS = ['lean', 'turn', 'side'];
const RIG_FIELDS = ['height', 'headsTall', 'build', 'pose'];
const POSE_FIELDS = ['arms', 'legs', 'armL', 'armR', 'legL', 'legR', 'head', 'spine'];

function parseArm(v: unknown, name: string, defAbduct: number): JointPose {
  const o = obj(v, name);
  assertNoUnknownKeys(o, ARM_FIELDS, name);
  return {
    abduct: num(o.abduct, defAbduct, `${name}.abduct`),
    flex: num(o.flex, 0, `${name}.flex`),
    elbow: num(o.elbow, 0, `${name}.elbow`, 0, 160),
    twist: num(o.twist, 0, `${name}.twist`),
  };
}
function parseLeg(v: unknown, name: string): JointPose {
  const o = obj(v, name);
  assertNoUnknownKeys(o, LEG_FIELDS, name);
  return {
    abduct: num(o.abduct, 6, `${name}.abduct`),
    flex: num(o.flex, 0, `${name}.flex`),
    knee: num(o.knee, 0, `${name}.knee`, 0, 150),
    twist: num(o.twist, 0, `${name}.twist`),
  };
}

/** Master proportion + pose object. Every part and landmark derives from it. */
export interface RigOptions {
  height?: number;
  headsTall?: number;
  build?: 'slim' | 'average' | 'stocky';
  pose?: {
    armL?: object; armR?: object; legL?: object; legR?: object;
    head?: object; spine?: object;
  };
}

export interface FaceAnchors {
  eyeL: Vec3; eyeR: Vec3; browL: Vec3; browR: Vec3;
  nose: Vec3; mouth: Vec3; earL: Vec3; earR: Vec3; chinTip: Vec3;
}

export interface Rig {
  joints: Record<string, Vec3>;
  /** Canonical radii / half-extents, in world units. */
  r: Record<string, number>;
  /** Unit directions for orienting parts. */
  dir: Record<string, Vec3>;
  /** Facial landmark world positions (derived; never hand-typed). */
  face: FaceAnchors;
  opts: { height: number; headsTall: number; build: string; pose: ResolvedPose };
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
      turn: num(headRaw.turn, 0, 'rig.pose.head.turn'),
      tilt: num(headRaw.tilt, 0, 'rig.pose.head.tilt'),
      nod: num(headRaw.nod, 0, 'rig.pose.head.nod'),
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

  // --- Widths / radii ----------------------------------------------------
  const shoulderHalfX = H * 0.108 * bw;
  const hipHalfX = H * 0.072 * bw;
  const r = {
    head: ryHead, headX: rxHead, headZ: rzHead,
    neck: H * 0.034 * bw,
    chestX: H * 0.105 * bw, chestY: H * 0.066 * bw,
    pelvisX: H * 0.086 * bw, pelvisY: H * 0.060 * bw,
    // The garment-fitting radius at the natural waist (rig.joints.navel) — use
    // this, not pelvisX (a leg-insertion radius), to size belts/skirts/tutus.
    waist: H * 0.082 * bw,
    upperArm: H * 0.034 * bw, foreArm: H * 0.028 * bw, hand: H * 0.042 * bw,
    thigh: H * 0.048 * bw, shank: H * 0.036 * bw, foot: H * 0.040 * bw,
  };

  // --- Arm FK ------------------------------------------------------------
  const upperArmLen = H * 0.165;
  const foreArmLen = H * 0.150;
  const fwd: Vec3 = [0, -1, 0];          // body front (−Y)

  function armChain(side: number, p: JointPose) {
    const S: Vec3 = [side * shoulderHalfX, 0, shoulderZ];
    // abduct: 0 = hanging down, 90 = straight out to the side, 180 = up.
    let dir: Vec3 = [side * Math.sin(p.abduct * DEG), 0, -Math.cos(p.abduct * DEG)];
    // flex: + brings the arm forward (−Y).
    dir = rotX(dir, -p.flex);
    dir = norm3(dir);
    const E = add3(S, scale3(dir, upperArmLen));
    // Elbow flexion curls the forearm in the plane of the upper arm. The hinge
    // ⟂ to (upperArm, front) gives an anatomical FORWARD curl at twist 0.
    let hinge = cross3(dir, fwd);
    if (len3(hinge) < 1e-4) hinge = [side, 0, 0];
    hinge = norm3(hinge);
    // `twist` (shoulder/forearm roll) rolls that curl plane about the upper-arm
    // axis — the DOF that lets a RAISED arm curl the fist UP (double-biceps) or
    // inward (ballet fifth) instead of only forward. Multiplying by `side`
    // keeps a symmetric `arms:{twist}` lifting both fists the same way.
    if (p.twist) hinge = norm3(rotAxis(hinge, dir, p.twist * side));
    const foreDir = norm3(rotAxis(dir, hinge, -(p.elbow ?? 0)));
    const W = add3(E, scale3(foreDir, foreArmLen));
    const handC = add3(W, scale3(foreDir, r.hand * 0.9));
    return { S, E, W, handC, dir, foreDir };
  }
  const aL = armChain(+1, pose.armL);
  const aR = armChain(-1, pose.armR);

  // --- Leg FK ------------------------------------------------------------
  const thighLen = hipZ - kneeZ;
  const shankLen = kneeZ - ankleZ;
  function legChain(side: number, p: JointPose) {
    const Hj: Vec3 = [side * hipHalfX, 0, hipZ];
    let dir: Vec3 = [side * Math.sin(p.abduct * DEG), 0, -Math.cos(p.abduct * DEG)];
    dir = rotX(dir, -p.flex);
    dir = norm3(dir);
    const K = add3(Hj, scale3(dir, thighLen));
    // Knee bends the shank backward (+Y) relative to the thigh.
    let hinge = cross3(dir, fwd);
    if (len3(hinge) < 1e-4) hinge = [side, 0, 0];
    hinge = norm3(hinge);
    const shankDir = norm3(rotAxis(dir, hinge, +(p.knee ?? 0)));
    const A = add3(K, scale3(shankDir, shankLen));
    return { Hj, K, A, dir, shankDir };
  }
  const lL = legChain(+1, pose.legL);
  const lR = legChain(-1, pose.legR);

  // --- Head frame + face anchors ----------------------------------------
  const headCenter: Vec3 = [0, 0, headCenterZ];
  // Head local frame: forward points −Y, rotated by head pose. `headLeft` is
  // the lateral axis pointing to the figure's LEFT (+X when facing −Y), so the
  // `L` anchors land on +X, matching the body's L/R convention.
  let hf: Vec3 = [0, -1, 0];
  hf = rotZ(hf, pose.head.turn);    // yaw
  hf = rotX(hf, pose.head.nod);     // nod
  hf = rotY(hf, pose.head.tilt);    // tilt
  hf = norm3(hf);
  const up: Vec3 = [0, 0, 1];
  const headLeft = norm3(cross3(up, hf));   // +X when facing −Y (figure's left)
  const headUp = norm3(cross3(hf, headLeft)); // +Z when upright

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

  return {
    joints: {
      pelvis: [0, 0, pelvisZ], navel: [0, -r.chestY * 0.4, navelZ], chest: [0, -r.chestY * 0.2, chestZ],
      neckBase: [0, 0, shoulderZ + neckLen * 0.2], headCenter, crown: [headCenter[0], headCenter[1], H], chin: [0, 0, chinZ],
      shoulderL: aL.S, elbowL: aL.E, wristL: aL.W, handL: aL.handC,
      shoulderR: aR.S, elbowR: aR.E, wristR: aR.W, handR: aR.handC,
      hipL: lL.Hj, kneeL: lL.K, ankleL: lL.A, hipR: lR.Hj, kneeR: lR.K, ankleR: lR.A,
    },
    r,
    dir: {
      upperArmL: aL.dir, foreArmL: aL.foreDir, upperArmR: aR.dir, foreArmR: aR.foreDir,
      thighL: lL.dir, shankL: lL.shankDir, thighR: lR.dir, shankR: lR.shankDir,
      headForward: hf, headUp, headLeft,
    },
    face,
    opts: { height: H, headsTall: N, build, pose },
  };
}

// --- Part builders --------------------------------------------------------
// Each takes the rig first and returns an unlabeled Node (the caller composes
// regions and labels the result, matching the paintByLabel flow).

function buildTorso(sdf: SdfApi, rig: Rig): Node {
  const j = rig.joints, r = rig.r;
  const chest = sdf.ellipsoid(r.chestX, r.chestY, (j.chest[2] - j.navel[2]) * 1.15 + r.chestY)
    .translate(j.chest);
  const belly = sdf.ellipsoid(r.chestX * 0.92, r.chestY * 0.94, (j.navel[2] - j.pelvis[2]) * 0.9 + r.chestY * 0.6)
    .translate([0, -r.chestY * 0.1, mix(j.navel[2], j.pelvis[2], 0.4)]);
  const pelvis = sdf.ellipsoid(r.pelvisX, r.pelvisY, r.pelvisY * 1.25).translate(j.pelvis);
  const k = r.chestY * 0.6;
  return chest.smoothUnion(belly, k).smoothUnion(pelvis, k);
}

function buildNeck(sdf: SdfApi, rig: Rig): Node {
  const j = rig.joints, r = rig.r;
  return sdf.capsule(j.chest as Vec3, add3(j.headCenter as Vec3, [0, 0, -r.headZ * 0.5]), r.neck);
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
  const k = r.foreArm * 1.3;             // elbow weld — soft, no kink
  function arm(S: Vec3, E: Vec3, W: Vec3): Node {
    const upper = tapered(sdf, S, E, r.upperArm, r.foreArm * 1.05, k);
    const fore = tapered(sdf, E, W, r.foreArm * 1.02, r.foreArm * 0.8, k);
    // Deltoid cap so the shoulder reads as a rounded mass, not a tube stub.
    const deltoid = sdf.sphere(r.upperArm * 1.15).translate(S);
    return upper.smoothUnion(fore, k).smoothUnion(deltoid, r.upperArm * 0.9);
  }
  const armL = arm(j.shoulderL as Vec3, j.elbowL as Vec3, j.wristL as Vec3);
  const armR = arm(j.shoulderR as Vec3, j.elbowR as Vec3, j.wristR as Vec3);
  return armL.union(armR);
}

function buildHands(sdf: SdfApi, rig: Rig, opts?: unknown): Node {
  const o = obj(opts, 'hands(opts)');
  assertNoUnknownKeys(o, ['grip'], 'hands(opts)');
  const grip = o.grip === undefined ? 'relaxed'
    : assertEnum(o.grip, ['fist', 'open', 'relaxed'] as const, 'hands.grip');
  const j = rig.joints, r = rig.r;
  function hand(c: Vec3, dir: Vec3): Node {
    if (grip === 'fist') return sdf.sphere(r.hand * 1.05).translate(c);
    if (grip === 'open') {
      // A flattened paddle aligned with the forearm.
      const palm = sdf.ellipsoid(r.hand * 0.55, r.hand * 1.2, r.hand * 0.9).translate(c);
      return palm;
    }
    // relaxed: a soft tapered blob
    const tip = add3(c, scale3(dir, r.hand * 1.1));
    return tapered(sdf, c, tip, r.hand * 0.95, r.hand * 0.6, r.hand * 0.5);
  }
  return hand(j.handL as Vec3, rig.dir.foreArmL).union(hand(j.handR as Vec3, rig.dir.foreArmR));
}

function buildLegs(sdf: SdfApi, rig: Rig): Node {
  const j = rig.joints, r = rig.r;
  const k = r.shank * 1.3;               // knee weld — soft, no kink
  function leg(Hj: Vec3, K: Vec3, A: Vec3): Node {
    const thigh = tapered(sdf, Hj, K, r.thigh, r.shank * 1.1, k);
    const shank = tapered(sdf, K, A, r.shank * 1.05, r.shank * 0.78, k);
    return thigh.smoothUnion(shank, k);
  }
  return leg(j.hipL as Vec3, j.kneeL as Vec3, j.ankleL as Vec3)
    .union(leg(j.hipR as Vec3, j.kneeR as Vec3, j.ankleR as Vec3));
}

/** The ground-contact Z of a foot, derived from its ankle. The foot FOLLOWS
 *  the ankle (one foot-radius below it) instead of being pinned to z=0, so a
 *  posed/elevated ankle (lunge, tiptoe) keeps the foot attached to the leg —
 *  no detached component. For a normal standing ankle this lands near z≈0. */
function footSoleZ(rig: Rig, ankle: Vec3): number {
  return ankle[2] - rig.r.foot;
}

function buildFeet(sdf: SdfApi, rig: Rig): Node {
  const j = rig.joints, r = rig.r;
  function foot(A: Vec3, side: number): Node {
    const footLen = r.foot * 2.4;
    const sz = footSoleZ(rig, A);
    // Toe forward (−Y), heel back, ankle ~40% from the heel so the foot sits
    // UNDER the body instead of jutting forward (which reads as leaning back).
    const toe: Vec3 = [A[0] + side * r.foot * 0.12, A[1] - footLen * 0.62, sz];
    const heel: Vec3 = [A[0], A[1] + footLen * 0.38, sz];
    const sole = sdf.capsule(heel, toe, r.foot * 0.62);
    const instep = sdf.ellipsoid(r.foot * 0.8, footLen * 0.5, r.foot * 0.8)
      .translate([A[0], A[1] - footLen * 0.35, sz + r.foot * 0.15]);
    // A short ankle column bridges the (possibly elevated) ankle to the sole so
    // the foot stays welded to the leg in any pose.
    const ankleCol = sdf.capsule(A, [A[0], A[1], sz + r.foot * 0.2], r.shank * 0.8);
    return sole.smoothUnion(instep, r.foot * 0.6).smoothUnion(ankleCol, r.foot * 0.6);
  }
  return foot(j.ankleL as Vec3, +1).union(foot(j.ankleR as Vec3, -1));
}

function buildHead(sdf: SdfApi, rig: Rig): Node {
  const r = rig.r, c = rig.joints.headCenter as Vec3;
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
  const aL = rig.joints.ankleL, aR = rig.joints.ankleR;
  const footLen = r.foot * 2.4;
  // Auto-size: cover the stance footprint (so a wide/lunge stance isn't off the
  // edge) and rise to meet the LOWEST foot (so at least one foot always merges
  // with the base, keeping the whole figure one component in any pose).
  const reach = Math.max(Math.abs(aL[0]), Math.abs(aR[0])) + footLen * 0.6
    + Math.max(Math.abs(aL[1]), Math.abs(aR[1]));
  const radius = num(o.radius, Math.max(H * 0.22, reach), 'base.radius', 1);
  const lowestSole = Math.min(footSoleZ(rig, aL), footSoleZ(rig, aR));
  const top = num(o.thickness, Math.max(H * 0.035, lowestSole + r.foot * 0.55), 'base.thickness', 0.1);
  return sdf.roundedCylinder(radius, top, Math.min(top * 0.35, r.foot * 0.5))
    .translate([0, 0, top * 0.5 - 0.01]);
}

// --- Face features (read rig.face anchors) --------------------------------

function buildEyes(sdf: SdfApi, rig: Rig, opts?: unknown): Node {
  const o = obj(opts, 'eyes(opts)');
  assertNoUnknownKeys(o, ['radius'], 'eyes(opts)');
  const rad = num(o.radius, rig.r.head * 0.16, 'eyes.radius', 0.01);
  return sdf.sphere(rad).translate(rig.face.eyeL).union(sdf.sphere(rad).translate(rig.face.eyeR));
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

function buildMouth(sdf: SdfApi, rig: Rig, opts?: unknown): Node {
  const o = obj(opts, 'mouth(opts)');
  assertNoUnknownKeys(o, ['width', 'smirk', 'open'], 'mouth(opts)');
  const width = num(o.width, rig.r.head * 0.5, 'mouth.width', 0.01);
  const smirk = num(o.smirk, 0, 'mouth.smirk', -1, 1);
  const u = rig.dir.headUp, right = rig.dir.headLeft;
  const m = rig.face.mouth;
  // A thin lip ridge; smirk tips one corner up.
  const a = add3(add3(m, scale3(right, width * 0.5)), scale3(u, smirk * width * 0.25));
  const b = add3(add3(m, scale3(right, -width * 0.5)), scale3(u, -smirk * width * 0.25));
  return sdf.capsule(a, b, rig.r.head * 0.06);
}

function buildEars(sdf: SdfApi, rig: Rig, opts?: unknown): Node {
  const o = obj(opts, 'ears(opts)');
  assertNoUnknownKeys(o, ['size'], 'ears(opts)');
  const s = num(o.size, rig.r.head * 0.3, 'ears.size', 0.01);
  const earL = sdf.ellipsoid(s * 0.4, s * 0.8, s).translate(rig.face.earL);
  const earR = sdf.ellipsoid(s * 0.4, s * 0.8, s).translate(rig.face.earR);
  return earL.union(earR);
}

function buildBrows(sdf: SdfApi, rig: Rig): Node {
  const right = rig.dir.headLeft;
  const w = rig.r.head * 0.22;
  const browR = (a: Vec3): Node => sdf.capsule(add3(a, scale3(right, w)), add3(a, scale3(right, -w)), rig.r.head * 0.06);
  return browR(rig.face.browL).union(browR(rig.face.browR));
}

/** Weld eyes/nose/mouth/ears/brows onto a head with SHARP creases (small k),
 *  vs the soft body weld. Pass `false` for any feature to skip it. */
function assembleFace(sdf: SdfApi, head: Node, rig: Rig, opts?: unknown): Node {
  const o = obj(opts, 'face.assemble(opts)');
  assertNoUnknownKeys(o, ['eyes', 'nose', 'mouth', 'ears', 'brows'], 'face.assemble(opts)');
  const crease = rig.r.head * 0.12;
  let result = head;
  if (o.nose !== false) result = result.smoothUnion(buildNose(sdf, rig, o.nose === true ? undefined : o.nose), crease);
  if (o.brows !== false && o.brows !== undefined) result = result.smoothUnion(buildBrows(sdf, rig), crease);
  if (o.ears !== false) result = result.smoothUnion(buildEars(sdf, rig, o.ears === true ? undefined : o.ears), crease * 1.5);
  if (o.mouth !== false) result = result.smoothUnion(buildMouth(sdf, rig, o.mouth === true ? undefined : o.mouth), crease * 0.7);
  if (o.eyes !== false) result = result.union(buildEyes(sdf, rig, o.eyes === true ? undefined : o.eyes));
  return result;
}

// --- Hair -----------------------------------------------------------------

function buildHair(sdf: SdfApi, rig: Rig, opts?: unknown): Node {
  const o = obj(opts, 'hair(opts)');
  assertNoUnknownKeys(o, ['style', 'thickness'], 'hair(opts)');
  const style = o.style === undefined ? 'short'
    : assertEnum(o.style, ['short', 'long', 'bun', 'bald'] as const, 'hair.style');
  if (style === 'bald') return sdf.sphere(1e-3).translate([0, 0, -1e6]); // empty-ish
  const r = rig.r, c = rig.joints.headCenter as Vec3;
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
  }
  void right;
  return cap;
}

// --- Clothing (derived from body regions → always fits) -------------------

function buildPants(sdf: SdfApi, rig: Rig, opts?: unknown): Node {
  const o = obj(opts, 'pants(opts)');
  assertNoUnknownKeys(o, ['rise', 'leg', 'cuffZ', 'thickness'], 'pants(opts)');
  const leg = o.leg === undefined ? 'slim' : assertEnum(o.leg, ['slim', 'cargo'] as const, 'pants.leg');
  const rise = o.rise === undefined ? 'mid' : assertEnum(o.rise, ['low', 'mid', 'high'] as const, 'pants.rise');
  const j = rig.joints, r = rig.r;
  const t = num(o.thickness, r.thigh * 0.22, 'pants.thickness', 0.01);
  const cuffZ = num(o.cuffZ, (j.ankleL as Vec3)[2] + r.shank * 1.5, 'pants.cuffZ');
  const flare = leg === 'cargo' ? 1.35 : 1.08;
  const waistZ = rise === 'high' ? j.navel[2] : rise === 'low' ? j.pelvis[2] : mix(j.pelvis[2], j.navel[2], 0.5);

  function legSleeve(Hj: Vec3, K: Vec3, A: Vec3): Node {
    // Trim the leg above the cuff: build inflated capsules from waist height
    // down to the cuff.
    const top: Vec3 = [Hj[0], Hj[1], waistZ];
    const ankleCuff: Vec3 = [A[0], A[1], cuffZ];
    const thighS = sdf.capsule(top, K, (r.thigh + t) * flare);
    const shankS = sdf.capsule(K, ankleCuff, (r.shank + t) * flare);
    return thighS.smoothUnion(shankS, r.shank * 0.8);
  }
  const seat = sdf.ellipsoid((r.pelvisX + t) * 1.02, (r.pelvisY + t), r.pelvisY * 1.2)
    .translate([0, 0, mix(j.pelvis[2], waistZ, 0.5)]);
  let pants = seat
    .smoothUnion(legSleeve(j.hipL as Vec3, j.kneeL as Vec3, j.ankleL as Vec3), r.thigh * 0.6)
    .smoothUnion(legSleeve(j.hipR as Vec3, j.kneeR as Vec3, j.ankleR as Vec3), r.thigh * 0.6);
  if (leg === 'cargo') {
    const pkt = (side: number): Node => sdf.roundedBox([r.thigh * 0.9, r.thigh * 0.4, r.thigh * 1.4], r.thigh * 0.18)
      .translate([side * (r.thigh + t) * 1.15, -r.thigh * 0.2, mix(j.kneeL[2], j.hipL[2], 0.5)]);
    pants = pants.smoothUnion(pkt(+1), r.thigh * 0.25).smoothUnion(pkt(-1), r.thigh * 0.25);
  }
  return pants;
}

function buildTop(sdf: SdfApi, rig: Rig, opts?: unknown): Node {
  const o = obj(opts, 'top(opts)');
  assertNoUnknownKeys(o, ['sleeve', 'hemZ', 'thickness'], 'top(opts)');
  const sleeve = o.sleeve === undefined ? 'short' : assertEnum(o.sleeve, ['none', 'short', 'long'] as const, 'top.sleeve');
  const j = rig.joints, r = rig.r;
  const t = num(o.thickness, r.chestY * 0.2, 'top(thickness)', 0.01);
  const hemZ = num(o.hemZ, j.navel[2] - r.chestY * 0.3, 'top.hemZ');
  // Torso shell from shoulders to hem.
  const chest = sdf.ellipsoid(r.chestX + t, r.chestY + t, (j.chest[2] - hemZ) * 0.62 + r.chestY)
    .translate([0, 0, mix(hemZ, j.chest[2] + r.chestY, 0.5)]);
  let top = chest;
  if (sleeve !== 'none') {
    const reach = sleeve === 'long' ? 1.0 : 0.4;
    function sl(S: Vec3, E: Vec3, W: Vec3): Node {
      const end = lerp3(E, W, reach);
      return sdf.capsule(S, end, (r.upperArm + t) * 1.05);
    }
    top = top
      .smoothUnion(sl(j.shoulderL as Vec3, j.elbowL as Vec3, j.wristL as Vec3), r.upperArm * 0.7)
      .smoothUnion(sl(j.shoulderR as Vec3, j.elbowR as Vec3, j.wristR as Vec3), r.upperArm * 0.7);
  }
  return top;
}

// --- Body weld ------------------------------------------------------------

/** Smooth-weld the major body masses with one rig-derived soft k. Face
 *  features keep their crisp creases (they were welded in assembleFace). */
function weldBody(sdf: SdfApi, rig: Rig, parts: unknown, opts?: unknown): Node {
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new ValidationError('figure.weld(rig, parts): `parts` must be a non-empty array of SDF nodes.');
  }
  const o = obj(opts, 'weld(opts)');
  assertNoUnknownKeys(o, ['k'], 'weld(opts)');
  const k = num(o.k, Math.min(rig.r.foreArm, rig.r.neck) * 0.85, 'weld.k', 1e-4);
  void sdf;
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
  hair(rig: Rig, opts?: object): Node;
  weld(rig: Rig, parts: Node[], opts?: object): Node;
  /** Snap an accessory node to a rig joint by its bbox anchor (no offset math).
   *  `joint` is a Vec3 like `rig.joints.crown`; `opts.anchor` ∈ center|bottom|top. */
  placeAt(node: Node, joint: Vec3, opts?: object): Node;
  face: {
    eyes(rig: Rig, opts?: object): Node;
    nose(rig: Rig, opts?: object): Node;
    mouth(rig: Rig, opts?: object): Node;
    ears(rig: Rig, opts?: object): Node;
    brows(rig: Rig, opts?: object): Node;
    assemble(head: Node, rig: Rig, opts?: object): Node;
  };
  clothing: {
    pants(rig: Rig, opts?: object): Node;
    top(rig: Rig, opts?: object): Node;
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
    hair: (rig, opts) => buildHair(sdf, assertRig(rig, 'hair(rig)'), opts),
    weld: (rig, parts, opts) => weldBody(sdf, assertRig(rig, 'weld(rig)'), parts, opts),
    placeAt: (node, joint, opts) => placeAt(node as Node, joint, opts),
    face: {
      eyes: (rig, opts) => buildEyes(sdf, assertRig(rig, 'face.eyes(rig)'), opts),
      nose: (rig, opts) => buildNose(sdf, assertRig(rig, 'face.nose(rig)'), opts),
      mouth: (rig, opts) => buildMouth(sdf, assertRig(rig, 'face.mouth(rig)'), opts),
      ears: (rig, opts) => buildEars(sdf, assertRig(rig, 'face.ears(rig)'), opts),
      brows: (rig) => buildBrows(sdf, assertRig(rig, 'face.brows(rig)')),
      assemble: (head, rig, opts) => assembleFace(sdf, head as Node, assertRig(rig, 'face.assemble(rig)'), opts),
    },
    clothing: {
      pants: (rig, opts) => buildPants(sdf, assertRig(rig, 'clothing.pants(rig)'), opts),
      top: (rig, opts) => buildTop(sdf, assertRig(rig, 'clothing.top(rig)'), opts),
    },
  };
}

/** @internal Exposed for unit tests. */
export const __figureTestables__ = { buildRig };
