// Unit tests for the #1055 follow-ups in src/geometry/sdfFigure.ts: rig
// headSink, per-hand hold cups + handScale (and the smaller 'under' residual),
// brows following a translated face inside a whole weld, toy shoes, trim zones,
// conformal emboss, bead eyes, F.face.surfaceY, and the shag hair's notched
// fringe / radial face window / crownSize / backWidth / culled locks.
// Pure logic — SDF nodes are evaluated directly, nothing is meshed. Uses the
// real SDF namespace (with a stub Manifold) so the internal culling / polygon /
// radial-projection ops are exercised exactly as in a build.

import { describe, it, expect } from 'vitest';
import { createSdfNamespace, type SdfNamespace } from '../../src/geometry/sdf';
import { compileSdfEval } from '../../src/geometry/sdfCompile';
import { __figureTestables__, createFigureNamespace } from '../../src/geometry/sdfFigure';
import { __testables__ as sdfT } from '../../src/geometry/sdf';
import type { SdfApi, Vec3 } from '../../src/geometry/sdfFigure';

const stubManifold = new Proxy({}, { get: () => () => undefined }) as unknown as Parameters<typeof createSdfNamespace>[0];
const sdf: SdfNamespace = createSdfNamespace(stubManifold, (s) => s);
const F = sdf.figure;
const api = sdf as unknown as SdfApi;
const { buildRig, buildHair, buildHead } = __figureTestables__;

type Ev = { evaluate: (x: number, y: number, z: number) => number; bounds(): { min: Vec3; max: Vec3 } };
const sub = (a: number[], b: number[]): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: number[], b: number[]): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: number[], s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const len = (a: number[]): number => Math.hypot(a[0], a[1], a[2]);
const norm = (a: number[]): Vec3 => { const l = len(a); return [a[0] / l, a[1] / l, a[2] / l]; };
const ev = (n: Ev, p: number[]): number => n.evaluate(p[0], p[1], p[2]);

const TOY = { height: 100, proportions: 'funko', sex: 'male', headScale: { x: 2.3, y: 1.8, z: 2.1 } } as const;

describe('rig — headSink', () => {
  const base = buildRig({});
  const sunk = buildRig({ headSink: 0.5 });
  const neckLen = (60 / 6) * 0.34;   // headH × 0.34 on the default rig
  const drop = 0.5 * neckLen;

  it('lowers the head centre, crown, chin and every face anchor by headSink × neck length', () => {
    for (const k of ['head', 'crown', 'chin'] as const) {
      expect(sunk.joints[k][2]).toBeCloseTo(base.joints[k][2] - drop, 9);
      expect(sunk.joints[k][0]).toBeCloseTo(base.joints[k][0], 9);
    }
    for (const k of Object.keys(base.face) as Array<keyof typeof base.face>) {
      expect(sub(sunk.face[k], base.face[k])).toEqual([0, 0, expect.closeTo(-drop, 9)]);
    }
    expect(sunk.opts.headSink).toBe(0.5);
  });

  it('leaves the body (and the default rig) untouched', () => {
    for (const k of ['chest', 'neck', 'hips', 'upperArmL', 'footR'] as const) expect(sunk.joints[k]).toEqual(base.joints[k]);
    expect(base.opts.headSink).toBeUndefined();
    expect(buildRig({ headSink: 0 })).toEqual(base);
  });

  it('carries the head-derived builders with it (head, hair)', () => {
    const hb = buildHead(api, base), hs = buildHead(api, sunk);
    const p = add(base.joints.head, [0, -base.r.head * 0.9, 0]);
    expect(ev(hs, sub(p, [0, 0, drop]))).toBeCloseTo(ev(hb, p), 9);
    const hairB = buildHair(api, base, { style: 'bob' }), hairS = buildHair(api, sunk, { style: 'bob' });
    const q = add(base.joints.crown, [0, 0, 0.3]);
    expect(ev(hairS, sub(q, [0, 0, drop]))).toBeCloseTo(ev(hairB, q), 6);
  });

  it('validates its range', () => {
    expect(() => buildRig({ headSink: 2 })).toThrow(/headSink/);
  });

  it('keeps rig.ring.neck clear below the sunk chin (unchanged without a sink)', () => {
    expect(buildRig({ headSink: 0 }).ring.neck).toEqual(base.ring.neck);
    for (const s of [0.42, 0.7, 1, 1.5]) {
      const rig = buildRig({ headSink: s });
      expect(rig.ring.neck.center[2]).toBeLessThan(rig.joints.chin[2] - neckLen * 0.25);
      // …and a neck trim zone there doesn't reach up into the chin.
      const z = F.trimZone(rig, { ring: 'neck', width: rig.r.neck * 0.5 });
      expect(ev(z, add(rig.joints.chin, [0, 0, 0.05]))).toBeGreaterThan(0);
    }
  });
});

