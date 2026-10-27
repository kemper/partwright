// Parametric human — pure runtime over the packed MakeHuman (CC0) asset.
//
// A character is a list of numbers: macro body sliders (gender, age, muscle,
// weight, stature, ethnicity), detail morphs (jaw, cheekbones, nose, …) and a
// pose. This module turns those numbers into a deformed triangle mesh:
//
//   1. MORPH  — the base mesh plus a weighted sum of sparse vertex-delta
//      targets. The macro weights follow MakeHuman's multilinear corner scheme
//      (each "universal" target is one gender × age × muscle × weight corner);
//      that scheme is reimplemented here from the data layout, not ported.
//   2. RIG    — joint positions are centroids of the morphed joint-helper
//      vertices, so the skeleton follows every morph.
//   3. POSE   — forward kinematics over MakeHuman's default skeleton, driven by
//      the same pose vocabulary as `api.sdf.figure` (armL.raiseSide, legR.bend,
//      spine.lean, head.yaw, …), then linear-blend skinning with the rig's own
//      artist-painted weights.
//
// Dependency-free (no WASM, no DOM): unit-tested directly, and the sandbox
// namespace in humanApi.ts turns the result into a Manifold.

export type Vec3 = [number, number, number];
/** Row-major 3×3 rotation. */
type Mat3 = number[];

export interface HumanTarget { name: string; count: number; quantum: number; idx: Uint16Array; delta: Int8Array | Int16Array }
export interface HumanBone { name: string; parent: number; head: number; tail: number }
/** One MakeHuman modelling slider: −1…1 between `lo` and `hi` targets, or 0…1 onto `one`. */
export interface HumanModifier { key: string; group: string; min?: string; max?: string; lo?: string; hi?: string; one?: string }
export type HumanPack = 'core' | 'morphs' | 'young';

export interface HumanAsset {
  nV: number;
  nT: number;
  positions: Float32Array;
  triVerts: Uint16Array;
  /** 0 body skin, 1 eyeball, 2 skirt helper, 3 tights helper, 4 hair-cap helper. */
  triLabel: Uint8Array;
  skinIndex: Uint8Array;
  skinWeight: Float32Array;
  joints: { name: string; verts: number[] }[];
  bones: HumanBone[];
  /** Targets of the packs that are loaded. */
  targets: Map<string, HumanTarget>;
  /** Which pack each known target lives in (loaded or not). */
  targetPack: Map<string, HumanPack>;
  modifiers: Map<string, HumanModifier>;
}

/** Layout of public/human/hm08.json (written by scripts/human/build-human-assets.mjs). */
export interface HumanAssetMeta {
  nV: number;
  nT: number;
  packs: Record<HumanPack, string>;
  offsets: { positions: number; triVerts: number; triLabel: number; skinIndex: number; skinWeight: number };
  joints: { name: string; verts: number[] }[];
  bones: HumanBone[];
  targets: { name: string; count: number; quantum: number; bits: 8 | 16; pack: HumanPack; idx: number; delta: number }[];
  modifiers: HumanModifier[];
}

/** Parse the asset from its JSON table and whichever pack buffers are loaded
 *  (`core` is required — it holds the mesh). */
export function parseHumanAsset(meta: HumanAssetMeta, packs: Partial<Record<HumanPack, ArrayBuffer>>): HumanAsset {
  const core = packs.core;
  if (!core) throw new Error('api.human: the core asset pack is required');
  const o = meta.offsets;
  const targets = new Map<string, HumanTarget>();
  const targetPack = new Map<string, HumanPack>();
  for (const t of meta.targets) {
    targetPack.set(t.name, t.pack);
    const buf = packs[t.pack];
    if (!buf) continue;
    targets.set(t.name, {
      name: t.name, count: t.count, quantum: t.quantum,
      idx: new Uint16Array(buf, t.idx, t.count),
      delta: t.bits === 16 ? new Int16Array(buf, t.delta, t.count * 3) : new Int8Array(buf, t.delta, t.count * 3),
    });
  }
  return {
    nV: meta.nV,
    nT: meta.nT,
    positions: new Float32Array(core, o.positions, meta.nV * 3),
    triVerts: new Uint16Array(core, o.triVerts, meta.nT * 3),
    triLabel: new Uint8Array(core, o.triLabel, meta.nT),
    skinIndex: new Uint8Array(core, o.skinIndex, meta.nV * 4),
    skinWeight: new Float32Array(core, o.skinWeight, meta.nV * 4),
    joints: meta.joints,
    bones: meta.bones,
    targets,
    targetPack,
    modifiers: new Map(meta.modifiers.map((m) => [m.key, m])),
  };
}

// --- Morphs -------------------------------------------------------------------

export interface HumanBody {
  /** 0 = female, 1 = male. */
  gender: number;
  /** Years, 1–90 (baby 1, child 11, young adult 25, old 90 are the data's corners). */
  age: number;
  /** 0–1, 0.5 = average. */
  muscle: number;
  /** 0–1, 0.5 = average. */
  weight: number;
  /** 0–1 real-world stature, 0.5 = average (proportions only — print size is `height`). */
  stature: number;
  /** 0–1 bust (applied on the female side of `gender`). */
  breast: number;
  /** Relative mix; normalized. */
  ethnicity: { african: number; asian: number; caucasian: number };
}

/** Friendly face sliders, each −1…1 (0 = neutral) except `headSquare` (0…1).
 *  Each maps onto MakeHuman modelling sliders (see FRIENDLY_MORPHS). */
export interface HumanFace {
  jawWidth: number; chin: number; cheekbones: number;
  noseWidth: number; noseLength: number; mouthWidth: number; eyeSize: number;
  headSquare: number;
}
export interface HumanTorso { vShape: number; belly: number }

