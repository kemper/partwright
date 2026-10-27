// Style presets for the parametric human: anime, chibi, Funko-style toy,
// heroic comic proportions. Pure (no WASM).
//
// A style reshapes the REST pose before anything else sees it, so the
// skeleton, the pose, clothing, hair and accessories all follow for free:
//
//   - per-bone affine transforms, composed down the skeleton: a uniform scale
//     for the head and eyeballs, a length / girth scale along each limb, and a
//     uniform scale for hands and feet. Every vertex (helpers included, so the
//     joints move with the skin) blends its bones' transforms by skin weight.
//   - extra MakeHuman sliders (bigger eye openings, a smaller nose and mouth,
//     a rounder or squarer head) layered under the user's own `morphs`.
//   - iris / pupil cone sizes and default paint (a toy's solid black eyes).

// Kept free of humanModel imports (humanModel imports this module).
type Vec3 = [number, number, number];
/** The slice of the human asset a restyle needs. */
interface SkinnedAsset {
  nV: number;
  nT: number;
  triVerts: ArrayLike<number>;
  /** 0 = body skin. */
  triLabel: ArrayLike<number>;
  skinIndex: Uint8Array;
  skinWeight: Float32Array;
  bones: { name: string; parent: number }[];
}

export const STYLE_PRESETS = ['realistic', 'anime', 'chibi', 'funko', 'heroic'] as const;
export type StylePreset = typeof STYLE_PRESETS[number];

/** Proportion knobs (1 = MakeHuman's own proportions). */
export interface HumanStyle {
  /** Head size (uniform, about the base of the skull). */
  head: number;
  /** Eyeball size (uniform, about each eye's centre). Pair with an eye-opening morph. */
  eyes: number;
  /** Leg length and girth. */
  legs: number;
  legGirth: number;
  /** Arm length and girth. */
  arms: number;
  armGirth: number;
  hands: number;
  feet: number;
  /** Trunk height (squashes the spine; arms and head ride along). */
  torso: number;
  /** Iris and pupil cone half-angles, in degrees (realistic eyes). */
  iris: number;
  pupil: number;
  /** Smoothing passes over the face and head (simplifies the anatomy). */
  smooth: number;
  /** 0–1: pull the head toward a fitted superellipsoid (a toy's simple head). */
  simplify: number;
  /** Superellipsoid exponent for `simplify`: 2 = round, 3–4 = boxy. */
  headShape: number;
  /** 'real' eyeballs, or sculpted 'anime' / 'toy' eyes seated on the face. */
  eyeShape: 'real' | 'anime' | 'toy';
}

/** The numeric knobs (eyeShape is the one string). */
export const STYLE_KEYS = ['head', 'eyes', 'legs', 'legGirth', 'arms', 'armGirth', 'hands', 'feet', 'torso', 'iris', 'pupil', 'smooth', 'simplify', 'headShape'] as const;
export const EYE_SHAPES = ['real', 'anime', 'toy'] as const;

const REALISTIC: HumanStyle = { head: 1, eyes: 1, legs: 1, legGirth: 1, arms: 1, armGirth: 1, hands: 1, feet: 1, torso: 1, iris: 28, pupil: 12, smooth: 0, simplify: 0, headShape: 2, eyeShape: 'real' };

interface Preset { style: Partial<HumanStyle>; morphs: Record<string, number>; colors: Record<string, string> }