describe('rig — pose.hold per-hand cups + handScale', () => {
  it("cuts the 'under' residual to ≲6% of the hand (was ~24%)", () => {
    for (const R of [10.5, 12]) {
      const rig = buildRig({ ...TOY, pose: { hold: { sphere: { radius: R }, cup: 'under' } } });
      expect(rig.hold!.residual).toBeLessThan(rig.r.hand * 1.15 * 0.06);
    }
  });

  it('keeps every contact ON the ball, below its centre for an under-cup', () => {
    const rig = buildRig({ ...TOY, pose: { hold: { sphere: { radius: 10.5 }, cup: 'under' } } });
    const h = rig.hold!;
    for (const c of [h.contactL, h.contactR]) {
      expect(len(sub(c, h.center))).toBeCloseTo(h.radius, 6);
      expect(c[2]).toBeLessThan(h.center[2] - h.radius * 0.5);
    }
  });

  it("cupL / cupR put one hand under the ball and one at its side", () => {
    const rig = buildRig({ ...TOY, pose: { hold: { sphere: { radius: 10.5 }, cupR: 'under', cupL: 'sides' } } });
    const h = rig.hold!;
    expect(h.cupL).toBe('sides');
    expect(h.cupR).toBe('under');
    expect(h.contactR[2]).toBeLessThan(h.contactL[2] - h.radius * 0.3);   // right hand lower (under)
    expect(Math.abs(h.contactL[0] - h.center[0])).toBeGreaterThan(Math.abs(h.contactR[0] - h.center[0]));   // left out at the side
  });

  it("leaves 'sides' and a plain cup unchanged, and `cup` still fills both hands", () => {
    const rig = buildRig({ ...TOY, pose: { hold: { sphere: { radius: 12 }, cup: 'sides' } } });
    expect(rig.hold!.cupL).toBe('sides');
    expect(rig.hold!.cupR).toBe('sides');
    expect(rig.hold!.handScale).toBe(1);
  });

  it('handScale sizes the solve and becomes F.hands’ default size', () => {
    const rig = buildRig({ ...TOY, pose: { hold: { sphere: { radius: 10.5 }, cup: 'under', handScale: 1.4 } } });
    expect(rig.hold!.handScale).toBe(1.4);
    const auto = F.hands(rig, { grip: 'open' }), explicit = F.hands(rig, { grip: 'open', size: 1.4 }), one = F.hands(rig, { grip: 'open', size: 1 });
    const p = rig.joints.handL as Vec3;
    expect(ev(auto, p)).toBeCloseTo(ev(explicit, p), 9);
    expect(ev(auto, p)).not.toBeCloseTo(ev(one, p), 3);
    expect(() => buildRig({ pose: { hold: { sphere: { radius: 5 }, handScale: 4 } } })).toThrow(/handScale/);
    expect(() => buildRig({ pose: { hold: { sphere: { radius: 5 }, cupL: 'over' } } })).toThrow(/cupL/);
  });
});