export const DEFAULT_BODY: HumanBody = {
  gender: 0.5, age: 25, muscle: 0.5, weight: 0.5, stature: 0.5, breast: 0,
  ethnicity: { african: 1, asian: 1, caucasian: 1 },
};
export const DEFAULT_FACE: HumanFace = {
  jawWidth: 0, chin: 0, cheekbones: 0, noseWidth: 0, noseLength: 0, mouthWidth: 0, eyeSize: 0, headSquare: 0,
};
export const DEFAULT_TORSO: HumanTorso = { vShape: 0, belly: 0 };

/** Friendly slider → the MakeHuman modelling slider keys it drives. */
const FRIENDLY_MORPHS: Record<string, string[]> = {
  jawWidth: ['chin-width'], chin: ['chin-prominent'], cheekbones: ['l-cheek-bones', 'r-cheek-bones'],
  noseWidth: ['nose-scale-horiz'], noseLength: ['nose-scale-vert'], mouthWidth: ['mouth-scale-horiz'],
  eyeSize: ['l-eye-scale', 'r-eye-scale'], headSquare: ['head-square'],
  vShape: ['torso-vshape'], belly: ['stomach-pregnant'],
};

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/** Weights of the min / average / max corners for a 0–1 slider. */
function triWeights(v: number): [number, number, number] {
  const t = clamp(v, 0, 1);
  return t < 0.5 ? [1 - 2 * t, 2 * t, 0] : [0, 2 - 2 * t, 2 * t - 1];
}

/** Age corners (years) of the macro targets. */
const AGE_CORNERS: [string, number][] = [['baby', 1], ['child', 11], ['young', 25], ['old', 90]];
function ageWeights(years: number): [string, number][] {
  const y = clamp(years, 1, 90);
  for (let i = 0; i + 1 < AGE_CORNERS.length; i++) {
    const [a, ya] = AGE_CORNERS[i], [b, yb] = AGE_CORNERS[i + 1];
    if (y <= yb) { const t = (y - ya) / (yb - ya); return [[a, 1 - t], [b, t]]; }
  }
  return [['old', 1]];
}

/** Every target name → weight for these parameters (zero weights omitted).
 *  `morphs` is the raw MakeHuman slider map ({ 'nose-hump': 0.4, … }); the
 *  friendly `face` / `torso` sliders add onto the same keys. */
export function morphWeights(
  asset: Pick<HumanAsset, 'modifiers'>, body: HumanBody, face: HumanFace, torso: HumanTorso,
  morphs: Record<string, number> = {},
): Map<string, number> {
  const w = new Map<string, number>();
  const add = (name: string, v: number) => { if (v !== 0) w.set(name, (w.get(name) ?? 0) + v); };

  const g = clamp(body.gender, 0, 1);
  const gender: [string, number][] = [['female', 1 - g], ['male', g]];
  const age = ageWeights(body.age);
  const LV = ['min', 'average', 'max'];
  const mu = triWeights(body.muscle);
  const we = triWeights(body.weight);
  const e = body.ethnicity;
  const eSum = (e.african + e.asian + e.caucasian) || 1;
  const eth: [string, number][] = [['african', e.african / eSum], ['asian', e.asian / eSum], ['caucasian', e.caucasian / eSum]];
  const s = clamp(body.stature, 0, 1);

  for (const [gn, gw] of gender) {
    for (const [an, aw] of age) {
      const ga = gw * aw;
      if (ga === 0) continue;
      for (const [en, ew] of eth) add(`macrodetails/${en}-${gn}-${an}`, ga * ew);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        add(`macrodetails/universal-${gn}-${an}-${LV[i]}muscle-${LV[j]}weight`, ga * mu[i] * we[j]);
      }
      if (s < 0.5) add(`macrodetails/height/${gn}-${an}-averagemuscle-averageweight-minheight`, ga * (0.5 - s) * 2);
      if (s > 0.5) add(`macrodetails/height/${gn}-${an}-averagemuscle-averageweight-maxheight`, ga * (s - 0.5) * 2);
    }
  }
  // The bust target is an adult one; fade it out through childhood.
  const adult = clamp((body.age - 11) / 14, 0, 1);
  add('breast/female-young-averagemuscle-averageweight-maxcup-averagefirmness', clamp(body.breast, 0, 1) * (1 - g) * adult);

  const sliders = new Map<string, number>();
  const slide = (key: string, v: number) => { if (v) sliders.set(key, (sliders.get(key) ?? 0) + v); };
  for (const [k, v] of Object.entries({ ...face, ...torso })) for (const key of FRIENDLY_MORPHS[k] ?? []) slide(key, v);
  for (const [k, v] of Object.entries(morphs)) slide(k, v);
  for (const [key, v] of sliders) {
    const m = asset.modifiers.get(key);
    if (!m) throw new Error(`api.human: unknown morph "${key}". See /ai/human.md#morphs`);
    if (m.one) add(m.one, clamp(v, 0, 1));
    else { const t = clamp(v, -1, 1); if (t < 0) add(m.lo!, -t); else add(m.hi!, t); }
  }
  return w;
}

/** Base mesh + weighted targets → a fresh position array. A weighted target
 *  whose pack wasn't loaded is an error (the loader picks packs from the source). */
export function applyMorphs(asset: HumanAsset, weights: Map<string, number>): Float32Array {
  const out = new Float32Array(asset.positions);
  for (const [name, wt] of weights) {
    const t = asset.targets.get(name);
    if (!t) {
      const pack = asset.targetPack.get(name);
      if (!pack) continue;
      throw new Error(`api.human: this figure needs the "${pack}" data pack, which loads when the code mentions ${pack === 'young' ? '`age`' : '`face`, `torso`, `morphs` or `expression`'}. See /ai/human.md`);
    }
    const k = wt * t.quantum;
    for (let i = 0; i < t.count; i++) {
      const v = t.idx[i] * 3;
      out[v] += t.delta[i * 3] * k;
      out[v + 1] += t.delta[i * 3 + 1] * k;
      out[v + 2] += t.delta[i * 3 + 2] * k;
    }
  }
  return out;
}

