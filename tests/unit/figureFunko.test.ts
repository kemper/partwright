// Unit tests for the stylized-toy primitives in src/geometry/sdfFigure.ts
// (issue #1055): rig headScale / proportions / faceLayout, the 'mop' hair
// style, the two-hand sphere hold, rig.floorZ, F.place and F.surfacePoint.
// Pure logic — SDF nodes are evaluated directly, nothing is meshed.

import { describe, it, expect } from 'vitest';
import { __figureTestables__, createFigureNamespace } from '../../src/geometry/sdfFigure';
import { __testables__ as sdfT } from '../../src/geometry/sdf';
import type { SdfApi, Vec3 } from '../../src/geometry/sdfFigure';

const { buildRig, buildHair, buildHead, placeFigure, surfacePoint } = __figureTestables__;

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

const sub = (a: number[], b: number[]): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: number[]): number => Math.hypot(a[0], a[1], a[2]);
const dot = (a: number[], b: number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: number[], b: number[]): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: number[]): Vec3 => { const l = len(a); return [a[0] / l, a[1] / l, a[2] / l]; };

describe('figure rig — headScale', () => {
  const hs = { x: 2, y: 1.5, z: 1.2 };
  const N = 3, H = 100;
  const scaled = buildRig({ height: H, headsTall: N, headScale: hs });
  // The unscaled canon the scaled rig is built on: height shrinks so the crown stays at H.
  const base = buildRig({ height: H / (1 + (hs.z - 1) / N), headsTall: N });

  it('keeps `height` as the total crown height', () => {
    expect(scaled.joints.crown[2]).toBeCloseTo(H, 9);
    expect(scaled.opts.height).toBe(H);
  });

  it('grows the head up from the chin and scales the head radii per axis', () => {
    expect(scaled.joints.chin).toEqual(base.joints.chin);
    expect(scaled.joints.head[2]).toBeCloseTo(base.joints.chin[2] + hs.z * (base.joints.head[2] - base.joints.chin[2]), 9);
    expect(scaled.r.headX).toBeCloseTo(base.r.headX * hs.x, 9);
    expect(scaled.r.head).toBeCloseTo(base.r.head * hs.y, 9);
    expect(scaled.r.headZ).toBeCloseTo(base.r.headZ * hs.z, 9);
  });

  it('scales every face anchor about the head centre in the head frame', () => {
    for (const k of ['eyeL', 'eyeR', 'browL', 'nose', 'mouth', 'earL', 'chinTip'] as const) {
      const d0 = sub(base.face[k], base.joints.head);
      const d1 = sub(scaled.face[k], scaled.joints.head);
      expect(d1[0]).toBeCloseTo(d0[0] * hs.x, 9);
      expect(d1[1]).toBeCloseTo(d0[1] * hs.y, 9);
      expect(d1[2]).toBeCloseTo(d0[2] * hs.z, 9);
    }
  });

  it('leaves the body (joints, girths, torso anchors) on the unscaled canon', () => {
    expect(scaled.joints.upperArmL).toEqual(base.joints.upperArmL);
    expect(scaled.r.chestX).toBe(base.r.chestX);
    expect(scaled.torso.nippleL[2]).toBeCloseTo(base.torso.nippleL[2], 9);
  });

  it('a number scales uniformly; an unscaled rig carries no head-scale state', () => {
    const u = buildRig({ headScale: 1.5 });
    expect(u.opts.headScale).toEqual({ x: 1.5, y: 1.5, z: 1.5 });
    const plain = buildRig({});
    expect(plain.opts.headScale).toBeUndefined();
    expect(plain.r.headBody).toBeUndefined();
    expect(buildRig({ headScale: 1 })).toEqual(plain);
  });

  it('validates the scale', () => {
    expect(() => buildRig({ headScale: 10 })).toThrow();
    expect(() => buildRig({ headScale: { w: 2 } as never })).toThrow();
  });
});