const PRESETS: Record<StylePreset, Preset> = {
  realistic: { style: {}, morphs: {}, colors: {} },
  anime: {
    style: { head: 1.12, eyes: 1, legs: 1.08, legGirth: 0.94, arms: 1.02, armGirth: 0.93, hands: 0.92, feet: 0.9, smooth: 4, eyeShape: 'anime' },
    morphs: {
      'l-eye-scale': 1, 'r-eye-scale': 1, 'l-eye-height2': 0.6, 'r-eye-height2': 0.6,
      'nose-scale-horiz': -0.7, 'nose-scale-vert': -0.5, 'nose-scale-depth': -0.5, 'nose-point-width': -0.6,
      'mouth-scale-horiz': -0.45, 'mouth-scale-vert': -0.3, 'chin-width': -0.6, 'chin-height': -0.2,
      'head-oval': 0.6, 'neck-scale-horiz': -0.4,
    },
    colors: {},
  },
  chibi: {
    style: { head: 2.0, eyes: 1.15, legs: 0.6, legGirth: 1, arms: 0.68, armGirth: 1, hands: 1.2, feet: 1.3, torso: 0.78, smooth: 12, simplify: 0.3, headShape: 2, eyeShape: 'anime' },
    morphs: {
      'l-eye-scale': 1, 'r-eye-scale': 1, 'l-eye-height2': 0.8, 'r-eye-height2': 0.8,
      'nose-scale-horiz': -0.9, 'nose-scale-vert': -0.8, 'nose-scale-depth': -0.8,
      'mouth-scale-horiz': -0.6, 'chin-width': -0.3, 'head-round': 1, 'head-fat': 0.4,
    },
    colors: {},
  },
  funko: {
    style: { head: 2.6, eyes: 1, legs: 0.5, legGirth: 1.08, arms: 0.62, armGirth: 1.08, hands: 1.1, feet: 1.35, torso: 0.72, smooth: 30, simplify: 0.92, headShape: 3, eyeShape: 'toy' },
    morphs: {
      'nose-scale-horiz': -1, 'nose-scale-vert': -1, 'nose-scale-depth': -1,
      'mouth-scale-horiz': -1, 'mouth-scale-vert': -1, 'head-square': 1, 'head-fat': 0.6,
    },
    // Solid black eyes and no painted mouth or brows.
    colors: { eyes: '#111111', lips: '@skin', mouth: '@skin', brows: '@skin' },
  },
  heroic: {
    style: { head: 0.9, eyes: 1, legs: 1.08, legGirth: 1.04, arms: 1.04, armGirth: 1.06, hands: 1.05, feet: 1, iris: 28, pupil: 12 },
    morphs: { 'torso-vshape': 0.8, 'torso-muscle-pectoral': 0.6, 'torso-muscle-dorsi': 0.6, 'neck-scale-horiz': 0.4, 'chin-width': 0.4, 'chin-prominent': 0.3 },
    colors: {},
  },
};

/** A preset name (or a preset plus overrides) → proportions, extra sliders and colours. */
export function resolveStyle(preset: StylePreset, overrides: Partial<HumanStyle> = {}): Preset & { style: HumanStyle } {
  const p = PRESETS[preset];
  return { style: { ...REALISTIC, ...p.style, ...overrides }, morphs: p.morphs, colors: p.colors };
}

/** True when the style leaves the rest pose untouched. */
export function isRealistic(s: HumanStyle): boolean {
  return s.smooth === 0 && s.simplify === 0 && STYLE_KEYS.every((k) => k === 'iris' || k === 'pupil' || k === 'smooth' || k === 'simplify' || k === 'headShape' || s[k] === 1);
}

type Mat3 = number[];   // row-major
interface Affine { A: Mat3; t: Vec3 }
const I3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
function mul(a: Mat3, b: Mat3): Mat3 {
  const o = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return o;
}
const apply = (A: Mat3, p: Vec3): Vec3 => [A[0] * p[0] + A[1] * p[1] + A[2] * p[2], A[3] * p[0] + A[4] * p[1] + A[5] * p[2], A[6] * p[0] + A[7] * p[1] + A[8] * p[2]];
/** Scale by `along` in direction d, `across` perpendicular to it. */
function stretch(d: Vec3, along: number, across: number): Mat3 {
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  const n = [d[0] / l, d[1] / l, d[2] / l];
  const m: Mat3 = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) m.push((r === c ? across : 0) + (along - across) * n[r] * n[c]);
  return m;
}

/**
 * Reshape rest positions (every asset vertex, in place copy) by the style's
 * per-bone transforms. `joints` are the rest joints of `rest`.
 */