/** Joint centroids of the (morphed) helper vertices, by joint name. */
export function jointPositions(asset: HumanAsset, pos: Float32Array): Map<string, Vec3> {
  const out = new Map<string, Vec3>();
  for (const j of asset.joints) {
    let x = 0, y = 0, z = 0;
    for (const v of j.verts) { x += pos[v * 3]; y += pos[v * 3 + 1]; z += pos[v * 3 + 2]; }
    const n = j.verts.length || 1;
    out.set(j.name, [x / n, y / n, z / n]);
  }
  return out;
}

// --- Rotation helpers -----------------------------------------------------------

const DEG = Math.PI / 180;
const I3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
function mul(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  }
  return r;
}
const transpose = (a: Mat3): Mat3 => [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]];
const apply = (m: Mat3, v: Vec3): Vec3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Rotation about unit `k` by `deg` (Rodrigues). */
function axisAngle(k: Vec3, deg: number): Mat3 {
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG), t = 1 - c;
  const [x, y, z] = k;
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ];
}
const rotX = (deg: number) => axisAngle([1, 0, 0], deg);
const rotY = (deg: number) => axisAngle([0, 1, 0], deg);
const rotZ = (deg: number) => axisAngle([0, 0, 1], deg);

/** Unit quaternion [w, x, y, z] of a rotation matrix (Shepperd's method —
 *  branches on the largest component, so it stays well-conditioned near 180°). */
function toQuat(m: Mat3): [number, number, number, number] {
  const tr = m[0] + m[4] + m[8];
  let w: number, x: number, y: number, z: number;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    w = s / 4; x = (m[7] - m[5]) / s; y = (m[2] - m[6]) / s; z = (m[3] - m[1]) / s;
  } else if (m[0] > m[4] && m[0] > m[8]) {
    const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2;
    w = (m[7] - m[5]) / s; x = s / 4; y = (m[1] + m[3]) / s; z = (m[2] + m[6]) / s;
  } else if (m[4] > m[8]) {
    const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2;
    w = (m[2] - m[6]) / s; x = (m[1] + m[3]) / s; y = s / 4; z = (m[5] + m[7]) / s;
  } else {
    const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2;
    w = (m[3] - m[1]) / s; x = (m[2] + m[6]) / s; y = (m[5] + m[7]) / s; z = s / 4;
  }
  return w < 0 ? [-w, -x, -y, -z] : [w, x, y, z];
}

/** The fraction `t` of rotation `m` (same axis, t × angle), via its quaternion. */
function partial(m: Mat3, t: number): Mat3 {
  const [w, x, y, z] = toQuat(m);
  const sinHalf = Math.hypot(x, y, z);
  if (sinHalf < 1e-12) return I3;
  const ang = 2 * Math.atan2(sinHalf, w);
  return axisAngle([x / sinHalf, y / sinHalf, z / sinHalf], (ang / DEG) * t);
}

/** Columns = an orthonormal frame with x along `primary`, y from `secondary`. */
function frame(primary: Vec3, secondary: Vec3): Mat3 {
  const x = norm(primary);
  const y = norm(sub(secondary, x.map((c) => c * dot(secondary, x)) as Vec3));
  const z = cross(x, y);
  return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
}

// --- Pose -------------------------------------------------------------------------

/** Same vocabulary as `api.sdf.figure`'s rig (degrees). */
export interface LimbPose { raiseSide: number; raiseFwd: number; bend: number; twist: number }
export interface HumanPose {
  armL?: Partial<LimbPose>; armR?: Partial<LimbPose>;
  legL?: Partial<LimbPose>; legR?: Partial<LimbPose>;
  spine?: { lean?: number; turn?: number; side?: number };
  head?: { yaw?: number; pitch?: number; roll?: number };
}

/** Arms relaxed at the sides — MakeHuman's rest is an A-pose. */
const STANDING_ARM: LimbPose = { raiseSide: 9, raiseFwd: 0, bend: 8, twist: 0 };
/** Mouth ellipse size relative to the lip bones' extent (width: corner reach,
 *  height: upper-to-lower lip span). */
const MOUTH_WIDTH_FRACTION = 0.9;
const MOUTH_HEIGHT_FRACTION = 0.8;
/** How far behind the lip front (in half eye-spacings) the mouth cavity starts. */
const MOUTH_DEPTH = 0.6;

const limb = (p: Partial<LimbPose> | undefined, def: LimbPose): LimbPose => ({ ...def, ...(p ?? {}) });

/** Unit bone direction for a limb pose (the sdfFigure rig's formula). */
function limbDir(side: number, p: LimbPose): Vec3 {
  const d: Vec3 = [side * Math.sin(p.raiseSide * DEG), 0, -Math.cos(p.raiseSide * DEG)];
  return norm(apply(rotX(-p.raiseFwd), d));
}
/** The bend hinge for a limb pose: the rest lateral axis carried through the
 *  bone's raises, rolled by twist (the sdfFigure rig's formula). */
function limbHinge(side: number, p: LimbPose, dir: Vec3): Vec3 {
  let h = norm(apply(rotX(-p.raiseFwd), apply(rotY(-side * p.raiseSide), [-1, 0, 0])));
  if (p.twist) h = norm(apply(axisAngle(dir, -p.twist * side), h));
  return h;
}
/** Recover raiseSide / raiseFwd from a unit bone direction. */
function anglesOf(side: number, d: Vec3): LimbPose {
  const rs = Math.asin(clamp(side * d[0], -1, 1)) / DEG;
  const rf = Math.atan2(-d[1], -d[2]) / DEG;
  return { raiseSide: rs, raiseFwd: rf, bend: 0, twist: 0 };
}

