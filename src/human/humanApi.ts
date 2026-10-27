// `api.human(opts)` — the parametric MakeHuman-based character as a Manifold.
//
//   api.human({
//     height: 60,                                   // print height, soles → crown
//     body:  { gender: 0.2, age: 30, muscle: 0.6, weight: 0.4, stature: 0.5, breast: 0.4 },
//     face:  { jawWidth: 0.3, cheekbones: 0.5, noseWidth: -0.2, eyeSize: 0.2 },
//     torso: { vShape: 0.3 },
//     pose:  { armL: { raiseSide: 40, bend: 30 }, legR: { raiseFwd: 20, bend: 25 }, head: { yaw: -15 } },
//     weld:  'mesh' | 'voxel',                      // see below
//     base:  true,
//   })
//
// Returns one Manifold labelled `skin`, `eyes` (sclera), `iris`, `pupil` and
// (optionally) `base`. weld 'mesh' (default) keeps the exact skinned surface —
// crisp, and valid whenever the pose doesn't push skin through skin. weld
// 'voxel' re-solidifies the body through a signed-distance lattice (nonzero
// winding, so overlaps from a deep bend merge instead of cancelling) into one
// clean watertight solid, at the cost of ~voxel-size detail.
import {
  assertObject, assertNoUnknownKeys, assertNumber, assertEnum, ValidationError,
} from '../validation/apiValidation';
import {
  rasterizeOccupancy, edt3dSquared, makeTrilinearSampler, blurField, type GridSpec,
} from '../geometry/meshSdf';
import {
  buildHumanMesh, type HumanAsset, type HumanOptions, type HumanPose, type HumanExpression, type HandPose,
  DEFAULT_BODY, DEFAULT_FACE, DEFAULT_TORSO, EXPRESSION_KEYS, EXPRESSION_PRESETS, HAND_POSES,
} from './humanModel';
import { getHumanAsset } from './humanAsset';
import { buildWear, WEAR_ITEMS, ARMOR_ITEMS, type WearOptions } from './humanWear';
import { buildGear, computeSockets, socketMatrix, ACCESSORY_ITEMS, PROP_ITEMS, type GearOptions } from './humanGear';
import { buildHairField, HAIR_STYLES, HAIR_FRINGES, BEARD_STYLES, type HairOptions, type HairStyle } from './humanHair';

const DOC = 'See /ai/human.md';
const LIMB_KEYS = ['raiseSide', 'raiseFwd', 'bend', 'twist'] as const;
/** Default paint per label; override with `colors` or `api.paint.label`. */
const DEFAULT_COLORS: Record<string, string> = {
  skin: '#c68642', lips: '#a3584a', mouth: '#5a2622', brows: '#3a2a20', eyes: '#f4f4f0', iris: '#5b3a21', pupil: '#161616', base: '#4a4a4a', hair: '#3b2a1e',
};
// voxel-weld lattice bounds — API contract limits like meshSdfOps' resolution
// cap, not tuning knobs: callers pick `voxel` per call. The default (height/300)
// keeps a 60-unit figure near ~300k triangles; the sample cap keeps the two
// Float64 distance transforms well under a Worker's memory.
const DEFAULT_VOXEL_FRACTION = 1 / 300;
const MAX_VOXEL_SAMPLES = 8e6;
/** Outward offset of the voxel-welded surface, in voxels. */
const VOXEL_GROW = 0.5;

function numbers(obj: unknown, keys: readonly string[], where: string, lo: number, hi: number): Record<string, number> {
  const o = assertObject(obj, where)!;
  assertNoUnknownKeys(o, keys, where);
  const out: Record<string, number> = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = assertNumber(o[k], `${where}.${k}`, { min: lo, max: hi })!;
  return out;
}

function parsePose(raw: unknown): HumanPose | 'rest' {
  if (raw === 'rest') return 'rest';
  const o = assertObject(raw, 'human.pose')!;
  assertNoUnknownKeys(o, ['armL', 'armR', 'legL', 'legR', 'spine', 'head', 'handL', 'handR'], 'human.pose');
  const pose: HumanPose = {};
  for (const k of ['handL', 'handR'] as const) {
    if (o[k] === undefined) continue;
    pose[k] = typeof o[k] === 'number'
      ? assertNumber(o[k], `human.pose.${k}`, { min: 0, max: 1 })!
      : assertEnum(o[k], HAND_POSES, `human.pose.${k}`) as HandPose;
  }
  for (const k of ['armL', 'armR', 'legL', 'legR'] as const) {
    if (o[k] !== undefined) pose[k] = numbers(o[k], LIMB_KEYS, `human.pose.${k}`, -180, 180);
  }
  if (o.spine !== undefined) pose.spine = numbers(o.spine, ['lean', 'turn', 'side'], 'human.pose.spine', -90, 90);
  if (o.head !== undefined) pose.head = numbers(o.head, ['yaw', 'pitch', 'roll'], 'human.pose.head', -90, 90);
  return pose;
}

