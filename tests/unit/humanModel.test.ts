import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseHumanAsset, morphWeights, applyMorphs, jointPositions, solvePose, skin, buildHumanMesh,
  DEFAULT_BODY, DEFAULT_FACE, DEFAULT_TORSO, EXPRESSION_PRESETS, type HumanAssetMeta,
} from '../../src/human/humanModel';
import { sourceUsesHuman, humanPacksFor } from '../../src/human/humanAsset';

const meta = JSON.parse(readFileSync('public/human/hm08.json', 'utf8')) as HumanAssetMeta;
const pack = (file: string) => { const b = readFileSync(`public/human/${file}`); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const buffers = { core: pack(meta.packs.core), morphs: pack(meta.packs.morphs), young: pack(meta.packs.young) };
const asset = parseHumanAsset(meta, buffers);
const coreOnly = parseHumanAsset(meta, { core: buffers.core });

const zRange = (pos: Float32Array) => {
  let lo = Infinity, hi = -Infinity;
  for (let i = 2; i < pos.length; i += 3) { lo = Math.min(lo, pos[i]); hi = Math.max(hi, pos[i]); }
  return [lo, hi];
};

describe('human morphs', () => {
  it('splits the macro corners so each family sums to 1', () => {
    for (const age of [3, 18, 50]) {
      const w = morphWeights(asset, { ...DEFAULT_BODY, gender: 0.3, age, muscle: 0.8, weight: 0.2 }, DEFAULT_FACE, DEFAULT_TORSO);
      let universal = 0, ethnic = 0;
      for (const [name, v] of w) {
        if (name.includes('/universal-')) universal += v;
        else if (/macrodetails\/(african|asian|caucasian)-/.test(name)) ethnic += v;
      }
      expect(universal).toBeCloseTo(1, 6);
      expect(ethnic).toBeCloseTo(1, 6);
    }
  });

  it('blends the neighbouring age corners', () => {
    const w = morphWeights(asset, { ...DEFAULT_BODY, gender: 0, age: 6 }, DEFAULT_FACE, DEFAULT_TORSO);
    expect(w.get('macrodetails/caucasian-female-baby')! + w.get('macrodetails/caucasian-female-child')!).toBeCloseTo(1 / 3, 6);
    expect(w.has('macrodetails/caucasian-female-young')).toBe(false);
  });

  it('maps a friendly face slider and a raw slider onto the target pair', () => {
    const w = morphWeights(asset, DEFAULT_BODY, { ...DEFAULT_FACE, jawWidth: -0.4 }, DEFAULT_TORSO, { 'nose-hump': 0.7, 'head-oval': 0.5 });
    expect(w.get('chin/chin-width-decr')).toBeCloseTo(0.4);
    expect(w.has('chin/chin-width-incr')).toBe(false);
    expect(w.get('nose/nose-hump-incr')).toBeCloseTo(0.7);
    expect(w.get('head/head-oval')).toBeCloseTo(0.5);
  });

  it('rejects an unknown raw slider', () => {
    expect(() => morphWeights(asset, DEFAULT_BODY, DEFAULT_FACE, DEFAULT_TORSO, { 'nose-banana': 1 })).toThrow(/unknown morph/);
  });

  it('every weighted target exists in the shipped asset', () => {
    for (const age of [2, 15, 70]) {
      const w = morphWeights(asset, { ...DEFAULT_BODY, stature: 0.9, breast: 0.5, age }, { ...DEFAULT_FACE, cheekbones: 1, headSquare: 1, eyeSize: -1 }, { vShape: 1, belly: 1 });
      for (const name of w.keys()) expect(asset.targets.has(name), name).toBe(true);
    }
  });

  it('names the missing pack instead of silently skipping its targets', () => {
    const w = morphWeights(coreOnly, { ...DEFAULT_BODY, age: 5 }, DEFAULT_FACE, DEFAULT_TORSO);
    expect(() => applyMorphs(coreOnly, w)).toThrow(/"young" data pack/);
  });

  it('stature changes the body height', () => {
    const tall = applyMorphs(asset, morphWeights(asset, { ...DEFAULT_BODY, stature: 1 }, DEFAULT_FACE, DEFAULT_TORSO));
    const short = applyMorphs(asset, morphWeights(asset, { ...DEFAULT_BODY, stature: 0 }, DEFAULT_FACE, DEFAULT_TORSO));
    const h = (p: Float32Array) => { const [lo, hi] = zRange(p); return hi - lo; };
    expect(h(tall)).toBeGreaterThan(h(short) * 1.05);
  });
});

describe('human pose', () => {
  const rest = applyMorphs(asset, morphWeights(asset, DEFAULT_BODY, DEFAULT_FACE, DEFAULT_TORSO));
  const joints = jointPositions(asset, rest);

  it("the 'rest' pose skins every vertex back onto itself (both skinning methods)", () => {
    for (const method of ['dq', 'linear'] as const) {
      const out = skin(asset, rest, solvePose(asset, joints, 'rest'), method);
      let maxErr = 0;
      for (let i = 0; i < rest.length; i++) maxErr = Math.max(maxErr, Math.abs(out[i] - rest[i]));
      expect(maxErr, method).toBeLessThan(1e-4);
    }
  });

  it('raising the left arm overhead lifts the left wrist above the head', () => {
    const xf = solvePose(asset, joints, { armL: { raiseSide: 170, bend: 0 } });
    const w = joints.get('wrist.L____head')!;
    const bi = asset.bones.findIndex((b) => b.name === 'wrist.L');
    const m = xf.R[bi], t = xf.T[bi];
    const z = m[6] * w[0] + m[7] * w[1] + m[8] * w[2] + t[2];
    expect(z).toBeGreaterThan(joints.get('head____head')![2]);
  });

  it('dual-quaternion skinning keeps a twisted, bent forearm thicker than linear blending', () => {
    const pose = { armL: { raiseSide: 30, raiseFwd: 60, bend: 140, twist: 70 } };
    const xf = solvePose(asset, joints, pose);
    const lbs = skin(asset, rest, xf, 'linear');
    const dq = skin(asset, rest, xf, 'dq');
    // Spread of the elbow-region vertices around their centroid.
    const elbow = asset.bones.findIndex((b) => b.name === 'lowerarm01.L');
    const verts: number[] = [];
    for (let v = 0; v < asset.nV; v++) if (asset.skinIndex[v * 4] === elbow && asset.skinWeight[v * 4] < 0.7) verts.push(v);
    const spread = (p: Float32Array) => {
      const c = [0, 0, 0];
      for (const v of verts) for (let k = 0; k < 3; k++) c[k] += p[v * 3 + k] / verts.length;
      return verts.reduce((s, v) => s + Math.hypot(p[v * 3] - c[0], p[v * 3 + 1] - c[1], p[v * 3 + 2] - c[2]), 0) / verts.length;
    };
    expect(verts.length).toBeGreaterThan(10);
    expect(spread(dq)).toBeGreaterThanOrEqual(spread(lbs) * 0.999);
  });

  it('a smile lifts the mouth corners and an open jaw drops the chin', () => {
    const corner = joints.get('oris03.L____head')!;
    const ci = asset.bones.findIndex((b) => b.name === 'oris03.L');
    const smile = solvePose(asset, joints, {}, EXPRESSION_PRESETS.smile);
    const neutral = solvePose(asset, joints, {}, {});
    const z = (xf: typeof smile, i: number, p: number[]) => xf.R[i][6] * p[0] + xf.R[i][7] * p[1] + xf.R[i][8] * p[2] + xf.T[i][2];
    expect(z(smile, ci, corner)).toBeGreaterThan(z(neutral, ci, corner));
    const ji = asset.bones.findIndex((b) => b.name === 'special04');
    const chin = joints.get('special04____head')!;
    const open = solvePose(asset, joints, {}, { jawOpen: 1 });
    expect(z(open, ji, chin)).toBeLessThan(z(neutral, ji, chin));
  });

  it('builds grounded parts at the requested print height with face labels', () => {
    const mesh = buildHumanMesh(asset, { height: 60, pose: 'rest' });
    const skinPart = mesh.parts.find((p) => p.label === 'skin')!;
    const [lo, hi] = zRange(skinPart.positions);
    expect(lo).toBeCloseTo(0, 6);
    expect(hi).toBeCloseTo(60, 1);
    for (const l of ['iris', 'pupil'] as const) expect(mesh.eyeLabels.filter((x) => x === l).length).toBeGreaterThan(0);
    for (const l of ['lips', 'mouth', 'brows'] as const) expect(mesh.skinLabels.filter((x) => x === l).length, l).toBeGreaterThan(0);
    expect(mesh.skinLabels.length).toBe(skinPart.triVerts.length / 3);
  });
});

describe('extreme poses', () => {
  const rest = applyMorphs(asset, morphWeights(asset, DEFAULT_BODY, DEFAULT_FACE, DEFAULT_TORSO));
  const joints = jointPositions(asset, rest);
  it('keeps every bone rotation orthonormal, even at a 180° spine split', () => {
    const xf = solvePose(asset, joints, { spine: { lean: -90, turn: -90, side: -90 }, head: { yaw: 90, pitch: 90, roll: 90 } }, EXPRESSION_PRESETS.laugh);
    for (const m of xf.R) {
      for (const v of m) expect(Number.isFinite(v)).toBe(true);
      const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
      expect(det).toBeCloseTo(1, 6);
    }
  });
});

describe('sourceUsesHuman / humanPacksFor', () => {
  it('matches api.human and a destructure from api', () => {
    expect(sourceUsesHuman('return api.human({})')).toBe(true);
    expect(sourceUsesHuman('const { human, sdf } = api; return human()')).toBe(true);
  });
  it('ignores comments and unrelated functions named human', () => {
    expect(sourceUsesHuman('// a human (adult)\nfunction human(x) { return x }')).toBe(false);
  });
  it('asks for the optional packs only when the source needs them', () => {
    expect(humanPacksFor('api.human({ pose: {} })')).toEqual([]);
    expect(humanPacksFor("api.human({ expression: 'smile' })")).toEqual(['morphs']);
    expect(humanPacksFor('api.human({ body: { age: 8 } })')).toEqual(['young']);
  });
});