/** Facial expression channels, each 0…1 (`jawOpen` too). They move the face
 *  bones of MakeHuman's default skeleton, so they work on any face shape. */
export interface HumanExpression {
  smile: number; frown: number; browRaise: number; browFurrow: number;
  blinkL: number; blinkR: number; squint: number; jawOpen: number; pucker: number;
}
export const EXPRESSION_KEYS = ['smile', 'frown', 'browRaise', 'browFurrow', 'blinkL', 'blinkR', 'squint', 'jawOpen', 'pucker'] as const;
/** Named expressions → channel mixes. */
export const EXPRESSION_PRESETS: Record<string, Partial<HumanExpression>> = {
  neutral: {},
  smile: { smile: 0.8, squint: 0.15 },
  grin: { smile: 1, jawOpen: 0.25, squint: 0.25 },
  laugh: { smile: 1, jawOpen: 0.6, squint: 0.45, browRaise: 0.2 },
  frown: { frown: 0.8, browFurrow: 0.3 },
  sad: { frown: 0.7, browRaise: 0.35, squint: 0.1 },
  angry: { browFurrow: 1, frown: 0.5, squint: 0.35 },
  surprised: { browRaise: 1, jawOpen: 0.45 },
  wink: { smile: 0.6, blinkL: 1, squint: 0.1 },
  sleepy: { blinkL: 0.65, blinkR: 0.65, browRaise: 0.1 },
  kiss: { pucker: 1, blinkL: 0.5, blinkR: 0.5 },
};

/** Bone-local displacement (head-frame dm offset of the bone head) and
 *  rotation for each expression channel at full strength. Offsets are for the
 *  figure's LEFT bone; the right one mirrors x. */
const EXPRESSION_RIG: Record<keyof HumanExpression, { bone: string; off?: Vec3; rotX?: number; sided?: 'L' | 'R' }[]> = {
  smile: [
    { bone: 'oris03', off: [0.07, 0.05, 0.1] }, { bone: 'oris07', off: [0.05, 0.04, 0.07] },
    { bone: 'risorius03', off: [0.04, 0.03, 0.07] }, { bone: 'levator05', off: [0.015, -0.03, 0.06] },
  ],
  frown: [
    { bone: 'oris03', off: [-0.01, 0.01, -0.09] }, { bone: 'oris07', off: [0.0, 0.0, -0.06] },
    { bone: 'levator05', off: [0.0, 0.0, -0.03] }, { bone: 'oris01', off: [0.0, -0.015, 0.01] },
  ],
  browRaise: [{ bone: 'oculi01', off: [0.0, 0.0, 0.07] }],
  browFurrow: [{ bone: 'oculi01', off: [-0.04, -0.01, -0.045] }],
  blinkL: [{ bone: 'orbicularis03', rotX: 1, sided: 'L' }, { bone: 'orbicularis04', rotX: -0.25, sided: 'L' }],
  blinkR: [{ bone: 'orbicularis03', rotX: 1, sided: 'R' }, { bone: 'orbicularis04', rotX: -0.25, sided: 'R' }],
  squint: [{ bone: 'orbicularis04', rotX: -0.5 }, { bone: 'orbicularis03', rotX: 0.25 }],
  jawOpen: [{ bone: 'jaw', rotX: 1 }],
  pucker: [
    { bone: 'oris03', off: [-0.05, -0.035, 0.0] }, { bone: 'oris07', off: [-0.03, -0.03, 0.0] },
    { bone: 'oris05', off: [0.0, -0.04, 0.0] }, { bone: 'oris01', off: [0.0, -0.04, 0.0] },
  ],
};
/** Full-strength rotation (degrees) behind each rig entry's `rotX` factor. */
const EXPRESSION_ANGLE: Partial<Record<keyof HumanExpression, number>> = {
  blinkL: 38, blinkR: 38, squint: 38, jawOpen: 22,
};

/** Per-bone local offset + rotation for an expression (bone index → …). */
function expressionLocals(asset: HumanAsset, expr: Partial<HumanExpression>): Map<number, { off: Vec3; rot: Mat3 }> {
  const byName = new Map(asset.bones.map((b, i) => [b.name, i]));
  const out = new Map<number, { off: Vec3; rot: Mat3 }>();
  for (const key of EXPRESSION_KEYS) {
    const amt = clamp(expr[key] ?? 0, 0, 1);
    if (!amt) continue;
    for (const e of EXPRESSION_RIG[key]) {
      const names = byName.has(e.bone) ? [[e.bone, 1]] : (['L', 'R'] as const).filter((s) => !e.sided || e.sided === s).map((s) => [`${e.bone}.${s}`, s === 'L' ? 1 : -1]);
      for (const [name, side] of names as [string, number][]) {
        const i = byName.get(name);
        if (i === undefined) continue;
        const cur = out.get(i) ?? { off: [0, 0, 0] as Vec3, rot: I3 };
        if (e.off) cur.off = [cur.off[0] + e.off[0] * side * amt, cur.off[1] + e.off[1] * amt, cur.off[2] + e.off[2] * amt];
        if (e.rotX) cur.rot = mul(cur.rot, rotX(e.rotX * (EXPRESSION_ANGLE[key] ?? 0) * amt));
        out.set(i, cur);
      }
    }
  }
  return out;
}

/**
 * Per-bone skinning transforms for a pose: world rotation `R[b]` and the
 * translation so that x' = R[b]·(x − head_b) + head'_b. Bones without a pose
 * override inherit their parent's rotation (rigid follow).
 */