describe('figure rig — proportions presets + faceLayout', () => {
  it("'funko' gives a head ≈45% of the height and keeps the crown at height", () => {
    const rig = buildRig({ height: 100, proportions: 'funko' });
    expect(rig.joints.crown[2]).toBeCloseTo(100, 9);
    const headFrac = (rig.joints.crown[2] - rig.joints.chin[2]) / 100;
    expect(headFrac).toBeGreaterThan(0.42);
    expect(headFrac).toBeLessThan(0.5);
    expect(rig.r.headX).toBeGreaterThan(rig.r.headZ * 1.1);   // wider than tall
    expect(rig.opts.build).toBe('slim');
  });

  it('explicit keys override the preset', () => {
    const rig = buildRig({ height: 100, proportions: 'funko', headsTall: 4, build: 'stocky', headScale: 1 });
    expect(rig.opts.headsTall).toBe(4);
    expect(rig.opts.build).toBe('stocky');
    expect(rig.opts.headScale).toBeUndefined();
  });

  it('eyeSpread multiplies the eye lateral offset; eyeHeight drops eyes (brows/nose follow at 60%)', () => {
    const a = buildRig({});
    const b = buildRig({ faceLayout: { eyeSpread: 1.3, eyeHeight: -0.2 } });
    expect(b.face.eyeL[0]).toBeCloseTo(a.face.eyeL[0] * 1.3, 9);
    expect(b.face.eyeL[2] - a.face.eyeL[2]).toBeCloseTo(-0.2 * a.r.headZ, 9);
    expect(b.face.browL[2] - a.face.browL[2]).toBeCloseTo(-0.12 * a.r.headZ, 9);
    expect(b.face.nose[2] - a.face.nose[2]).toBeCloseTo(-0.12 * a.r.headZ, 9);
    expect(() => buildRig({ faceLayout: { eyeSize: 2 } as never })).toThrow();
  });
});

describe('figure hair — mop', () => {
  const rig = buildRig({ height: 100, proportions: 'funko' });
  const pts: Vec3[] = [];
  for (let i = 0; i < 40; i++) {
    const a = i * 2.39996, e = Math.sin(i * 1.7) * 0.9;
    const R = 26 + (i % 5) * 1.5;
    pts.push([rig.joints.head[0] + R * Math.cos(e) * Math.cos(a), rig.joints.head[1] + R * Math.cos(e) * Math.sin(a), rig.joints.head[2] + R * Math.sin(e)]);
  }
  const sample = (n: { evaluate: (x: number, y: number, z: number) => number }): number[] => pts.map((p) => n.evaluate(p[0], p[1], p[2]));

  it('is deterministic for a seed and varies with it', () => {
    const a = sample(buildHair(api, rig, { style: 'mop', seed: 3, locks: 12 }));
    const b = sample(buildHair(api, rig, { style: 'mop', seed: 3, locks: 12 }));
    const c = sample(buildHair(api, rig, { style: 'mop', seed: 4, locks: 12 }));
    expect(a).toEqual(b);
    expect(c).not.toEqual(a);
  });

  it('sits on the scaled head: covers the crown and the back, opens the face', () => {
    const head = buildHead(api, rig);
    const hair = buildHair(api, rig, { style: 'mop', on: head, locks: 12 });
    const c = rig.joints.head;
    // Just above the skull top and behind the head: inside the hair.
    let top = c[2] + rig.r.headZ * 2;
    while (head.evaluate(c[0], c[1], top) > 0) top -= 0.05;
    expect(hair.evaluate(c[0], c[1], top + 0.3)).toBeLessThan(0);
    let back = c[1] + rig.r.head * 2;
    while (head.evaluate(c[0], back, c[2]) > 0) back -= 0.05;
    expect(hair.evaluate(c[0], back + 0.3, c[2])).toBeLessThan(0);
    // The eyes are in the face window — no hair over them.
    const e = rig.face.eyeL;
    expect(hair.evaluate(e[0], e[1] - 0.5, e[2])).toBeGreaterThan(0);
  });

  it('rejects mop-only keys on other styles', () => {
    expect(() => buildHair(api, rig, { style: 'short', seed: 2 })).toThrow(/only apply to style 'mop'/);
    expect(() => buildHair(api, rig, { style: 'mop', locks: 2 })).toThrow();
  });
});

