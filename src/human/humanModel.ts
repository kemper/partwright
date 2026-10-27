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

export interface HumanTarget { name: string; count: number; quantum: number; idx: Uint16Array; delta: Int16Array }
export interface HumanBone { name: string; parent: number; head: number; tail: number }

export interface HumanAsset {
  nV: number;
  nT: number;
  positions: Float32Array;
  triVerts: Uint16Array;
  /** 0 = body skin, 1 = eyeball. */
  triLabel: Uint8Array;
  skinIndex: Uint8Array;
  skinWeight: Float32Array;
  joints: { name: string; verts: number[] }[];
  bones: HumanBone[];
  targets: Map<string, HumanTarget>;
}

/** Layout of public/human/hm08.json (written by scripts/human/build-human-assets.mjs). */
export interface HumanAssetMeta {
  nV: number;
  nT: number;
  offsets: { positions: number; triVerts: number; triLabel: number; skinIndex: number; skinWeight: number };
  joints: { name: string; verts: number[] }[];
  bones: HumanBone[];
  targets: { name: string; count: number; quantum: number; idx: number; delta: number }[];
}

export function parseHumanAsset(meta: HumanAssetMeta, buf: ArrayBuffer): HumanAsset {
  const o = meta.offsets;
  const targets = new Map<string, HumanTarget>();
  for (const t of meta.targets) {
    targets.set(t.name, {
      name: t.name, count: t.count, quantum: t.quantum,
      idx: new Uint16Array(buf, t.idx, t.count),
      delta: new Int16Array(buf, t.delta, t.count * 3),
    });
  }
  return {
    nV: meta.nV,
    nT: meta.nT,
    positions: new Float32Array(buf, o.positions, meta.nV * 3),
    triVerts: new Uint16Array(buf, o.triVerts, meta.nT * 3),
    triLabel: new Uint8Array(buf, o.triLabel, meta.nT),
    skinIndex: new Uint8Array(buf, o.skinIndex, meta.nV * 4),
    skinWeight: new Float32Array(buf, o.skinWeight, meta.nV * 4),
    joints: meta.joints,
    bones: meta.bones,
    targets,
  };
}

// --- Morphs -------------------------------------------------------------------