export function solvePose(
  asset: HumanAsset, joints: Map<string, Vec3>, pose: HumanPose | 'rest', expression: Partial<HumanExpression> = {},
): { R: Mat3[]; T: Vec3[] } {
  const bones = asset.bones;
  const byName = new Map(bones.map((b, i) => [b.name, i]));
  const J = (name: string): Vec3 => joints.get(`${name}____head`)!;
  const override = new Map<number, Mat3>();
  const set = (name: string, m: Mat3) => { const i = byName.get(name); if (i !== undefined) override.set(i, m); };

  if (pose !== 'rest') {
    // Spine: R = Ry(side)·Rx(lean)·Rz(turn), spread up the five spine bones.
    const sp = pose.spine ?? {};
    const Rs = mul(rotY(sp.side ?? 0), mul(rotX(sp.lean ?? 0), rotZ(sp.turn ?? 0)));
    const spine = ['spine05', 'spine04', 'spine03', 'spine02', 'spine01'];
    spine.forEach((n, k) => set(n, partial(Rs, (k + 1) / spine.length)));

    // Head: forward = rotX(pitch)·rotZ(yaw)·(−Y); roll about forward. Spread
    // over the neck, on top of the spine.
    const hp = pose.head ?? {};
    const hf = norm(apply(rotX(hp.pitch ?? 0), apply(rotZ(hp.yaw ?? 0), [0, -1, 0])));
    let left = norm(cross([0, 0, 1], hf));
    let up = norm(cross(hf, left));
    if (hp.roll) { const r = axisAngle(hf, -hp.roll); left = apply(r, left); up = apply(r, up); }
    const Rh: Mat3 = [left[0], -hf[0], up[0], left[1], -hf[1], up[1], left[2], -hf[2], up[2]];
    const neck = ['neck01', 'neck02', 'neck03', 'head'];
    neck.forEach((n, k) => set(n, mul(Rs, partial(Rh, (k + 1) / neck.length))));

    for (const [s, side] of [['L', 1], ['R', -1]] as const) {
      // Arms: aim the upper arm and forearm frames, under the spine rotation.
      const S = J(`upperarm01.${s}`), E = J(`lowerarm01.${s}`), W = J(`wrist.${s}`);
      const dir0 = norm(sub(E, S)), fore0 = norm(sub(W, E));
      const rest = anglesOf(side, dir0);
      const hinge0 = limbHinge(side, rest, dir0);
      const ap = limb(side > 0 ? pose.armL : pose.armR, STANDING_ARM);
      const dir = limbDir(side, ap);
      const hinge = limbHinge(side, ap, dir);
      const fore = norm(apply(axisAngle(hinge, ap.bend), dir));
      const Ru = mul(Rs, mul(frame(dir, hinge), transpose(frame(dir0, hinge0))));
      const Rf = mul(Rs, mul(frame(fore, hinge), transpose(frame(fore0, hinge0))));
      set(`clavicle.${s}`, Rs); set(`shoulder01.${s}`, Rs);
      set(`upperarm01.${s}`, Ru); set(`upperarm02.${s}`, Ru);
      set(`lowerarm01.${s}`, Rf); set(`lowerarm02.${s}`, Rf);

      // Legs: only when posed (the rest stance is already natural). Knees bend
      // backward; feet stay flat (yawed by turnout) like the sdfFigure rig.
      const lp = side > 0 ? pose.legL : pose.legR;
      if (lp) {
        const H = J(`upperleg01.${s}`), K = J(`lowerleg01.${s}`), A = J(`foot.${s}`);
        const d0 = norm(sub(K, H)), sh0 = norm(sub(A, K));
        const restL = anglesOf(side, d0);
        const h0 = limbHinge(side, restL, d0);
        const p = limb(lp, { raiseSide: restL.raiseSide, raiseFwd: restL.raiseFwd, bend: 0, twist: 0 });
        const d = limbDir(side, p);
        const h = limbHinge(side, p, d);
        const sh = norm(apply(axisAngle(h, -p.bend), d));
        const Rt = mul(frame(d, h), transpose(frame(d0, h0)));
        const Rk = mul(frame(sh, h), transpose(frame(sh0, h0)));
        set(`upperleg01.${s}`, Rt); set(`upperleg02.${s}`, Rt);
        set(`lowerleg01.${s}`, Rk); set(`lowerleg02.${s}`, Rk);
        set(`foot.${s}`, rotZ(side * p.twist));
      }
    }
  }

  // Face bones: expression offsets/rotations, local to the parent's frame.
  const locals = expressionLocals(asset, expression);
  const R: Mat3[] = new Array(bones.length);
  const T: Vec3[] = new Array(bones.length);
  const headPos = bones.map((b) => joints.get(asset.joints[b.head].name)!);
  bones.forEach((b, i) => {
    const parent = b.parent;
    const local = locals.get(i);
    const inherited = override.get(i) ?? (parent >= 0 ? R[parent] : I3);
    R[i] = local ? mul(inherited, local.rot) : inherited;
    // The bone's head (plus any expression offset) rides its parent's transform.
    const h = local ? [headPos[i][0] + local.off[0], headPos[i][1] + local.off[1], headPos[i][2] + local.off[2]] as Vec3 : headPos[i];
    const newHead: Vec3 = parent >= 0 ? (() => { const r = apply(R[parent], sub(h, headPos[parent])); const t = T[parent]; return [r[0] + t[0], r[1] + t[1], r[2] + t[2]] as Vec3; })() : h;
    // Store the translation as "posed head", applied as R·(x − head) + newHead.
    T[i] = newHead;
  });
  // Convert to x' = R·x + t form.
  const t: Vec3[] = bones.map((_, i) => { const rh = apply(R[i], headPos[i]); return [T[i][0] - rh[0], T[i][1] - rh[1], T[i][2] - rh[2]]; });
  return { R, T: t };
}

type Quat = [number, number, number, number];
const qmul = (a: Quat, b: Quat): Quat => [
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
  a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
  a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
];