export function restyle(asset: SkinnedAsset, rest: Float32Array, joints: Map<string, Vec3>, s: HumanStyle): Float32Array {
  const J = (n: string) => joints.get(`${n}____head`)!;
  // Local transform per bone that starts a styled subtree: [matrix, centre].
  const local = new Map<string, [Mat3, Vec3]>();
  const uniform = (k: number): Mat3 => [k, 0, 0, 0, k, 0, 0, 0, k];
  if (s.head !== 1) local.set('head', [uniform(s.head), J('head')]);
  if (s.torso !== 1) {
    const lo = J('spine04'), hi = J('neck01');
    local.set('spine04', [stretch([hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]], s.torso, 1), lo]);
  }
  for (const side of ['L', 'R']) {
    if (s.eyes !== 1) local.set(`eye.${side}`, [uniform(s.eyes), J(`eye.${side}`)]);
    if (s.legs !== 1 || s.legGirth !== 1) {
      const hip = J(`upperleg01.${side}`), ankle = J(`foot.${side}`);
      local.set(`upperleg01.${side}`, [stretch([ankle[0] - hip[0], ankle[1] - hip[1], ankle[2] - hip[2]], s.legs, s.legGirth), hip]);
    }
    if (s.arms !== 1 || s.armGirth !== 1) {
      const sh = J(`upperarm01.${side}`), wr = J(`wrist.${side}`);
      local.set(`upperarm01.${side}`, [stretch([wr[0] - sh[0], wr[1] - sh[1], wr[2] - sh[2]], s.arms, s.armGirth), sh]);
    }
    if (s.hands !== 1) local.set(`wrist.${side}`, [uniform(s.hands), J(`wrist.${side}`)]);
    if (s.feet !== 1) local.set(`foot.${side}`, [uniform(s.feet), J(`foot.${side}`)]);
  }
  // Compose down the skeleton (bones are stored parent-first).
  const xf: Affine[] = [];
  asset.bones.forEach((b, i) => {
    const parent = b.parent >= 0 ? xf[b.parent] : { A: I3, t: [0, 0, 0] as Vec3 };
    const l = local.get(b.name);
    if (!l) { xf[i] = parent; return; }
    const [S, c] = l;
    // x → parent(c + S (x − c))
    const A = mul(parent.A, S);
    const sc = apply(S, c);
    const pc = apply(parent.A, [c[0] - sc[0], c[1] - sc[1], c[2] - sc[2]]);
    xf[i] = { A, t: [pc[0] + parent.t[0], pc[1] + parent.t[1], pc[2] + parent.t[2]] };
  });
  const out = new Float32Array(rest.length);
  for (let v = 0; v < asset.nV; v++) {
    const p: Vec3 = [rest[v * 3], rest[v * 3 + 1], rest[v * 3 + 2]];
    let x = 0, y = 0, z = 0, wsum = 0;
    for (let k = 0; k < 4; k++) {
      const w = asset.skinWeight[v * 4 + k];
      if (w <= 0) continue;
      const f = xf[asset.skinIndex[v * 4 + k]];
      const q = apply(f.A, p);
      x += w * (q[0] + f.t[0]); y += w * (q[1] + f.t[1]); z += w * (q[2] + f.t[2]); wsum += w;
    }
    if (wsum > 0) { out[v * 3] = x / wsum; out[v * 3 + 1] = y / wsum; out[v * 3 + 2] = z / wsum; } else out.set(p, v * 3);
  }
  if (s.simplify > 0) simplifyHead(asset, out, s.simplify, s.headShape);
  if (s.smooth > 0) smoothHead(asset, out, Math.round(s.smooth));
  return out;
}

/** Per-vertex weight on the head's own bones (not the eyeballs). */
function headWeights(asset: SkinnedAsset): Float32Array {
  const head = new Set<number>();
  asset.bones.forEach((b, i) => { if (b.name === 'head' || (b.parent >= 0 && head.has(b.parent))) head.add(i); });
  const eyeBones = new Set<number>();
  asset.bones.forEach((b, i) => { if (b.name.startsWith('eye.') || (b.parent >= 0 && eyeBones.has(b.parent))) eyeBones.add(i); });
  const w = new Float32Array(asset.nV);
  for (let v = 0; v < asset.nV; v++) {
    for (let k = 0; k < 4; k++) {
      const bone = asset.skinIndex[v * 4 + k];
      if (head.has(bone) && !eyeBones.has(bone)) w[v] += asset.skinWeight[v * 4 + k];
    }
  }
  return w;
}

/**
 * Pull the head's outward-facing skin toward a superellipsoid fitted to it.
 * Only skin that faces away from the head's centre moves, so the inside of
 * the mouth (which faces inward) never gets pushed through the face.
 */