export interface HumanBody {
  /** 0 = female, 1 = male. */
  gender: number;
  /** Years, 25–90 (adult range of the shipped targets). */
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

/** Bidirectional detail morphs, each −1…1 (0 = neutral). */
export interface HumanFace {
  jawWidth: number; chin: number; cheekbones: number;
  noseWidth: number; noseLength: number; mouthWidth: number; eyeSize: number;
  /** 0–1 toward a square head. */
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

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/** Weights of the min / average / max corners for a 0–1 slider. */
function triWeights(v: number): [number, number, number] {
  const t = clamp(v, 0, 1);
  return t < 0.5 ? [1 - 2 * t, 2 * t, 0] : [0, 2 - 2 * t, 2 * t - 1];
}

/** Every target name → weight for these parameters (zero weights omitted). */
export function morphWeights(body: HumanBody, face: HumanFace, torso: HumanTorso): Map<string, number> {
  const w = new Map<string, number>();
  const add = (name: string, v: number) => { if (v !== 0) w.set(name, (w.get(name) ?? 0) + v); };

  const g = clamp(body.gender, 0, 1);
  const gender: [string, number][] = [['female', 1 - g], ['male', g]];
  const a = clamp((body.age - 25) / 65, 0, 1);
  const age: [string, number][] = [['young', 1 - a], ['old', a]];
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
  add('breast/female-young-averagemuscle-averageweight-maxcup-averagefirmness', clamp(body.breast, 0, 1) * (1 - g));

  const bi = (base: string, v: number) => {
    const t = clamp(v, -1, 1);
    if (t < 0) add(`${base}-decr`, -t); else if (t > 0) add(`${base}-incr`, t);
  };
  bi('chin/chin-width', face.jawWidth);
  bi('chin/chin-prominent', face.chin);
  bi('cheek/l-cheek-bones', face.cheekbones);
  bi('cheek/r-cheek-bones', face.cheekbones);
  bi('nose/nose-scale-horiz', face.noseWidth);
  bi('nose/nose-scale-vert', face.noseLength);
  bi('mouth/mouth-scale-horiz', face.mouthWidth);
  bi('eyes/l-eye-scale', face.eyeSize);
  bi('eyes/r-eye-scale', face.eyeSize);
  add('head/head-square', clamp(face.headSquare, 0, 1));
  bi('torso/torso-vshape', torso.vShape);
  bi('stomach/stomach-pregnant', torso.belly);
  return w;
}

/** Base mesh + weighted targets → a fresh position array. */
export function applyMorphs(asset: HumanAsset, weights: Map<string, number>): Float32Array {
  const out = new Float32Array(asset.positions);
  for (const [name, wt] of weights) {
    const t = asset.targets.get(name);
    if (!t) continue;
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

/** The fraction `t` of rotation `m` (same axis, t × angle). */
function partial(m: Mat3, t: number): Mat3 {
  const cos = clamp((m[0] + m[4] + m[8] - 1) / 2, -1, 1);
  const ang = Math.acos(cos);
  if (ang < 1e-9) return I3;
  const axis = norm([m[7] - m[5], m[2] - m[6], m[3] - m[1]]);
  return axisAngle(axis, (ang / DEG) * t);
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
export const STANDING_ARM: LimbPose = { raiseSide: 9, raiseFwd: 0, bend: 8, twist: 0 };

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

/**
 * Per-bone skinning transforms for a pose: world rotation `R[b]` and the
 * translation so that x' = R[b]·(x − head_b) + head'_b. Bones without a pose
 * override inherit their parent's rotation (rigid follow).
 */
export function solvePose(asset: HumanAsset, joints: Map<string, Vec3>, pose: HumanPose | 'rest'): { R: Mat3[]; T: Vec3[] } {
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

  const R: Mat3[] = new Array(bones.length);
  const T: Vec3[] = new Array(bones.length);
  const headPos = bones.map((b) => joints.get(asset.joints[b.head].name)!);
  bones.forEach((b, i) => {
    const parent = b.parent;
    R[i] = override.get(i) ?? (parent >= 0 ? R[parent] : I3);
    // The bone's head rides its parent's transform.
    const h = headPos[i];
    const newHead: Vec3 = parent >= 0 ? (() => { const r = apply(R[parent], sub(h, headPos[parent])); const t = T[parent]; return [r[0] + t[0], r[1] + t[1], r[2] + t[2]] as Vec3; })() : h;
    // Store the translation as "posed head", applied as R·(x − head) + newHead.
    T[i] = newHead;
  });
  // Convert to x' = R·x + t form.
  const t: Vec3[] = bones.map((_, i) => { const rh = apply(R[i], headPos[i]); return [T[i][0] - rh[0], T[i][1] - rh[1], T[i][2] - rh[2]]; });
  return { R, T: t };
}

/** Linear-blend skin `pos` with the asset's weights. */
export function skin(asset: HumanAsset, pos: Float32Array, xf: { R: Mat3[]; T: Vec3[] }): Float32Array {
  const out = new Float32Array(pos.length);
  const { skinIndex, skinWeight } = asset;
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

export interface HumanOptions {
  body?: Partial<HumanBody>;
  face?: Partial<HumanFace>;
  torso?: Partial<HumanTorso>;
  pose?: HumanPose | 'rest';
  /** Print height (world units) of the unposed figure, soles to crown. */
  height?: number;
}

export type HumanLabel = 'skin' | 'eyes' | 'iris' | 'pupil';

export interface HumanMesh {
  /** xyz per vertex (world units, soles at z = 0). */
  positions: Float32Array;
  /** Body (`skin`) and the two eyeballs (`eyes`), each re-indexed per part. */
  parts: { label: 'skin' | 'eyes'; positions: Float32Array; triVerts: Uint32Array }[];
  /** Per eyeball triangle (in `eyes` part order): its paint label. The iris and
   *  pupil are the front cap of each eyeball, classified in the rest pose. */
  eyeLabels: HumanLabel[];
  joints: Map<string, Vec3>;
}

/** The full pipeline: numbers in, posed + scaled + grounded mesh parts out. */
export function buildHumanMesh(asset: HumanAsset, opts: HumanOptions = {}): HumanMesh {
  const body = { ...DEFAULT_BODY, ...(opts.body ?? {}), ethnicity: { ...DEFAULT_BODY.ethnicity, ...(opts.body?.ethnicity ?? {}) } };
  const face = { ...DEFAULT_FACE, ...(opts.face ?? {}) };
  const torso = { ...DEFAULT_TORSO, ...(opts.torso ?? {}) };
  const rest = applyMorphs(asset, morphWeights(body, face, torso));
  const joints = jointPositions(asset, rest);

  // Scale from the unposed figure so a pose never changes the print size.
  let zMin = Infinity, zMax = -Infinity;
  for (let t = 0; t < asset.nT * 3; t++) { const z = rest[asset.triVerts[t] * 3 + 2]; if (z < zMin) zMin = z; if (z > zMax) zMax = z; }
  const k = (opts.height ?? 60) / (zMax - zMin);

  const posed = skin(asset, rest, solvePose(asset, joints, opts.pose ?? {}));
  let pMin = Infinity;
  for (let t = 0; t < asset.nT * 3; t++) { const z = posed[asset.triVerts[t] * 3 + 2]; if (z < pMin) pMin = z; }
  for (let i = 0; i < posed.length; i += 3) {
    posed[i] *= k; posed[i + 1] *= k; posed[i + 2] = (posed[i + 2] - pMin) * k;
  }
  const scaledJoints = new Map<string, Vec3>();
  for (const [n, p] of joints) scaledJoints.set(n, [p[0] * k, p[1] * k, (p[2] - zMin) * k]);

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
  return { positions: posed, parts, eyeLabels, joints: scaledJoints };
}