/**
 * Skin `pos` with the asset's weights. `dq` (default) blends the bone
 * transforms as unit dual quaternions, which keeps volume through bends and
 * twists (no "candy-wrapper" collapse at an elbow or a rolled forearm);
 * `linear` is plain linear-blend skinning.
 */
export function skin(asset: HumanAsset, pos: Float32Array, xf: { R: Mat3[]; T: Vec3[] }, method: 'dq' | 'linear' = 'dq'): Float32Array {
  const out = new Float32Array(pos.length);
  const { skinIndex, skinWeight } = asset;
  if (method === 'linear') {
    for (let v = 0; v < asset.nV; v++) {
      const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      let ox = 0, oy = 0, oz = 0;
      for (let k = 0; k < 4; k++) {
        const w = skinWeight[v * 4 + k];
        if (w === 0) continue;
        const b = skinIndex[v * 4 + k];
        const m = xf.R[b], t = xf.T[b];
        ox += w * (m[0] * x + m[1] * y + m[2] * z + t[0]);
        oy += w * (m[3] * x + m[4] * y + m[5] * z + t[1]);
        oz += w * (m[6] * x + m[7] * y + m[8] * z + t[2]);
      }
      out[v * 3] = ox; out[v * 3 + 1] = oy; out[v * 3 + 2] = oz;
    }
    return out;
  }
  // Per-bone unit dual quaternion (real qr, dual qd = ½·t·qr).
  const qr = xf.R.map((m) => toQuat(m));
  const qd = qr.map((q, b) => { const t = xf.T[b]; const d = qmul([0, t[0], t[1], t[2]], q); return [d[0] / 2, d[1] / 2, d[2] / 2, d[3] / 2] as Quat; });
  for (let v = 0; v < asset.nV; v++) {
    let r0 = 0, r1 = 0, r2 = 0, r3 = 0, d0 = 0, d1 = 0, d2 = 0, d3 = 0;
    const pivot = qr[skinIndex[v * 4]];
    for (let k = 0; k < 4; k++) {
      let w = skinWeight[v * 4 + k];
      if (w === 0) continue;
      const b = skinIndex[v * 4 + k];
      const a = qr[b], d = qd[b];
      // Antipodal quaternions are the same rotation: blend on one hemisphere.
      if (a[0] * pivot[0] + a[1] * pivot[1] + a[2] * pivot[2] + a[3] * pivot[3] < 0) w = -w;
      r0 += w * a[0]; r1 += w * a[1]; r2 += w * a[2]; r3 += w * a[3];
      d0 += w * d[0]; d1 += w * d[1]; d2 += w * d[2]; d3 += w * d[3];
    }
    const n = Math.hypot(r0, r1, r2, r3) || 1;
    r0 /= n; r1 /= n; r2 /= n; r3 /= n; d0 /= n; d1 /= n; d2 /= n; d3 /= n;
    // Rotation part.
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    const tx = 2 * (r2 * z - r3 * y), ty = 2 * (r3 * x - r1 * z), tz = 2 * (r1 * y - r2 * x);
    const rx = x + r0 * tx + (r2 * tz - r3 * ty);
    const ry = y + r0 * ty + (r3 * tx - r1 * tz);
    const rz = z + r0 * tz + (r1 * ty - r2 * tx);
    // Translation part: 2·(qd·conj(qr)).vec
    const ox = 2 * (-d0 * r1 + d1 * r0 - d2 * r3 + d3 * r2);
    const oy = 2 * (-d0 * r2 + d1 * r3 + d2 * r0 - d3 * r1);
    const oz = 2 * (-d0 * r3 - d1 * r2 + d2 * r1 + d3 * r0);
    out[v * 3] = rx + ox; out[v * 3 + 1] = ry + oy; out[v * 3 + 2] = rz + oz;
  }
  return out;
}

export interface HumanOptions {
  body?: Partial<HumanBody>;
  face?: Partial<HumanFace>;
  torso?: Partial<HumanTorso>;
  /** Raw MakeHuman modelling sliders by key ({ 'nose-hump': 0.4, … }). */
  morphs?: Record<string, number>;
  pose?: HumanPose | 'rest';
  expression?: Partial<HumanExpression>;
  skinning?: 'dq' | 'linear';
  /** Print height (world units) of the unposed figure, soles to crown. */
  height?: number;
}

type HumanLabel = 'skin' | 'eyes' | 'iris' | 'pupil' | 'lips' | 'brows' | 'mouth';

export interface HumanMesh {
  /** Body (`skin`) and the two eyeballs (`eyes`), each re-indexed per part. */
  parts: { label: 'skin' | 'eyes'; positions: Float32Array; triVerts: Uint32Array }[];
  /** Per eyeball triangle (in `eyes` part order): its paint label. The iris and
   *  pupil are the front cap of each eyeball, classified in the rest pose. */
  eyeLabels: HumanLabel[];
  /** Per skin triangle (in `skin` part order): `skin`, `lips`, `mouth` or `brows`. */
  skinLabels: HumanLabel[];
  /** World units per MakeHuman decimetre (print scale). */
  scale: number;
  /** Posed + scaled + grounded positions of every asset vertex (helpers too). */
  posed: Float32Array;
  /** Rest-pose (morphed, unscaled) positions of every asset vertex. */
  rest: Float32Array;
  /** Posed + scaled joint positions by joint name. */
  joints: Map<string, Vec3>;
  /** Per-bone posed transforms in scaled world units: x' = R·x_rest·scale + T. */
  bones: { R: Mat3[]; T: Vec3[] };
}

/** Summed skin weight of the bones whose names start with any of `prefixes`. */
function boneWeight(asset: HumanAsset, v: number, prefixes: string[]): number {
  let w = 0;
  for (let k = 0; k < 4; k++) {
    const sw = asset.skinWeight[v * 4 + k];
    if (!sw) continue;
    const name = asset.bones[asset.skinIndex[v * 4 + k]].name;
    if (prefixes.some((p) => name.startsWith(p))) w += sw;
  }
  return w;
}