describe('brows — follow a translated face inside the whole weld', () => {
  const rig = buildRig({ ...TOY });
  const head = F.head(rig, { faceShape: 'round', cheek: 1.2 });
  const face = F.face.assemble(head, rig, { eyes: false, mouth: false, brows: false, ears: false });
  const dz = -3.5;
  const moved = face.translate(0, 0, dz);
  const weld = F.weld(rig, [F.torso(rig), F.neck(rig), F.arms(rig), moved]);
  const opts = { shape: 'arched', thickness: 3, width: 1.5 };

  it('seats the brows on the moved face exactly as passing the moved node itself', () => {
    const direct = F.face.brows(rig, { ...opts, on: moved });
    const viaWeld = F.face.brows(rig, { ...opts, on: weld });
    // Probe straight through the brow centre line: same marking either way.
    const c = add(rig.face.browL, [0, 0, dz]);
    for (let s = -1.5; s <= 3; s += 0.25) {
      const p = add(c, mul(rig.dir.headForward, s));
      expect(Math.sign(ev(viaWeld, p))).toBe(Math.sign(ev(direct, p)));
    }
    // …and it is actually there (solid somewhere along that line), at the moved height.
    const hits = Array.from({ length: 40 }, (_, i) => add(c, mul(rig.dir.headForward, -2 + i * 0.15))).filter((p) => ev(viaWeld, p) < 0);
    expect(hits.length).toBeGreaterThan(0);
  });

  it('a primitive merely positioned at the head is not mistaken for a move', () => {
    const blob = sdf.sphere(1).translate(rig.joints.head as Vec3);
    const a = F.face.brows(rig, { ...opts, on: F.weld(rig, [F.torso(rig), face, blob]) });
    const b = F.face.brows(rig, { ...opts, on: F.weld(rig, [F.torso(rig), face]) });
    const c = rig.face.browL;
    for (let s = -1.5; s <= 3; s += 0.5) {
      const p = add(c, mul(rig.dir.headForward, s));
      expect(Math.sign(ev(a, p))).toBe(Math.sign(ev(b, p)));
    }
  });
});

describe('clothing.shoes — style toy', () => {
  const rig = buildRig({ ...TOY });
  const fitted = F.clothing.shoes(rig) as Ev;
  const toy = F.clothing.shoes(rig, { style: 'toy' }) as Ev;

  const s = rig.sole.L;
  /** A point on the foot's footprint, `fwd` × length toward the toe, `up` × foot above the ground. */
  const at = (fwd: number, side: number, up: number): Vec3 => [
    s.point[0] + s.heading[0] * s.length * fwd - s.heading[1] * side * rig.r.foot,
    s.point[1] + s.heading[1] * s.length * fwd + s.heading[0] * side * rig.r.foot,
    s.groundZ + rig.r.foot * up,
  ];

  it('is a bigger, taller, rounder shoe on the same ground plane', () => {
    // Past the fitted toe / sides / instep, but inside the chunky toy sneaker.
    for (const p of [at(0.7, 0, 0.6), at(0, 1.12, 0.6), at(0.45, 0, 1.25)]) {
      expect(ev(fitted, p)).toBeGreaterThan(0);
      expect(ev(toy, p)).toBeLessThan(0);
    }
    // Planted flat on the sole plane: solid just above groundZ under the sole point, empty below.
    expect(ev(toy, [s.point[0], s.point[1], s.groundZ + rig.r.foot * 0.3])).toBeLessThan(0);
    expect(ev(toy, [s.point[0], s.point[1], s.groundZ - rig.r.foot * 0.2])).toBeGreaterThan(0);
  });

  it('`height` scales the toy upper; `cleats` hang studs below the sole', () => {
    const tall = F.clothing.shoes(rig, { style: 'toy', height: 1.6 }) as Ev;
    const p = at(0.45, 0, 1.8);
    expect(ev(toy, p)).toBeGreaterThan(0);
    expect(ev(tall, p)).toBeLessThan(0);
    const cleated = F.clothing.shoes(rig, { style: 'toy', cleats: true }) as Ev;
    expect(cleated.bounds().min[2]).toBeLessThan(rig.sole.L.groundZ - rig.r.foot * 0.1);
  });

  it('an odd cleat count centres its last stud — symmetric, the same on both shoes', () => {
    const three = F.clothing.shoes(rig, { style: 'toy', cleats: 3 }) as Ev;
    for (const so of [rig.sole.L, rig.sole.R]) {
      // 3 studs = a front pair + one heel stud on the centreline (local y = −0.68 × 0.8 × length).
      const back = -0.68 * 0.8 * so.length;
      const p: Vec3 = [so.point[0] + so.heading[0] * back, so.point[1] + so.heading[1] * back, so.groundZ - rig.r.foot * 0.15];
      expect(ev(three, p)).toBeLessThan(0);
    }
  });

  it('rejects toy-only knobs on a fitted shoe and bad cleat counts', () => {
    expect(() => F.clothing.shoes(rig, { height: 1.2 })).toThrow(/toy/);
    expect(() => F.clothing.shoes(rig, { style: 'toy', cleats: 2.5 })).toThrow(/cleats/);
    expect(() => F.clothing.shoes(rig, { style: 'sandal' })).toThrow();
  });
});