function parseOptions(raw: unknown, asset: HumanAsset) {
  const o = raw === undefined ? {} : assertObject(raw, 'human(opts)')!;
  assertNoUnknownKeys(o, ['height', 'body', 'face', 'torso', 'morphs', 'pose', 'expression', 'skinning', 'wear', 'accessories', 'hold', 'hair', 'weld', 'voxel', 'base', 'colors'], 'human(opts)');
  const opts: HumanOptions = {};
  if (o.height !== undefined) opts.height = assertNumber(o.height, 'human.height', { min: 5, max: 2000 })!;
  if (o.body !== undefined) {
    const b = assertObject(o.body, 'human.body')!;
    assertNoUnknownKeys(b, [...Object.keys(DEFAULT_BODY)], 'human.body');
    const { ethnicity, ...rest } = b;
    const nums = numbers(rest, ['gender', 'muscle', 'weight', 'stature', 'breast', 'age'], 'human.body', 0, 90);
    if (nums.age !== undefined && nums.age < 1) throw new ValidationError(`human.body.age must be 1–90 years. ${DOC}`);
    for (const k of ['gender', 'muscle', 'weight', 'stature', 'breast']) {
      if (nums[k] !== undefined && nums[k] > 1) throw new ValidationError(`human.body.${k} must be 0–1. ${DOC}`);
    }
    opts.body = nums;
    if (ethnicity !== undefined) {
      const e = { african: 0, asian: 0, caucasian: 0, ...numbers(ethnicity, ['african', 'asian', 'caucasian'], 'human.body.ethnicity', 0, 1) };
      // The ethnic targets carry most of the gender/age shape; an all-zero mix
      // would silently switch both off.
      if (e.african + e.asian + e.caucasian <= 0) throw new ValidationError(`human.body.ethnicity needs at least one non-zero weight. ${DOC}`);
      opts.body.ethnicity = e;
    }
  }
  if (o.face !== undefined) {
    const { headSquare, ...rest } = assertObject(o.face, 'human.face')!;
    opts.face = numbers(rest, Object.keys(DEFAULT_FACE).filter((k) => k !== 'headSquare'), 'human.face', -1, 1);
    if (headSquare !== undefined) opts.face.headSquare = assertNumber(headSquare, 'human.face.headSquare', { min: 0, max: 1 })!;
  }
  if (o.torso !== undefined) opts.torso = numbers(o.torso, Object.keys(DEFAULT_TORSO), 'human.torso', -1, 1);
  if (o.morphs !== undefined) {
    const m = assertObject(o.morphs, 'human.morphs')!;
    opts.morphs = {};
    for (const [k, v] of Object.entries(m)) {
      const mod = asset.modifiers.get(k);
      if (!mod) throw new ValidationError(`human.morphs.${k} is not a MakeHuman slider. Keys are listed in /ai/human.md#morphs (e.g. "nose-hump", "r-ear-lobe", "torso-scale-horiz").`);
      opts.morphs[k] = assertNumber(v, `human.morphs.${k}`, { min: mod.one ? 0 : -1, max: 1 })!;
    }
  }
  if (o.pose !== undefined) opts.pose = parsePose(o.pose);
  if (o.expression !== undefined) {
    if (typeof o.expression === 'string') {
      const preset = EXPRESSION_PRESETS[o.expression];
      if (!preset) throw new ValidationError(`human.expression must be one of ${Object.keys(EXPRESSION_PRESETS).map((k) => `"${k}"`).join(', ')} or a channel object. ${DOC}`);
      opts.expression = preset;
    } else {
      const e = numbers(o.expression, EXPRESSION_KEYS, 'human.expression', 0, 1);
      opts.expression = e as Partial<HumanExpression>;
    }
  }
  if (o.skinning !== undefined) opts.skinning = assertEnum(o.skinning, ['dq', 'linear'] as const, 'human.skinning');
  const weld = o.weld === undefined ? 'mesh' : assertEnum(o.weld, ['mesh', 'voxel'] as const, 'human.weld');
  const height = opts.height ?? 60;
  if (o.voxel !== undefined && weld !== 'voxel') throw new ValidationError(`human.voxel only applies with weld: 'voxel'. ${DOC}`);
  const voxel = o.voxel === undefined ? height * DEFAULT_VOXEL_FRACTION : assertNumber(o.voxel, 'human.voxel', { min: height / 1000, max: height / 50 })!;
  let base: { radius?: number; thickness: number } | null = null;
  if (o.base === true) base = { thickness: height * 0.04 };
  else if (o.base !== undefined && o.base !== false) {
    const b = numbers(o.base, ['radius', 'thickness'], 'human.base', 0.1, 1000);
    base = { radius: b.radius, thickness: b.thickness ?? height * 0.04 };
  }
  const colors: Record<string, string> = { ...DEFAULT_COLORS };
  if (o.colors !== undefined) {
    const c = assertObject(o.colors, 'human.colors')!;
    assertNoUnknownKeys(c, Object.keys(DEFAULT_COLORS), 'human.colors');
    for (const [k, v] of Object.entries(c)) {
      if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) throw new ValidationError(`human.colors.${k} must be a "#rrggbb" string. ${DOC}`);
      colors[k] = v;
    }
  }
  const wear = o.wear === undefined ? [] : parseWear(o.wear);
  const gear = o.accessories === undefined ? [] : parseGear(o.accessories, 'human.accessories');
  if (o.hold !== undefined) {
    const hold = assertObject(o.hold, 'human.hold')!;
    assertNoUnknownKeys(hold, ['L', 'R'], 'human.hold');
    for (const side of ['L', 'R'] as const) {
      if (hold[side] === undefined) continue;
      const [g] = parseGear([typeof hold[side] === 'string' ? { item: hold[side] } : hold[side]], `human.hold.${side}`);
      if (!(PROP_ITEMS as readonly string[]).includes(g.item)) throw new ValidationError(`human.hold.${side} must be a prop: ${PROP_ITEMS.join(', ')}. ${DOC}`);
      g.hand = side;
      gear.push(g);
      // Close the hand round the handle unless the pose already says how.
      const key = side === 'L' ? 'handL' : 'handR';
      if (opts.pose !== 'rest' && g.item !== 'shield') {
        const pose: HumanPose = opts.pose ?? (opts.pose = {});
        if (pose[key] === undefined) pose[key] = 'grip';
      }
    }
  }
  const hair = o.hair === undefined || o.hair === false ? null : parseHair(o.hair);
  return { opts, weld, voxel, base, colors, wear, gear, hair };
}

