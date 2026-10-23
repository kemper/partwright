// Unit tests for the 'shag' hair style in src/geometry/sdfFigure.ts and the
// builder gaps it needed: the notched (jagged) cap window, the ribbon tip-width
// floor, surface-following F.hair.tuft endpoints and F.place({ heightOf }).
// Pure logic — SDF nodes are evaluated directly, nothing is meshed.

import { describe, it, expect } from 'vitest';
import { __figureTestables__, createFigureNamespace } from '../../src/geometry/sdfFigure';
import { __testables__ as sdfT } from '../../src/geometry/sdf';
import type { SdfApi, Vec3 } from '../../src/geometry/sdfFigure';

const { buildRig, buildHair, buildHead, placeFigure, ribbonLock } = __figureTestables__;

const api: SdfApi = {
  sphere: sdfT.primSphere,
  ellipsoid: sdfT.primEllipsoid,
  box: sdfT.primBox,
  roundedBox: sdfT.primRoundedBox,
  cylinder: sdfT.primCylinder,
  roundedCylinder: sdfT.primRoundedCylinder,
  capsule: sdfT.primCapsule,
  union: (...nodes) => nodes.reduce((a, b) => sdfT.opUnion(a, b)),
  __fineHands: (node, regions) => sdfT.opFineHands(node, regions),
} as unknown as SdfApi;
const F = createFigureNamespace(api);

type Ev = { evaluate: (x: number, y: number, z: number) => number };
const norm = (a: number[]): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
/** The first point outside `n` marching from `from` along `d`. */
const exitAlong = (n: Ev, from: Vec3, d: Vec3): Vec3 => {
  let t = 0;
  while (n.evaluate(from[0] + d[0] * t, from[1] + d[1] * t, from[2] + d[2] * t) <= 0) t += 0.05;
  return [from[0] + d[0] * t, from[1] + d[1] * t, from[2] + d[2] * t];
};