describe('trimZone + trim', () => {
  const rig = buildRig({ ...TOY });
  const j = rig.joints;

  it('a bone zone is a disc across the bone at `at`, on both sides (or one with L/R)', () => {
    const z = F.trimZone(rig, { bone: 'lowerLeg', at: 0.5, width: 2 });
    for (const s of ['L', 'R']) {
      const mid = mul(add(j['lowerLeg' + s], j['foot' + s]), 0.5);
      expect(ev(z, mid)).toBeLessThan(0);
      expect(ev(z, j['lowerLeg' + s])).toBeGreaterThan(0);
    }
    const left = F.trimZone(rig, { bone: 'lowerLegL', at: 0.5, width: 2 });
    expect(ev(left, mul(add(j.lowerLegR, j.footR), 0.5))).toBeGreaterThan(0);
  });

  it('stripes split the span into n bands with equal gaps', () => {
    const z = F.trimZone(rig, { bone: 'lowerLegL', from: 0, to: 1, stripes: 3 });
    const a = j.lowerLegL, b = j.footL;
    const at = (t: number): Vec3 => add(a, mul(sub(b, a), t));
    // 5 equal segments: band, gap, band, gap, band.
    for (const [t, inside] of [[0.1, true], [0.3, false], [0.5, true], [0.7, false], [0.9, true]] as const) {
      expect(ev(z, at(t)) < 0).toBe(inside);
    }
  });

  it('a ring zone straddles the ring centre; trim splits a garment into rest + band', () => {
    const z = F.trimZone(rig, { ring: 'waist', width: 3 });
    expect(ev(z, rig.ring.waist.center)).toBeLessThan(0);
    expect(ev(z, add(rig.ring.waist.center, [0, 0, 3]))).toBeGreaterThan(0);
    const garment = F.clothing.top(rig);
    const { rest, band } = F.trim(garment, z);
    // rest ∪ band is the garment again (same inside/outside everywhere).
    for (let dz = -5.95; dz <= 6; dz += 0.5) for (const dy of [-1.3, -1.05, -0.8]) {
      const p = add(rig.ring.waist.center, [0, rig.r.hipsY * dy, dz]);
      expect(Math.min(ev(rest, p), ev(band, p)) < 0).toBe(ev(garment, p) < 0);
    }
    expect(ev(band, add(rig.ring.waist.center, [0, -rig.r.hipsY * 0.9, 6]))).toBeGreaterThan(0);
  });

  it('validates its options', () => {
    expect(() => F.trimZone(rig, {})).toThrow(/bone/);
    expect(() => F.trimZone(rig, { bone: 'tail' })).toThrow(/bone/);
    expect(() => F.trimZone(rig, { bone: 'upperArm', at: 0.5, from: 0 })).toThrow();
    expect(() => F.trimZone(rig, { ring: 'neck', at: 0.5 })).toThrow();
    expect(() => F.trimZone(rig, { bone: 'upperArm', stripes: 1.5 })).toThrow(/stripes/);
  });
});