/** Hair lattice step as a fraction of the print height. */
const HAIR_VOXEL_FRACTION = 1 / 360;
function parseHair(raw: unknown): HairOptions {
  if (typeof raw === 'string') return { style: assertEnum(raw, HAIR_STYLES, 'human.hair') as HairStyle };
  const o = assertObject(raw, 'human.hair')!;
  assertNoUnknownKeys(o, ['style', 'color', 'length', 'volume', 'fringe', 'beard', 'beardColor', 'beardLength'], 'human.hair');
  const h: HairOptions = { style: o.style === undefined ? 'bald' : assertEnum(o.style, HAIR_STYLES, 'human.hair.style') as HairStyle };
  for (const k of ['color', 'beardColor'] as const) {
    if (o[k] === undefined) continue;
    if (typeof o[k] !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(o[k] as string)) throw new ValidationError(`human.hair.${k} must be a "#rrggbb" string. ${DOC}`);
    h[k] = o[k] as string;
  }
  if (o.length !== undefined) h.length = assertNumber(o.length, 'human.hair.length', { min: 0.3, max: 2.5 })!;
  if (o.volume !== undefined) h.volume = assertNumber(o.volume, 'human.hair.volume', { min: 0.3, max: 2.5 })!;
  if (o.beardLength !== undefined) h.beardLength = assertNumber(o.beardLength, 'human.hair.beardLength', { min: 0.3, max: 3 })!;
  if (o.fringe !== undefined) h.fringe = assertEnum(o.fringe, HAIR_FRINGES, 'human.hair.fringe') as HairOptions['fringe'];
  if (o.beard !== undefined) h.beard = assertEnum(o.beard, BEARD_STYLES, 'human.hair.beard') as HairOptions['beard'];
  return h;
}