describe('figure hair — shag', () => {
  const rig = buildRig({ height: 100, proportions: 'funko', headScale: { x: 2.3, y: 1.8, z: 2.1 } });
  const head = buildHead(api, rig, { faceShape: 'round', cheek: 1.2 });
  const c = rig.joints.head, f = rig.dir.headForward;
  const R = Math.cbrt(rig.r.headX * rig.r.head * rig.r.headZ);
  const pts: Vec3[] = [];
  for (let i = 0; i < 80; i++) {
    const a = i * 2.39996, e = Math.sin(i * 1.7) * 1.2, Rr = rig.r.head * (0.9 + (i % 7) * 0.12);
    pts.push([c[0] + Rr * Math.cos(e) * Math.cos(a), c[1] + Rr * Math.cos(e) * Math.sin(a), c[2] + Rr * Math.sin(e)]);
  }
  const sample = (n: Ev): number[] => pts.map((p) => n.evaluate(p[0], p[1], p[2]));
  /** Farthest solid point of `n` along the ray from the head centre (≤ 2.5 R) — sees past gaps. */
  const reach = (n: Ev, d: Vec3): number => {
    let far = 0;
    for (let t = 0; t < R * 2.5; t += 0.05) if (n.evaluate(c[0] + d[0] * t, c[1] + d[1] * t, c[2] + d[2] * t) < 0) far = t;
    return far;
  };
  /** Head-frame direction at azimuth θ (deg, 0 = face, 180 = back) / elevation φ (deg). */
  const dirAt = (th: number, ph: number): Vec3 => {
    const t = th * Math.PI / 180, p = ph * Math.PI / 180, L = rig.dir.headLeft, U = rig.dir.headUp;
    return norm([0, 1, 2].map((i) => L[i] * rig.r.headX * Math.cos(p) * Math.sin(t) + f[i] * rig.r.head * Math.cos(p) * Math.cos(t) + U[i] * rig.r.headZ * Math.sin(p)));
  };
  const hair = buildHair(api, rig, { style: 'shag', on: head, seed: 11 });

  it('is deterministic for a seed and varies with it', () => {
    expect(sample(hair)).toEqual(sample(buildHair(api, rig, { style: 'shag', on: head, seed: 11 })));
    expect(sample(buildHair(api, rig, { style: 'shag', on: head, seed: 12 }))).not.toEqual(sample(hair));
  });

  it("the default 'spiky' crown stands spikes up above the crown, fanning back", () => {
    const flat = buildHair(api, rig, { style: 'shag', on: head, seed: 11, spike: 0 });
    const skin = reach(head, dirAt(145, 56));
    // The back-fanning spikes stand proud of the skull, past where spike: 0
    // (laid flat; only the cap + layers remain) ends.
    expect(reach(hair, dirAt(145, 56)) - skin).toBeGreaterThan(R * 0.35);
    expect(reach(hair, dirAt(145, 56))).toBeGreaterThan(reach(flat, dirAt(145, 56)) + R * 0.08);
    expect(reach(hair, dirAt(215, 56))).toBeGreaterThan(reach(flat, dirAt(215, 56)) + R * 0.08);
    // The side-up spikes flick out past the temples.
    expect(reach(hair, dirAt(100, 60))).toBeGreaterThan(reach(flat, dirAt(100, 60)) + R * 0.2);
    // 'tousled' is a different crown.
    expect(sample(buildHair(api, rig, { style: 'shag', on: head, seed: 11, crown: 'tousled' }))).not.toEqual(sample(hair));
  });

  it('leaves the eyes and brows uncovered, but hairs the forehead and the back', () => {
    for (const a of [rig.face.eyeL, rig.face.eyeR, rig.face.browL, rig.face.browR]) {
      const p = exitAlong(head, [a[0], c[1], a[2]], f);
      expect(hair.evaluate(p[0] + f[0] * 0.4, p[1] + f[1] * 0.4, p[2])).toBeGreaterThan(0);
    }
    const p = exitAlong(head, [0, c[1], c[2] + rig.r.headZ * 0.75], f);
    expect(hair.evaluate(p[0] + f[0] * 0.4, p[1] + f[1] * 0.4, p[2])).toBeLessThan(0);
    const back = exitAlong(head, c, [-f[0], -f[1], -f[2]]);
    expect(hair.evaluate(back[0] - f[0] * 0.3, back[1] - f[1] * 0.3, back[2])).toBeLessThan(0);
  });

  it('layers / flare add hair mass; raggedness 0 still builds', () => {
    // The nape layer (layers 3) hangs low over the back of the neck; 1 layer doesn't.
    const nape = (n: Ev): number => {
      let k = 0;
      for (let th = 140; th <= 220; th += 4) {
        const d = dirAt(th, -28), p = exitAlong(head, c, d);
        if (n.evaluate(p[0] + d[0] * 5.5, p[1] + d[1] * 5.5, p[2] + d[2] * 5.5) < 0) k++;
      }
      return k;
    };
    expect(nape(buildHair(api, rig, { style: 'shag', on: head, seed: 11, layers: 1 }))).toBeLessThan(nape(hair));
    const sideOut = (n: Ev): number => reach(n, dirAt(90, 34));
    expect(sideOut(buildHair(api, rig, { style: 'shag', on: head, seed: 11, flare: 2.5 })))
      .toBeGreaterThan(sideOut(buildHair(api, rig, { style: 'shag', on: head, seed: 11, flare: 0 })));
    expect(() => buildHair(api, rig, { style: 'shag', on: head, raggedness: 0 })).not.toThrow();
  });

  it('validates its keys', () => {
    expect(() => buildHair(api, rig, { style: 'shag', crown: 'mohawk' })).toThrow(/crown/);
    expect(() => buildHair(api, rig, { style: 'shag', layers: 2.5 })).toThrow(/layers/);
    expect(() => buildHair(api, rig, { style: 'shag', layers: 4 })).toThrow(/layers/);
    expect(() => buildHair(api, rig, { style: 'shag', raggedness: 3 })).toThrow(/raggedness/);
    expect(() => buildHair(api, rig, { style: 'shag', locks: 3 })).toThrow(/locks/);
    expect(() => buildHair(api, rig, { style: 'shag', swoop: 1 })).toThrow(/only apply to style 'anime'/);
    expect(() => buildHair(api, rig, { style: 'shag', spread: 1 })).toThrow(/only apply to style 'mop'/);
    expect(() => buildHair(api, rig, { style: 'anime', layers: 2 })).toThrow(/only apply to style 'shag'/);
    expect(() => buildHair(api, rig, { style: 'short', crown: 'spiky' })).toThrow(/only apply to style 'shag'/);
    expect(() => buildHair(api, rig, { style: 'mop', spike: 1 })).toThrow(/only apply to style 'anime' or 'shag'/);
  });
});

