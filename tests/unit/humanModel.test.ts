import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseHumanAsset, morphWeights, applyMorphs, jointPositions, solvePose, skin, buildHumanMesh,
  DEFAULT_BODY, DEFAULT_FACE, DEFAULT_TORSO, type HumanAssetMeta,
} from '../../src/human/humanModel';
import { sourceUsesHuman } from '../../src/human/humanAsset';

const meta = JSON.parse(readFileSync('public/human/hm08.json', 'utf8')) as HumanAssetMeta;
const bin = readFileSync('public/human/hm08.bin');
const asset = parseHumanAsset(meta, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));

const zRange = (pos: Float32Array) => {
  let lo = Infinity, hi = -Infinity;
  for (let i = 2; i < pos.length; i += 3) { lo = Math.min(lo, pos[i]); hi = Math.max(hi, pos[i]); }
  return [lo, hi];
};

describe('human morphs', () => {
  it('splits the macro corners so each family sums to 1', () => {
    const w = morphWeights({ ...DEFAULT_BODY, gender: 0.3, age: 50, muscle: 0.8, weight: 0.2 }, DEFAULT_FACE, DEFAULT_TORSO);
    let universal = 0, ethnic = 0;
    for (const [name, v] of w) {
      if (name.includes('/universal-')) universal += v;
      else if (/macrodetails\/(african|asian|caucasian)-/.test(name)) ethnic += v;
    }
    expect(universal).toBeCloseTo(1, 6);
    expect(ethnic).toBeCloseTo(1, 6);
  });

  it('maps a bidirectional face slider onto the decr / incr target pair', () => {
    const w = morphWeights(DEFAULT_BODY, { ...DEFAULT_FACE, jawWidth: -0.4, noseWidth: 0.7 }, DEFAULT_TORSO);
    expect(w.get('chin/chin-width-decr')).toBeCloseTo(0.4);
    expect(w.has('chin/chin-width-incr')).toBe(false);
    expect(w.get('nose/nose-scale-horiz-incr')).toBeCloseTo(0.7);
  });

  it('every weighted target exists in the shipped asset', () => {
    const w = morphWeights({ ...DEFAULT_BODY, stature: 0.9, breast: 0.5, age: 70 }, { ...DEFAULT_FACE, cheekbones: 1, headSquare: 1, eyeSize: -1 }, { vShape: 1, belly: 1 });
    for (const name of w.keys()) expect(asset.targets.has(name), name).toBe(true);
  });

  it('stature changes the body height', () => {
    const tall = applyMorphs(asset, morphWeights({ ...DEFAULT_BODY, stature: 1 }, DEFAULT_FACE, DEFAULT_TORSO));
    const short = applyMorphs(asset, morphWeights({ ...DEFAULT_BODY, stature: 0 }, DEFAULT_FACE, DEFAULT_TORSO));
    const h = (p: Float32Array) => { const [lo, hi] = zRange(p); return hi - lo; };
    expect(h(tall)).toBeGreaterThan(h(short) * 1.05);
  });
});

describe('human pose', () => {
  const rest = applyMorphs(asset, morphWeights(DEFAULT_BODY, DEFAULT_FACE, DEFAULT_TORSO));
  const joints = jointPositions(asset, rest);

  it("the 'rest' pose skins every vertex back onto itself", () => {
    const out = skin(asset, rest, solvePose(asset, joints, 'rest'));
    let maxErr = 0;
    for (let i = 0; i < rest.length; i++) maxErr = Math.max(maxErr, Math.abs(out[i] - rest[i]));
    expect(maxErr).toBeLessThan(1e-4);
  });

  it('raising the left arm overhead lifts the left wrist above the head', () => {
    const xf = solvePose(asset, joints, { armL: { raiseSide: 170, bend: 0 } });
    const w = joints.get('wrist.L____head')!;
    const bi = asset.bones.findIndex((b) => b.name === 'wrist.L');
    const m = xf.R[bi], t = xf.T[bi];
    const z = m[6] * w[0] + m[7] * w[1] + m[8] * w[2] + t[2];
    expect(z).toBeGreaterThan(joints.get('head____head')![2]);
  });

  it('builds grounded parts at the requested print height', () => {
    const mesh = buildHumanMesh(asset, { height: 60, pose: 'rest' });
    const skinPart = mesh.parts.find((p) => p.label === 'skin')!;
    const [lo, hi] = zRange(skinPart.positions);
    expect(lo).toBeCloseTo(0, 6);
    expect(hi).toBeCloseTo(60, 1);
    expect(mesh.eyeLabels.filter((l) => l === 'iris').length).toBeGreaterThan(0);
    expect(mesh.eyeLabels.filter((l) => l === 'pupil').length).toBeGreaterThan(0);
  });
});

describe('extreme poses', () => {
  const rest = applyMorphs(asset, morphWeights(DEFAULT_BODY, DEFAULT_FACE, DEFAULT_TORSO));
  const joints = jointPositions(asset, rest);
  it('keeps every bone rotation orthonormal, even at a 180° spine split', () => {
    const xf = solvePose(asset, joints, { spine: { lean: -90, turn: -90, side: -90 }, head: { yaw: 90, pitch: 90, roll: 90 } });
    for (const m of xf.R) {
      for (const v of m) expect(Number.isFinite(v)).toBe(true);
      const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
      expect(det).toBeCloseTo(1, 6);
    }
  });
});

describe('sourceUsesHuman', () => {
  it('matches api.human and a destructure from api', () => {
    expect(sourceUsesHuman('return api.human({})')).toBe(true);
    expect(sourceUsesHuman('const { human, sdf } = api; return human()')).toBe(true);
  });
  it('ignores comments and unrelated functions named human', () => {
    expect(sourceUsesHuman('// a human (adult)\nfunction human(x) { return x }')).toBe(false);
  });
});