describe('emboss — conformal lettering', () => {
  const rig = buildRig({ ...TOY });
  // A flat-fronted 'garment' (front face at y = -10) and a curved one (a sphere).
  const slab = sdf.box([40, 20, 40]);
  const ball = sdf.sphere(12);
  // A 6×6 square with a 2×2 hole (even-odd), like a glyph with a counter.
  const square: Array<Array<[number, number]>> = [[[-3, -3], [3, -3], [3, 3], [-3, 3]], [[-1, -1], [1, -1], [1, 1], [-1, 1]]];

  it('stands `depth` proud of the surface, centred at `at`, with the counter open', () => {
    const e = F.emboss(square, slab, { at: [0, -11, 0], depth: 0.8, label: 'numeral' });
    expect((e as unknown as { labelName?: string }).labelName).toBe('numeral');
    expect(ev(e, [2, -10.4, 2])).toBeLessThan(0);       // in the stroke, proud of the face
    expect(ev(e, [2, -11.2, 2])).toBeGreaterThan(0);    // past the relief
    expect(ev(e, [0, -10.4, 0])).toBeGreaterThan(0);    // the counter (hole) stays open
    expect(ev(e, [5, -10.4, 0])).toBeGreaterThan(0);    // outside the glyph
    expect(ev(e, [2, -4, 2])).toBeGreaterThan(0);       // the prism stops inside the body
  });

  it('`size` scales it to that height and `up` turns it (reading the right way round)', () => {
    const big = F.emboss(square, slab, { at: [0, -10, 0], size: 12, depth: 0.6 });
    expect(ev(big, [0, -10.3, 4.5])).toBeLessThan(0);
    expect(ev(big, [0, -10.3, 7.5])).toBeGreaterThan(0);
    // An asymmetric glyph (an L): viewed from the front (−Y) its foot points to the viewer's right = +X.
    const L: Array<Array<[number, number]>> = [[[0, 0], [4, 0], [4, 1], [1, 1], [1, 5], [0, 5]]];
    const e = F.emboss(L, slab, { at: [0, -10, 0], depth: 0.6 });
    expect(ev(e, [1.5, -10.3, -2])).toBeLessThan(0);    // the foot runs to +X at the bottom
    expect(ev(e, [-1.5, -10.3, 2])).toBeLessThan(0);    // the upright is on the viewer's left (−X)
    expect(ev(e, [1.5, -10.3, 2])).toBeGreaterThan(0);
    const sideways = F.emboss(L, slab, { at: [0, -10, 0], depth: 0.6, up: [1, 0, 0] });
    expect(ev(sideways, [1.5, -10.3, -2])).toBeGreaterThan(0);
    expect(ev(sideways, [-2, -10.3, -1])).toBeLessThan(0);   // its foot now runs down (+X is its up)
  });

  it('follows a curved surface (conformal, not a flat plate)', () => {
    const e = F.emboss(square, ball, { at: [0, -13, 0], size: 10, depth: 0.5 });
    // At the stroke's edge the sphere has fallen away from the centre plane; the
    // lettering still sits on it, 0.5 proud.
    const q: [number, number, number] = [4, 0, 0];
    const y = -Math.sqrt(144 - 16);
    expect(ev(e, [q[0], y - 0.25, q[2]])).toBeLessThan(0);
    expect(ev(e, [q[0], -12.25, q[2]])).toBeGreaterThan(0);
  });

  it('never pokes through a part thinner than the lettering (clamped to the far side)', () => {
    const big: Array<Array<[number, number]>> = [[[-5, -5], [5, -5], [5, 5], [-5, 5]]];
    const rod = sdf.cylinder(2, 40);
    const e = F.emboss(big, rod, { at: [2, 0, 0], depth: 0.4 });
    expect(ev(e, [-2.2, 0, 0])).toBeGreaterThan(0);     // nothing out of the far side
    expect(ev(e, [-1.9, 0, 0])).toBeGreaterThan(0);
    expect(ev(e, [2.2, 0, 2])).toBeLessThan(0);         // still proud on the near side
  });

  it('accepts a CrossSection-like shape and validates its inputs', () => {
    const cs = { toPolygons: () => square };
    expect(() => F.emboss(cs, slab, { at: [0, -11, 0] })).not.toThrow();
    expect(() => F.emboss('N', slab, { at: [0, -11, 0] })).toThrow(/size/);
    expect(() => F.emboss(42 as never, slab, { at: [0, -11, 0] })).toThrow(/string/);
    expect(() => F.emboss(square, slab, { at: [0, -11, 0], tilt: 3 })).toThrow();
    expect(() => F.emboss(square, slab, { at: [500, 500, 500] })).toThrow(/surface/);
    // Malformed contour points are a ValidationError, not a TypeError.
    const bad = [[[0, 0], null, [1, 1], [0, 1]]] as unknown as Array<Array<[number, number]>>;
    expect(() => F.emboss(bad, slab, { at: [0, -11, 0] })).toThrow(/finite \[x, y\]/);
    // Text with no fonts loaded (the unit tier never preloads them) names emboss.
    expect(() => F.emboss('N', slab, { at: [0, -11, 0], size: 5 })).toThrow(/emboss\(text\).*not loaded/);
    void rig;
  });
});

