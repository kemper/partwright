import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseHumanAsset, buildHumanMesh, type HumanAssetMeta } from '../../src/human/humanModel';
import { buildWear, WEAR_ITEMS, ARMOR_ITEMS, type ShellMesh } from '../../src/human/humanWear';
import { buildHairField, HAIR_STYLES } from '../../src/human/humanHair';
import { computeSockets } from '../../src/human/humanGear';
import { makeTrilinearSampler } from '../../src/geometry/meshSdf';

/** These build every item / hair style; a busy CI runner needs more than 5 s. */
const HEAVY = 60_000;

const meta = JSON.parse(readFileSync('public/human/hm08.json', 'utf8')) as HumanAssetMeta;
const pack = (file: string) => { const b = readFileSync(`public/human/${file}`); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const asset = parseHumanAsset(meta, { core: pack(meta.packs.core), morphs: pack(meta.packs.morphs) });
const H = 60;
const mesh = buildHumanMesh(asset, { height: H, body: { gender: 0.4 } });

/** Every edge of a closed, consistently wound surface appears once in each direction. */
function isClosed(m: ShellMesh): boolean {
  const half = new Map<string, number>();
  const t = m.triVerts;
  for (let k = 0; k < t.length; k += 3) {
    for (let c = 0; c < 3; c++) {
      const key = `${t[k + c]},${t[k + (c + 1) % 3]}`;
      half.set(key, (half.get(key) ?? 0) + 1);
    }
  }
  for (const [key, n] of half) {
    const [a, b] = key.split(',');
    if (n !== 1 || half.get(`${b},${a}`) !== 1) return false;
  }
  return true;
}
function volume(m: ShellMesh): number {
  const p = m.positions, t = m.triVerts;
  let v = 0;
  for (let k = 0; k < t.length; k += 3) {
    const a = t[k] * 3, b = t[k + 1] * 3, c = t[k + 2] * 3;
    v += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return v / 6;
}

describe('human wear', () => {
  it('every clothing item and armor piece is a closed, positive-volume shell', () => {
    for (const item of [...WEAR_ITEMS, ...ARMOR_ITEMS]) {
      const shells = buildWear(asset, mesh, [{ item }], H);
      expect(shells.length, item).toBeGreaterThan(0);
      for (const s of shells) {
        expect(s.label).toBe(item);
        if (s.fields) {
          // Footwear: one signed-distance field per foot, with a solid inside.
          expect(s.fields.length, item).toBe(2);
          for (const f of s.fields) expect(f.field.some((v) => v < 0), item).toBe(true);
          continue;
        }
        expect(isClosed(s.mesh!), item).toBe(true);
        expect(volume(s.mesh!), item).toBeGreaterThan(0);
      }
    }
  }, HEAVY);

  it('a layer worn over another sits further out', () => {
    const reach = (m: ShellMesh) => { let r = 0; for (let i = 0; i < m.positions.length; i += 3) r = Math.max(r, Math.abs(m.positions[i + 1])); return r; };
    const [inner, outer] = buildWear(asset, mesh, [{ item: 'tshirt' }, { item: 'cuirass' }], H);
    expect(reach(outer.mesh!)).toBeGreaterThan(reach(inner.mesh!));
  });

  it('shoes close over the toes and put a sole under the foot', () => {
    const [shoes] = buildWear(asset, mesh, [{ item: 'shoes' }], H);
    // The bare figure stands on z = 0; the soles reach below it.
    for (const f of shoes.fields!) expect(f.minZ).toBeLessThan(0);
  }, HEAVY);

  it('flare swings a skirt out', () => {
    const width = (m: ShellMesh) => { let lo = Infinity, hi = -Infinity; for (let i = 0; i < m.positions.length; i += 3) { lo = Math.min(lo, m.positions[i]); hi = Math.max(hi, m.positions[i]); } return hi - lo; };
    const [straight] = buildWear(asset, mesh, [{ item: 'skirt', length: 'midi' }], H);
    const [bell] = buildWear(asset, mesh, [{ item: 'skirt', length: 'midi', flare: 1 }], H);
    expect(width(bell.mesh!)).toBeGreaterThan(width(straight.mesh!) * 1.15);
  });
});

describe('human hair', () => {
  const sampleAt = (style: (typeof HAIR_STYLES)[number], beard?: 'full') => {
    const r = buildHairField(asset, mesh, { style, beard }, H, H / 200);
    return { hair: r.field && makeTrilinearSampler(r.field, r.spec), beard: r.beard && makeTrilinearSampler(r.beard, r.spec) };
  };
  // Head-local landmarks: the crown sits above the head joint, the face in front (−y).
  const k = mesh.scale;
  const head = mesh.restJoints.get('head____head')!;
  const local = (n: string) => { const p = mesh.restJoints.get(`${n}____head`)!; return [0, 1, 2].map((c) => (p[c] - head[c]) * k); };
  const eye = local('eye.L');
  // The highest skin vertex.
  let crown = [0, 0, -Infinity];
  for (let t = 0; t < asset.nT; t++) {
    if (asset.triLabel[t] !== 0) continue;
    const v = asset.triVerts[t * 3];
    const z = (mesh.rest[v * 3 + 2] - head[2]) * k;
    if (z > crown[2]) crown = [(mesh.rest[v * 3] - head[0]) * k, (mesh.rest[v * 3 + 1] - head[1]) * k, z];
  }

  it('covers the crown but leaves the eyes clear, for every style that has hair', () => {
    for (const style of HAIR_STYLES) {
      const { hair } = sampleAt(style);
      if (style === 'bald') { expect(hair).toBeNull(); continue; }
      expect(hair!(crown[0], crown[1], crown[2]), style).toBeLessThan(0);
      expect(hair!(eye[0], eye[1] - H * 0.004, eye[2]), style).toBeGreaterThan(0);
    }
  }, HEAVY);

  it('a full beard covers the chin, not the lips', () => {
    const { beard } = sampleAt('bald', 'full');
    const chin = local('special04');
    const mouth = [local('oris03.L'), local('oris03.R')].reduce((a, b) => a.map((v, i) => (v + b[i]) / 2));
    // Just in front of the chin bone and below it: inside the beard.
    let inside = false;
    for (let dy = 0; dy < H * 0.04 && !inside; dy += H / 400) if (beard!(0, chin[1] - dy, chin[2] - H * 0.02) < 0) inside = true;
    expect(inside).toBe(true);
    // In front of the lips: clear.
    let clear = true;
    for (let dy = 0; dy < H * 0.02; dy += H / 400) if (beard!(0, mouth[1] - dy, mouth[2]) < 0) clear = false;
    expect(clear).toBe(true);
  }, HEAVY);
});

describe('human sockets', () => {
  it('every socket frame is orthonormal and the grip sits in the hand', () => {
    const { sockets } = computeSockets(asset, mesh, H);
    for (const name of ['head', 'chest', 'hand.L', 'hand.R', 'foot.L', 'shoulder.R']) {
      const s = sockets.get(name)!;
      for (const a of [s.x, s.y, s.z]) expect(Math.hypot(...a), name).toBeCloseTo(1, 5);
      const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      expect(Math.abs(dot(s.x, s.y)), name).toBeLessThan(1e-5);
      expect(Math.abs(dot(s.x, s.z)), name).toBeLessThan(1e-5);
    }
    const grip = sockets.get('hand.R')!.origin;
    const wrist = mesh.joints.get('wrist.R____head')!;
    expect(Math.hypot(grip[0] - wrist[0], grip[1] - wrist[1], grip[2] - wrist[2])).toBeLessThan(H * 0.1);
  });
});