describe('figure hair — anime', () => {
  const rig = buildRig({ height: 100, proportions: 'funko', headScale: { x: 2.3, y: 1.8, z: 2.1 } });
  const head = buildHead(api, rig, { faceShape: 'round', cheek: 1.2 });
  const c = rig.joints.head, f = rig.dir.headForward;
  const pts: Vec3[] = [];
  for (let i = 0; i < 60; i++) {
    const a = i * 2.39996, e = Math.sin(i * 1.7) * 1.2, R = rig.r.head * (0.9 + (i % 6) * 0.12);
    pts.push([c[0] + R * Math.cos(e) * Math.cos(a), c[1] + R * Math.cos(e) * Math.sin(a), c[2] + R * Math.sin(e)]);
  }
  const sample = (n: { evaluate: (x: number, y: number, z: number) => number }): number[] => pts.map((p) => n.evaluate(p[0], p[1], p[2]));
  // The first point outside `n` marching from the head centre along `d`.
  const exitAlong = (n: { evaluate: (x: number, y: number, z: number) => number }, from: Vec3, d: Vec3): Vec3 => {
    let t = 0;
    while (n.evaluate(from[0] + d[0] * t, from[1] + d[1] * t, from[2] + d[2] * t) <= 0) t += 0.05;
    return [from[0] + d[0] * t, from[1] + d[1] * t, from[2] + d[2] * t];
  };
  const hair = buildHair(api, rig, { style: 'anime', on: head, seed: 5 });

  it('is deterministic for a seed and varies with it', () => {
    const a = sample(hair);
    const b = sample(buildHair(api, rig, { style: 'anime', on: head, seed: 5 }));
    const d = sample(buildHair(api, rig, { style: 'anime', on: head, seed: 6 }));
    expect(a).toEqual(b);
    expect(d).not.toEqual(a);
  });

  it('caps the crown and the back of the scaled head', () => {
    const top = exitAlong(head, c, [0, 0, 1]);
    expect(hair.evaluate(top[0], top[1], top[2] + 0.3)).toBeLessThan(0);
    const back = exitAlong(head, c, [-f[0], -f[1], -f[2]]);
    expect(hair.evaluate(back[0] - f[0] * 0.3, back[1] - f[1] * 0.3, back[2])).toBeLessThan(0);
  });

  it('leaves the eyes and brows uncovered (the face window), but hairs the forehead above', () => {
    for (const a of [rig.face.eyeL, rig.face.eyeR, rig.face.browL, rig.face.browR]) {
      const p = exitAlong(head, [a[0], c[1], a[2]], f);   // the real skin in front of the anchor
      expect(hair.evaluate(p[0] + f[0] * 0.4, p[1] + f[1] * 0.4, p[2])).toBeGreaterThan(0);
    }
    const fh: Vec3 = [0, c[1], c[2] + rig.r.headZ * 0.75];
    const p = exitAlong(head, fh, f);
    expect(hair.evaluate(p[0] + f[0] * 0.4, p[1] + f[1] * 0.4, p[2])).toBeLessThan(0);
  });

  it('validates its keys', () => {
    expect(() => buildHair(api, rig, { style: 'anime', spread: 1 })).toThrow(/only apply to style 'mop'/);
    expect(() => buildHair(api, rig, { style: 'mop', spike: 1 })).toThrow(/only apply to style 'anime'/);
    expect(() => buildHair(api, rig, { style: 'short', swoop: 1 })).toThrow(/only apply to style 'anime'/);
    expect(() => buildHair(api, rig, { style: 'anime', locks: 4 })).toThrow();
    expect(() => buildHair(api, rig, { style: 'anime', ears: 'over', spike: 2, swoop: -0.5, fringe: 0.5 })).not.toThrow();
  });

  it('F.hair.cap / F.hair.tuft helpers', () => {
    const r = F.rig({ height: 100, proportions: 'funko', headScale: { x: 2.3, y: 1.8, z: 2.1 } });
    const h = F.head(r, { faceShape: 'round', cheek: 1.2 });
    const cap = F.hair.cap(r, { on: h, hairlinePlane: { back: -0.7 }, window: { width: 1.1 } });
    const top = exitAlong(h, r.joints.head, [0, 0, 1]);
    expect(cap.evaluate(top[0], top[1], top[2] + 0.3)).toBeLessThan(0);
    const e = exitAlong(h, [r.face.eyeL[0], r.joints.head[1], r.face.eyeL[2]], r.dir.headForward);
    expect(cap.evaluate(e[0], e[1] - 0.4, e[2])).toBeGreaterThan(0);
    // window:false keeps the forehead capped
    const closed = F.hair.cap(r, { on: h, window: false });
    expect(closed.evaluate(e[0], e[1] - 0.4, e[2] + r.r.headZ * 0.35)).toBeLessThan(0);
    // A tuft runs from base along dir and ends in a point.
    const base: Vec3 = [0, 0, 120];
    const tuft = F.hair.tuft(r, { base, dir: [1, 0, 0], length: 10, width: 2, curve: 0 });
    expect(tuft.evaluate(0, 0, 120)).toBeCloseTo(-2, 6);
    expect(tuft.evaluate(10, 0, 120)).toBeLessThan(0.0);
    expect(tuft.evaluate(10, 0, 120)).toBeGreaterThan(-1);
    expect(tuft.evaluate(5, 0, 123)).toBeGreaterThan(0);
    expect(F.hair.tuft(r, { base, dir: [1, 0, 0], length: 10, width: 2, curve: 0.3 }).evaluate(5, 0, 123)).toBeLessThan(0);
    expect(() => F.hair.tuft(r, { base, dir: [1, 0, 0], bogus: 1 })).toThrow();
    expect(() => F.hair.cap(r, { window: { size: 2 } })).toThrow();
  });
});