describe("face.eyes — style 'bead'", () => {
  const rig = buildRig({ ...TOY });
  const head = F.head(rig, { faceShape: 'round', cheek: 1.2 });
  const face = F.face.assemble(head, rig, { eyes: false, mouth: false, brows: false, ears: false });
  const fwd = rig.dir.headForward;

  it('seats a labelled bead + highlight ON the real face, sunk a little in', () => {
    const eyes = F.face.eyes(rig, { style: 'bead', on: face, radius: 5 });
    const labels = new Set<string>();
    const walk = (n: { labelName?: string; _children?: unknown[] }): void => { if (n.labelName) labels.add(n.labelName); for (const c of n._children ?? []) walk(c as never); };
    walk(eyes as never);
    expect([...labels].sort()).toEqual(['eyeHighlight', 'eyes']);
    const s = F.surfacePoint(face, rig.face.eyeL, fwd)!;
    expect(ev(eyes, s)).toBeLessThan(0);                                  // the bead straddles the face surface
    expect(ev(eyes, add(s, mul(fwd, 5 * 0.72)))).toBeGreaterThan(0);     // shallow: not a ball
    expect(ev(eyes, add(s, mul(fwd, 5 * 0.4)))).toBeLessThan(0);          // but proud of the face
  });

  it('highlight: false (or 0) drops the glint; style-specific keys are validated', () => {
    for (const highlight of [false, 0]) {
      const plain = F.face.eyes(rig, { style: 'bead', on: face, highlight });
      const labels = new Set<string>();
      const walk = (n: { labelName?: string; _children?: unknown[] }): void => { if (n.labelName) labels.add(n.labelName); for (const c of n._children ?? []) walk(c as never); };
      walk(plain as never);
      expect([...labels]).toEqual(['eyes']);
    }
    expect(() => F.face.eyes(rig, { style: 'bead', lids: 'half' })).toThrow(/bead/);
    expect(() => F.face.eyes(rig, { on: face })).toThrow(/bead/);
  });
});

