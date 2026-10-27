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
import { buildHumanMesh, type HumanOptions, type HumanPose, DEFAULT_BODY, DEFAULT_FACE, DEFAULT_TORSO } from './humanModel';
import { getHumanAsset } from './humanAsset';

const DOC = 'See /ai/human.md';
const LIMB_KEYS = ['raiseSide', 'raiseFwd', 'bend', 'twist'] as const;
/** Default paint per label; override with `colors` or `api.paint.label`. */
const DEFAULT_COLORS: Record<string, string> = {
  skin: '#c68642', eyes: '#f4f4f0', iris: '#5b3a21', pupil: '#161616', base: '#4a4a4a',
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
  assertNoUnknownKeys(o, ['armL', 'armR', 'legL', 'legR', 'spine', 'head'], 'human.pose');
  const pose: HumanPose = {};
  for (const k of ['armL', 'armR', 'legL', 'legR'] as const) {
    if (o[k] !== undefined) pose[k] = numbers(o[k], LIMB_KEYS, `human.pose.${k}`, -180, 180);
  }
  if (o.spine !== undefined) pose.spine = numbers(o.spine, ['lean', 'turn', 'side'], 'human.pose.spine', -90, 90);
  if (o.head !== undefined) pose.head = numbers(o.head, ['yaw', 'pitch', 'roll'], 'human.pose.head', -90, 90);
  return pose;
}

function parseOptions(raw: unknown) {
  const o = raw === undefined ? {} : assertObject(raw, 'human(opts)')!;
  assertNoUnknownKeys(o, ['height', 'body', 'face', 'torso', 'pose', 'weld', 'voxel', 'base', 'colors'], 'human(opts)');
  const opts: HumanOptions = {};
  if (o.height !== undefined) opts.height = assertNumber(o.height, 'human.height', { min: 5, max: 2000 })!;
  if (o.body !== undefined) {
    const b = assertObject(o.body, 'human.body')!;
    assertNoUnknownKeys(b, [...Object.keys(DEFAULT_BODY)], 'human.body');
    const { ethnicity, ...rest } = b;
    const nums = numbers(rest, ['gender', 'muscle', 'weight', 'stature', 'breast', 'age'], 'human.body', 0, 90);
    if (nums.age !== undefined && (nums.age < 25 || nums.age > 90)) throw new ValidationError(`human.body.age must be 25–90 years (adult targets only for now). ${DOC}`);
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
  if (o.pose !== undefined) opts.pose = parsePose(o.pose);
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
  return { opts, weld, voxel, base, colors };
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
  const ofParts = (positions: Float32Array, triVerts: Uint32Array) =>
    Manifold.ofMesh(new Mesh({ numProp: 3, vertProperties: positions, triVerts }));

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

  // The eyeballs as ONE closed mesh whose triangles are grouped into runs, one
  // per paint label (sclera / iris / pupil): splitting into separate sub-meshes
  // would tear the surface. Each run gets its own originalID, registered as a
  // label exactly like api.importWithParts does. `api.removePart` on `eyes`
  // drops the eyeballs (the body is closed behind them); on `iris` / `pupil` it
  // can't cut a hole in a closed ball, so that region folds into the label it
  // sits in (pupil → iris → sclera) and the removed label disappears.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function labelledEyes(positions: Float32Array, triVerts: Uint32Array, labels: string[], colors: Record<string, string>): any {
    if (isRemoved('eyes')) return null;
    const order = ['eyes', 'iris', 'pupil'].filter((n) => !isRemoved(n));
    const fold = (n: string): string => (order.includes(n) ? n : n === 'pupil' ? fold('iris') : 'eyes');
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function human(rawOpts?: unknown): any {
    const asset = getHumanAsset();
    if (!asset) throw new Error(`api.human: the human asset is not loaded (it preloads when the code mentions api.human). ${DOC}`);
    const { opts, weld, voxel, base, colors } = parseOptions(rawOpts);
    const mesh = buildHumanMesh(asset, opts);
    const skinPart = mesh.parts.find((p) => p.label === 'skin')!;
    const eyePart = mesh.parts.find((p) => p.label === 'eyes')!;
    const bodySolid = weld === 'voxel' ? voxelWeld(skinPart.positions, skinPart.triVerts, voxel) : ofParts(skinPart.positions, skinPart.triVerts);
    // The eyeballs as one Manifold whose triangle runs carry the sclera / iris
    // / pupil labels (one originalID per label via Manifold.ofMesh runs).
    const eyes = labelledEyes(eyePart.positions, eyePart.triVerts, mesh.eyeLabels, colors);
    const pieces = [label(bodySolid, 'skin', { color: colors.skin })];
    if (eyes) pieces.push(eyes);
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
    const out = Manifold.union(pieces);
    // A human is one connected solid, so any extra piece is debris: a
    // zero-volume sliver where an eyeball meets its lid, or (voxel weld) a
    // fingertip thinner than the lattice pinched off. Keep the main body, plus
    // anything inside the eyeballs' box so a stray eyeball is never dropped.
    const parts = out.decompose();
    if (parts.length <= 1) return out;
    const vols: number[] = parts.map((m: { volume(): number }) => m.volume());
    const biggest = Math.max(...vols);
    const inEyes = (m: { boundingBox(): { min: number[]; max: number[] } }) => {
      if (!eyeBox) return false;
      const b = m.boundingBox();
      return [0, 1, 2].every((c) => { const mid = (b.min[c] + b.max[c]) / 2; return mid >= eyeBox.min[c] && mid <= eyeBox.max[c]; });
    };
    const keep = parts.filter((m: { volume(): number; boundingBox(): { min: number[]; max: number[] } }, i: number) =>
      vols[i] === biggest || (vols[i] > biggest * 1e-6 && inEyes(m)));
    return keep.length === parts.length ? out : Manifold.compose(keep);
  }

  return human;
}
