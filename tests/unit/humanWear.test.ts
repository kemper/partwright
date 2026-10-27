import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseHumanAsset, buildHumanMesh, type HumanAssetMeta } from '../../src/human/humanModel';
import { buildWear, BodyContext, WEAR_ITEMS, ARMOR_ITEMS, type ShellMesh } from '../../src/human/humanWear';
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

  it('plates carry rivets along their edges unless turned off', () => {
    const [studded] = buildWear(asset, mesh, [{ item: 'cuirass' }], H);
    expect(studded.rivets?.length ?? 0).toBeGreaterThan(10);
    const [plain] = buildWear(asset, mesh, [{ item: 'cuirass', rivets: false }], H);
    expect(plain.rivets).toBeUndefined();
  }, HEAVY);

  it('a top bridges the cleavage instead of following it', () => {
    const female = buildHumanMesh(asset, { height: H, body: { gender: 0, breast: 1 } });
    const ctx = new BodyContext(asset, female);
    // The cleavage: the front-most skin on the mid-line between the breasts' apexes.
    const zc = (female.joints.get('breast.L____tail')![2] + female.joints.get('breast.R____tail')![2]) / 2;
    const front = (pos: ArrayLike<number>) => {
      let y = Infinity;
      for (let i = 0; i < pos.length; i += 3) if (Math.abs(pos[i]) < H * 0.004 && Math.abs(pos[i + 2] - zc) < H * 0.004) y = Math.min(y, pos[i + 1]);
      return y;
    };
    const skin = front(female.posed);
    const bridged = front(buildWear(asset, female, [{ item: 'tshirt' }], H)[0].mesh!.positions);
    const orig = BodyContext.prototype.bustBridge;
    BodyContext.prototype.bustBridge = function () { return { ...orig.call(this), weight: new Float32Array(asset.nV) }; };
    try {
      const hugging = front(buildWear(asset, female, [{ item: 'tshirt' }], H)[0].mesh!.positions);
      // Without the bridge the shirt dips into the cleavage; with it, it
      // spans it well in front of the skin.
      expect(skin - bridged).toBeGreaterThan((skin - hugging) * 2);
    } finally {
      BodyContext.prototype.bustBridge = orig;
    }
    expect(ctx.bustRegion().some((w) => w > 0.9)).toBe(true);
  }, HEAVY);

  it('a sleeveless top keeps straps over the shoulders; a cuirass stops below the shoulder slope', () => {
    const sh = mesh.joints.get('upperarm01.L____head')!, neck = mesh.joints.get('neck01____head')!;
    const ux = Math.abs(sh[0]);
    // Highest point of the shell between the neck and the shoulder joint.
    const peak = (m: ShellMesh, x0: number, x1: number) => {
      let z = -Infinity;
      for (let i = 0; i < m.positions.length; i += 3) { const x = Math.abs(m.positions[i]); if (x > x0 && x < x1) z = Math.max(z, m.positions[i + 2]); }
      return z;
    };
    const [tank] = buildWear(asset, mesh, [{ item: 'top', sleeve: 'none' }], H);
    // The strap runs over the top of the shoulder, above the shoulder joint.
    expect(peak(tank.mesh!, ux * 0.55, ux * 0.7)).toBeGreaterThan(sh[2] + (neck[2] - sh[2]) * 0.5);
    // …but the shoulder cap itself is bare.
    expect(peak(tank.mesh!, ux * 0.95, ux * 1.2)).toBeLessThan(sh[2] + (neck[2] - sh[2]) * 0.3);
    const [cuirass] = buildWear(asset, mesh, [{ item: 'cuirass', rivets: false }], H);
    // Near the shoulder it ends low: no points standing up the slope.
    expect(peak(cuirass.mesh!, ux * 0.8, ux * 1.2)).toBeLessThan(sh[2] + ux * mesh.scale * 0.35);
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

  it('a hat presses the hair flat above its band; below it the hair stays full', () => {
    const band = crown[2] - H * 0.03;
    const free = buildHairField(asset, mesh, { style: 'afro' }, H, H / 200);
    const capped = buildHairField(asset, mesh, { style: 'afro' }, H, H / 200, { edge: () => band, keep: H * 0.003 });
    const at = (r: typeof free) => makeTrilinearSampler(r.field!, r.spec);
    // Over the crown, where the afro stands far off the scalp: hair, then none.
    const above: [number, number, number] = [crown[0], crown[1], crown[2] + H * 0.02];
    expect(at(free)(...above)).toBeLessThan(0);
    expect(at(capped)(...above)).toBeGreaterThan(0);
    // The crown itself stays covered by the thin layer.
    expect(at(capped)(crown[0], crown[1], crown[2])).toBeLessThan(0);
    // Well below the band, the hair is untouched.
    const side: [number, number, number] = [0, 0, band - H * 0.06];
    let x = 0;
    while (x < H * 0.2 && at(free)(x, side[1], side[2]) < 0 === false) x += H / 400;
    while (x < H * 0.2 && at(free)(x, side[1], side[2]) < 0) x += H / 400;
    expect(at(capped)(x - H / 200, side[1], side[2])).toBeLessThan(0);
  }, HEAVY);

  it('an open jaw carries the beard with it: skin on the jaw keeps the same beard over it', () => {
    const closed = buildHumanMesh(asset, { height: H, body: { gender: 1 } });
    const open = buildHumanMesh(asset, { height: H, body: { gender: 1 }, expression: { jawOpen: 1 } });
    const field = (m: typeof open) => {
      const r = buildHairField(asset, m, { style: 'bald', beard: 'full' }, H, H / 200);
      return makeTrilinearSampler(r.beard!, r.spec);
    };
    const fClosed = field(closed), fOpen = field(open);
    // A posed point in the head's frame (where the hair field lives).
    const inHead = (m: typeof open, p: number[]) => {
      const head = computeSockets(asset, m, H).sockets.get('head')!;
      const d = [0, 1, 2].map((c) => p[c] - head.origin[c]);
      return [head.x, head.y, head.z].map((a) => a[0] * d[0] + a[1] * d[1] + a[2] * d[2]) as [number, number, number];
    };
    // Skin that rides the jaw (the chin): the beard over it must move with it,
    // so its field value there is about the same open or closed. (Without the
    // jaw carrying the beard the gap is about twice the bound.)
    const jaw = new Set<number>();
    asset.bones.forEach((b, i) => { if (b.name === 'jaw' || (b.parent >= 0 && jaw.has(b.parent))) jaw.add(i); });
    const isSkin = new Uint8Array(asset.nV);
    for (let t = 0; t < asset.nT; t++) if (asset.triLabel[t] === 0) for (let c = 0; c < 3; c++) isSkin[asset.triVerts[t * 3 + c]] = 1;
    let worst = 0, n = 0;
    for (let v = 0; v < asset.nV; v++) {
      if (!isSkin[v]) continue;
      let w = 0;
      for (let k = 0; k < 4; k++) if (jaw.has(asset.skinIndex[v * 4 + k])) w += asset.skinWeight[v * 4 + k];
      if (w < 0.8) continue;
      const pc = inHead(closed, [0, 1, 2].map((c) => closed.posed[v * 3 + c]));
      const po = inHead(open, [0, 1, 2].map((c) => open.posed[v * 3 + c]));
      // A little in front of the skin, inside the beard's thickness.
      const a = fClosed(pc[0], pc[1] - H * 0.004, pc[2]), b = fOpen(po[0], po[1] - H * 0.004, po[2]);
      // Only where the closed jaw's beard is (the chin's front, not the mouth).
      if (!(a < 0)) continue;
      worst = Math.max(worst, Math.abs(a - b)); n++;
    }
    expect(n).toBeGreaterThan(5);
    expect(worst).toBeLessThan(H * 0.006);
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