describe('face.surfaceY', () => {
  it('returns the front of the face at x / z (null off it)', () => {
    const rig = buildRig({});
    const head = F.head(rig);
    const c = rig.joints.head;
    const y = F.face.surfaceY(head, c[0], c[2])!;
    expect(head.evaluate(c[0], y, c[2])).toBeCloseTo(0, 4);
    expect(head.evaluate(c[0], y - 0.05, c[2])).toBeGreaterThan(0);
    expect(y).toBeLessThan(c[1]);
    expect(F.face.surfaceY(head, c[0] + 100, c[2])).toBeNull();
  });
});

describe('hair — shag follow-ups', () => {
  const rig = buildRig({ ...TOY });
  const head = F.head(rig, { faceShape: 'round', cheek: 1.2 });
  const c = rig.joints.head, R = Math.cbrt(rig.r.headX * rig.r.head * rig.r.headZ);
  const base = { style: 'shag', on: head, seed: 11 };
  const hair = F.hair(rig, base);
  const L = rig.dir.headLeft, f = rig.dir.headForward, U = rig.dir.headUp;
  const dirAt = (th: number, ph: number): Vec3 => {
    const t = th * Math.PI / 180, p = ph * Math.PI / 180;
    return norm([0, 1, 2].map((i) => L[i] * rig.r.headX * Math.cos(p) * Math.sin(t) + f[i] * rig.r.head * Math.cos(p) * Math.cos(t) + U[i] * rig.r.headZ * Math.sin(p)));
  };
  const reach = (n: Ev, d: Vec3): number => {
    let far = 0;
    for (let t = 0; t < R * 2.5; t += 0.05) if (n.evaluate(c[0] + d[0] * t, c[1] + d[1] * t, c[2] + d[2] * t) < 0) far = t;
    return far;
  };

  it('the notched fringe hangs a crisp tooth of cap below the plain hairline', () => {
    const plain = F.hair(rig, { ...base, notched: false });
    // Probe a band of skin across the forehead between the brows and the window top.
    let more = 0, fewer = 0;
    for (let th = -55; th <= 55; th += 2.5) for (let h = 0.3; h <= 0.62; h += 0.04) {
      const d = norm(add(mul(L, rig.r.headX * Math.sin(th * Math.PI / 180)), mul(f, rig.r.head * Math.cos(th * Math.PI / 180))));
      const o = add(c, mul(U, h * rig.r.headZ));
      let t = 0;
      while (head.evaluate(o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t) < 0 && t < R * 3) t += 0.05;
      const p = add(o, mul(d, t + 0.3));
      const a = ev(hair, p) < 0, b = ev(plain, p) < 0;
      if (a && !b) more++;
      if (b && !a) fewer++;
    }
    expect(more).toBeGreaterThan(fewer + 10);
    expect(() => F.hair(rig, { ...base, notched: 'yes' })).toThrow(/notched/);
  });

  it('the face-window cut is RADIAL — a full-thickness step, no knife-edge wedge (temple sliver fix)', () => {
    // Walk round the side edge of the window: where the skin just turns to hair,
    // the hair keeps (nearly) its full thickness right at the edge.
    let checked = 0;
    for (const s of [1, -1]) for (let h = 0.0; h <= 0.4; h += 0.1) {
      const o = add(c, mul(U, h * rig.r.headZ));
      let prev = false;
      for (let th = 20; th <= 120; th += 0.5) {
        const d = norm(add(mul(L, s * rig.r.headX * Math.sin(th * Math.PI / 180)), mul(f, rig.r.head * Math.cos(th * Math.PI / 180))));
        let t = 0;
        while (head.evaluate(o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t) < 0 && t < R * 3) t += 0.02;
        const skin = add(o, mul(d, t));
        const radial = norm(sub(skin, c));
        const onHair = ev(hair, add(skin, mul(radial, 0.2))) < 0;
        if (onHair && !prev && th > 20) {
          // Just past the edge: still hair a good way out along the radial.
          const step = add(skin, mul(radial, 0.25));
          const out = add(step, mul(radial, rig.r.head * 0.12 * 0.6));
          expect(ev(hair, add(step, mul(norm(sub(skin, add(c, [0, 0, 0]))), 0)))).toBeLessThan(0);
          expect(ev(hair, out)).toBeLessThan(0);
          checked++;
          break;
        }
        prev = onHair;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(4);
  });

  it('crownSize grows the spikes; backWidth pulls the side/back layers in', { timeout: 60_000 }, () => {
    const big = F.hair(rig, { ...base, crownSize: 1.6 });
    let grew = 0;
    for (let th = 0; th < 360; th += 20) for (const ph of [56, 68]) if (reach(big, dirAt(th, ph)) > reach(hair, dirAt(th, ph)) + R * 0.05) grew++;
    expect(grew).toBeGreaterThan(3);
    const narrow = F.hair(rig, { ...base, backWidth: 0.5 });
    const width = (n: Ev): number => {
      let best = 0;
      for (const z of [-0.2, 0].map((h) => c[2] + h * rig.r.headZ)) for (let y = c[1] - 30; y <= c[1] + 30; y += 1.5) for (let x = 25; x <= 45; x += 0.25) if (n.evaluate(c[0] + x, y, z) < 0) best = Math.max(best, x);
      return best;
    };
    expect(width(narrow)).toBeLessThan(width(hair) - 1);
    expect(() => F.hair(rig, { ...base, backWidth: 3 })).toThrow(/backWidth/);
    expect(() => F.hair(rig, { style: 'anime', on: head, crownSize: 1 })).toThrow();
  });

  it('bounding-box culling of the locks leaves the field exact near the surface', { timeout: 30_000 }, () => {
    const plainApi = { ...(sdf as unknown as Record<string, unknown>), __bounded: undefined } as unknown as SdfApi;
    const exact = createFigureNamespace(plainApi).hair(rig, base) as Ev;
    let seed = 7;
    const rnd = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    let near = 0;
    for (let i = 0; i < 3000; i++) {
      const d = norm([rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1]);
      const p = add(c, mul(d, R * (0.8 + rnd() * 0.8)));
      const a = ev(exact, p);
      if (Math.abs(a) < 2) { near++; expect(ev(hair, p)).toBeCloseTo(a, 9); }
      else expect(Math.sign(ev(hair, p))).toBe(Math.sign(a));
    }
    expect(near).toBeGreaterThan(100);
  });
});

describe('sdf internals — bounded / polygonPrism', () => {
  it('bounded = child near it, box distance far away; compiles identically', () => {
    const child = sdf.sphere(3).translate([10, 0, 0]);
    const b = sdfT.opBounded(child as never, 2);
    expect(b.evaluate(10, 0, 4)).toBeCloseTo(child.evaluate(10, 0, 4), 12);
    expect(b.evaluate(30, 0, 0)).toBeCloseTo(17, 9);   // 30 − (10 + 3)
    const tree = sdfT.opUnion(b, sdf.box([4, 4, 4]) as never);
    const fn = compileSdfEval(tree as never)!;
    expect(fn).not.toBeNull();
    for (const p of [[0, 0, 0], [10, 0, 3.5], [25, 3, -2], [12, 1, 0]]) expect(fn(p[0], p[1], p[2])).toBeCloseTo(tree.evaluate(p[0], p[1], p[2]), 12);
  });

  it('polygonPrism is an exact even-odd extrusion', () => {
    const sq: Array<Array<[number, number]>> = [[[-2, -2], [2, -2], [2, 2], [-2, 2]], [[-1, -1], [1, -1], [1, 1], [-1, 1]]];
    const p = sdfT.primPolygonPrism(sq, 1);
    expect(p.evaluate(1.5, 0, 0)).toBeCloseTo(-0.5, 12);   // in the ring, 0.5 from both walls
    expect(p.evaluate(0, 0, 0)).toBeCloseTo(1, 12);        // in the hole
    expect(p.evaluate(5, 0, 0)).toBeCloseTo(3, 12);
    expect(p.evaluate(1.5, 0, 3)).toBeCloseTo(2, 12);      // above the slab
  });
});