const GEAR_KEYS = ['item', 'label', 'color', 'hand', 'size', 'style', 'shape', 'socket', 'offset', 'rotate'] as const;
function parseGear(raw: unknown, where0: string): GearOptions[] {
  if (!Array.isArray(raw)) throw new ValidationError(`${where0} must be an array of item names or { item, … } objects. ${DOC}`);
  return raw.map((entry, i) => {
    const where = `${where0}[${i}]`;
    const o = typeof entry === 'string' ? { item: entry } : assertObject(entry, where)!;
    assertNoUnknownKeys(o, GEAR_KEYS, where);
    const custom = o.shape !== undefined;
    const item = custom ? 'custom' : o.item;
    if (!custom && (typeof item !== 'string' || !(ACCESSORY_ITEMS as readonly string[]).includes(item))) {
      throw new ValidationError(`${where}.item must be one of ${ACCESSORY_ITEMS.map((n) => `"${n}"`).join(', ')} — or pass { shape: <Manifold>, socket } to attach your own. ${DOC}`);
    }
    const out: GearOptions = { item: item as string };
    if (custom) {
      const sh = o.shape as { transform?: unknown };
      if (!sh || typeof sh.transform !== 'function') throw new ValidationError(`${where}.shape must be a Manifold`);
      out.shape = o.shape;
      if (typeof o.socket !== 'string') throw new ValidationError(`${where}.socket is required with shape (e.g. "hand.R", "head", "back", or any bone name). ${DOC}`);
      out.label = typeof o.label === 'string' && o.label ? o.label : 'accessory';
    }
    if (o.socket !== undefined) { if (typeof o.socket !== 'string') throw new ValidationError(`${where}.socket must be a string`); out.socket = o.socket; }
    if (o.label !== undefined) { if (typeof o.label !== 'string' || !o.label) throw new ValidationError(`${where}.label must be a non-empty string`); out.label = o.label; }
    if (o.color !== undefined) { if (typeof o.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(o.color)) throw new ValidationError(`${where}.color must be "#rrggbb"`); out.color = o.color; }
    if (o.hand !== undefined) out.hand = assertEnum(o.hand, ['L', 'R'] as const, `${where}.hand`);
    if (o.size !== undefined) out.size = assertNumber(o.size, `${where}.size`, { min: 0.2, max: 5 })!;
    if (o.style !== undefined) { if (typeof o.style !== 'string') throw new ValidationError(`${where}.style must be a string`); out.style = o.style; }
    for (const k of ['offset', 'rotate'] as const) {
      if (o[k] === undefined) continue;
      const v = o[k];
      if (!Array.isArray(v) || v.length !== 3 || v.some((n) => typeof n !== 'number' || !Number.isFinite(n))) throw new ValidationError(`${where}.${k} must be [x, y, z]`);
      out[k] = v as [number, number, number];
    }
    return out;
  });
}

const WEAR_KEYS = ['item', 'label', 'color', 'thickness', 'fit', 'sleeve', 'neckline', 'length', 'rise', 'flare', 'width'] as const;
/** Default paint per worn item when it has no `color`. */
const WEAR_COLORS: Record<string, string> = {
  shirt: '#e8e4da', top: '#e8e4da', tshirt: '#2f6f8f', sweater: '#8a3b3b', jacket: '#3a4a3a', coat: '#4a3b2e',
  pants: '#2c3144', jeans: '#3b5675', shorts: '#556070', leggings: '#202024', briefs: '#e8e4da', skirt: '#6a3d7a',
  socks: '#f2f2f2', shoes: '#2a2420', sneakers: '#f2f2f2', boots: '#4a3424', gloves: '#3a2a20', belt: '#3b2a1e',
  straps: '#4a3a24', scarf: '#b03a2e',
};
const METAL = '#9aa3ad';
/** Worn items that cover the chest. */
const CHEST_COVER = new Set(['shirt', 'top', 'tshirt', 'sweater', 'jacket', 'coat', 'breastplate', 'cuirass']);