function simplifyHead(asset: SkinnedAsset, pos: Float32Array, amount: number, n: number): void {
  const w = headWeights(asset);
  const isSkin = new Uint8Array(asset.nV);
  for (let t = 0; t < asset.nT; t++) if (asset.triLabel[t] === 0) for (let c = 0; c < 3; c++) isSkin[asset.triVerts[t * 3 + c]] = 1;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < asset.nV; v++) {
    if (!isSkin[v] || w[v] < 0.95) continue;
    for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], pos[v * 3 + c]); hi[c] = Math.max(hi[c], pos[v * 3 + c]); }
  }
  const ctr = [0, 1, 2].map((c) => (lo[c] + hi[c]) / 2);
  const rad = [0, 1, 2].map((c) => (hi[c] - lo[c]) / 2);
  // Vertex normals, to tell outward-facing skin from the mouth's inside.
  const nrm = new Float32Array(asset.nV * 3);
  for (let t = 0; t < asset.nT; t++) {
    if (asset.triLabel[t] !== 0) continue;
    const a = asset.triVerts[t * 3], b = asset.triVerts[t * 3 + 1], c = asset.triVerts[t * 3 + 2];
    const u = [pos[b * 3] - pos[a * 3], pos[b * 3 + 1] - pos[a * 3 + 1], pos[b * 3 + 2] - pos[a * 3 + 2]];
    const v2 = [pos[c * 3] - pos[a * 3], pos[c * 3 + 1] - pos[a * 3 + 1], pos[c * 3 + 2] - pos[a * 3 + 2]];
    const nx = u[1] * v2[2] - u[2] * v2[1], ny = u[2] * v2[0] - u[0] * v2[2], nz = u[0] * v2[1] - u[1] * v2[0];
    for (const q of [a, b, c]) { nrm[q * 3] += nx; nrm[q * 3 + 1] += ny; nrm[q * 3 + 2] += nz; }
  }
  for (let v = 0; v < asset.nV; v++) {
    if (!isSkin[v] || w[v] < 0.05) continue;
    const u = [pos[v * 3] - ctr[0], pos[v * 3 + 1] - ctr[1], pos[v * 3 + 2] - ctr[2]];
    const ul = Math.hypot(u[0], u[1], u[2]) || 1;
    const nl = Math.hypot(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]) || 1;
    const facing = (u[0] * nrm[v * 3] + u[1] * nrm[v * 3 + 1] + u[2] * nrm[v * 3 + 2]) / (ul * nl);
    if (facing < 0.2) continue;
    let sum = 0;
    for (let c = 0; c < 3; c++) sum += Math.abs(u[c] / rad[c]) ** n;
    const t = sum ** (-1 / n);
    // Fade in from the neck (head weight) and with how squarely the skin faces out.
    const k = amount * Math.min(1, w[v]) * Math.min(1, (facing - 0.2) / 0.4);
    for (let c = 0; c < 3; c++) pos[v * 3 + c] += (ctr[c] + u[c] * t - pos[v * 3 + c]) * k;
  }
}

/** Taubin passes over the skin of the head (weight ≥ HEAD_SMOOTH_MIN on the
 *  head's bones), fading out down the neck, so a stylized face loses the
 *  small anatomy (nostrils, lip lines, brow ridges) without shrinking. */
const HEAD_SMOOTH_MIN = 0.5;
function smoothHead(asset: SkinnedAsset, pos: Float32Array, passes: number): void {
  const w = headWeights(asset);
  const nbr: number[][] = Array.from({ length: asset.nV }, () => []);
  for (let t = 0; t < asset.nT; t++) {
    if (asset.triLabel[t] !== 0) continue;
    for (let c = 0; c < 3; c++) {
      const a = asset.triVerts[t * 3 + c], b = asset.triVerts[t * 3 + (c + 1) % 3];
      nbr[a].push(b); nbr[b].push(a);
    }
  }
  const step = (lambda: number) => {
    const prev = pos.slice();
    for (let v = 0; v < asset.nV; v++) {
      const ns = nbr[v];
      if (!ns.length || w[v] < 0.05) continue;
      const k = lambda * Math.min(1, w[v] / HEAD_SMOOTH_MIN);
      for (let c = 0; c < 3; c++) {
        let m = 0;
        for (const j of ns) m += prev[j * 3 + c];
        pos[v * 3 + c] += k * (m / ns.length - prev[v * 3 + c]);
      }
    }
  };
  for (let i = 0; i < passes; i++) { step(0.5); step(-0.53); }
}