describe('figure rig — two-hand sphere hold', () => {
  for (const cup of ['sides', 'under'] as const) {
    it(`cup:'${cup}' lands both palms on the ball`, () => {
      const R = 12;
      const rig = buildRig({ height: 100, proportions: 'funko', pose: { hold: { sphere: { radius: R }, cup } } });
      const hold = rig.hold!;
      expect(hold.radius).toBe(R);
      const rh = rig.r.hand * 1.15;
      for (const s of ['L', 'R'] as const) {
        const fore = rig.dir[`lowerArm${s}`], splay = rig.dir[`handSplay${s}`];
        const palmN = norm(cross(fore, splay));
        const handC = rig.joints[`hand${s}`];
        const palmC = handC.map((v, i) => v + fore[i] * rh * 0.43 + palmN[i] * rh * 0.25);
        // Palm centre within a hand-fraction of the ball surface, facing the centre.
        expect(Math.abs(len(sub(palmC, hold.center)) - R)).toBeLessThan(rh * (cup === 'sides' ? 0.15 : 0.45));
        expect(dot(palmN, norm(sub(hold.center, palmC)))).toBeGreaterThan(0.7);
        // The reported contact really is on the sphere.
        expect(len(sub(s === 'L' ? hold.contactL : hold.contactR, hold.center))).toBeCloseTo(R, 6);
      }
      expect(hold.residual).toBeLessThan(rh * (cup === 'sides' ? 0.15 : 0.45));
      // Left/right mirror for a centred ball.
      expect(rig.joints.handL[0]).toBeCloseTo(-rig.joints.handR[0], 6);
    });
  }

  it("'under' cradles lower than 'sides'", () => {
    const side = buildRig({ pose: { hold: { sphere: { radius: 6, center: [0, -12, 30] }, cup: 'sides' } } });
    const under = buildRig({ pose: { hold: { sphere: { radius: 6, center: [0, -12, 30] }, cup: 'under' } } });
    expect(under.hold!.contactL[2]).toBeLessThan(side.hold!.contactL[2]);
  });

  it('heldSphere returns the ball node; hold + explicit arms is rejected', () => {
    const rig = F.rig({ pose: { hold: { sphere: { radius: 5 } } } });
    const ball = F.heldSphere(rig);
    const c = rig.hold!.center;
    expect(ball.evaluate(c[0], c[1], c[2])).toBeCloseTo(-5, 9);
    expect(() => F.heldSphere(F.rig({}))).toThrow();
    expect(() => buildRig({ pose: { hold: { sphere: { radius: 5 } }, armL: { bend: 20 } } })).toThrow(/hold solves both arms/);
    expect(() => buildRig({ pose: { hold: { sphere: {} } } })).toThrow(/radius is required/);
  });
});

describe('figure floor + place', () => {
  it('rig.floorZ is the lowest sole plane (and tracks F.ground)', () => {
    const rig = buildRig({ pose: { legL: { raiseFwd: 30, bend: 40 } } });
    expect(rig.floorZ).toBe(Math.min(rig.sole.L.groundZ, rig.sole.R.groundZ));
    const g = F.ground(rig, { z: rig.floorZ + 1, mode: 'drop' });
    expect(g.floorZ).toBeCloseTo(rig.floorZ + 1, 6);
  });

  it('drops an SDF node to the floor by the rig sole and turns it to face +X', () => {
    const rig = buildRig({});
    // A marker box sitting on the rig floor, in FRONT of the figure (−Y).
    const marker = api.box([2, 2, 2]).translate([0, -10, rig.floorZ + 1]);
    const placed = placeFigure(marker, rig, { face: '+X' }) as typeof marker;
    const b = placed.bounds();
    expect(b.min[2]).toBeCloseTo(0, 6);       // floor at z = 0
    expect((b.min[0] + b.max[0]) / 2).toBeCloseTo(10, 6);   // −Y front now points +X
    expect((b.min[1] + b.max[1]) / 2).toBeCloseTo(0, 6);
  });

  it("uses a built mesh's true bottom ('auto') and can rescale to a height", () => {
    const rig = buildRig({});
    const calls: string[] = [];
    // Immutable like a manifold-3d Manifold: every transform returns a new mesh.
    class Mesh {
      constructor(readonly lo: number, readonly hi: number) {}
      boundingBox() { return { min: [0, 0, this.lo], max: [0, 0, this.hi] }; }
      translate(v: number[]) { calls.push(`t${v[2]}`); return new Mesh(this.lo + v[2], this.hi + v[2]); }
      scale(s: number) { calls.push(`s${s}`); return new Mesh(this.lo * s, this.hi * s); }
      rotate(v: number[]) { calls.push(`r${v[2]}`); return this; }
    }
    const mesh = new Mesh(-7, 33);
    const out = placeFigure(mesh, rig, { floor: 0, height: 80, face: '-X' }) as Mesh;
    expect(calls[0]).toBe('t7');               // dropped by the mesh bottom, not the rig sole
    expect(out.lo).toBeCloseTo(0, 9);
    expect(out.hi).toBeCloseTo(80, 9);
    expect(calls[calls.length - 1]).toBe('r-90');
    expect(() => placeFigure(mesh, rig, { face: 'up' })).toThrow();
    expect(() => placeFigure({}, rig)).toThrow();
  });
});