/**
 * Paint regions on the body surface, classified in the (morphed) rest pose so
 * they follow every face shape:
 *  - `lips`: the lip bones' (oris01/05 upper + lower lip) region, clipped to an
 *    ellipse spanning the mouth corners (oris03) so it never spills onto cheeks;
 *  - `mouth`: the same ellipse, behind the lip surface — the inside of the
 *    mouth, which shows when the jaw opens;
 *  - `brows`: an arched band above each eye, sized from the eye spacing.
 */
function faceLabels(asset: HumanAsset, rest: Float32Array, joints: Map<string, Vec3>): HumanLabel[] {
  const lip: number[] = [], corner: number[] = [];
  for (let v = 0; v < asset.nV; v++) {
    if (boneWeight(asset, v, ['oris01', 'oris05']) > 0.5) lip.push(v);
    if (boneWeight(asset, v, ['oris03']) > 0.5) corner.push(v);
  }
  let cx = 0, cz = 0, zLo = Infinity, zHi = -Infinity, yFront = Infinity;
  for (const v of lip) {
    cx += rest[v * 3]; cz += rest[v * 3 + 2];
    zLo = Math.min(zLo, rest[v * 3 + 2]); zHi = Math.max(zHi, rest[v * 3 + 2]); yFront = Math.min(yFront, rest[v * 3 + 1]);
  }
  cx /= lip.length || 1; cz = (zLo + zHi) / 2;
  let halfW = 0;
  for (const v of corner) halfW = Math.max(halfW, Math.abs(rest[v * 3] - cx));
  halfW *= MOUTH_WIDTH_FRACTION;
  const halfH = ((zHi - zLo) / 2) * MOUTH_HEIGHT_FRACTION;

  // Bones riding the jaw (it and its descendants) — the lower lip and chin.
  const jawBones = new Set<number>();
  asset.bones.forEach((b, i) => { if (b.name === 'jaw' || (b.parent >= 0 && jawBones.has(b.parent))) jawBones.add(i); });
  const jawWeight = (v: number) => {
    let w = 0;
    for (let k = 0; k < 4; k++) if (jawBones.has(asset.skinIndex[v * 4 + k])) w += asset.skinWeight[v * 4 + k];
    return w;
  };

  const eyeL = joints.get('eye.L____head')!, eyeR = joints.get('eye.R____head')!;
  const u = Math.abs(eyeL[0] - eyeR[0]) / 2;           // half the eye spacing

  // Mouth cavity: everything well behind the lip front inside a box around
  // the mouth. The box stops short of the chin, so the neck (also "behind"
  // the lips) is never caught; the cheeks are outside its width.
  const skinTris: number[] = [];
  for (let t = 0; t < asset.nT; t++) if (asset.triLabel[t] === 0) skinTris.push(t);
  const cen = (t: number): Vec3 => {
    let x = 0, y = 0, z = 0;
    for (let c = 0; c < 3; c++) { const v = asset.triVerts[t * 3 + c]; x += rest[v * 3] / 3; y += rest[v * 3 + 1] / 3; z += rest[v * 3 + 2] / 3; }
    return [x, y, z];
  };
  // The cavity ends in front of the head joint (the back of the mouth); past
  // it is the back of the head.
  const yBack = joints.get('head____head')![1];
  const inCavityBox = (p: Vec3) =>
    Math.abs(p[0] - cx) < halfW * 1.4 && Math.abs(p[2] - cz) < halfH * 3 && p[1] > yFront + u * MOUTH_DEPTH && p[1] < yBack;
  // The face beside the mouth is "behind" the protruding lips too, so depth
  // alone isn't enough: flood-fill from the cavity's deepest triangle. The
  // cavity meets the face only along the lip edge, which isn't deep, so the
  // fill stops there.
  const edgeTris = new Map<string, number[]>();
  for (const t of skinTris) for (let c = 0; c < 3; c++) {
    const a = asset.triVerts[t * 3 + c], b = asset.triVerts[t * 3 + (c + 1) % 3];
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    const list = edgeTris.get(key);
    if (list) list.push(t); else edgeTris.set(key, [t]);
  }
  let seed = -1, seedY = -Infinity;
  for (const t of skinTris) {
    const p = cen(t);
    if (inCavityBox(p) && Math.abs(p[0] - cx) < halfW * 0.4 && p[1] > seedY) { seedY = p[1]; seed = t; }
  }
  const cavity = new Set<number>();
  if (seed >= 0) {
    const stack = [seed];
    cavity.add(seed);
    while (stack.length) {
      const t = stack.pop()!;
      for (let c = 0; c < 3; c++) {
        const a = asset.triVerts[t * 3 + c], b = asset.triVerts[t * 3 + (c + 1) % 3];
        for (const n of edgeTris.get(a < b ? `${a},${b}` : `${b},${a}`) ?? []) {
          if (!cavity.has(n) && inCavityBox(cen(n))) { cavity.add(n); stack.push(n); }
        }
      }
    }
  }

  const out: HumanLabel[] = [];
  for (const t of skinTris) {
    const [x, y, z] = cen(t);
    if (cavity.has(t)) { out.push('mouth'); continue; }
    const ex = (x - cx) / halfW, ez = (z - cz) / halfH;
    if (ex * ex + ez * ez < 1) {
      // A triangle with corners on both the jaw side and the upper-lip side
      // straddles the lip seam — it's what stretches across the gap when the
      // jaw opens, so it's mouth interior, not lip.
      let jawSide = 0;
      for (let c = 0; c < 3; c++) if (jawWeight(asset.triVerts[t * 3 + c]) > 0.5) jawSide++;
      out.push(jawSide > 0 && jawSide < 3 ? 'mouth' : 'lips');
      continue;
    }
    // Brow band: an arch over each eye, peaking a little outboard of centre.
    const eye = x > 0 ? eyeL : eyeR;
    const dx = (Math.abs(x) - Math.abs(eye[0])) / u;    // + = outward
    const front = y < eye[1] + u * 0.1;
    if (front && dx > -0.6 && dx < 0.8) {
      const centre = eye[2] + u * (0.62 - 0.35 * (dx - 0.2) * (dx - 0.2));
      const halfThick = u * (0.11 - 0.05 * Math.max(0, dx - 0.2));
      if (Math.abs(z - centre) < halfThick) { out.push('brows'); continue; }
    }
    out.push('skin');
  }
  return out;
}