describe('figure hair — builder gaps (notched window, tip floor, surface tufts, place heightOf)', () => {
  const r = F.rig({ height: 100, proportions: 'funko', headScale: { x: 2.3, y: 1.8, z: 2.1 } });
  const h = F.head(r, { faceShape: 'round', cheek: 1.2 });
  const f = r.dir.headForward, c = r.joints.head;

  it('window notches hang pointed teeth of cap into the hairline', () => {
    const plain = F.hair.cap(r, { on: h, window: { top: 0.55 } });
    const notched = F.hair.cap(r, { on: h, window: { top: 0.55, notches: 9, depth: 0.25 } });
    // Sample just proud of the forehead skin across the front, below the arch top.
    let pc = 0, nc = 0;
    for (let x = -14; x <= 14; x += 0.7) {
      for (let zz = 0.3; zz <= 0.55; zz += 0.02) {
        const p = exitAlong(h, [c[0] + x, c[1], c[2] + r.r.headZ * zz], f);
        const q: Vec3 = [p[0] + f[0] * 0.3, p[1] + f[1] * 0.3, p[2]];
        if (plain.evaluate(...q) < 0) pc++;
        if (notched.evaluate(...q) < 0) nc++;
      }
    }
    expect(nc).toBeGreaterThan(pc + 20);
    // The eyes stay clear.
    const e = exitAlong(h, [r.face.eyeL[0], c[1], r.face.eyeL[2]], f);
    expect(notched.evaluate(e[0], e[1] - 0.4, e[2])).toBeGreaterThan(0);
    expect(() => F.hair.cap(r, { window: { notches: 2.5 } })).toThrow(/notches/);
    expect(() => F.hair.cap(r, { window: { depth: 0.2 } })).toThrow(/notches/);
  });

  it('ribbon tipWidth keeps the tip chunky (no needle point)', () => {
    const up = (): Vec3 => [0, 0, 1];
    const ext = (n: Ev, p: Vec3): number => { let t = 0; while (n.evaluate(p[0], p[1] + t, p[2]) < 0 && t < 50) t += 0.005; return t; };
    const sharp = ribbonLock(api, [0, 0, 0], [5, 0, 0], [10, 0, 0], { width: 2, thickness: 0.5, tipFloor: 0.02, outward: up });
    const blunt = ribbonLock(api, [0, 0, 0], [5, 0, 0], [10, 0, 0], { width: 2, thickness: 0.5, tipFloor: 0.02, outward: up, tipWidth: 0.8 });
    expect(ext(blunt, [9.5, 0, 0])).toBeGreaterThan(ext(sharp, [9.5, 0, 0]) * 1.4);
    expect(ext(blunt, [9.8, 0, 0])).toBeGreaterThan(ext(sharp, [9.8, 0, 0]) * 1.4);
    expect(ext(blunt, [1, 0, 0])).toBeCloseTo(ext(sharp, [1, 0, 0]), 1);   // root unchanged
    // Also on F.hair.tuft (ribbon only).
    expect(() => F.hair.tuft(r, { base: [0, 0, 0], dir: [1, 0, 0], width: 2, tipWidth: 0.5 })).not.toThrow();
    expect(() => F.hair.tuft(r, { base: [0, 0, 0], dir: [1, 0, 0], width: 2, tipWidth: 3 })).toThrow(/tipWidth/);
    expect(() => F.hair.tuft(r, { base: [0, 0, 0], dir: [1, 0, 0], shape: 'tube', tipWidth: 0.5 })).toThrow(/only apply to shape 'ribbon'/);
  });

  it('F.hair.tuft takes surface-following endpoints on the head', () => {
    const t = F.hair.tuft(r, { on: h, from: { az: 180, el: 70 }, to: { az: 180, el: 30, out: 6 }, width: 4 });
    const back = (el: number): Vec3 => norm([0, -Math.cos(el * Math.PI / 180) * r.r.head * f[1], Math.sin(el * Math.PI / 180) * r.r.headZ]);
    // Root: just under the skin at (180°, 70°) — inside the lock.
    const d70 = back(70), s70 = exitAlong(h, c, d70);
    expect(t.evaluate(s70[0] - d70[0] * 0.6, s70[1] - d70[1] * 0.6, s70[2] - d70[2] * 0.6)).toBeLessThan(0);
    // Tip: 6 units out from the skin at (180°, 30°) — the lock ends near it.
    const d30 = back(30), s30 = exitAlong(h, c, d30);
    const at = (k: number): Vec3 => [s30[0] + d30[0] * k, s30[1] + d30[1] * k, s30[2] + d30[2] * k];
    // The point ends within a hair of the requested tip, nothing past it.
    expect(Math.abs(t.evaluate(...at(6)))).toBeLessThan(2.5);   // ellipsoid-chain field is a bound, not exact
    expect(t.evaluate(...at(10))).toBeGreaterThan(0);
    // …and the tip really stands out (a surface `out: 0` tip ends at the skin).
    const flush = F.hair.tuft(r, { on: h, from: { az: 180, el: 70 }, to: { az: 180, el: 30 }, width: 4 });
    expect(Math.abs(flush.evaluate(...at(0)))).toBeLessThan(2.5);
    expect(flush.evaluate(...at(6))).toBeGreaterThan(t.evaluate(...at(6)) + 2);
    // The `h` (height) form + `via`.
    expect(() => F.hair.tuft(r, { on: h, from: { az: 20, h: 0.8 }, via: { az: 25, h: 0.55, out: 2 }, to: { az: 30, h: 0.3, out: 1 } })).not.toThrow();
    expect(() => F.hair.tuft(r, { from: { az: 0, el: 60 } })).toThrow(/from and to/);
    expect(() => F.hair.tuft(r, { from: { az: 0, el: 60 }, to: { az: 0, el: 20 }, base: [0, 0, 0] })).toThrow(/base/);
    expect(() => F.hair.tuft(r, { from: { az: 0, el: 60, h: 0.4 }, to: { az: 0, el: 20 } })).toThrow(/exactly one/);
    expect(() => F.hair.tuft(r, { from: { el: 60 }, to: { az: 0, el: 20 } })).toThrow(/az/);
    expect(() => F.hair.tuft(r, { from: { az: 0, el: 60 }, to: { az: 0, el: 20 }, via: { az: 0, el: 40 }, curve: 0.2 })).toThrow(/via/);
    expect(() => F.hair.tuft(r, { base: [0, 0, 0], dir: [1, 0, 0], via: { az: 0, el: 40 } })).toThrow(/via/);
  });

  it("place heightOf: 'body' measures to the rig crown, ignoring hair spikes", () => {
    const rig = buildRig({});
    class Mesh {
      constructor(readonly lo: number, readonly hi: number) {}
      boundingBox() { return { min: [0, 0, this.lo], max: [0, 0, this.hi] }; }
      translate(v: number[]) { return new Mesh(this.lo + v[2], this.hi + v[2]); }
      scale(s: number) { return new Mesh(this.lo * s, this.hi * s); }
      rotate() { return this; }
    }
    const crown = rig.joints.crown[2];
    const spiky = new Mesh(-2, crown + 9);   // hair spikes 9 above the crown
    expect((placeFigure(spiky, rig, { height: 50 }) as Mesh).hi).toBeCloseTo(50, 9);   // default 'all' (unchanged)
    const body = placeFigure(spiky, rig, { height: 50, heightOf: 'body' }) as Mesh;
    expect(body.lo).toBeCloseTo(0, 9);
    expect(body.hi).toBeCloseTo((crown + 9 + 2) * (50 / (crown + 2)), 9);   // crown lands at 50, spikes above
    expect(() => placeFigure(spiky, rig, { heightOf: 'body' })).toThrow(/heightOf/);
    expect(() => placeFigure(spiky, rig, { height: 50, heightOf: 'hair' })).toThrow();
  });
});