describe('figure surfacePoint', () => {
  it('finds the first exit of an SDF along a line through the point', () => {
    const s = api.sphere(5).translate([1, 2, 3]);
    const p = surfacePoint(s, [1, 2, 3], [0, -1, 0])!;
    expect(p[1]).toBeCloseTo(-3, 5);
    expect(p[0]).toBeCloseTo(1, 9);
    // From a point OUTSIDE (in front of) the surface it still lands on it.
    const q = surfacePoint(s, [1, -10, 3], [0, -1, 0], { reach: 20 })!;
    expect(q[1]).toBeCloseTo(-3, 5);
    expect(surfacePoint(s, [40, 40, 40], [0, 0, 1], { reach: 2 })).toBeNull();
  });
});

describe('figure brows — conformal seating (#1055)', () => {
  // A brow marking is `on.round(proud) ∩ arc`; it adds paintable surface only
  // where it pokes OUTSIDE the skin. Search for one such solid point.
  type Evaluable = { evaluate: (x: number, y: number, z: number) => number };
  const exposed = (brows: Evaluable & { bounds: () => { min: Vec3; max: Vec3 } }, skin: Evaluable): boolean => {
    const b = brows.bounds(), S = 0.25;
    for (let x = b.min[0]; x <= b.max[0]; x += S) for (let y = b.min[1]; y <= b.max[1]; y += S) for (let z = b.min[2]; z <= b.max[2]; z += S) {
      if (brows.evaluate(x, y, z) < 0 && skin.evaluate(x, y, z) > 0) return true;
    }
    return false;
  };
  const funko = { height: 100, proportions: 'funko', headScale: { x: 2.3, y: 1.8, z: 2.1 } } as const;
  const faceOf = (rig: ReturnType<typeof buildRig>, head: object) =>
    F.face.assemble(F.head(rig, head), rig, { eyes: false, mouth: false, brows: false, ears: false });

  it('seat on a cheek-bulged face (cheek 1.5)', () => {
    const rig = F.rig({ height: 100 });
    const face = faceOf(rig, { cheek: 1.5 });
    expect(exposed(F.face.brows(rig, { on: face }), face)).toBe(true);
  });

  it('seat on a headScaled Funko face', () => {
    const rig = F.rig(funko);
    const face = faceOf(rig, { faceShape: 'round', jaw: 1.6, cheek: 1.3 });
    expect(exposed(F.face.brows(rig, { shape: 'arched', thickness: 3, on: face }), face)).toBe(true);
  });

  it('follow a face translated after building', () => {
    const rig = F.rig(funko);
    const face = faceOf(rig, { faceShape: 'round', cheek: 1.1 }).translate([0, 0, -3.5]);
    const brows = F.face.brows(rig, { on: face });
    expect(exposed(brows, face)).toBe(true);
    // …and sit where the moved face's brow line is (≈ rig brow height − 3.5).
    const b = brows.bounds();
    expect(Math.abs((b.min[2] + b.max[2]) / 2 - (rig.face.browL[2] - 3.5))).toBeLessThan(rig.r.headZ * 0.15);
  });

  it('throw instead of silently painting nothing when `on` is the wrong node', () => {
    const rig = F.rig({ height: 100 });
    const elsewhere = api.sphere(5).translate([200, 0, 0]);
    expect(() => F.face.brows(rig, { on: elsewhere })).toThrow(/0 triangles/);
  });
});