/** The full pipeline: numbers in, posed + scaled + grounded mesh parts out. */
export function buildHumanMesh(asset: HumanAsset, opts: HumanOptions = {}): HumanMesh {
  const body = { ...DEFAULT_BODY, ...(opts.body ?? {}), ethnicity: { ...DEFAULT_BODY.ethnicity, ...(opts.body?.ethnicity ?? {}) } };
  const face = { ...DEFAULT_FACE, ...(opts.face ?? {}) };
  const torso = { ...DEFAULT_TORSO, ...(opts.torso ?? {}) };
  const rest = applyMorphs(asset, morphWeights(asset, body, face, torso, opts.morphs));
  const joints = jointPositions(asset, rest);

  // Scale from the unposed body (skin only — helpers like the hair cap stick
  // out) so a pose never changes the print size.
  let zMin = Infinity, zMax = -Infinity;
  for (let t = 0; t < asset.nT; t++) {
    if (asset.triLabel[t] !== 0) continue;
    for (let c = 0; c < 3; c++) { const z = rest[asset.triVerts[t * 3 + c] * 3 + 2]; if (z < zMin) zMin = z; if (z > zMax) zMax = z; }
  }
  const k = (opts.height ?? 60) / (zMax - zMin);

  const xf = solvePose(asset, joints, opts.pose ?? {}, opts.expression ?? {});
  const posed = skin(asset, rest, xf, opts.skinning ?? 'dq');
  let pMin = Infinity;
  for (let t = 0; t < asset.nT; t++) {
    if (asset.triLabel[t] > 1) continue;
    for (let c = 0; c < 3; c++) { const z = posed[asset.triVerts[t * 3 + c] * 3 + 2]; if (z < pMin) pMin = z; }
  }
  for (let i = 0; i < posed.length; i += 3) {
    posed[i] *= k; posed[i + 1] *= k; posed[i + 2] = (posed[i + 2] - pMin) * k;
  }
  const bonesWorld = {
    R: xf.R,
    T: xf.T.map((t) => [t[0] * k, t[1] * k, (t[2] - pMin) * k] as Vec3),
  };
  // Every bone's head and tail joint, carried by that bone's transform.
  const posedJoints = new Map<string, Vec3>();
  asset.bones.forEach((b, i) => {
    for (const j of [b.head, b.tail]) {
      const name = asset.joints[j].name;
      const r = apply(xf.R[i], joints.get(name)!);
      posedJoints.set(name, [(r[0] + xf.T[i][0]) * k, (r[1] + xf.T[i][1]) * k, (r[2] + xf.T[i][2] - pMin) * k]);
    }
  });

  // Iris / pupil: the eyeball triangles inside a cone around each eye's
  // forward axis (−Y in the rest pose), measured from that eyeball's centroid.
  const IRIS = Math.cos(28 * DEG), PUPIL = Math.cos(12 * DEG);
  const eyeCentre = [[0, 0, 0, 0], [0, 0, 0, 0]];
  for (let t = 0; t < asset.nT; t++) {
    if (asset.triLabel[t] !== 1) continue;
    for (let c = 0; c < 3; c++) {
      const v = asset.triVerts[t * 3 + c];
      const e = eyeCentre[rest[v * 3] > 0 ? 0 : 1];
      e[0] += rest[v * 3]; e[1] += rest[v * 3 + 1]; e[2] += rest[v * 3 + 2]; e[3]++;
    }
  }
  const eyeLabels: HumanLabel[] = [];
  for (let t = 0; t < asset.nT; t++) {
    if (asset.triLabel[t] !== 1) continue;
    let cx = 0, cy = 0, cz = 0;
    for (let c = 0; c < 3; c++) { const v = asset.triVerts[t * 3 + c]; cx += rest[v * 3] / 3; cy += rest[v * 3 + 1] / 3; cz += rest[v * 3 + 2] / 3; }
    const e = eyeCentre[cx > 0 ? 0 : 1];
    const d = norm([cx - e[0] / e[3], cy - e[1] / e[3], cz - e[2] / e[3]]);
    const fwd = -d[1];
    eyeLabels.push(fwd > PUPIL ? 'pupil' : fwd > IRIS ? 'iris' : 'eyes');
  }

  const skinLabels = faceLabels(asset, rest, joints);

  const parts: HumanMesh['parts'] = [];
  for (const [label, id] of [['skin', 0], ['eyes', 1]] as const) {
    const remap = new Int32Array(asset.nV).fill(-1);
    const verts: number[] = [];
    const tris: number[] = [];
    for (let t = 0; t < asset.nT; t++) {
      if (asset.triLabel[t] !== id) continue;
      for (let c = 0; c < 3; c++) {
        const v = asset.triVerts[t * 3 + c];
        if (remap[v] < 0) { remap[v] = verts.length / 3; verts.push(posed[v * 3], posed[v * 3 + 1], posed[v * 3 + 2]); }
        tris.push(remap[v]);
      }
    }
    parts.push({ label, positions: new Float32Array(verts), triVerts: new Uint32Array(tris) });
  }
  return { parts, eyeLabels, skinLabels, scale: k, posed, rest, joints: posedJoints, bones: bonesWorld };
}