function parseWear(raw: unknown): WearOptions[] {
  if (!Array.isArray(raw)) throw new ValidationError(`human.wear must be an array of item names or { item, … } objects. ${DOC}`);
  const items = [...WEAR_ITEMS, ...ARMOR_ITEMS] as readonly string[];
  return raw.map((entry, i) => {
    const where = `human.wear[${i}]`;
    const o = typeof entry === 'string' ? { item: entry } : assertObject(entry, where)!;
    assertNoUnknownKeys(o, WEAR_KEYS, where);
    if (typeof o.item !== 'string' || !items.includes(o.item)) {
      throw new ValidationError(`${where}.item must be one of ${items.map((n) => `"${n}"`).join(', ')}. ${DOC}`);
    }
    const out: WearOptions = { item: o.item };
    if (o.label !== undefined) { if (typeof o.label !== 'string' || !o.label) throw new ValidationError(`${where}.label must be a non-empty string`); out.label = o.label; }
    if (o.color !== undefined) { if (typeof o.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(o.color)) throw new ValidationError(`${where}.color must be "#rrggbb"`); out.color = o.color; }
    if (o.thickness !== undefined) out.thickness = assertNumber(o.thickness, `${where}.thickness`, { min: 0.2, max: 5 })!;
    if (o.fit !== undefined) out.fit = assertNumber(o.fit, `${where}.fit`, { min: 0, max: 1 })!;
    if (o.flare !== undefined) out.flare = assertNumber(o.flare, `${where}.flare`, { min: 0, max: 1 })!;
    if (o.width !== undefined) out.width = assertNumber(o.width, `${where}.width`, { min: 0.01, max: 0.5 })!;
    if (o.sleeve !== undefined) out.sleeve = assertEnum(o.sleeve, ['none', 'cap', 'short', 'elbow', 'three-quarter', 'long'] as const, `${where}.sleeve`);
    if (o.neckline !== undefined) out.neckline = assertEnum(o.neckline, ['crew', 'scoop', 'v', 'turtle', 'boat'] as const, `${where}.neckline`);
    if (o.rise !== undefined) out.rise = assertEnum(o.rise, ['low', 'mid', 'high'] as const, `${where}.rise`);
    if (o.length !== undefined) {
      if (typeof o.length === 'number') out.length = assertNumber(o.length, `${where}.length`, { min: -20, max: 20 })!;
      else out.length = assertEnum(o.length, ['crop', 'waist', 'hip', 'tunic', 'briefs', 'shorts', 'knee', 'capri', 'full', 'mini', 'midi', 'maxi'] as const, `${where}.length`) as WearOptions['length'];
    }
    return out;
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createHumanNamespace(
  module: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  label: (shape: any, name: string, options?: { color: string }) => any,
  registerRun: (originalID: number, name: string, color?: string) => void,
  /** True for a part the model removed with `api.removePart(name)`. */
  isRemoved: (name: string) => boolean,
) {
  const { Manifold, Mesh } = module;
  const stripProps = (props: Float32Array, numProp: number) => {
    const out = new Float32Array((props.length / numProp) * 3);
    for (let i = 0, j = 0; i < props.length; i += numProp, j += 3) { out[j] = props[i]; out[j + 1] = props[i + 1]; out[j + 2] = props[i + 2]; }
    return out;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function voxelWeld(positions: Float32Array, triVerts: Uint32Array, voxel: number): any {
    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3) for (let c = 0; c < 3; c++) {
      min[c] = Math.min(min[c], positions[i + c]); max[c] = Math.max(max[c], positions[i + c]);
    }
    const pad = voxel * 3;
    min = min.map((v) => v - pad); max = max.map((v) => v + pad);
    const spec: GridSpec = {
      nx: Math.ceil((max[0] - min[0]) / voxel) + 1,
      ny: Math.ceil((max[1] - min[1]) / voxel) + 1,
      nz: Math.ceil((max[2] - min[2]) / voxel) + 1,
      origin: [min[0], min[1], min[2]], voxel,
    };
    if (spec.nx * spec.ny * spec.nz > MAX_VOXEL_SAMPLES) {
      throw new ValidationError(`human: voxel ${voxel} is too fine for this figure (over ${MAX_VOXEL_SAMPLES / 1e6}M lattice samples) — raise it. ${DOC}`);
    }
    const occ = rasterizeOccupancy({ vertProperties: positions, triVerts, numProp: 3, numTri: triVerts.length / 3 }, spec, 'nonzero');
    const dOut = edt3dSquared((i) => occ[i] !== 0, spec.nx, spec.ny, spec.nz);
    const dIn = edt3dSquared((i) => occ[i] === 0, spec.nx, spec.ny, spec.nz);
    let field = new Float32Array(occ.length);
    for (let i = 0; i < field.length; i++) field[i] = (Math.sqrt(dOut[i]) - Math.sqrt(dIn[i])) * voxel;
    field = blurField(field, spec);
    const sample = makeTrilinearSampler(field, spec);
    const bounds = { min: spec.origin, max: [min[0] + (spec.nx - 1) * voxel, min[1] + (spec.ny - 1) * voxel, min[2] + (spec.nz - 1) * voxel] };
    // Grow the surface by half a voxel: fingertips and other features thinner
    // than the lattice otherwise pinch off into pieces joined only by a
    // zero-thickness edge (and a slightly fuller fingertip prints better).
    const grow = voxel * VOXEL_GROW;
    return Manifold.levelSet((p: [number, number, number]) => grow - sample(p[0], p[1], p[2]), bounds, voxel, 0);
  }

  // One closed mesh whose triangles are grouped into runs, one per paint label
  // (skin / lips / brows on the body; sclera / iris / pupil on the eyes):
  // splitting into separate sub-meshes would tear the surface. Each run gets
  // its own originalID, registered as a label exactly like api.importWithParts
  // does. A label removed with `api.removePart` can't cut a hole in a closed
  // surface, so its region folds into the label `fold` names and the removed
  // label disappears.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function labelledMesh(positions: Float32Array, triVerts: Uint32Array, labels: string[], names: string[], fold: (n: string) => string, colors: Record<string, string>): any {
    const order = names.filter((n) => !isRemoved(n));
    const first = Manifold.reserveIDs(order.length);
    const ids = order.map((_, i) => first + i);
    const sorted: number[] = [];
    const runIndex = [0];
    for (const name of order) {
      for (let t = 0; t < labels.length; t++) if (fold(labels[t]) === name) sorted.push(triVerts[t * 3], triVerts[t * 3 + 1], triVerts[t * 3 + 2]);
      runIndex.push(sorted.length);
    }
    const m = Manifold.ofMesh(new Mesh({
      numProp: 3, vertProperties: positions, triVerts: new Uint32Array(sorted),
      runIndex: new Uint32Array(runIndex), runOriginalID: new Uint32Array(ids),
    }));
    order.forEach((name, i) => registerRun(ids[i], name, colors[name]));
    return m;
  }

  function ofMeshSafe(positions: Float32Array, triVerts: Uint32Array, what: string) {
    try {
      return Manifold.ofMesh(new Mesh({ numProp: 3, vertProperties: positions, triVerts }));
    } catch (e) {
      throw new Error(`api.human: the worn "${what}" didn't close into a solid (${(e as Error).message}). Try weld: 'voxel'. ${DOC}`);
    }
  }

  /** Each output triangle takes the label of the nearest source triangle
   *  (centroid to centroid, via a uniform hash grid) — carries the body's paint
   *  labels across the voxel weld, which rebuilds the surface from scratch. */
  function transferLabels(
    srcPos: Float32Array, srcTris: Uint32Array, srcLabels: string[],
    outPos: Float32Array, outTris: Uint32Array, numProp: number, cell: number,
  ): string[] {
    const cellOf = (x: number, y: number, z: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
    const grid = new Map<string, number[]>();
    const cen = new Float64Array(srcLabels.length * 3);
    for (let t = 0; t < srcLabels.length; t++) {
      for (let c = 0; c < 3; c++) {
        const v = srcTris[t * 3 + c];
        for (let k = 0; k < 3; k++) cen[t * 3 + k] += srcPos[v * 3 + k] / 3;
      }
      const key = cellOf(cen[t * 3], cen[t * 3 + 1], cen[t * 3 + 2]);
      const list = grid.get(key);
      if (list) list.push(t); else grid.set(key, [t]);
    }
    const out: string[] = [];
    const nT = outTris.length / 3;
    for (let t = 0; t < nT; t++) {
      let x = 0, y = 0, z = 0;
      for (let c = 0; c < 3; c++) { const v = outTris[t * 3 + c]; x += outPos[v * numProp] / 3; y += outPos[v * numProp + 1] / 3; z += outPos[v * numProp + 2] / 3; }
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
      let best = -1, bestD = Infinity;
      for (let r = 1; r <= 3 && best < 0; r++) {
        for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) for (let k = -r; k <= r; k++) {
          const list = grid.get(`${cx + i},${cy + j},${cz + k}`);
          if (!list) continue;
          for (const s of list) {
            const d = (cen[s * 3] - x) ** 2 + (cen[s * 3 + 1] - y) ** 2 + (cen[s * 3 + 2] - z) ** 2;
            if (d < bestD) { bestD = d; best = s; }
          }
        }
      }
      out.push(best >= 0 ? srcLabels[best] : srcLabels[0]);
    }
    return out;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function human(rawOpts?: unknown): any {
    const asset = getHumanAsset();
    if (!asset) throw new Error(`api.human: the human asset is not loaded (it preloads when the code mentions api.human). ${DOC}`);
    const { opts, weld, voxel, base, colors, wear, gear, hair } = parseOptions(rawOpts, asset);
    // Under a top or a cuirass, soften the nipples (MakeHuman's own sliders)
    // so they don't print through the cloth; explicit morphs still win.
    if (wear.some((w) => CHEST_COVER.has(w.item)) && asset.targets.has('breast/nipple-size-decr')) {
      opts.morphs = { 'nipple-size': -1, 'nipple-point': -1, ...opts.morphs };
    }
    const mesh = buildHumanMesh(asset, opts);
    const worn = buildWear(asset, mesh, wear, opts.height ?? 60);
    // Soles and boots reach below the bare feet: re-ground so the lowest
    // point of the dressed figure sits at z = 0.
    let minZ = 0;
    for (const w of worn) {
      if (w.mesh) for (let i = 2; i < w.mesh.positions.length; i += 3) minZ = Math.min(minZ, w.mesh.positions[i]);
      for (const f of w.fields ?? []) minZ = Math.min(minZ, f.minZ);
    }
    const lift = -minZ;
    if (lift > 0) {
      for (const part of mesh.parts) for (let i = 2; i < part.positions.length; i += 3) part.positions[i] += lift;
      for (const w of worn) if (w.mesh) for (let i = 2; i < w.mesh.positions.length; i += 3) w.mesh.positions[i] += lift;
    }
    const skinPart = mesh.parts.find((p) => p.label === 'skin')!;
    const eyePart = mesh.parts.find((p) => p.label === 'eyes')!;
    const pieces = [];
    if (!isRemoved('skin')) {
      // Lips / brows are painted regions of the one body surface.
      const toSkin = (n: string) => (isRemoved(n) ? 'skin' : n);
      if (weld === 'voxel') {
        const welded = voxelWeld(skinPart.positions, skinPart.triVerts, voxel).getMesh();
        const labels = transferLabels(skinPart.positions, skinPart.triVerts, mesh.skinLabels as string[], welded.vertProperties, welded.triVerts, welded.numProp, voxel * 4);
        pieces.push(labelledMesh(
          welded.numProp === 3 ? welded.vertProperties : stripProps(welded.vertProperties, welded.numProp),
          welded.triVerts, labels, ['skin', 'lips', 'mouth', 'brows'], toSkin, colors,
        ));
      } else {
        pieces.push(labelledMesh(skinPart.positions, skinPart.triVerts, mesh.skinLabels as string[], ['skin', 'lips', 'mouth', 'brows'], toSkin, colors));
      }
    }
    // Removing `eyes` drops the eyeballs (the face is closed behind them);
    // iris / pupil fold outward: pupil → iris → sclera.
    const eyes = isRemoved('eyes') ? null : labelledMesh(
      eyePart.positions, eyePart.triVerts, mesh.eyeLabels as string[], ['eyes', 'iris', 'pupil'],
      function fold(n: string): string { return !isRemoved(n) ? n : n === 'pupil' ? fold('iris') : 'eyes'; }, colors,
    );
    if (eyes) pieces.push(eyes);
    if (gear.length) {
      // Accessories ride the same lift as the clothes.
      for (const g of buildGear(module, asset, mesh, gear, opts.height ?? 60, worn.flatMap((w) => (w.mesh ? [w.mesh.positions] : [])), lift)) {
        if (isRemoved(g.label)) continue;
        const shape = lift > 0 ? (g.manifold as { translate(v: number[]): unknown }).translate([0, 0, lift]) : g.manifold;
        pieces.push(label(shape, g.label, { color: g.color }));
      }
    }
    if (hair && (!isRemoved('hair') || !isRemoved('beard'))) {
      const height = opts.height ?? 60;
      const step = height * HAIR_VOXEL_FRACTION;
      const built = buildHairField(asset, mesh, hair, height, step);
      const { spec } = built;
      const bounds = { min: spec.origin, max: [0, 1, 2].map((c) => spec.origin[c] + ([spec.nx, spec.ny, spec.nz][c] - 1) * step) };
      // Built in the head's rest frame; the head socket carries it into the pose.
      const head = socketMatrix(computeSockets(asset, mesh, height).sockets.get('head')!);
      const mesh1 = (field: Float32Array) => {
        const sample = makeTrilinearSampler(field, spec);
        const shape = Manifold.levelSet((p: [number, number, number]) => -sample(p[0], p[1], p[2]), bounds, step, 0).transform(head);
        return lift > 0 ? shape.translate([0, 0, lift]) : shape;
      };
      if (built.field && !isRemoved('hair')) pieces.push(label(mesh1(built.field), 'hair', { color: hair.color ?? colors.hair }));
      if (built.beard && !isRemoved('beard')) pieces.push(label(mesh1(built.beard), 'beard', { color: hair.beardColor ?? hair.color ?? colors.hair }));
    }
    for (const w of worn) {
      if (isRemoved(w.label)) continue;
      const isMetal = (ARMOR_ITEMS as readonly string[]).includes(w.label);
      const color = w.color ?? WEAR_COLORS[w.label] ?? (isMetal ? METAL : '#888888');
      if (w.mesh) pieces.push(label(ofMeshSafe(w.mesh.positions, w.mesh.triVerts, w.label), w.label, { color }));
      // Footwear comes as one signed-distance field per foot.
      for (const f of w.fields ?? []) {
        const sample = makeTrilinearSampler(f.field, f.spec);
        const { origin, voxel: step, nx, ny, nz } = f.spec;
        const bounds = { min: origin, max: [origin[0] + (nx - 1) * step, origin[1] + (ny - 1) * step, origin[2] + (nz - 1) * step] };
        let shoe = Manifold.levelSet((p: [number, number, number]) => -sample(p[0], p[1], p[2]), bounds, step, 0);
        if (lift > 0) shoe = shoe.translate([0, 0, lift]);
        pieces.push(label(shoe, w.label, { color }));
      }
    }
    const eyeBox: { min: number[]; max: number[] } | null = eyes ? eyes.boundingBox() : null;
    if (base) {
      const height = opts.height ?? 60;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      const p = skinPart.positions;
      for (let i = 0; i < p.length; i += 3) {
        if (p[i + 2] > height * 0.05) continue;     // footprint = the feet
        minX = Math.min(minX, p[i]); maxX = Math.max(maxX, p[i]); minY = Math.min(minY, p[i + 1]); maxY = Math.max(maxY, p[i + 1]);
      }
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      const r = base.radius ?? Math.max(height * 0.22, Math.hypot(maxX - minX, maxY - minY) / 2 + height * 0.05);
      // Sink the soles a little into the base so the union fuses.
      const sink = height * 0.004;
      pieces.push(label(Manifold.cylinder(base.thickness, r, r).translate([cx, cy, -base.thickness + sink]), 'base', { color: colors.base }));
    }
    if (pieces.length === 0) return Manifold.union([]);
    const out = Manifold.union(pieces);
    // A human is one connected solid, so any extra piece is debris: a
    // zero-volume sliver where an eyeball meets its lid, or (voxel weld) a
    // fingertip thinner than the lattice pinched off. Keep the main body, plus
    // anything inside the eyeballs' box so a stray eyeball is never dropped.
    const inEyes = (m: { boundingBox(): { min: number[]; max: number[] } }) => {
      if (!eyeBox) return false;
      const b = m.boundingBox();
      return [0, 1, 2].every((c) => { const mid = (b.min[c] + b.max[c]) / 2; return mid >= eyeBox.min[c] && mid <= eyeBox.max[c]; });
    };
    // Shells meeting at a hem can leave a zero-volume flap that only comes
    // apart after a compose; filter until nothing more splits off.
    let cur = out;
    for (let pass = 0; pass < 3; pass++) {
      const parts = cur.decompose();
      if (parts.length <= 1) break;
      const vols: number[] = parts.map((m: { volume(): number }) => m.volume());
      const biggest = Math.max(...vols);
      const keep = parts.filter((m: { volume(): number; boundingBox(): { min: number[]; max: number[] } }, i: number) =>
        vols[i] === biggest || (vols[i] > biggest * 1e-6 && inEyes(m)));
      if (keep.length === parts.length) break;
      cur = Manifold.compose(keep);
    }
    return cur;
  }

  return human;
}
