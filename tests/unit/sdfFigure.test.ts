// Unit tests for src/geometry/sdfFigure.ts — the deterministic rig math
// behind api.sdf.figure. Pure logic (no WASM): proportion scaling, pose
// forward-kinematics, left/right symmetry, the joint-overlap invariant that
// keeps a figure one component, and option validation. Meshing the parts is
// exercised headlessly via model:preview / the e2e tier.

import { describe, it, expect } from 'vitest';
import { __figureTestables__, createFigureNamespace } from '../../src/geometry/sdfFigure';
import { __testables__ as sdfT, partitionByLabel, type SdfNode } from '../../src/geometry/sdf';
import type { SdfApi } from '../../src/geometry/sdfFigure';

const { buildRig, buildTorso, buildLegs, buildNipples, breastMounds, torsoMasses, areolaColor, buildMouthPart, buildMouthAccents, buildEyes, buildEars, buildBrows, faceDetail, buildPants, buildTop, buildShoes, buildBoots, buildPanel, buildApron, buildBase, buildFeet, footDetail, standOn, groundRig, buildHands, handDetail, buildHair } = __figureTestables__;

/** Minimal engine-free SdfApi over the raw primitive factories — enough for
 *  the part builders (only `.build()` needs the engine binding). */
const api: SdfApi = {
  sphere: sdfT.primSphere,
  ellipsoid: sdfT.primEllipsoid,
  box: sdfT.primBox,
  roundedBox: sdfT.primRoundedBox,
  cylinder: sdfT.primCylinder,
  roundedCylinder: sdfT.primRoundedCylinder,
  capsule: sdfT.primCapsule,
  union: (...nodes) => nodes.reduce((a, b) => sdfT.opUnion(a, b)),
} as unknown as SdfApi;

const dist = (a: number[], b: number[]): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('figure rig — proportions', () => {
  it('places the crown at z = height and sole landmarks near 0', () => {
    const rig = buildRig({ height: 80 });
    expect(rig.joints.crown[2]).toBeCloseTo(80, 6);
    // ankles sit just above the ground; feet bring it to z≈0.
    expect(rig.joints.footL[2]).toBeLessThan(80 * 0.1);
    expect(rig.joints.footL[2]).toBeGreaterThan(0);
  });

  it('lower headsTall yields a proportionally larger head', () => {
    const chibi = buildRig({ height: 60, headsTall: 3 });
    const adult = buildRig({ height: 60, headsTall: 8 });
    expect(chibi.r.head).toBeGreaterThan(adult.r.head);
  });

  it('scales every landmark linearly with height', () => {
    const a = buildRig({ height: 60 });
    const b = buildRig({ height: 120 });
    expect(b.joints.upperArmL[0]).toBeCloseTo(a.joints.upperArmL[0] * 2, 5);
    expect(b.joints.upperLegL[2]).toBeCloseTo(a.joints.upperLegL[2] * 2, 5);
  });

  it('stocky build widens limbs vs slim', () => {
    const slim = buildRig({ build: 'slim' });
    const stocky = buildRig({ build: 'stocky' });
    expect(stocky.r.upperArm).toBeGreaterThan(slim.r.upperArm);
    expect(stocky.r.chestX).toBeGreaterThan(slim.r.chestX);
  });

  it('never inverts the hip above the shoulders, even for an extreme head', () => {
    for (const headsTall of [2, 3, 5, 8, 12]) {
      const rig = buildRig({ headsTall });
      expect(rig.joints.upperLegL[2]).toBeLessThan(rig.joints.upperArmL[2]);
      expect(rig.joints.lowerLegL[2]).toBeLessThan(rig.joints.upperLegL[2]);
    }
  });
});

describe('figure torso — nipple + navel surface landmarks', () => {
  it('places nipples symmetrically on the chest front, below its centre', () => {
    const rig = buildRig({ height: 60, sex: 'male' });
    const { nippleL, nippleR, navel } = rig.torso;
    const chest = rig.joints.chest;
    // Figure left = +X, right = −X — mirror-symmetric across the sagittal plane.
    expect(nippleL[0]).toBeGreaterThan(0);
    expect(nippleR[0]).toBeCloseTo(-nippleL[0], 6);
    expect(nippleL[1]).toBeCloseTo(nippleR[1], 6);
    expect(nippleL[2]).toBeCloseTo(nippleR[2], 6);
    // On the FRONT (−Y) surface, in front of the chest mass centre.
    expect(nippleL[1]).toBeLessThan(chest[1]);
    // On the UPPER chest — ≈0.62 head below the shoulder line (the figure-drawing
    // canon nipple line), a touch below the chest mass centre but well above the
    // navel. Regression guard for the "nipples in the middle of the body" defect:
    // the old chest-ellipsoid-relative drop scaled with the (capped) chest semi-Z
    // and sank the line toward the lower ribcage on tall/stocky rigs.
    const headH = 60 / rig.opts.headsTall;
    const shoulderZ = rig.joints.upperArmL[2];
    expect(nippleL[2]).toBeCloseTo(shoulderZ - headH * 0.62, 5);
    expect(nippleL[2]).toBeLessThan(chest[2]);
    // Comfortably in the UPPER chest: above the chest↔navel midpoint, not sunk low.
    expect(nippleL[2]).toBeGreaterThan((chest[2] + navel[2]) / 2);
    expect(nippleL[2]).toBeGreaterThan(navel[2]);
  });

  it('keeps the nipple line on the upper chest across headsTall (no low-ribcage drop)', () => {
    // The bug was headsTall-dependent: the chest semi-Z is capped LARGER on tall
    // (and stocky) rigs, so the old `chestZ − cz·0.16` drop grew with it and sank
    // the nipples to the mid-torso. The corrected head-unit anchor stays a fixed
    // ≈0.62 head below the shoulder at every headsTall.
    for (const headsTall of [4, 6, 7.5, 8.5]) {
      const rig = buildRig({ height: 60, headsTall, sex: 'female', bust: 0.5 });
      const shoulderZ = rig.joints.upperArmL[2];
      const navelZ = rig.torso.navel[2];
      // Nipple sits below the shoulder but in the UPPER portion of the
      // navel→shoulder span — never sunk down toward the midriff.
      expect(rig.torso.nippleL[2]).toBeLessThan(shoulderZ);
      expect(rig.torso.nippleL[2]).toBeGreaterThan(navelZ + (shoulderZ - navelZ) * 0.35);
    }
  });

  it('places the navel centred on the belly front, between hips and chest', () => {
    const rig = buildRig({ height: 60 });
    const { navel } = rig.torso;
    expect(navel[0]).toBeCloseTo(0, 6);
    expect(navel[1]).toBeLessThan(0);                 // front of the body
    expect(navel[2]).toBeGreaterThan(rig.joints.hips[2]);
    expect(navel[2]).toBeLessThan(rig.joints.chest[2]);
  });

  it('tracks proportions: a fuller/heavier torso pushes the landmarks out', () => {
    const lean = buildRig({ height: 60, sex: 'neutral', weight: 0.2 });
    const heavy = buildRig({ height: 60, sex: 'male', weight: 0.9 });
    // A heavier chest depth bulges the nipples further forward (more −Y).
    expect(heavy.torso.nippleL[1]).toBeLessThan(lean.torso.nippleL[1]);
    // A heavier belly bulges the navel further forward too.
    expect(heavy.torso.navel[1]).toBeLessThan(lean.torso.navel[1]);
    // A female bust widens the inter-nipple span vs neutral.
    const female = buildRig({ height: 60, sex: 'female' });
    const neutral = buildRig({ height: 60, sex: 'neutral' });
    expect(female.torso.nippleL[0]).toBeGreaterThan(neutral.torso.nippleL[0]);
  });

  it('scales the landmarks linearly with height', () => {
    const a = buildRig({ height: 60 });
    const b = buildRig({ height: 120 });
    expect(b.torso.nippleL[0]).toBeCloseTo(a.torso.nippleL[0] * 2, 5);
    expect(b.torso.navel[2]).toBeCloseTo(a.torso.navel[2] * 2, 5);
  });

  it('builds a torso (navel opt-in) and rejects unknown options', () => {
    const rig = buildRig({ height: 60 });
    expect(() => buildTorso(api, rig)).not.toThrow();                       // default: no navel
    expect(() => buildTorso(api, rig, { navel: true })).not.toThrow();
    expect(() => buildTorso(api, rig, { navel: { depth: 1.2 } })).not.toThrow();
    // Unknown keys throw (the figure naming policy) — `nipples` is its own builder now.
    expect(() => buildTorso(api, rig, { nipples: true } as object)).toThrow();
    expect(() => buildTorso(api, rig, { navel: { radius: 1 } } as object)).toThrow();
  });
});

describe('figure — bust mounds + areola', () => {
  it('bust defaults to 0 (flat) and is pre-filled for sex:female, overridable', () => {
    expect(buildRig({}).opts.bust).toBe(0);
    expect(buildRig({ sex: 'male' }).opts.bust).toBe(0);
    expect(buildRig({ sex: 'female' }).opts.bust).toBeCloseTo(0.35, 6);
    // Explicit bust overrides the sex default — works on ANY figure.
    expect(buildRig({ sex: 'female', bust: 0 }).opts.bust).toBe(0);
    expect(buildRig({ sex: 'male', bust: 0.8 }).opts.bust).toBeCloseTo(0.8, 6);
    expect(buildRig({ bust: 1.2 }).opts.bust).toBeCloseTo(1.2, 6);
    expect(() => buildRig({ bust: 3 })).toThrow();   // out of range
  });

  it('breastMounds: null when flat, present and apex-forward when bust > 0', () => {
    const flat = buildRig({ height: 60, bust: 0 });
    expect(breastMounds(flat.joints, flat.r, flat.opts.bust)).toBeNull();
    const busty = buildRig({ height: 60, bust: 0.7 });
    const m = breastMounds(busty.joints, busty.r, busty.opts.bust)!;
    expect(m).not.toBeNull();
    // Apexes mirror across the sagittal plane and sit in FRONT of the chest centre.
    expect(m.apexL[0]).toBeGreaterThan(0);
    expect(m.apexR[0]).toBeCloseTo(-m.apexL[0], 6);
    expect(m.apexL[1]).toBeLessThan(busty.joints.chest[1]);
    // The nipple anchors ride the mound apex when there's a bust.
    expect(busty.torso.nippleL).toEqual(m.apexL);
  });

  it('a larger bust projects the nipples further forward', () => {
    const small = buildRig({ height: 60, bust: 0.3 });
    const full = buildRig({ height: 60, bust: 1.1 });
    expect(full.torso.nippleL[1]).toBeLessThan(small.torso.nippleL[1]);
  });

  it('buildNipples returns a single areola-labelled region', () => {
    const rig = buildRig({ height: 60, bust: 0.5 });
    const node = buildNipples(api, rig) as unknown as SdfNode;
    expect(node.labelName).toBe('areola');
    expect(() => buildNipples(api, rig, { size: 0.4, nipple: 0.1 })).not.toThrow();
    expect(() => buildNipples(api, rig, { areola: 1 } as object)).toThrow();   // unknown key
  });

  it('areola coin is a SHALLOW flush disc, not a deep backward plug (#706)', () => {
    // A bare (no-bust) chest used the gently-curved-chest curvature radius
    // (1.4·chestX). The old clip cylinder spanned the whole sphere depth, so the
    // areola intersected into a plug ~1.1·surfR (≈1.5·chestX) BEHIND the front
    // anchor — which on a narrow/shallow torso punched a rod out the BACK. The
    // coin must instead seat only a shallow depth into the body (+Y = into the
    // chest), so its back extent stays near the front surface.
    const rig = buildRig({ height: 60, headsTall: 7, sex: 'male', weight: 0.4, muscle: 0.2 });
    const node = buildNipples(api, rig) as unknown as SdfNode;
    const b = node.bounds();
    const anchorY = rig.torso.nippleL[1];                  // front-of-chest landmark
    const chestX = rig.r.chestX;
    // Back face sits a fraction of the chest half-width behind the anchor — NOT
    // the old ~1.5·chestX plug that exits a lean back.
    expect(b.max[1] - anchorY).toBeLessThan(chestX * 0.4);
    // Still pokes proud of the surface at the front (−Y), so it reads as a disc.
    expect(b.min[1]).toBeLessThan(anchorY);
  });

  it('areolaColor darkens a skin hex or named tone, and is overridable in strength', () => {
    const darker = areolaColor('#cf9163');
    expect(darker).toMatch(/^#[0-9a-f]{6}$/);
    // Every channel is darker than the source.
    expect(parseInt(darker.slice(1, 3), 16)).toBeLessThan(0xcf);
    expect(parseInt(darker.slice(3, 5), 16)).toBeLessThan(0x91);
    expect(parseInt(darker.slice(5, 7), 16)).toBeLessThan(0x63);
    // Accepts a curated skin name.
    expect(areolaColor('sand')).toMatch(/^#[0-9a-f]{6}$/);
    // A smaller factor is darker than a larger one.
    expect(parseInt(areolaColor('#cf9163', 0.5).slice(1, 3), 16))
      .toBeLessThan(parseInt(areolaColor('#cf9163', 0.9).slice(1, 3), 16));
    expect(() => areolaColor('not-a-color')).toThrow();
  });
});

describe('figure rig — belly (abdominal / pregnancy) swell', () => {
  it('belly defaults to 0 and is range-checked', () => {
    expect(buildRig({}).opts.belly).toBe(0);
    expect(buildRig({ sex: 'female' }).opts.belly).toBe(0);   // not pre-filled by sex
    expect(buildRig({ belly: 0.7 }).opts.belly).toBeCloseTo(0.7, 6);
    expect(buildRig({ belly: 2 }).opts.belly).toBe(2);
    expect(() => buildRig({ belly: -0.1 })).toThrow();         // out of range
    expect(() => buildRig({ belly: 3 })).toThrow();            // out of range
  });

  it('torsoMasses: belly grows the abdomen FORWARD without dropping its bottom', () => {
    const rig = buildRig({ height: 60 });
    const flat = torsoMasses(rig.joints, rig.r, 0);
    const round = torsoMasses(rig.joints, rig.r, 1);
    // Forward projection (the −Y depth semi-axis) grows strongly.
    expect(round.belly.b).toBeGreaterThan(flat.belly.b * 1.5);
    // Centre is pushed forward (more −Y) so the swell sits proud of the body.
    expect(round.belly.c[1]).toBeLessThan(flat.belly.c[1]);
    // The swell's BOTTOM never descends below the flat baseline — it can't drop
    // toward the crotch (the pendant-between-the-legs failure mode).
    const flatBottom = flat.belly.c[2] - flat.belly.cz;
    const roundBottom = round.belly.c[2] - round.belly.cz;
    // Raising the centre in lock-step with the growth keeps the bottom from
    // descending — it actually rises a touch, so the swell can never reach down
    // toward the crotch as the belly grows.
    expect(roundBottom).toBeGreaterThan(flatBottom);
  });

  it('belly === 0 leaves the abdomen ellipsoid byte-identical', () => {
    const rig = buildRig({ height: 60, sex: 'female', bust: 0.4 });
    const a = torsoMasses(rig.joints, rig.r, 0);
    const b = torsoMasses(rig.joints, rig.r);   // default arg
    expect(a.belly).toEqual(b.belly);
  });

  it('the navel landmark rides the swell forward as belly grows', () => {
    const flat = buildRig({ height: 60, belly: 0 });
    const round = buildRig({ height: 60, belly: 1 });
    expect(round.torso.navel[1]).toBeLessThan(flat.torso.navel[1]);   // more −Y = further forward
  });

  it('buildTorso with a belly stays one solid mass and bulges forward', () => {
    const flat = buildTorso(api, buildRig({ height: 60 })) as unknown as SdfNode;
    const round = buildTorso(api, buildRig({ height: 60, belly: 1 })) as unknown as SdfNode;
    // The pregnant torso reaches further forward (−Y) than the flat one.
    expect(round.bounds().min[1]).toBeLessThan(flat.bounds().min[1]);
  });
});

describe('figure rig — head-unit proportions & sex (Loomis canon)', () => {
  it('keeps shoulder width a CONSTANT multiple of head size across headsTall', () => {
    // The old fixed-fraction-of-height widths let this ratio drift with
    // headsTall (pin-narrow chibi shoulders, broad-shouldered tall figures);
    // head-unit widths hold it steady, so every headsTall stays coherent.
    const ratio = (n: number) => {
      const rig = buildRig({ height: 60, headsTall: n });
      return Math.abs(rig.joints.upperArmL[0]) / rig.r.head;
    };
    expect(ratio(3)).toBeCloseTo(ratio(8), 5);
    expect(ratio(6)).toBeCloseTo(ratio(8), 5);
  });
  it('still scales every width linearly with height', () => {
    const a = buildRig({ height: 60 });
    const b = buildRig({ height: 120 });
    expect(b.r.chestX).toBeCloseTo(a.r.chestX * 2, 5);
    expect(Math.abs(b.joints.upperArmL[0])).toBeCloseTo(Math.abs(a.joints.upperArmL[0]) * 2, 5);
  });
  it("defaults to 'neutral' and preserves the previous headsTall:6 silhouette", () => {
    // Calibration anchor: at the default headsTall, neutral widths equal the
    // historical fractions-of-height, so existing figures/catalog are unchanged.
    const rig = buildRig({ height: 60, headsTall: 6 });
    expect(Math.abs(rig.joints.upperArmL[0])).toBeCloseTo(60 * 0.108, 4);
    expect(rig.r.chestX).toBeCloseTo(60 * 0.105, 4);
    expect(rig.r.upperLeg).toBeCloseTo(60 * 0.048, 4);
  });
  it('sex shifts the shoulder/hip balance and waist-to-hip ratio', () => {
    const male = buildRig({ sex: 'male' });
    const female = buildRig({ sex: 'female' });
    const neutral = buildRig({});
    // male: wider shoulders; female: narrower shoulders.
    expect(Math.abs(male.joints.upperArmL[0])).toBeGreaterThan(Math.abs(neutral.joints.upperArmL[0]));
    expect(Math.abs(female.joints.upperArmL[0])).toBeLessThan(Math.abs(neutral.joints.upperArmL[0]));
    // female: wider hips than male.
    expect(female.r.hipsX).toBeGreaterThan(male.r.hipsX);
    // female: smaller waist-to-hip ratio (the hourglass signal).
    expect(female.r.waist / female.r.hipsX).toBeLessThan(male.r.waist / male.r.hipsX);
    // female bust: chest girth above neutral.
    expect(female.r.chestX).toBeGreaterThan(neutral.r.chestX);
  });
});

describe('figure rig — age & weight axes (MakeHuman CC0 mined)', () => {
  it('defaults (age 25, weight 0.5) leave the calibration anchor untouched', () => {
    const def = buildRig({ height: 60, headsTall: 6 });
    const explicit = buildRig({ height: 60, headsTall: 6, sex: 'neutral', age: 25, weight: 0.5 });
    expect(explicit.r.chestX).toBeCloseTo(def.r.chestX, 9);
    expect(explicit.r.waist).toBeCloseTo(def.r.waist, 9);
    expect(explicit.r.hipsX).toBeCloseTo(def.r.hipsX, 9);
    expect(explicit.r.hipsY).toBeCloseTo(def.r.hipsY, 9);
    // and equal to the historical fractions-of-height calibration values
    expect(def.r.chestX).toBeCloseTo(60 * 0.105, 4);
  });

  it('weight widens the waist and hips and adds torso depth, monotonically', () => {
    const lean = buildRig({ weight: 0 });
    const avg = buildRig({ weight: 0.5 });
    const heavy = buildRig({ weight: 1 });
    expect(heavy.r.waist).toBeGreaterThan(avg.r.waist);
    expect(avg.r.waist).toBeGreaterThan(lean.r.waist);
    expect(heavy.r.hipsX).toBeGreaterThan(lean.r.hipsX);
    // weight adds 3D bulk, not just width — torso DEPTH grows too.
    expect(heavy.r.hipsY).toBeGreaterThan(avg.r.hipsY);
    expect(avg.r.hipsY).toBeCloseTo(buildRig({}).r.hipsY, 9); // average = baseline depth
  });

  it('age shifts torso girth (baby narrower waist/hip than young) without touching headsTall', () => {
    const baby = buildRig({ age: 1 });
    const young = buildRig({ age: 25 });
    expect(baby.r.waist).toBeLessThan(young.r.waist);
    expect(baby.r.hipsX).toBeLessThan(young.r.hipsX);
    // age is a girth axis only — the head-to-body ratio (headsTall) is unchanged.
    expect(baby.r.head).toBeCloseTo(young.r.head, 9);
  });

  it('age & weight compose with sex multiplicatively', () => {
    const base = buildRig({ sex: 'female' });
    const heavy = buildRig({ sex: 'female', weight: 1 });
    expect(heavy.r.waist).toBeGreaterThan(base.r.waist);
  });

  it('validates age (1..90) and weight (0..1) ranges', () => {
    expect(() => buildRig({ age: 0 })).toThrow(/age/);
    expect(() => buildRig({ age: 200 })).toThrow(/age/);
    expect(() => buildRig({ weight: -0.1 })).toThrow(/weight/);
    expect(() => buildRig({ weight: 1.5 })).toThrow(/weight/);
    expect(() => buildRig({ girth: 2 } as never)).toThrow();
  });

  it('records age & weight on rig.opts', () => {
    const rig = buildRig({ age: 40, weight: 0.7 });
    expect(rig.opts.age).toBe(40);
    expect(rig.opts.weight).toBe(0.7);
  });
});

describe('figure rig — muscle axis', () => {
  const { buildTorso, buildArms, buildLegs } = __figureTestables__;
  const ext = (b: { min: number[]; max: number[] }, i: number): number => b.max[i] - b.min[i];

  it('defaults to muscle 0 and records it on rig.opts', () => {
    expect(buildRig({}).opts.muscle).toBe(0);
    expect(buildRig({ muscle: 0.6 }).opts.muscle).toBe(0.6);
  });

  it('validates the muscle range (0..1)', () => {
    expect(() => buildRig({ muscle: -0.1 })).toThrow(/muscle/);
    expect(() => buildRig({ muscle: 1.5 })).toThrow(/muscle/);
  });

  it('muscle raises the minimum torso DEPTH so a lean+muscled torso never goes paper-thin', () => {
    // A maximally lean/slim/narrow torso: at muscle 0 the depth is its natural
    // (un-floored) value; muscle lifts the floor so the muscled core is deeper.
    const opts = { height: 60, headsTall: 7.5, sex: 'female' as const, build: 'slim' as const, weight: 0 };
    const lean = buildRig({ ...opts, muscle: 0 });
    const buff = buildRig({ ...opts, muscle: 1 });
    expect(buff.r.chestY).toBeGreaterThan(lean.r.chestY);
    expect(buff.r.hipsY).toBeGreaterThan(lean.r.hipsY);
    // The floor scales with the head (headH = height/headsTall = 8 here).
    const headH = 60 / 7.5;
    expect(buff.r.chestY).toBeCloseTo(headH * (0.26 + 0.14), 6); // floored
    expect(buff.r.hipsY).toBeCloseTo(headH * (0.24 + 0.14), 6);
  });

  it('the depth floor does NOT trigger for normal builds (muscle 0 unchanged)', () => {
    // A neutral and even a slim muscle-0 figure sits above the floor, so the
    // floor is a no-op there — pinning the byte-identical guarantee.
    const slim0 = buildRig({ build: 'slim', muscle: 0 });
    const headH = slim0.opts.height / slim0.opts.headsTall;
    expect(slim0.r.chestY).toBeGreaterThan(headH * 0.26);
    expect(slim0.r.hipsY).toBeGreaterThan(headH * 0.24);
  });

  it('exposes the knee-hinge direction (the leg analog of elbowHinge)', () => {
    const rig = buildRig({ pose: { legL: { bend: 60 } } });
    expect(rig.dir.kneeHingeL).toBeDefined();
    expect(rig.dir.kneeHingeR).toBeDefined();
    // unit-length
    const h = rig.dir.kneeHingeL;
    expect(Math.hypot(h[0], h[1], h[2])).toBeCloseTo(1, 6);
  });

  it('muscle 0 leaves the torso/arms/legs geometry byte-identical to a bare rig', () => {
    const plain = buildRig({ height: 60, headsTall: 7 });
    const m0 = buildRig({ height: 60, headsTall: 7, muscle: 0 });
    for (const build of [buildTorso, buildArms, buildLegs]) {
      const a = build(api, plain).bounds();
      const b = build(api, m0).bounds();
      for (let i = 0; i < 3; i++) {
        expect(b.min[i]).toBeCloseTo(a.min[i], 9);
        expect(b.max[i]).toBeCloseTo(a.max[i], 9);
      }
    }
  });

  it('muscle adds anterior chest depth and widens the torso (pecs/abs/lats)', () => {
    const lean = buildTorso(api, buildRig({ height: 60, headsTall: 7, muscle: 0 })).bounds();
    const buff = buildTorso(api, buildRig({ height: 60, headsTall: 7, muscle: 1 })).bounds();
    // pecs/abs bulge forward (−Y) → the front extent grows more negative.
    expect(buff.min[1]).toBeLessThan(lean.min[1]);
    // lats flare the sides → wider in X.
    expect(ext(buff, 0)).toBeGreaterThan(ext(lean, 0));
  });

  it('muscle thickens the arms and legs, monotonically', () => {
    // Bounding-box volume grows with muscle (bellies add girth everywhere the
    // bare capsule chain didn't reach), independent of which axis dominates.
    const vol = (b: { min: number[]; max: number[] }): number => ext(b, 0) * ext(b, 1) * ext(b, 2);
    const armVol = (m: number): number => vol(buildArms(api, buildRig({ muscle: m })).bounds());
    expect(armVol(0.5)).toBeGreaterThan(armVol(0));
    expect(armVol(1)).toBeGreaterThan(armVol(0));
    const legVol = (m: number): number => vol(buildLegs(api, buildRig({ muscle: m })).bounds());
    expect(legVol(0.5)).toBeGreaterThan(legVol(0));
    expect(legVol(1)).toBeGreaterThan(legVol(0));
  });
});

describe('figure rig — canonical pose & joint vocabulary', () => {
  it('drives arm & leg DOFs with raiseSide/raiseFwd/bend/twist', () => {
    const a = buildRig({ pose: { armL: { raiseSide: 90, raiseFwd: 20, bend: 100, twist: 30 } } });
    expect(a.joints.wristL).toBeDefined();
    const c = buildRig({ pose: { legL: { raiseSide: 15, raiseFwd: 30, bend: 60, twist: 10 } } });
    expect(c.joints.footL).toBeDefined();
  });
  it('drives the head with yaw/pitch/roll', () => {
    const a = buildRig({ pose: { head: { yaw: 20, pitch: 10, roll: 5 } } });
    expect(a.dir.headForward).toBeDefined();
  });
  it('rejects the retired legacy DOF names (abduct/flex/elbow/knee/turn/nod/tilt)', () => {
    expect(() => buildRig({ pose: { armL: { abduct: 90 } as never } })).toThrow();
    expect(() => buildRig({ pose: { armL: { flex: 20 } as never } })).toThrow();
    expect(() => buildRig({ pose: { armL: { elbow: 100 } as never } })).toThrow();
    expect(() => buildRig({ pose: { legL: { knee: 60 } as never } })).toThrow();
    expect(() => buildRig({ pose: { head: { turn: 20 } as never } })).toThrow();
    expect(() => buildRig({ pose: { head: { nod: 10 } as never } })).toThrow();
    expect(() => buildRig({ pose: { head: { tilt: 5 } as never } })).toThrow();
  });
  it('exposes VRM/Unity humanoid joint names (hips, upperArm*, lowerArm*, upperLeg*, lowerLeg*, foot*)', () => {
    const rig = buildRig({});
    for (const k of ['hips', 'spine', 'chest', 'neck', 'head',
      'upperArmL', 'upperArmR', 'lowerArmL', 'lowerArmR', 'wristL', 'handL',
      'upperLegL', 'upperLegR', 'lowerLegL', 'lowerLegR', 'footL', 'footR']) {
      expect(rig.joints[k], k).toBeDefined();
    }
    // The retired names are gone, not silently aliased.
    expect(rig.joints.pelvis).toBeUndefined();
    expect(rig.joints.shoulderL).toBeUndefined();
    expect(rig.joints.ankleL).toBeUndefined();
  });
});

describe('figure rig — symmetry', () => {
  it('mirrors L/R joints across X for a symmetric pose', () => {
    const rig = buildRig({});
    for (const name of ['upperArm', 'lowerArm', 'wrist', 'upperLeg', 'lowerLeg', 'foot']) {
      const L = rig.joints[`${name}L`];
      const R = rig.joints[`${name}R`];
      expect(L[0]).toBeCloseTo(-R[0], 5);  // opposite X
      expect(L[1]).toBeCloseTo(R[1], 5);   // same Y
      expect(L[2]).toBeCloseTo(R[2], 5);   // same Z
    }
  });

  it('puts the figure-left eye on +X and the right eye on −X (facing −Y)', () => {
    const rig = buildRig({});
    expect(rig.face.eyeL[0]).toBeGreaterThan(0);
    expect(rig.face.eyeR[0]).toBeLessThan(0);
    expect(rig.face.eyeL[0]).toBeCloseTo(-rig.face.eyeR[0], 5);
  });

  it('places the nose in front (−Y) of the head center', () => {
    const rig = buildRig({});
    expect(rig.face.nose[1]).toBeLessThan(rig.joints.head[1]);
  });
});

describe('figure rig — pose forward kinematics', () => {
  it('abduct 90 swings the upper arm straight out to the side', () => {
    const rig = buildRig({ height: 60, pose: { armL: { raiseSide: 90 } } });
    const S = rig.joints.upperArmL, E = rig.joints.lowerArmL;
    // elbow moves out in +X at (near) the shoulder height.
    expect(E[0]).toBeGreaterThan(S[0]);
    expect(E[2]).toBeCloseTo(S[2], 4);
  });

  it('abduct 0 hangs the upper arm straight down', () => {
    const rig = buildRig({ pose: { armL: { raiseSide: 0 } } });
    const S = rig.joints.upperArmL, E = rig.joints.lowerArmL;
    expect(E[2]).toBeLessThan(S[2]);
    expect(E[0]).toBeCloseTo(S[0], 4);
  });

  it('elbow flexion moves the wrist (curls the forearm)', () => {
    const straight = buildRig({ pose: { armL: { raiseSide: 90, bend: 0 } } });
    const curled = buildRig({ pose: { armL: { raiseSide: 90, bend: 120 } } });
    expect(dist(straight.joints.wristL, curled.joints.wristL)).toBeGreaterThan(1);
  });

  it('elbow flexion curls a hanging forearm FORWARD (−Y), like a real elbow', () => {
    // Regression: the hinge sign once curled the forearm BACKWARD (+Y) — the
    // same sign-bug family as the knee. A hanging arm with a bent elbow must
    // bring the wrist forward of the body and raise it, on both sides.
    for (const side of ['L', 'R'] as const) {
      const straight = buildRig({ pose: { [`arm${side}`]: { raiseSide: 0, bend: 0 } } });
      const bent = buildRig({ pose: { [`arm${side}`]: { raiseSide: 0, bend: 70 } } });
      expect(bent.joints[`wrist${side}`][1]).toBeLessThan(straight.joints[`wrist${side}`][1] - 1);
      expect(bent.joints[`wrist${side}`][2]).toBeGreaterThan(straight.joints[`wrist${side}`][2] + 1);
    }
  });

  it('sitting pose (flex 90, knee 90) bends BOTH shanks down, symmetrically', () => {
    // Regression ×2: flex 90 makes the thigh (nearly) parallel to body-front.
    // The old cross(dir, fwd) knee hinge degenerated there — exactly parallel
    // bent the left knee UP ([side,0,0] fallback), and any nonzero abduct
    // swung the shins SIDEWAYS frog-style (the tiny abduct component
    // dominated the cross product). The frame-derived hinge must drop the
    // shins straight down in a chair sit, with or without stance width.
    for (const raiseSide of [0, 8]) {
      const rig = buildRig({ pose: { legs: { raiseSide, raiseFwd: 90, bend: 90 } } });
      for (const side of ['L', 'R'] as const) {
        const K = rig.joints[`lowerLeg${side}`], A = rig.joints[`foot${side}`];
        expect(A[2]).toBeLessThan(K[2] - 1);     // shin drops below the knee
        // and stays under it, not swung out sideways (frog-sit regression).
        expect(Math.abs(A[0] - K[0])).toBeLessThan(2);
      }
      expect(rig.joints.footL[0]).toBeCloseTo(-rig.joints.footR[0], 5);
      expect(rig.joints.footL[2]).toBeCloseTo(rig.joints.footR[2], 5);
    }
  });

  it('knee flexion bends the shank BACKWARD (+Y), like a real knee', () => {
    // Regression: the hinge sign once swung the shank FORWARD, giving a
    // lunge a horizontal shin floating in front of the figure.
    const straight = buildRig({ pose: { legL: { raiseSide: 0, raiseFwd: 0, bend: 0 } } });
    const bent = buildRig({ pose: { legL: { raiseSide: 0, raiseFwd: 0, bend: 60 } } });
    expect(bent.joints.footL[1]).toBeGreaterThan(straight.joints.footL[1] + 1);
    // and the ankle rises (the shank shortens vertically when bent).
    expect(bent.joints.footL[2]).toBeGreaterThan(straight.joints.footL[2] + 1);
  });

  it('lunge: flex forward + matching knee bend puts the ankle under the knee', () => {
    const rig = buildRig({ pose: { legL: { raiseSide: 0, raiseFwd: 45, bend: 45 } } });
    const K = rig.joints.lowerLegL, A = rig.joints.footL;
    // shank vertical: ankle directly below the knee.
    expect(A[1]).toBeCloseTo(K[1], 4);
    expect(A[2]).toBeLessThan(K[2]);
  });

  it('head yaw rotates the face anchors off the centreline', () => {
    const fwd = buildRig({ pose: { head: { yaw: 0 } } });
    const turned = buildRig({ pose: { head: { yaw: 40 } } });
    expect(dist(fwd.face.nose, turned.face.nose)).toBeGreaterThan(0.5);
  });

  it('elbow hinge stays a stable lateral plane across flex 90 (no pole flip)', () => {
    // Regression: the old cross(dir, fwd) elbow hinge collapsed in magnitude
    // and SWUNG THROUGH the pole as a forward-reaching arm crossed horizontal
    // (flex → 90) with small abduct — its X-component flipped sign 85→95, so a
    // bent forward-punch curled in a pose-dependent wrong plane. The frame-
    // derived hinge keeps a near-constant lateral axis: a forward-reaching bent
    // arm curls the wrist UP (above the elbow) continuously, on both sides.
    for (const side of ['L', 'R'] as const) {
      let prevHingeX: number | undefined;
      for (const raiseFwd of [85, 90, 95]) {
        const rig = buildRig({ pose: { [`arm${side}`]: { raiseSide: 10, raiseFwd, bend: 90 } } });
        const h = rig.dir[`elbowHinge${side}`];
        const W = rig.joints[`wrist${side}`], E = rig.joints[`lowerArm${side}`];
        expect(W[2]).toBeGreaterThan(E[2] + 1);        // forearm curls UP, not sideways
        if (prevHingeX !== undefined) {
          expect(Math.sign(h[0])).toBe(Math.sign(prevHingeX)); // no sign flip across 90
          expect(Math.abs(h[0] - prevHingeX)).toBeLessThan(0.1); // and barely moves
        }
        prevHingeX = h[0];
      }
    }
  });

  it('leg twist turns the foot out (and is no longer a silent no-op)', () => {
    // Regression: leg twist was parsed + validated but never read by the leg
    // chain. It now yaws the foot heading OUTWARD (toe toward +X on the left,
    // −X on the right) and rolls a bent-knee turnout, symmetrically.
    const neutral = buildRig({ pose: { legL: { raiseSide: 6 } } });
    expect(neutral.dir.footL[0]).toBeCloseTo(0, 4);     // toe straight ahead at rest
    const turned = buildRig({ pose: { legs: { raiseSide: 6, twist: 30 } } });
    expect(turned.dir.footL[0]).toBeGreaterThan(0.3);   // left toe yaws to +X (out)
    expect(turned.dir.footR[0]).toBeLessThan(-0.3);     // right toe yaws to −X (out)
    expect(turned.dir.footL[0]).toBeCloseTo(-turned.dir.footR[0], 5); // symmetric
    // A bent knee with turnout moves the shank/ankle vs no twist.
    const bent0 = buildRig({ pose: { legL: { raiseFwd: 20, bend: 60, twist: 0 } } });
    const bentT = buildRig({ pose: { legL: { raiseFwd: 20, bend: 60, twist: 40 } } });
    expect(dist(bent0.joints.footL, bentT.joints.footL)).toBeGreaterThan(1);
  });

  it('twist rolls the forearm-curl plane so a raised arm can curl the fist up', () => {
    // With the arm out to the side, elbow alone curls forward; twist lifts the
    // fist UP (the double-biceps / ballet-fifth pose that needs the roll DOF).
    const noTwist = buildRig({ pose: { armL: { raiseSide: 90, bend: 95, twist: 0 } } });
    const rolled = buildRig({ pose: { armL: { raiseSide: 90, bend: 95, twist: 90 } } });
    // twist must move the wrist, and lift it above the no-twist wrist.
    expect(dist(noTwist.joints.wristL, rolled.joints.wristL)).toBeGreaterThan(2);
    expect(rolled.joints.wristL[2]).toBeGreaterThan(noTwist.joints.wristL[2]);
  });
});

describe('figure rig — documented pose recipes (public/ai/figure.md)', () => {
  // The recipes figure.md hands to modeling agents, asserted verbatim as rig
  // math. An FK change that breaks a documented recipe must fail HERE, in
  // vitest, not in a sculpt agent's render loop. If one of these fails after
  // an intentional FK change, update figure.md's recipe in the same commit.
  // (Chair-sit `legs: {raiseFwd: 90, bend: 90}` is pinned by the sitting-pose
  // test above; this block covers the remaining documented recipes.)

  it('double-biceps `arms: {raiseSide: 95, bend: 95, twist: 90}` puts both fists up by the head', () => {
    const rig = buildRig({ height: 60, pose: { arms: { raiseSide: 95, bend: 95, twist: 90 } } });
    for (const side of ['L', 'R'] as const) {
      const S = rig.joints[`upperArm${side}`], W = rig.joints[`wrist${side}`], H = rig.joints[`hand${side}`];
      // fist raised well above the shoulder, up beside the head…
      expect(W[2]).toBeGreaterThan(S[2] + rig.r.head);
      expect(H[2]).toBeGreaterThan(rig.joints.head[2]);
      // …and OUT to the side (a flex pose, not hands clasped at the chest).
      expect(Math.abs(W[0])).toBeGreaterThan(Math.abs(S[0]) * 1.5);
    }
    expect(rig.joints.handL[0]).toBeCloseTo(-rig.joints.handR[0], 5);
    expect(rig.joints.handL[2]).toBeCloseTo(rig.joints.handR[2], 5);
  });

  it('ballet fifth `arms: {raiseSide: 150, bend: 70, twist: 90}` rounds an "O" overhead', () => {
    const rig = buildRig({ height: 60, pose: { arms: { raiseSide: 150, bend: 70, twist: 90 } } });
    for (const side of ['L', 'R'] as const) {
      const E = rig.joints[`lowerArm${side}`], H = rig.joints[`hand${side}`];
      // hands above the crown…
      expect(H[2]).toBeGreaterThan(rig.joints.crown[2]);
      // …curling inward toward the midline (the rounded "O") without crossing it.
      expect(Math.abs(H[0])).toBeLessThan(Math.abs(E[0]) * 0.6);
      expect(H[0] * E[0]).toBeGreaterThan(0); // same side of the midline
    }
    // the hands approach each other to close the "O" (gap under ~a head width).
    expect(dist(rig.joints.handL, rig.joints.handR)).toBeLessThan(rig.r.head * 2.2);
  });

  it('matched flex+knee keeps the shin vertical at any lunge depth', () => {
    // The generalized lunge rule behind figure.md's flex/knee guidance: a
    // forward step with knee bend equal to hip flex lands the ankle directly
    // under the knee. This is the configuration the old cross-product hinge
    // distorted as flex grew — sweep it well past the 45° case.
    for (const a of [20, 45, 70, 85]) {
      const rig = buildRig({ pose: { legL: { raiseSide: 0, raiseFwd: a, bend: a } } });
      const K = rig.joints.lowerLegL, A = rig.joints.footL;
      expect(A[0]).toBeCloseTo(K[0], 4);
      expect(A[1]).toBeCloseTo(K[1], 4);
      expect(A[2]).toBeLessThan(K[2]);
    }
  });
});

describe('figure rig — symmetric pose shorthand', () => {
  it('`arms` / `legs` seed both sides symmetrically', () => {
    const rig = buildRig({ pose: { arms: { raiseSide: 90 }, legs: { raiseSide: 25 } } });
    // both elbows swing out (abduct 90); symmetric in X.
    expect(rig.joints.lowerArmL[0]).toBeGreaterThan(rig.joints.upperArmL[0]);
    expect(rig.joints.lowerArmR[0]).toBeLessThan(rig.joints.upperArmR[0]);
    expect(rig.joints.lowerArmL[0]).toBeCloseTo(-rig.joints.lowerArmR[0], 5);
    expect(rig.joints.lowerLegL[0]).toBeCloseTo(-rig.joints.lowerLegR[0], 5);
  });
  it('per-side keys override the shorthand', () => {
    const rig = buildRig({ pose: { arms: { raiseSide: 90 }, armL: { raiseSide: 0 } } });
    // left arm hangs down (abduct 0), right stays out (abduct 90).
    expect(rig.joints.lowerArmL[2]).toBeLessThan(rig.joints.upperArmL[2]);
    expect(rig.joints.lowerArmR[0]).toBeLessThan(rig.joints.upperArmR[0]);
  });
});

describe('figure rig — one-component invariants', () => {
  // The welded figure stays a single component because (a) adjacent bones in a
  // chain share their joint endpoint exactly, so the capsules always overlap at
  // the joint, and (b) the chain roots (shoulder, hip) sit inside the torso
  // masses they weld into. Both hold regardless of pose.
  it('keeps every bone non-degenerate across a range of poses', () => {
    for (const bend of [0, 60, 120]) {
      for (const raiseSide of [0, 45, 90, 140]) {
        const rig = buildRig({ pose: { armL: { raiseSide, bend }, legL: { raiseSide: 20, bend: 60 } } });
        expect(dist(rig.joints.upperArmL, rig.joints.lowerArmL)).toBeGreaterThan(1);
        expect(dist(rig.joints.lowerArmL, rig.joints.wristL)).toBeGreaterThan(1);
        expect(dist(rig.joints.upperLegL, rig.joints.lowerLegL)).toBeGreaterThan(1);
        expect(dist(rig.joints.lowerLegL, rig.joints.footL)).toBeGreaterThan(1);
      }
    }
  });
  it('roots the arm at the chest and the leg at the pelvis (limbs attach)', () => {
    const rig = buildRig({});
    // shoulder X within chest half-width + the deltoid cap that bridges it.
    expect(Math.abs(rig.joints.upperArmL[0])).toBeLessThan(rig.r.chestX + rig.r.upperArm * 1.15);
    // hip X within the pelvis mass + thigh radius.
    expect(Math.abs(rig.joints.upperLegL[0])).toBeLessThan(rig.r.hipsX + rig.r.upperLeg);
  });
});

describe('figure mouth — styles', () => {
  const rig = buildRig({ height: 60, headsTall: 5 });

  it('defaults to a carved smile line', () => {
    const mouth = buildMouthPart(api, rig);
    expect(mouth.mode).toBe('carve');
    // The arc passes through (just below) the mouth anchor, so the anchor
    // point lies INSIDE the cutter.
    const m = rig.face.mouth;
    expect(mouth.node.evaluate(m[0], m[1], m[2])).toBeLessThan(0);
  });

  it('spans roughly the requested width', () => {
    const width = rig.r.head * 0.6;
    const mouth = buildMouthPart(api, rig, { width });
    const b = mouth.node.bounds();
    expect(b.max[0] - b.min[0]).toBeGreaterThan(width * 0.9);
  });

  it('`open` implies the open-cavity style and carves', () => {
    const mouth = buildMouthPart(api, rig, { open: 0.7 });
    expect(mouth.mode).toBe('carve');
    const m = rig.face.mouth;
    // The cavity straddles the anchor.
    expect(mouth.node.evaluate(m[0], m[1], m[2])).toBeLessThan(0);
  });

  it("style 'lips' keeps the protruding additive ridge", () => {
    const mouth = buildMouthPart(api, rig, { style: 'lips', smirk: 0.4 });
    expect(mouth.mode).toBe('add');
  });

  it('an open mouth gapes wider with larger `open`', () => {
    const small = buildMouthPart(api, rig, { open: 0.2 }).node.bounds();
    const big = buildMouthPart(api, rig, { open: 1 }).node.bounds();
    expect(big.max[2] - big.min[2]).toBeGreaterThan(small.max[2] - small.min[2]);
  });

  it('rejects bad style / out-of-range open / unknown keys', () => {
    expect(() => buildMouthPart(api, rig, { style: 'frown' })).toThrow(/style/);
    expect(() => buildMouthPart(api, rig, { open: 2 })).toThrow();
    expect(() => buildMouthPart(api, rig, { fangs: true })).toThrow();
  });

  // The arc corner height vs centre height tells smile (corners up) from frown
  // (corners down). Sample the cutter just below each corner and the centre.
  const cornerVsCentre = (opts: Record<string, unknown>): number => {
    const node = buildMouthPart(api, rig, opts).node;
    const m = rig.face.mouth, u = rig.dir.headUp, right = rig.dir.headLeft;
    const hw = rig.r.head * 0.25;
    // Walk up from the anchor until outside the cutter, at the corner vs centre.
    const topOf = (lat: number): number => {
      const base = [m[0] + right[0] * lat, m[1] + right[1] * lat, m[2] + right[2] * lat];
      let z = -rig.r.head;
      for (let s = -rig.r.head; s <= rig.r.head; s += rig.r.head * 0.02) {
        const p = [base[0] + u[0] * s, base[1] + u[1] * s, base[2] + u[2] * s];
        if (node.evaluate(p[0], p[1], p[2]) < 0) z = s;
      }
      return z;
    };
    return topOf(hw) - topOf(0); // corner-top minus centre-top
  };

  it('expression bends the mouth: smile lifts corners, frown drops them', () => {
    expect(cornerVsCentre({ expression: 'bigSmile' })).toBeGreaterThan(0);
    expect(cornerVsCentre({ expression: 'deepFrown' })).toBeLessThan(0);
    // A bigger smile lifts the corners more than a slight one.
    expect(cornerVsCentre({ expression: 'bigSmile' }))
      .toBeGreaterThan(cornerVsCentre({ expression: 'slightSmile' }));
  });

  it('numeric curve overrides the preset and rejects out-of-range', () => {
    expect(cornerVsCentre({ curve: -1 })).toBeLessThan(0);
    expect(() => buildMouthPart(api, rig, { curve: 2 })).toThrow(/curve/);
    expect(() => buildMouthPart(api, rig, { expression: 'grimace' })).toThrow(/expression/);
  });

  it("divided lips build the refined two-lip shape (taller than a single ridge)", () => {
    const single = buildMouthPart(api, rig, { style: 'lips' }).node.bounds();
    const two = buildMouthPart(api, rig, { style: 'lips', divided: true });
    expect(two.mode).toBe('add');
    const tb = two.node.bounds();
    expect(tb.max[2] - tb.min[2]).toBeGreaterThan(single.max[2] - single.min[2]);
  });

  it('lipShape presets are additive and differ in width', () => {
    for (const shape of ['natural', 'full', 'thin', 'wide', 'rosebud', 'flat']) {
      expect(buildMouthPart(api, rig, { style: 'lips', lipShape: shape }).mode).toBe('add');
    }
    const wide = buildMouthPart(api, rig, { style: 'lips', lipShape: 'wide' }).node.bounds();
    const rosebud = buildMouthPart(api, rig, { style: 'lips', lipShape: 'rosebud' }).node.bounds();
    // 'wide' spans clearly more laterally than the petite 'rosebud'.
    expect(wide.max[0] - wide.min[0]).toBeGreaterThan(rosebud.max[0] - rosebud.min[0]);
  });

  it('an explicit width overrides the lipShape preset width', () => {
    const preset = buildMouthPart(api, rig, { style: 'lips', lipShape: 'rosebud' }).node.bounds();
    const wider = buildMouthPart(api, rig, { style: 'lips', lipShape: 'rosebud', width: rig.r.head * 0.9 }).node.bounds();
    expect(wider.max[0] - wider.min[0]).toBeGreaterThan(preset.max[0] - preset.min[0]);
  });

  it('rejects an unknown lipShape', () => {
    expect(() => buildMouthPart(api, rig, { style: 'lips', lipShape: 'duckbill' })).toThrow(/lipShape/);
  });

  it('bare style:lips is the historical straight ridge (byte-identical)', () => {
    // Lock the back-compat default: bare lips (no lipShape/divided/curve) must
    // stay the exact historical capsule that catalog bakes were built against.
    const node = buildMouthPart(api, rig, { style: 'lips' }).node;
    const m = rig.face.mouth, u = rig.dir.headUp, right = rig.dir.headLeft, f = rig.dir.headForward;
    const R = rig.r.head, lipR = R * 0.085, halfW = R * 0.25; // default width R*0.5
    const fwd: [number, number, number] = [f[0] * lipR * 0.6, f[1] * lipR * 0.6, f[2] * lipR * 0.6];
    const a: [number, number, number] = [m[0] + fwd[0] + right[0] * halfW, m[1] + fwd[1] + right[1] * halfW, m[2] + fwd[2] + right[2] * halfW];
    const b: [number, number, number] = [m[0] + fwd[0] - right[0] * halfW, m[1] + fwd[1] - right[1] * halfW, m[2] + fwd[2] - right[2] * halfW];
    const ref = api.capsule(a, b, lipR) as SdfNode;
    // Two SDFs equal at enough independent points ⇒ identical capsule.
    const samples: Array<[number, number, number]> = [
      m, [m[0] + fwd[0], m[1] + fwd[1], m[2] + fwd[2]], a, b,
      [m[0] + u[0] * lipR, m[1] + u[1] * lipR, m[2] + u[2] * lipR],
      [m[0] + f[0] * R, m[1] + f[1] * R, m[2] + f[2] * R],
    ];
    for (const [x, y, z] of samples) {
      expect((node as SdfNode).evaluate(x, y, z)).toBeCloseTo(ref.evaluate(x, y, z), 9);
    }
  });

  it('render: painted makes the smile line additive (the #652-class fallback)', () => {
    expect(buildMouthPart(api, rig, { render: 'painted' }).mode).toBe('add');
    expect(buildMouthPart(api, rig, { render: 'carved' }).mode).toBe('carve');
  });

  it('auto-render falls back to additive only on genuinely small heads', () => {
    // Yoga-class proportions (#652): tiny head (r.head≈2.82) → carve would tear,
    // so paint.
    const tiny = buildRig({ height: 46, headsTall: 7.5, build: 'slim' });
    expect(buildMouthPart(api, tiny, { smirk: 0.15 }).mode).toBe('add');
    // A normal figure still carves the smile groove (back-compat).
    expect(buildMouthPart(api, rig).mode).toBe('carve');
    // Mainstream adult proportions (60-unit, headsTall 8, r.head≈3.45) must
    // STAY carved — the floor sits below them, not above (regression guard).
    expect(buildMouthPart(api, buildRig({ height: 60, headsTall: 8 })).mode).toBe('carve');
  });

  it('rejects a non-boolean `divided`', () => {
    expect(() => buildMouthPart(api, rig, { style: 'lips', divided: 'yes' })).toThrow(/divided/);
  });
});

describe('figure eyes — styles and labels', () => {
  const rig = buildRig({ height: 60, headsTall: 5 });
  const labelsOf = (node: unknown): string[] =>
    [...new Set(partitionByLabel(node as SdfNode).map(p => p.labelName).filter((n): n is string => !!n))].sort();

  it("iris style (the default) pre-labels eyes / iris / pupil regions", () => {
    expect(labelsOf(buildEyes(api, rig))).toEqual(['eyes', 'iris', 'pupil']);
  });

  it('solid style returns one unlabelled pair for the caller to label', () => {
    expect(labelsOf(buildEyes(api, rig, { style: 'solid' }))).toEqual([]);
  });

  it('pupil protrudes beyond the iris, iris beyond the eyeball', () => {
    const f = rig.dir.headForward;
    const reach = (node: unknown): number => {
      // farthest extent along the forward (−Y) axis
      const b = (node as SdfNode).bounds();
      return f[1] < 0 ? -b.min[1] : b.max[1];
    };
    const sclera = buildEyes(api, rig, { style: 'solid' });
    const all = buildEyes(api, rig);
    expect(reach(all)).toBeGreaterThan(reach(sclera) + 1e-6);
  });

  it('iris and pupil are concentric discs smaller than the eyeball (white sclera shows)', () => {
    // The eye reads as eye — not a flat coloured bead — only when the iris is
    // clearly smaller than the visible eyeball cap so a white sclera ring shows
    // around it, and the pupil clearly smaller than the iris. Both eyes sit at
    // the same height under a neutral pose, so each region's vertical (Z) extent
    // equals its in-plane diameter — a clean concentric-size comparison.
    const parts = partitionByLabel(buildEyes(api, rig) as SdfNode);
    const zExtent = (name: string): number => {
      const p = parts.find((p) => p.labelName === name);
      if (!p) throw new Error(`no ${name} region`);
      const b = p.node.bounds();
      return b.max[2] - b.min[2];
    };
    const sclera = zExtent('eyes'), iris = zExtent('iris'), pupil = zExtent('pupil');
    expect(iris).toBeLessThan(sclera);   // white sclera ring shows around the iris
    expect(pupil).toBeLessThan(iris);    // pupil dot nests inside the iris
    // Guard the specific regression (iris ≈ eyeball swallowed the white): the
    // iris must leave a generous white margin, not span the whole eyeball front.
    expect(iris).toBeLessThan(sclera * 0.6);
  });

  it('rejects unknown style and keys', () => {
    expect(() => buildEyes(api, rig, { style: 'laser' })).toThrow(/style/);
    expect(() => buildEyes(api, rig, { glow: true })).toThrow();
  });
});

describe('figure brows — flush, labelled, preset-driven (#724)', () => {
  // Neutral pose so headForward = −Y and headUp = +Z (clean axis assertions).
  const rig = buildRig({ height: 60, headsTall: 5 });
  const labelsOf = (node: unknown): string[] =>
    [...new Set(partitionByLabel(node as SdfNode).map(p => p.labelName).filter((n): n is string => !!n))].sort();

  it("self-labels the single 'brows' region (so a top-level union carries the colour)", () => {
    expect(labelsOf(buildBrows(api, rig))).toEqual(['brows']);
  });

  it('all shape presets build without throwing', () => {
    for (const shape of ['natural', 'thin', 'bushy', 'arched', 'flat', 'angled', 'rounded', 'straight']) {
      expect(() => buildBrows(api, rig, { shape })).not.toThrow();
    }
  });

  it("conformal `on` path: still labels 'brows' and builds non-degenerate geometry", () => {
    // `on` seats the brow as a conformal offset of the real surface (surfaceMarking)
    // — surface.round(proud) ∩ arc — rather than the legacy sunk strip. A head-sized
    // sphere stands in for the face surface; the offset must actually intersect the
    // arc region (a zero proud or a missed region would yield an empty/degenerate
    // patch), and the 'brows' label must survive the offset+clip.
    const surf = api.sphere(rig.r.head * 1.4).translate(rig.joints.head as Vec3);
    const brow = buildBrows(api, rig, { shape: 'natural', on: surf });
    expect(labelsOf(brow)).toEqual(['brows']);
    const b = brow.bounds();
    expect(b.max[0] - b.min[0]).toBeGreaterThan(0);            // lateral span (the brow pair)
    expect(b.max[2] - b.min[2]).toBeGreaterThan(0);            // vertical band
    // Seated at the brow height, not adrift (within a head radius of the anchors).
    const browZ = (rig.face.browL[2] + rig.face.browR[2]) / 2;
    expect(Math.abs((b.max[2] + b.min[2]) / 2 - browZ)).toBeLessThan(rig.r.head);
  });

  it("'bushy' is a thicker (taller) brow than 'thin'", () => {
    // Vertical extent of the strip ≈ its band thickness (+arch); bushy's wider
    // band dominates so the strip is clearly taller than the thin line.
    const zSpan = (opts: object): number => { const b = buildBrows(api, rig, opts).bounds(); return b.max[2] - b.min[2]; };
    expect(zSpan({ shape: 'bushy' })).toBeGreaterThan(zSpan({ shape: 'thin' }));
  });

  it('higher relief sits more PROUD (further forward) than a flush brow', () => {
    // headForward = −Y, so the forward-most surface is the most-negative Y.
    // relief 0 sinks the strip the full band back; relief 1 leaves it proud.
    const frontY = (relief: number): number => buildBrows(api, rig, { relief }).bounds().min[1];
    expect(frontY(1)).toBeLessThan(frontY(0) - 1e-6);
  });

  it('the width knob widens the lateral (X) span', () => {
    const xSpan = (opts: object): number => { const b = buildBrows(api, rig, opts).bounds(); return b.max[0] - b.min[0]; };
    expect(xSpan({ width: 1.6 })).toBeGreaterThan(xSpan({ width: 1 }));
  });

  it('default spacing sits each brow over its eye, not wider than the pair of eyes', () => {
    // Regression (#724 follow-up): the brow anchors sit a touch wider than the
    // eyes and read as "spread apart". Default brows must not splay past the eyes
    // by more than a natural margin — the brow centres track the eye spacing.
    const eyeOuter = buildEyes(api, rig, { radius: rig.r.head * 0.13 }).bounds().max[0];
    const browOuter = buildBrows(api, rig).bounds().max[0];
    // A natural brow extends a little past the outer eye corner, but nowhere near
    // the old ~37%-wider splay — keep it within ~25%.
    expect(browOuter).toBeLessThan(eyeOuter * 1.25);
  });

  it('the spacing knob spreads the brows apart (>1) or draws them in (<1)', () => {
    const xMax = (opts: object): number => buildBrows(api, rig, opts).bounds().max[0];
    expect(xMax({ spacing: 1.5 })).toBeGreaterThan(xMax({ spacing: 1 }));
    expect(xMax({ spacing: 0.5 })).toBeLessThan(xMax({ spacing: 1 }));
  });

  it('back-compat: legacy { thickness, lift } multipliers still work', () => {
    expect(() => buildBrows(api, rig, {})).not.toThrow();
    expect(() => buildBrows(api, rig, { thickness: 1.3, lift: 0 })).not.toThrow();
    // thickness scales the band → a thicker (taller) strip.
    const zSpan = (opts: object): number => { const b = buildBrows(api, rig, opts).bounds(); return b.max[2] - b.min[2]; };
    expect(zSpan({ thickness: 2 })).toBeGreaterThan(zSpan({ thickness: 1 }));
  });

  it('rejects an unknown shape and unknown keys', () => {
    expect(() => buildBrows(api, rig, { shape: 'unibrow' })).toThrow(/shape/);
    expect(() => buildBrows(api, rig, { bushiness: 2 })).toThrow();
  });

  it('faceDetail includes per-brow refinement spheres, droppable via brows:false', () => {
    const withBrows = faceDetail(rig).length;
    const without = faceDetail(rig, { brows: false }).length;
    expect(withBrows - without).toBe(2); // one sphere per brow
  });
});

describe('figure eyes — eyelids', () => {
  const rig = buildRig({ height: 60, headsTall: 5 });
  const labelsOf = (node: unknown): string[] =>
    [...new Set(partitionByLabel(node as SdfNode).map(p => p.labelName).filter((n): n is string => !!n))].sort();

  it("no lids by default — bare eyeball, no 'lids' region", () => {
    expect(labelsOf(buildEyes(api, rig))).not.toContain('lids');
  });

  it("iris + lids adds a paintable 'lids' region alongside the eye", () => {
    expect(labelsOf(buildEyes(api, rig, { lids: 'upper' }))).toEqual(['eyes', 'iris', 'lids', 'pupil']);
  });

  for (const lids of ['upper', 'hooded', 'half', 'closed', 'almond', 'tapered'] as const) {
    it(`lids: '${lids}' builds a labelled 'lids' fold`, () => {
      expect(labelsOf(buildEyes(api, rig, { lids }))).toContain('lids');
    });
  }

  it("solid + lids self-labels ('eyes' + 'lids'), unlike bare solid", () => {
    // bare solid is unlabelled; adding lids forces self-labelling so the two
    // regions stay paintable independently.
    expect(labelsOf(buildEyes(api, rig, { style: 'solid' }))).toEqual([]);
    expect(labelsOf(buildEyes(api, rig, { style: 'solid', lids: 'upper' }))).toEqual(['eyes', 'lids']);
  });

  it('accepts an explicit { upper, lower } pair', () => {
    expect(labelsOf(buildEyes(api, rig, { lids: { upper: 0.3, lower: 0.1 } }))).toContain('lids');
    // a single lid (only upper, or only lower) still builds a 'lids' region
    expect(labelsOf(buildEyes(api, rig, { lids: { upper: 0.4 } }))).toContain('lids');
    expect(labelsOf(buildEyes(api, rig, { lids: { lower: 0.4 } }))).toContain('lids');
  });

  it("{ upper: 0, lower: 0 } is the same as no lids", () => {
    expect(labelsOf(buildEyes(api, rig, { lids: { upper: 0, lower: 0 } }))).not.toContain('lids');
  });

  it('rejects an unknown lids style, out-of-range fractions, and unknown keys', () => {
    expect(() => buildEyes(api, rig, { lids: 'winged' })).toThrow(/lids/);
    expect(() => buildEyes(api, rig, { lids: { upper: 1.5 } })).toThrow();
    expect(() => buildEyes(api, rig, { lids: { upper: -0.2 } })).toThrow();
    expect(() => buildEyes(api, rig, { lids: { top: 0.3 } })).toThrow();
  });
});

describe('figure eyes — gaze (where the iris/pupil point)', () => {
  const rig = buildRig({ height: 60, headsTall: 5 });
  const labelsOf = (node: unknown): string[] =>
    [...new Set(partitionByLabel(node as SdfNode).map(p => p.labelName).filter((n): n is string => !!n))].sort();
  // partitionByLabel keeps the two eyes' iris regions separate (one per eye, in
  // build order [left eye = +X, right eye = −X]); resolveLabelMap merges them by
  // name later. So we read each eye's iris-disc centroid (its AABB centre)
  // independently — exactly what per-eye gaze needs to verify.
  const irises = (opts?: unknown): { L: { x: number; z: number }; R: { x: number; z: number } } => {
    const ps = partitionByLabel(buildEyes(api, rig, opts) as SdfNode).filter(p => p.labelName === 'iris');
    if (ps.length !== 2) throw new Error(`expected 2 iris regions, got ${ps.length}`);
    const ctr = (i: number): { x: number; z: number } => {
      const b = ps[i].node.bounds();
      return { x: (b.min[0] + b.max[0]) / 2, z: (b.min[2] + b.max[2]) / 2 };
    };
    return { L: ctr(0), R: ctr(1) };
  };
  const gap = (e: { L: { x: number }; R: { x: number } }): number => e.L.x - e.R.x;  // L is +X, R is −X

  it("default ('middle'/'center') gaze is symmetric, with the usual labels", () => {
    expect(labelsOf(buildEyes(api, rig, { gaze: 'middle' }))).toEqual(['eyes', 'iris', 'pupil']);
    expect(labelsOf(buildEyes(api, rig, { gaze: 'center' }))).toEqual(['eyes', 'iris', 'pupil']);
    const d = irises(), m = irises({ gaze: 'middle' });
    expect(d.L.x).toBeGreaterThan(0);          // left eye sits on +X
    expect(d.R.x).toBeLessThan(0);             // right eye on −X
    expect(d.L.x + d.R.x).toBeCloseTo(0, 1);   // mirror-symmetric ⇒ no net X bias
    expect(m.L.x).toBeCloseTo(d.L.x, 5);       // 'middle' === default
  });

  it("'left' turns BOTH irises toward the figure's own left (+X); 'right' the other way", () => {
    const d = irises();
    const l = irises({ gaze: 'left' });
    expect(l.L.x).toBeGreaterThan(d.L.x + 0.1);
    expect(l.R.x).toBeGreaterThan(d.R.x + 0.1);
    const r = irises({ gaze: 'right' });
    expect(r.L.x).toBeLessThan(d.L.x - 0.1);
    expect(r.R.x).toBeLessThan(d.R.x - 0.1);
  });

  it("'up' raises both irises, 'down' lowers them", () => {
    const d = irises();
    expect(irises({ gaze: 'up' }).L.z).toBeGreaterThan(d.L.z + 0.1);
    expect(irises({ gaze: 'down' }).L.z).toBeLessThan(d.L.z - 0.1);
  });

  it('the corner presets move on both axes', () => {
    const d = irises();
    const ul = irises({ gaze: 'upper-left' });
    expect(ul.L.x).toBeGreaterThan(d.L.x + 0.05);
    expect(ul.L.z).toBeGreaterThan(d.L.z + 0.05);
    const lr = irises({ gaze: 'lower-right' });
    expect(lr.L.x).toBeLessThan(d.L.x - 0.05);
    expect(lr.L.z).toBeLessThan(d.L.z - 0.05);
  });

  it('a { yaw, pitch } pair aims at an explicit angle (figure-left / up positive)', () => {
    const d = irises();
    expect(irises({ gaze: { yaw: 20 } }).L.x).toBeGreaterThan(d.L.x + 0.1);
    expect(irises({ gaze: { pitch: 20 } }).L.z).toBeGreaterThan(d.L.z + 0.1);
  });

  it('per-eye gazeL/gazeR aim eyes independently — cross-eyed converges, wall-eyed diverges', () => {
    const d = gap(irises());
    expect(gap(irises({ gazeL: 'right', gazeR: 'left' }))).toBeLessThan(d - 0.1);    // turn inward
    expect(gap(irises({ gazeL: 'left', gazeR: 'right' }))).toBeGreaterThan(d + 0.1); // turn outward
  });

  it('gazeL overrides only the left eye; gaze seeds both', () => {
    const d = irises();
    const one = irises({ gazeL: 'left' });
    expect(one.L.x).toBeGreaterThan(d.L.x + 0.1);  // left eye turned
    expect(one.R.x).toBeCloseTo(d.R.x, 5);         // right eye untouched
    const both = irises({ gaze: 'left' });
    expect(both.R.x).toBeGreaterThan(d.R.x + 0.1); // gaze moves the right eye too
  });

  it('rejects an unknown preset, out-of-range angles, and unknown keys', () => {
    expect(() => buildEyes(api, rig, { gaze: 'sideways' })).toThrow(/gaze/);
    expect(() => buildEyes(api, rig, { gaze: { yaw: 90 } })).toThrow();
    expect(() => buildEyes(api, rig, { gaze: { roll: 10 } })).toThrow();
    expect(() => buildEyes(api, rig, { gazeR: 'nope' })).toThrow(/gazeR/);
  });
});

describe('figure pants — posed-leg coverage', () => {
  it('pant cuffs stay ON the bone for a posed (lunge) leg', () => {
    // Regression: a fixed world-Z cuff endpoint pulled the pant shank off a
    // diagonal lunge shank entirely. The garment interior must contain the
    // shank-bone midpoint of BOTH legs.
    const rig = buildRig({ pose: { legL: { raiseFwd: 45, bend: 45 }, legR: { raiseFwd: -30, bend: 5 } } });
    const pants = buildPants(api, rig) as SdfNode;
    for (const side of ['L', 'R'] as const) {
      const K = rig.joints[`lowerLeg${side}`], A = rig.joints[`foot${side}`];
      const mid = [(K[0] + A[0]) / 2, (K[1] + A[1]) / 2, (K[2] + A[2]) / 2];
      expect(pants.evaluate(mid[0], mid[1], mid[2])).toBeLessThan(0);
    }
  });

  it('a deeply bent knee stays covered (knee pad)', () => {
    const rig = buildRig({ pose: { legL: { raiseFwd: 45, bend: 70 } } });
    const pants = buildPants(api, rig) as SdfNode;
    const K = rig.joints.lowerLegL;
    // A point one skin-bulge radius FORWARD of the knee joint (where the
    // skin's weld bulge peaks) must still be inside the garment.
    const probe = [K[0], K[1] - rig.r.lowerLeg * 1.2, K[2]];
    expect(pants.evaluate(probe[0], probe[1], probe[2])).toBeLessThan(0);
  });

  it("length: 'briefs' skips the leg sleeves", () => {
    const rig = buildRig({});
    const briefs = buildPants(api, rig, { length: 'briefs' }) as SdfNode;
    const full = buildPants(api, rig) as SdfNode;
    const K = rig.joints.lowerLegL;
    // knee is bare in briefs, covered by full pants.
    expect(briefs.evaluate(K[0], K[1], K[2])).toBeGreaterThan(0);
    expect(full.evaluate(K[0], K[1], K[2])).toBeLessThan(0);
    // pelvis is covered by both.
    const P = rig.joints.hips;
    expect(briefs.evaluate(P[0], P[1], P[2] - rig.r.hipsY * 0.3)).toBeLessThan(0);
  });

  it('rejects unknown length values', () => {
    const rig = buildRig({});
    expect(() => buildPants(api, rig, { length: 'capri' })).toThrow(/length/);
  });
});

describe('figure panel — conforming apron/bib/tabard/cape', () => {
  const rig = buildRig({ build: 'stocky', weight: 0.6 });   // a belly that a flat box can't follow
  const body = buildTorso(api, rig).union(buildLegs(api, rig)) as SdfNode;
  // Walk along ±Y at height z to find the body's front (−Y) / back (+Y) surface.
  const surfaceY = (z: number, dir: -1 | 1): number => {
    let y = 0;
    for (let i = 0; i < 400; i++) {
      const next = y + dir * 0.15;
      if (body.evaluate(0, next, z) > 0) return y;      // last point still inside
      y = next;
    }
    return y;
  };

  it('drapes flush on the curved body at BOTH the top and bottom of its span (the flat-slab bug)', () => {
    // The torso front sits at a different Y than the thigh front, so a single-Y
    // flat box can never cover both. A conforming panel — body offset + clipped —
    // covers the real front surface at every height in its range.
    const apron = buildPanel(api, rig, { side: 'front', top: 'chest', bottom: 'thigh' }) as SdfNode;
    const zHi = rig.joints.spine[2];                            // upper belly
    const zLo = rig.joints.upperLegL[2] - rig.r.upperLeg * 0.5; // upper thigh
    for (const z of [zHi, zLo]) {
      const fy = surfaceY(z, -1);
      expect(apron.evaluate(0, fy, z)).toBeLessThan(0);         // front surface covered
    }
  });

  it('is a FRONT shell — it does not pass through to the back, nor fill the torso interior', () => {
    const apron = buildPanel(api, rig, { side: 'front', top: 'chest', bottom: 'thigh' }) as SdfNode;
    const z = rig.joints.spine[2];
    expect(apron.evaluate(0, surfaceY(z, +1), z)).toBeGreaterThan(0);  // back surface bare
    expect(apron.evaluate(0, 0, z)).toBeGreaterThan(0);               // body centre not filled
  });

  it("side: 'back' covers the back surface and leaves the front bare", () => {
    const cape = buildPanel(api, rig, { side: 'back', top: 'chest', bottom: 'thigh' }) as SdfNode;
    const z = rig.joints.spine[2];
    expect(cape.evaluate(0, surfaceY(z, +1), z)).toBeLessThan(0);     // back covered
    expect(cape.evaluate(0, surfaceY(z, -1), z)).toBeGreaterThan(0);  // front bare
  });

  it("side: 'both' covers front AND back", () => {
    const tabard = buildPanel(api, rig, { side: 'both', top: 'chest', bottom: 'thigh' }) as SdfNode;
    const z = rig.joints.spine[2];
    expect(tabard.evaluate(0, surfaceY(z, -1), z)).toBeLessThan(0);
    expect(tabard.evaluate(0, surfaceY(z, +1), z)).toBeLessThan(0);
  });

  it('the apron preset is a front panel and accepts panel options', () => {
    const apron = buildApron(api, rig, { bottom: 'knee' }) as SdfNode;
    const z = rig.joints.spine[2];
    expect(apron.evaluate(0, surfaceY(z, -1), z)).toBeLessThan(0);
  });

  it('rejects unknown side, level, and keys', () => {
    expect(() => buildPanel(api, rig, { side: 'left' })).toThrow(/side/);
    expect(() => buildPanel(api, rig, { top: 'forehead' })).toThrow(/top/);
    expect(() => buildPanel(api, rig, { bottom: 'toe' })).toThrow(/bottom/);
    expect(() => buildPanel(api, rig, { wobble: 1 })).toThrow();
    // The apron preset surfaces its OWN name in validation errors, not panel's.
    expect(() => buildApron(api, rig, { wobble: 1 })).toThrow(/apron/);
  });
});

describe('figure top — dress/gown coverage', () => {
  it('a floor-length sleeveless gown still covers the chest on a tall figure', () => {
    // Regression (#topless-runway-gown): the hem "half-space" was a fixed
    // `big`-tall box, too short for a floor-length hem on a tall figure (chest
    // sits high in Z, `chestX` — hence `big` — is small). Its TOP sliced through
    // the chest/shoulders and amputated the whole bodice, leaving a bare torso
    // over a cone skirt. Build a runway-like rig + floor-length gown and assert
    // the bust and chest are INSIDE the garment.
    const rig = buildRig({ height: 72, headsTall: 8.5, sex: 'female', build: 'slim', weight: 0.3, bust: 0.4 });
    const hemZ = rig.opts.height * 0.06;             // near the ground
    const gown = buildTop(api, rig, { sleeve: 'none', hemZ }) as SdfNode;
    // The bust apexes sit on the skin surface; the garment offsets outward, so
    // each must be strictly inside. Before the fix these evaluated > 0 (clipped).
    const mounds = breastMounds(rig.joints, rig.r, rig.opts.bust);
    expect(mounds).not.toBeNull();
    if (mounds) {
      expect(gown.evaluate(...(mounds.apexL as [number, number, number]))).toBeLessThan(0);
      expect(gown.evaluate(...(mounds.apexR as [number, number, number]))).toBeLessThan(0);
    }
    // The chest-front surface (centre line, one chest-depth forward) is covered.
    const C = rig.joints.chest;
    expect(gown.evaluate(C[0], C[1] - rig.r.chestY, C[2])).toBeLessThan(0);
  });

  it('a dress skirt covers the OUTER thigh (legs do not poke through the cone)', () => {
    // Regression (#dress-outer-thigh): the skirt was a centered cone with NO leg
    // coverage, so a spread leg poked through its side at mid-thigh as a bare-skin
    // patch. The dress now folds the legs (offset by `t`) into the coverage, so the
    // outer-thigh skin surface must be strictly inside the garment.
    const rig = buildRig({ height: 56, headsTall: 7, sex: 'female', build: 'average', weight: 0.5,
      pose: { legL: { raiseSide: 8 }, legR: { raiseSide: 8 } } });
    const j = rig.joints, r = rig.r;
    const legs = buildLegs(api, rig) as SdfNode;
    const dress = buildTop(api, rig, { sleeve: 'none', hemZ: rig.opts.height * 0.18 }) as SdfNode;
    // Walk between hip and knee; at each height march OUTWARD (+x) from the leg
    // centre to the skin surface and assert the dress encloses it. Sample at y=0
    // (the leg's coronal mid-slice): the bug is purely lateral — the leg's widest
    // +x bulge punching through the cone's side — so y=0 is the worst case.
    for (let f = 0.2; f <= 0.8; f += 0.2) {
      const z = j.upperLegL[2] * (1 - f) + j.lowerLegL[2] * f;
      const cx = j.upperLegL[0] * (1 - f) + j.lowerLegL[0] * f;
      let xSkin = null as number | null;
      for (let x = cx; x < cx + 10; x += 0.05) { if (legs.evaluate(x, 0, z) > 0) { xSkin = x - 0.05; break; } }
      expect(xSkin).not.toBeNull();
      if (xSkin !== null) expect(dress.evaluate(xSkin, 0, z)).toBeLessThan(0);
    }
  });

  it('a non-dress top does NOT wrap the legs (a shirt is not pants)', () => {
    // The leg coverage is gated on the dress branch (hem below the pelvis); a
    // normal waist-length top must leave the thighs bare.
    const rig = buildRig({ height: 60, headsTall: 7 });
    const top = buildTop(api, rig, { sleeve: 'short' }) as SdfNode;
    const K = rig.joints.lowerLegL;
    expect(top.evaluate(K[0], K[1], K[2])).toBeGreaterThan(0);
  });

  it('the gown hem stops the skirt: just below hemZ is outside, just above is inside', () => {
    // Guards the hem BOTTOM edge (so the coverage-clip fix above doesn't
    // over-correct and regress the hemline) — NOT the #topless-runway-gown
    // defect itself, which was the box TOP and is covered by the test above.
    const rig = buildRig({ height: 72, headsTall: 8.5, sex: 'female', build: 'slim', weight: 0.3, bust: 0.4 });
    const hemZ = rig.opts.height * 0.06;
    const gown = buildTop(api, rig, { sleeve: 'none', hemZ }) as SdfNode;
    // On the body centre line, a point above the hem is inside the skirt; a point
    // well below the hem is outside (the hem still cuts the bottom edge).
    expect(gown.evaluate(0, 0, hemZ + 4)).toBeLessThan(0);
    expect(gown.evaluate(0, 0, hemZ - 4)).toBeGreaterThan(0);
  });
});

describe('figure footwear — shoes & boots', () => {
  it('shoes wrap each foot (sole point is inside)', () => {
    const rig = buildRig({});
    const shoes = buildShoes(api, rig) as SdfNode;
    for (const side of ['L', 'R'] as const) {
      const A = rig.joints[`foot${side}`];
      // The sole sits one foot-radius below the ankle; a point there is shod.
      const sole = [A[0], A[1], A[2] - rig.r.foot];
      expect(shoes.evaluate(sole[0], sole[1], sole[2])).toBeLessThan(0);
    }
  });

  it('hugs the foot — the shoe is not grossly longer than the bare foot', () => {
    // Guards the 2026-06 footwear/foot drift: the footwear last + heel + coverage
    // were authored (2026-06-13) for a long-heeled foot the very next day's reshape
    // (2026-06-14, "length in the forefoot, shallow heel") shrank — but the shoe was
    // never resized, so it ran ~1.7× the foot (heel jutting behind, club toe). Both
    // feet point the same way for a neutral stance, so the union's heel→toe (Y) span
    // is one shoe's length; assert it stays within a natural shoe margin of the foot.
    const rig = buildRig({});
    const feet = buildFeet(api, rig) as SdfNode;
    const shoes = buildShoes(api, rig) as SdfNode;
    const fy = feet.bounds().max[1] - feet.bounds().min[1];
    const sy = shoes.bounds().max[1] - shoes.bounds().min[1];
    expect(sy).toBeGreaterThan(fy);          // a shoe is a touch longer than the foot
    expect(sy / fy).toBeLessThan(1.4);       // …but not the old ~1.7× clown shoe
  });

  it("boots add a shaft up the shank that shoes leave bare", () => {
    const rig = buildRig({});
    const shoes = buildShoes(api, rig) as SdfNode;
    const boots = buildBoots(api, rig) as SdfNode;
    const A = rig.joints.footL, K = rig.joints.lowerLegL;
    // A point ~mid-calf along the ankle→knee bone: covered by the boot shaft,
    // bare on a low shoe.
    const calf = [A[0] * 0.5 + K[0] * 0.5, A[1] * 0.5 + K[1] * 0.5, A[2] * 0.5 + K[2] * 0.5];
    expect(boots.evaluate(calf[0], calf[1], calf[2])).toBeLessThan(0);
    expect(shoes.evaluate(calf[0], calf[1], calf[2])).toBeGreaterThan(0);
  });

  it('footwear follows the foot heading under leg twist (turnout)', () => {
    // A turned-out foot points its toe outward; the toe of the shoe must move
    // with it (the builder reads rig.dir.foot*, like F.feet).
    const rig = buildRig({ pose: { legL: { twist: 40 } } });
    const shoes = buildShoes(api, rig) as SdfNode;
    const A = rig.joints.footL, fwd = rig.dir.footL;
    const sz = A[2] - rig.r.foot;
    const footLen = rig.r.foot * 2.4;
    // A point out along the heading at sole height (under the toe) is shod.
    const toe = [A[0] + fwd[0] * footLen * 0.5, A[1] + fwd[1] * footLen * 0.5, sz];
    expect(shoes.evaluate(toe[0], toe[1], toe[2])).toBeLessThan(0);
  });

  it("boots' shaftZ projects onto a posed (lunge) shank bone", () => {
    // Regression guard mirroring pants' cuffPoint: a world-Z shaft target must
    // ride the diagonal shank, not a fixed world point off the leg.
    const rig = buildRig({ pose: { legL: { raiseFwd: 45, bend: 45 } } });
    const A = rig.joints.footL, K = rig.joints.lowerLegL;
    const shaftZ = A[2] * 0.4 + K[2] * 0.6;
    const boots = buildBoots(api, rig, { shaftZ }) as SdfNode;
    // The shank-bone point at that height projection is inside the boot.
    const frac = (shaftZ - A[2]) / (K[2] - A[2]);
    const p = [A[0] + (K[0] - A[0]) * frac, A[1] + (K[1] - A[1]) * frac, A[2] + (K[2] - A[2]) * frac];
    expect(boots.evaluate(p[0], p[1], p[2])).toBeLessThan(0);
  });

  it('rejects unknown footwear options', () => {
    const rig = buildRig({});
    expect(() => buildShoes(api, rig, { shaftZ: 5 })).toThrow(/shaftZ/);
    expect(() => buildBoots(api, rig, { bogus: 1 })).toThrow(/bogus/);
  });

  it('boots have a flat bottom clipped at the ground plane', () => {
    const rig = buildRig({});
    const boots = buildBoots(api, rig) as SdfNode;
    const s = rig.sole.L;
    // inside just above the ground plane, empty just below it (flat cut, not a
    // rounded capsule underside).
    expect(boots.evaluate(s.point[0], s.point[1], s.groundZ + 0.3)).toBeLessThan(0);
    expect(boots.evaluate(s.point[0], s.point[1], s.groundZ - 0.4)).toBeGreaterThan(0);
  });

  it('the boot encloses the foot underside (no bare-skin patch shows through)', () => {
    const rig = buildRig({});
    const boots = buildBoots(api, rig) as SdfNode;
    const feet = buildFeet(api, rig) as SdfNode;
    const s = rig.sole.L;
    // The boot extends BELOW the skin: at the ground plane the boot is solid but
    // the bare foot is not, so the boot (not skin) forms the underside.
    expect(boots.evaluate(s.point[0], s.point[1], s.groundZ + 0.05)).toBeLessThan(0);
    expect(feet.evaluate(s.point[0], s.point[1], s.groundZ + 0.05)).toBeGreaterThan(0);
    // Higher up, where the skin sole is solid, the boot is solid too (covers it).
    const z = s.groundZ + rig.r.foot * 0.4;
    expect(feet.evaluate(s.point[0], s.point[1], z)).toBeLessThan(0);
    expect(boots.evaluate(s.point[0], s.point[1], z)).toBeLessThan(0);
  });

  it('a plantarflexed (lifted) foot stays fully shod — the shoe pitches with the foot', () => {
    // A strongly lifted foot plantarflexes in buildFeet (#701/#707): the toe
    // points down along the leg's extension. The shoe MUST pivot with it, or the
    // pointed foot pokes out of a flat shoe (the regression this guards). Probe a
    // grid around the lifted foot: wherever the BARE foot is solid (below the
    // ankle, off the bare shank the opening leaves), the shoe must be solid too.
    const rig = buildRig({ pose: { legR: { raiseFwd: 65, bend: 14 }, legL: { raiseFwd: 5, bend: 20 } } });
    const feet = buildFeet(api, rig) as SdfNode;
    const shoes = buildShoes(api, rig) as SdfNode;
    const A = rig.joints.footR as number[];
    const rf = rig.r.foot;
    let probed = 0, pokesThrough = 0;
    for (let dx = -3; dx <= 3; dx++) {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dz = -4; dz <= 2; dz++) {
          const p = [A[0] + dx * rf * 0.5, A[1] + dy * rf * 0.5, A[2] + dz * rf * 0.5];
          if (p[2] > A[2] - rf * 0.2) continue;          // stay below the ankle (off the bare shank)
          if (feet.evaluate(p[0], p[1], p[2]) < -0.05) {  // solidly inside the bare foot
            probed++;
            if (shoes.evaluate(p[0], p[1], p[2]) > 0.05) pokesThrough++;
          }
        }
      }
    }
    expect(probed).toBeGreaterThan(10);   // we actually hit the lifted foot's mass
    expect(pokesThrough).toBe(0);          // …and the shoe encloses every bit of it
  });

  it('the base descends to contain a posed/shod sole (no poke-through)', () => {
    const rig = buildRig({ pose: { legR: { raiseFwd: 12, bend: 28 }, legL: { raiseSide: 6 } } });
    const base = buildBase(api, rig) as SdfNode;
    const boots = buildBoots(api, rig) as SdfNode;
    // the base bottom is at or below the lowest boot sole, so the boot can't
    // hang below the disc and punch through its underside.
    expect(base.bounds().min[2]).toBeLessThanOrEqual(boots.bounds().min[2] + 1e-6);
  });
});

describe('figure sole frames — the ground-contact anchor (foot analog of grips)', () => {
  it('exposes a sole frame per foot derived from the ankle', () => {
    const rig = buildRig({});
    for (const side of ['L', 'R'] as const) {
      const s = rig.sole[side];
      const A = rig.joints[`foot${side}`];
      expect(s.groundZ).toBeLessThan(A[2]);          // ground is below the ankle
      expect(s.point[2]).toBeCloseTo(s.groundZ);     // footprint point sits on the plane
      expect(s.length).toBeGreaterThan(0);
      expect(s.width).toBeGreaterThan(0);
      expect(s.normal).toEqual([0, 0, 1]);
    }
  });

  it('sole heading equals dir.foot, so it tracks turnout', () => {
    const rig = buildRig({ pose: { legL: { twist: 40 } } });
    expect(rig.sole.L.heading).toEqual(rig.dir.footL);
  });

  it('the sole frame plane sits at/below the bare foot underside', () => {
    const rig = buildRig({});
    const feet = buildFeet(api, rig) as SdfNode;
    const s = rig.sole.L;
    // groundZ is below the whole foot (footwear clips here to enclose the skin)…
    expect(feet.evaluate(s.point[0], s.point[1], s.groundZ + 0.05)).toBeGreaterThan(0);
    // …and rising into the foot reaches solid skin.
    expect(feet.evaluate(s.point[0], s.point[1], s.groundZ + rig.r.foot * 0.6)).toBeLessThan(0);
  });

  it('poseProbe reports the sole frames', () => {
    const rig = buildRig({});
    const probe = createFigureNamespace(api).poseProbe(rig);
    expect(probe.soles.L.groundZ).toBeCloseTo(rig.sole.L.groundZ);
    expect(probe.text).toMatch(/soles:/);
  });
});

describe('figure standOn — seat a prop under a foot', () => {
  const boxN = () => sdfT.primBox([4, 4, 4]) as unknown as SdfNode;

  it("drops a node's top onto the sole point by default", () => {
    const rig = buildRig({});
    const s = rig.sole.L;
    const placed = standOn(boxN(), s) as SdfNode;
    const b = placed.bounds();
    expect(b.max[2]).toBeCloseTo(s.point[2]);                  // top meets the sole
    expect((b.min[0] + b.max[0]) / 2).toBeCloseTo(s.point[0]); // centred under the foot
    expect((b.min[1] + b.max[1]) / 2).toBeCloseTo(s.point[1]);
  });

  it("anchor 'bottom' rests the node ON the sole point", () => {
    const rig = buildRig({});
    const s = rig.sole.L;
    const placed = standOn(boxN(), s, { anchor: 'bottom' }) as SdfNode;
    expect(placed.bounds().min[2]).toBeCloseTo(s.point[2]);
  });

  it('accepts a raw point and rejects unknown options', () => {
    const rig = buildRig({});
    expect(() => (standOn(boxN(), [0, 0, 0]) as SdfNode).bounds()).not.toThrow();
    expect(() => standOn(boxN(), rig.sole.L, { foo: 1 })).toThrow();
  });
});

describe('figure footwear — separate sole region', () => {
  it('emits a distinct sole region plus the upper, by default', () => {
    const rig = buildRig({});
    const names = partitionByLabel(buildBoots(api, rig) as SdfNode).map(r => r.labelName);
    expect(names).toContain('boots');
    expect(names).toContain('sole');
  });

  it("sole: false folds the sole into the upper (one region name)", () => {
    const rig = buildRig({});
    const names = partitionByLabel(buildBoots(api, rig, { sole: false }) as SdfNode).map(r => r.labelName);
    expect(names).toContain('boots');
    expect(names).not.toContain('sole');
  });

  it('custom upper + sole labels', () => {
    const rig = buildRig({});
    const names = partitionByLabel(buildBoots(api, rig, { label: 'kicks', sole: { label: 'tread' } }) as SdfNode).map(r => r.labelName);
    expect(names).toContain('kicks');
    expect(names).toContain('tread');
  });

  it('shoes default their upper label to "shoes"', () => {
    const rig = buildRig({});
    const names = partitionByLabel(buildShoes(api, rig) as SdfNode).map(r => r.labelName);
    expect(names).toContain('shoes');
  });

  it("sole style 'welt' (default) overhangs 'flush' laterally", () => {
    const rig = buildRig({});
    const r = rig.r, s = rig.sole.L;
    const welt = buildBoots(api, rig, { sole: { style: 'welt', lip: r.foot * 0.2 } }) as SdfNode;
    const flush = buildBoots(api, rig, { sole: { style: 'flush' } }) as SdfNode;
    // A point just outside the flush sole edge, at sole height, is empty for flush
    // but inside the welt (its lip is proud of the upper).
    const x = s.point[0] + r.foot * 1.08, y = s.point[1], z = s.groundZ + 0.1;
    expect(flush.evaluate(x, y, z)).toBeGreaterThan(0);
    expect(welt.evaluate(x, y, z)).toBeLessThan(0);
  });

  it('rejects an unknown sole style', () => {
    expect(() => buildBoots(api, buildRig({}), { sole: { style: 'platform' } })).toThrow(/style/);
  });
});

describe('figure ground — stand feet on one plane', () => {
  it('plant levels near-plane feet to a common groundZ', () => {
    const rig = buildRig({ pose: { legR: { bend: 28, raiseFwd: 10 } } });
    const g = groundRig(rig, { mode: 'plant' });
    expect(g.sole.L.groundZ).toBeCloseTo(g.sole.R.groundZ);
  });

  it('plant lifts a foot that is beyond tolerance', () => {
    const rig = buildRig({ pose: { legR: { raiseFwd: 80, bend: 80 } } });
    const g = groundRig(rig, { mode: 'plant', tolerance: 0.5 });
    expect(Math.abs(g.sole.L.groundZ - g.sole.R.groundZ)).toBeGreaterThan(0.5);
  });

  it('drop re-poses the legs so both feet reach the plane, preserving bone lengths', () => {
    const rig = buildRig({ pose: { legR: { bend: 28, raiseFwd: 10 } } });
    const g = groundRig(rig, { mode: 'drop' });
    expect(g.sole.L.groundZ).toBeCloseTo(g.sole.R.groundZ);
    // thigh + shank lengths are preserved by the 2-bone IK.
    for (const side of ['L', 'R'] as const) {
      const t0 = dist(rig.joints[`upperLeg${side}`], rig.joints[`lowerLeg${side}`]);
      const t1 = dist(g.joints[`upperLeg${side}`], g.joints[`lowerLeg${side}`]);
      const s0 = dist(rig.joints[`lowerLeg${side}`], rig.joints[`foot${side}`]);
      const s1 = dist(g.joints[`lowerLeg${side}`], g.joints[`foot${side}`]);
      expect(t1).toBeCloseTo(t0, 2);
      expect(s1).toBeCloseTo(s0, 2);
    }
  });

  it('grounds to an explicit z', () => {
    const g = groundRig(buildRig({}), { mode: 'plant', z: -5 });
    expect(g.sole.L.groundZ).toBeCloseTo(-5);
    expect(g.sole.R.groundZ).toBeCloseTo(-5);
  });

  it('rejects unknown options and bad modes', () => {
    expect(() => groundRig(buildRig({}), { foo: 1 })).toThrow();
    expect(() => groundRig(buildRig({}), { mode: 'hover' })).toThrow(/mode/);
  });
});

describe('figure mouthAccents — paintable teeth and lips', () => {
  const rig = buildRig({ height: 60, headsTall: 5 });
  const labelsOf = (node: unknown): string[] =>
    [...new Set(partitionByLabel(node as SdfNode).map(p => p.labelName).filter((n): n is string => !!n))].sort();

  it('open style yields teeth + lips regions by default', () => {
    expect(labelsOf(buildMouthAccents(api, rig, { style: 'open', open: 0.6 })))
      .toEqual(['lips', 'teeth']);
  });

  it('teeth/lips can be disabled individually', () => {
    expect(labelsOf(buildMouthAccents(api, rig, { open: 0.6, teeth: false }))).toEqual(['lips']);
    expect(labelsOf(buildMouthAccents(api, rig, { open: 0.6, lips: false }))).toEqual(['teeth']);
  });

  it("lips style yields the labelled ridge", () => {
    expect(labelsOf(buildMouthAccents(api, rig, { style: 'lips' }))).toEqual(['lips']);
  });

  it('smile style yields a paintable lip line labelled lips', () => {
    expect(labelsOf(buildMouthAccents(api, rig, { style: 'smile' }))).toEqual(['lips']);
  });

  it('fully-disabled open accents throw with guidance', () => {
    expect(() => buildMouthAccents(api, rig, { open: 0.6, teeth: false, lips: false })).toThrow(/nothing/);
  });

  it("teeth: 'lower'/'both' add a lower band (more vertical teeth extent)", () => {
    const upper = (buildMouthAccents(api, rig, { open: 0.6, lips: false }) as SdfNode).bounds();
    const both = (buildMouthAccents(api, rig, { open: 0.6, lips: false, teeth: 'both' }) as SdfNode).bounds();
    // 'both' grows the band set downward past the upper-only band.
    expect(both.min[2]).toBeLessThan(upper.min[2] - 1e-6);
    // 'lower' alone is still a single 'teeth' region.
    expect(labelsOf(buildMouthAccents(api, rig, { open: 0.6, teeth: 'lower' }))).toEqual(['lips', 'teeth']);
  });

  it('accents straddle the mouth anchor (they will fuse into the face)', () => {
    const node = buildMouthAccents(api, rig, { open: 0.6 }) as SdfNode;
    const m = rig.face.mouth;
    const b = node.bounds();
    expect(m[0]).toBeGreaterThan(b.min[0]);
    expect(m[0]).toBeLessThan(b.max[0]);
    expect(m[2]).toBeGreaterThan(b.min[2]);
    expect(m[2]).toBeLessThan(b.max[2]);
  });
});

describe('figure hands — sculpted fingers', () => {
  const rig = buildRig({ height: 60, headsTall: 6 });

  it('sculpted open fingers reach past the legacy paddle hand', () => {
    // Straight fingers extend beyond the old flat paddle along the forearm.
    const blob = (buildHands(api, rig, { grip: 'open', fingers: false }) as SdfNode).bounds();
    const sculpted = (buildHands(api, rig, { grip: 'open' }) as SdfNode).bounds();
    expect(sculpted.min[2]).toBeLessThan(blob.min[2] - 0.5); // hanging arms: fingers point down
  });

  it('every grip contains the hand-centre joint (welds to the arm)', () => {
    for (const grip of ['fist', 'open', 'relaxed'] as const) {
      const hands = buildHands(api, rig, { grip }) as SdfNode;
      for (const side of ['L', 'R'] as const) {
        const c = rig.joints[`hand${side}`];
        expect(hands.evaluate(c[0], c[1], c[2])).toBeLessThan(0);
      }
    }
  });

  it('open fingers splay symmetrically L/R', () => {
    const hands = buildHands(api, rig, { grip: 'open' }) as SdfNode;
    const b = hands.bounds();
    expect(b.max[0]).toBeCloseTo(-b.min[0], 1);
  });

  it('rejects unknown grips and keys', () => {
    expect(() => buildHands(api, rig, { grip: 'claw' })).toThrow(/grip/);
    expect(() => buildHands(api, rig, { claws: true })).toThrow();
  });
});

describe('figure hair — styles and hairline', () => {
  const rig = buildRig({ height: 60, headsTall: 5 });
  const browPoint = (): number[] => {
    // a point just above the brow line on the forehead surface
    const b = rig.face.browL;
    return [0, b[1], b[2] + rig.r.headZ * 0.12];
  };

  it('bangs bring the hairline down over the forehead (short does not)', () => {
    const p = browPoint();
    const short = buildHair(api, rig, { style: 'short' }) as SdfNode;
    const bangs = buildHair(api, rig, { style: 'bangs' }) as SdfNode;
    expect(short.evaluate(p[0], p[1], p[2])).toBeGreaterThan(0);  // forehead bare
    expect(bangs.evaluate(p[0], p[1], p[2])).toBeLessThan(0);     // fringe covers it
  });

  it('hairline option moves the face-window top edge', () => {
    // A point near the MID window's top edge: carved away at 'mid'
    // (inside the window), kept at 'low' (window dropped below it).
    const c = rig.joints.head;
    const p = [c[0], c[1] - rig.r.headZ * 0.7, c[2] + rig.r.headZ * 0.55];
    const mid = buildHair(api, rig, { style: 'short', hairline: 'mid' }) as SdfNode;
    const low = buildHair(api, rig, { style: 'short', hairline: 'low' }) as SdfNode;
    expect(mid.evaluate(p[0], p[1], p[2])).toBeGreaterThan(0);
    expect(low.evaluate(p[0], p[1], p[2])).toBeLessThan(0);
  });

  it('ponytail adds a tail down the back of the skull', () => {
    // Midpoint of the tail's mid→tip segment: outside the enlarged cap,
    // inside the swinging tail capsule.
    const c = rig.joints.head, R = rig.r.head, hz = rig.r.headZ;
    const p = [
      c[0],
      c[1] + hz * 0.7 + R * 0.28 - R * 0.04,
      c[2] + hz * 0.55 - R * 0.85 - R * 0.475,
    ];
    const short = buildHair(api, rig, { style: 'short' }) as SdfNode;
    const tail = buildHair(api, rig, { style: 'ponytail' }) as SdfNode;
    expect(short.evaluate(p[0], p[1], p[2])).toBeGreaterThan(0);
    expect(tail.evaluate(p[0], p[1], p[2])).toBeLessThan(0);
  });

  it('rejects unknown style / hairline / texture / part / keys', () => {
    expect(() => buildHair(api, rig, { style: 'mohawk' })).toThrow(/style/);
    expect(() => buildHair(api, rig, { hairline: 'widow' })).toThrow(/hairline/);
    expect(() => buildHair(api, rig, { texture: 'glitter' })).toThrow(/texture/);
    expect(() => buildHair(api, rig, { part: 'mullet' })).toThrow(/part/);
    expect(() => buildHair(api, rig, { volume: 9 })).toThrow(/volume/);   // out of 0.3..4
    expect(() => buildHair(api, rig, { frizz: 2 })).toThrow();            // unknown key
  });

  it('accepts the new styles and the length/volume/part/texture options', () => {
    for (const style of ['bob', 'afro', 'braids', 'spiked', 'locs', 'cornrows', 'boxBraids'] as const) {
      expect(buildHair(api, rig, { style }).bounds).toBeTypeOf('function');
    }
    expect(() => buildHair(api, rig, { style: 'long', length: 'long', volume: 1.6 })).not.toThrow();
    expect(() => buildHair(api, rig, { style: 'afro', texture: 'curls', part: 'left' })).not.toThrow();
    // 'coils' is the new 4c texture — usable on any style.
    expect(() => buildHair(api, rig, { style: 'short', texture: 'coils' })).not.toThrow();
  });

  it('locs / boxBraids hang strands below the head; cornrows lay tight to the scalp', () => {
    const head = buildHair(api, rig, { style: 'short' }) as SdfNode;
    const locs = buildHair(api, rig, { style: 'locs' }) as SdfNode;
    const box = buildHair(api, rig, { style: 'boxBraids' }) as SdfNode;
    const corn = buildHair(api, rig, { style: 'cornrows' }) as SdfNode;
    // Hanging styles reach well below a plain short cap.
    expect(locs.bounds().min[2]).toBeLessThan(head.bounds().min[2]);
    expect(box.bounds().min[2]).toBeLessThan(head.bounds().min[2]);
    // Cornrows stay near the head — they don't hang past the short cap's nape.
    expect(corn.bounds().min[2]).toBeGreaterThan(locs.bounds().min[2]);
  });

  it('new options are neutral at their defaults — classic styles are byte-identical', () => {
    // length:'mid', volume:1, texture:'none', part:'none' must reproduce the
    // pre-existing geometry exactly, so existing catalog bakes never drift.
    const probes = [
      [0, 0, rig.joints.head[2]],
      [rig.r.headX * 0.5, -rig.r.head, rig.joints.head[2] + rig.r.headZ * 0.4],
      [0, rig.r.head, rig.joints.head[2] - rig.r.head * 1.5],
    ];
    for (const style of ['short', 'long', 'bun', 'bangs', 'ponytail'] as const) {
      const bare = buildHair(api, rig, { style }) as SdfNode;
      const explicit = buildHair(api, rig, { style, length: 'mid', volume: 1, texture: 'none', part: 'none', ears: 'cover' }) as SdfNode;
      for (const p of probes) {
        expect(explicit.evaluate(p[0], p[1], p[2])).toBeCloseTo(bare.evaluate(p[0], p[1], p[2]), 9);
      }
    }
  });

  it('length:long drops a ponytail lower than the default', () => {
    const mid = buildHair(api, rig, { style: 'ponytail' }) as SdfNode;
    const long = buildHair(api, rig, { style: 'ponytail', length: 'long' }) as SdfNode;
    // A longer tail reaches farther below the head along −Z.
    expect(long.bounds().min[2]).toBeLessThan(mid.bounds().min[2]);
  });

  it("ears:'behind' carves an ear-clearance pocket that 'cover' leaves filled", () => {
    // A point just outboard of the ear anchor, where the bob's side wing sits:
    // 'cover' keeps hair there (inside the cap), 'behind' scoops it away so the
    // skin ear protrudes in front of the hair.
    const ear = rig.face.earL;
    const p = [ear[0] + rig.r.headX * 0.12, ear[1], ear[2]];
    const cover = buildHair(api, rig, { style: 'bob', ears: 'cover' }) as SdfNode;
    const behind = buildHair(api, rig, { style: 'bob', ears: 'behind' }) as SdfNode;
    expect(cover.evaluate(p[0], p[1], p[2])).toBeLessThan(0);    // hair covers the ear zone
    expect(behind.evaluate(p[0], p[1], p[2])).toBeGreaterThan(0); // pocket carved → ear exposed
  });

  it("ears:'behind' leaves the crown untouched (localized pocket)", () => {
    const c = rig.joints.head;
    const top = [c[0], c[1], c[2] + rig.r.headZ * 0.9];   // crown of the cap
    const cover = buildHair(api, rig, { style: 'short', ears: 'cover' }) as SdfNode;
    const behind = buildHair(api, rig, { style: 'short', ears: 'behind' }) as SdfNode;
    expect(behind.evaluate(top[0], top[1], top[2])).toBeCloseTo(cover.evaluate(top[0], top[1], top[2]), 9);
  });

  it('rejects an unknown hair.ears value', () => {
    expect(() => buildHair(api, rig, { ears: 'tuck' })).toThrow(/ears/);
  });
});

describe('figure ears — types', () => {
  const rig = buildRig({ height: 60, headsTall: 5 });

  it('builds a default ear and rejects an unknown type / key', () => {
    expect(buildEars(api, rig).bounds).toBeTypeOf('function');
    expect(() => buildEars(api, rig, { type: 'goblin' })).toThrow(/type/);
    expect(() => buildEars(api, rig, { wiggle: 1 })).toThrow();
  });

  it('builds all three types as valid nodes spanning both ear anchors', () => {
    for (const type of ['round', 'pointed', 'detailed'] as const) {
      const ears = buildEars(api, rig, { type }) as SdfNode;
      const b = ears.bounds();
      // Spans from the −X (right) anchor to the +X (left) anchor.
      expect(b.min[0]).toBeLessThan(0);
      expect(b.max[0]).toBeGreaterThan(0);
    }
  });

  it('pointed ears reach higher than round ears (the elf point)', () => {
    const round = buildEars(api, rig, { type: 'round' }) as SdfNode;
    const pointed = buildEars(api, rig, { type: 'pointed' }) as SdfNode;
    expect(pointed.bounds().max[2]).toBeGreaterThan(round.bounds().max[2]);
  });

  it('ears stand proud of the skull (extend past the lateral radius)', () => {
    // The ear's outer edge must reach beyond the bare skull's lateral half-width
    // (r.headX), so it protrudes instead of sitting flush like the old blob.
    const ears = buildEars(api, rig, { type: 'round' }) as SdfNode;
    expect(ears.bounds().max[0]).toBeGreaterThan(rig.r.headX);
  });

  it("tilt sweeps the pointed ear back (top moves toward the nape) and rejects out-of-range", () => {
    // The figure faces −Y (front); +Y is the back. A back tilt pushes the elf
    // point's max-Y reach toward the nape vs the untilted ear.
    const upright = buildEars(api, rig, { type: 'pointed' }) as SdfNode;
    const swept = buildEars(api, rig, { type: 'pointed', tilt: 30 }) as SdfNode;
    expect(swept.bounds().max[1]).toBeGreaterThan(upright.bounds().max[1]);
    expect(() => buildEars(api, rig, { type: 'pointed', tilt: 90 })).toThrow(/tilt/);
  });
});

describe('figure skin palette — F.skin', () => {
  const F = createFigureNamespace(api);
  const lum = (hex: string): number =>
    parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);

  it('returns a hex string for a known tone', () => {
    expect(F.skin('umber')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(F.skin('porcelain')).not.toBe(F.skin('ebony'));
  });

  it('returns the full {name: hex} map with no argument, spanning light → deep', () => {
    const all = F.skin() as Record<string, string>;
    expect(Object.keys(all).length).toBeGreaterThanOrEqual(12);
    for (const hex of Object.values(all)) expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
    // The ramp must actually cover the range AND be strictly monotonic light →
    // deep (insertion order = the documented porcelain…ebony order), so a future
    // mis-ordered palette edit is caught rather than passing on the endpoints.
    const lums = Object.values(all).map(lum);
    for (let i = 1; i < lums.length; i++) expect(lums[i]).toBeLessThan(lums[i - 1]);
  });

  it('throws naming the option on an unknown tone', () => {
    expect(() => F.skin('beige2')).toThrow(/skin/);
  });
});

describe('figure head — face shape & jaw/chin/cheek axes', () => {
  const F = createFigureNamespace(api);
  const rig = buildRig({ height: 60, headsTall: 6 });
  const span = (n: SdfNode, ax: number): number => n.bounds().max[ax] - n.bounds().min[ax];

  it('default (no opts) is byte-identical to faceShape:oval at default knobs', () => {
    const bare = F.head(rig) as unknown as SdfNode;
    const oval = F.head(rig, { faceShape: 'oval', jaw: 1, chin: 1, cheek: 1 }) as unknown as SdfNode;
    const probes = [
      [0, -rig.r.head, rig.joints.head[2]],
      [rig.r.headX, 0, rig.joints.head[2]],
      [0, 0, rig.joints.head[2] - rig.r.headZ],
    ];
    for (const p of probes) {
      expect(oval.evaluate(p[0], p[1], p[2])).toBeCloseTo(bare.evaluate(p[0], p[1], p[2]), 9);
    }
  });

  it('a wider jaw widens the head laterally', () => {
    const narrow = F.head(rig, { jaw: 0.6 }) as unknown as SdfNode;
    const wide = F.head(rig, { jaw: 1.5 }) as unknown as SdfNode;
    expect(span(wide, 0)).toBeGreaterThan(span(narrow, 0));
  });

  it('a longer chin extends the head downward', () => {
    const shortChin = F.head(rig, { chin: 0.6 }) as unknown as SdfNode;
    const longChin = F.head(rig, { chin: 1.5 }) as unknown as SdfNode;
    expect(longChin.bounds().min[2]).toBeLessThan(shortChin.bounds().min[2]);
  });

  it('rejects unknown faceShape, out-of-range knobs, and unknown keys', () => {
    expect(() => F.head(rig, { faceShape: 'potato' })).toThrow(/faceShape/);
    expect(() => F.head(rig, { jaw: 9 })).toThrow(/jaw/);
    expect(() => F.head(rig, { wat: 1 })).toThrow();
  });
});

describe('figure nose & lips — variation axes', () => {
  const F = createFigureNamespace(api);
  const rig = buildRig({ height: 60, headsTall: 6 });
  const span = (n: SdfNode, ax: number): number => n.bounds().max[ax] - n.bounds().min[ax];

  it('the no-arg nose equals the explicit "straight" preset defaults', () => {
    const bare = F.face.nose(rig) as unknown as SdfNode;
    const def = F.face.nose(rig, { type: 'straight' }) as unknown as SdfNode;
    const p = rig.face.nose;
    const q: [number, number, number] = [p[0] + 0.3, p[1] - 0.4, p[2] - 0.6];
    expect(def.evaluate(p[0], p[1], p[2])).toBeCloseTo(bare.evaluate(p[0], p[1], p[2]), 9);
    expect(def.evaluate(q[0], q[1], q[2])).toBeCloseTo(bare.evaluate(q[0], q[1], q[2]), 9);
  });

  it('a wider, flared nose has a larger lateral extent than a narrow one', () => {
    const narrow = F.face.nose(rig, { width: 0.6, flare: 0 }) as unknown as SdfNode;
    const wide = F.face.nose(rig, { width: 2.0, flare: 1.2 }) as unknown as SdfNode;
    expect(span(wide, 0)).toBeGreaterThan(span(narrow, 0));
  });

  it('carves nostril cavities — the underside cavity is OUTSIDE the carved nose where the un-carved one is solid', () => {
    const fwd = rig.dir.headForward, up = rig.dir.headUp, right = rig.dir.headLeft;
    const anchor = rig.face.nose;
    const tipR = rig.r.head * 0.12;
    const withNostrils = F.face.nose(rig, { type: 'broad' }) as unknown as SdfNode;
    const without = F.face.nose(rig, { type: 'broad', nostrils: false }) as unknown as SdfNode;
    // Scan a small grid through the nose underside: at least one point must be
    // solid in the un-carved nose (sdf < 0) yet open in the carved one
    // (sdf > 0). Robust to tip projection / spread tuning — it asserts the
    // carve removed real material, not a hardcoded sample point.
    const at = (a: number, b: number, c: number): [number, number, number] => [
      anchor[0] + fwd[0] * a + up[0] * b + right[0] * c,
      anchor[1] + fwd[1] * a + up[1] * b + right[1] * c,
      anchor[2] + fwd[2] * a + up[2] * b + right[2] * c,
    ];
    let carved = 0;
    for (let a = 0; a <= tipR * 2.5; a += tipR * 0.25) {           // forward (projection)
      for (let b = -tipR * 2; b <= tipR * 0.5; b += tipR * 0.25) { // down the underside
        for (let c = -tipR * 1.6; c <= tipR * 1.6; c += tipR * 0.25) { // lateral
          const p = at(a, b, c);
          if (without.evaluate(...p) < 0 && withNostrils.evaluate(...p) > 0) carved++;
        }
      }
    }
    expect(carved).toBeGreaterThan(0);
  });

  it('presets give distinct silhouettes — bulbous tip is wider than pointed', () => {
    const pointed = F.face.nose(rig, { type: 'pointed' }) as unknown as SdfNode;
    const bulbous = F.face.nose(rig, { type: 'bulbous' }) as unknown as SdfNode;
    expect(span(bulbous, 0)).toBeGreaterThan(span(pointed, 0));
  });

  it('upturn raises the nose underside (snub) vs a hooked tip', () => {
    const snub = F.face.nose(rig, { upturn: 1, nostrils: false }) as unknown as SdfNode;
    const hooked = F.face.nose(rig, { upturn: -1, nostrils: false }) as unknown as SdfNode;
    // The hooked tip projects/drops further: lower minimum on the up axis.
    expect(hooked.bounds().min[2]).toBeLessThan(snub.bounds().min[2]);
  });

  it('fuller lips thicken the lip ridge', () => {
    const thin = F.face.mouth(rig, { style: 'lips', fullness: 0.5 }) as unknown as SdfNode;
    const full = F.face.mouth(rig, { style: 'lips', fullness: 2.0 }) as unknown as SdfNode;
    expect(span(full, 2)).toBeGreaterThan(span(thin, 2));
  });

  it('rejects out-of-range / unknown nose params and bad mouth fullness', () => {
    expect(() => F.face.nose(rig, { bridge: 5 })).toThrow(/bridge/);
    expect(() => F.face.nose(rig, { width: 9 })).toThrow(/width/);
    expect(() => F.face.nose(rig, { upturn: 3 })).toThrow(/upturn/);
    expect(() => F.face.nose(rig, { type: 'schnozz' })).toThrow(/type/);
    expect(() => F.face.nose(rig, { nostrils: 'yes' })).toThrow(/nostrils/);
    expect(() => F.face.nose(rig, { tipShape: 'banana' })).toThrow(/tipShape/);
    expect(() => F.face.nose(rig, { profile: 4 })).toThrow(/profile/);
    expect(() => F.face.nose(rig, { projection: 5 })).toThrow(/projection/);
    // `bump` is validated even when `profile` (which wins) is also passed.
    expect(() => F.face.nose(rig, { profile: 0.3, bump: 9 })).toThrow(/bump/);
    expect(() => F.face.mouth(rig, { style: 'lips', fullness: 9 })).toThrow(/fullness/);
  });
});

describe('figure nose — small-nose nostril auto-skip (#703)', () => {
  const F = createFigureNamespace(api);
  // A small head → small tip radius below the absolute nostril floor.
  const smallRig = buildRig({ height: 20, headsTall: 4 });
  const bigRig = buildRig({ height: 70, headsTall: 8 });

  // Sample the nose underside and count how many points the carve opened up
  // (solid in the `nostrils:false` reference, open in the candidate).
  const countCarved = (candidate: SdfNode, reference: SdfNode, rig: ReturnType<typeof buildRig>): number => {
    const fwd = rig.dir.headForward, up = rig.dir.headUp, right = rig.dir.headLeft;
    const anchor = rig.face.nose;
    const tipR = rig.r.head * 0.12;
    const at = (a: number, b: number, c: number): [number, number, number] => [
      anchor[0] + fwd[0] * a + up[0] * b + right[0] * c,
      anchor[1] + fwd[1] * a + up[1] * b + right[1] * c,
      anchor[2] + fwd[2] * a + up[2] * b + right[2] * c,
    ];
    let carved = 0;
    for (let a = 0; a <= tipR * 2.5; a += tipR * 0.2) {
      for (let b = -tipR * 2; b <= tipR * 0.5; b += tipR * 0.2) {
        for (let c = -tipR * 1.6; c <= tipR * 1.6; c += tipR * 0.2) {
          const p = at(a, b, c);
          if (reference.evaluate(...p) < 0 && candidate.evaluate(...p) > 0) carved++;
        }
      }
    }
    return carved;
  };

  it('a small/button nose skips the nostril carve by default (clean bulb, no torn crater)', () => {
    const button = F.face.nose(smallRig, { type: 'button' }) as unknown as SdfNode;
    const ref = F.face.nose(smallRig, { type: 'button', nostrils: false }) as unknown as SdfNode;
    // Default == the un-carved reference: nothing was carved.
    expect(countCarved(button, ref, smallRig)).toBe(0);
  });

  it('an explicit nostrils:true still carves a small nose (caller opts into the risk)', () => {
    const forced = F.face.nose(smallRig, { type: 'button', nostrils: true }) as unknown as SdfNode;
    const ref = F.face.nose(smallRig, { type: 'button', nostrils: false }) as unknown as SdfNode;
    expect(countCarved(forced, ref, smallRig)).toBeGreaterThan(0);
  });

  it('a normal-sized nose still carves nostrils by default (good faces unchanged)', () => {
    const def = F.face.nose(bigRig, {}) as unknown as SdfNode;
    const ref = F.face.nose(bigRig, { nostrils: false }) as unknown as SdfNode;
    expect(countCarved(def, ref, bigRig)).toBeGreaterThan(0);
  });
});

describe('figure faceDetail — chest areola detail (#703)', () => {
  const rig = buildRig({ height: 60, headsTall: 6 });

  it('adds two chest detail spheres over the areola anchors by default', () => {
    const regions = faceDetail(rig);
    const nearAnchor = (c: number[], a: number[]): boolean =>
      Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]) < 1e-6;
    const chestRegions = regions.filter((d) =>
      nearAnchor(d.center, rig.torso.nippleL) || nearAnchor(d.center, rig.torso.nippleR));
    expect(chestRegions.length).toBe(2);
    // Far finer than the global figure grid (0.4–0.6) so the disc rim meshes
    // round instead of slivering at the coarse torso cell.
    for (const c of chestRegions) expect(c.edgeLength).toBeLessThan(0.4);
  });

  it('chest:false drops the chest spheres; the head/mouth ordering is preserved', () => {
    const regions = faceDetail(rig, { chest: false });
    const onChest = regions.some((d) =>
      Math.hypot(d.center[0] - rig.torso.nippleL[0], d.center[1] - rig.torso.nippleL[1], d.center[2] - rig.torso.nippleL[2]) < 1e-6);
    expect(onChest).toBe(false);
    expect(regions[0].center).toEqual(rig.joints.head);
    expect(regions[1].center).toEqual(rig.face.mouth);
  });

  it('rejects unknown / bad chest keys', () => {
    expect(() => faceDetail(rig, { chest: 'yes' } as object)).toThrow(/chest/);
    expect(() => faceDetail(rig, { chestThickness: 1 } as object)).toThrow();
  });
});

describe('figure placeOnHead — seat headwear on the hair', () => {
  const F = createFigureNamespace(api);
  const rig = buildRig({ height: 60, headsTall: 6 });
  const hat = (): SdfNode => api.box([2, 2, 2]) as unknown as SdfNode;

  it('rests an accessory bottom on the hair TOP, centred on the head', () => {
    const hair = F.hair(rig, { style: 'short' }) as unknown as SdfNode;
    const hairTop = hair.bounds().max[2];
    const placed = F.placeOnHead(hat() as object, rig, { rest: hair }) as unknown as SdfNode;
    const b = placed.bounds();
    expect(b.min[2]).toBeCloseTo(hairTop, 5);                               // bottom on hair top
    expect((b.min[0] + b.max[0]) / 2).toBeCloseTo(rig.joints.head[0], 5);   // centred X
    expect((b.min[1] + b.max[1]) / 2).toBeCloseTo(rig.joints.head[1], 5);   // centred Y
  });

  it('embed sinks it into the hair; clearance lifts it off', () => {
    const hair = F.hair(rig, { style: 'short' }) as unknown as SdfNode;
    const top = hair.bounds().max[2];
    const sunk = F.placeOnHead(hat() as object, rig, { rest: hair, embed: 1 }) as unknown as SdfNode;
    const lifted = F.placeOnHead(hat() as object, rig, { rest: hair, clearance: 1 }) as unknown as SdfNode;
    expect(sunk.bounds().min[2]).toBeCloseTo(top - 1, 5);
    expect(lifted.bounds().min[2]).toBeCloseTo(top + 1, 5);
  });

  it('falls back to the crown joint without rest, and validates inputs', () => {
    const placed = F.placeOnHead(hat() as object, rig) as unknown as SdfNode;
    expect(placed.bounds().min[2]).toBeCloseTo(rig.joints.crown[2], 5);
    expect(() => F.placeOnHead(hat() as object, rig, { rest: 5 })).toThrow(/rest/);
    expect(() => F.placeOnHead(hat() as object, rig, { wig: true })).toThrow();
  });
});

describe('figure handDetail — detail-region helper', () => {
  const rig = buildRig({ height: 60, headsTall: 6 });

  it('returns one sphere per hand, centred on the hand joints, finer than the figure grid', () => {
    const [L, R] = handDetail(rig);
    expect(L.center).toEqual(rig.joints.handL);
    expect(R.center).toEqual(rig.joints.handR);
    expect(L.edgeLength).toBeLessThan(0.4);          // finer than the 0.4–0.6 figure grid
    expect(L.radius).toBeGreaterThan(rig.r.hand * 2); // covers the fingers
  });

  it('follows posed hands and honours overrides', () => {
    const posed = buildRig({ pose: { armL: { raiseSide: 150, bend: 40 } } });
    const [L] = handDetail(posed);
    expect(L.center).toEqual(posed.joints.handL);
    const [o] = handDetail(rig, { radius: 9, edgeLength: 0.11 });
    expect(o.radius).toBe(9);
    expect(o.edgeLength).toBe(0.11);
    expect(() => handDetail(rig, { density: 1 })).toThrow();
  });
});

describe('figure feet — flat sole and optional toes', () => {
  const rig = buildRig({ height: 60, headsTall: 6 });

  it('welds to both ankle joints (smooth and toed)', () => {
    for (const opts of [undefined, { toes: true }]) {
      const feet = buildFeet(api, rig, opts) as SdfNode;
      for (const side of ['L', 'R'] as const) {
        const A = rig.joints[`foot${side}`];
        expect(feet.evaluate(A[0], A[1], A[2])).toBeLessThan(0); // ankle inside the foot mass
      }
    }
  });

  it('has a flat sole: air just below the underside, solid skin above (smooth and toed)', () => {
    const s = rig.sole.L;
    for (const opts of [undefined, { toes: true }]) {
      const feet = buildFeet(api, rig, opts) as SdfNode;
      expect(feet.evaluate(s.point[0], s.point[1], s.groundZ + 0.02)).toBeGreaterThan(0); // below the flat sole
      expect(feet.evaluate(s.point[0], s.point[1], s.groundZ + rig.r.foot * 0.5)).toBeLessThan(0); // inside the foot
    }
  });

  it('keeps toes within the footprint envelope (footwear coverage stays valid)', () => {
    // Footwear sizes its coverage to the sole-frame footprint. The true toe-tip
    // surface must stay inside that envelope so a worn shoe still covers it.
    // bounds() is a loose conservative AABB here, so probe the real surface with
    // evaluate: well past the footprint toe (0.6·footLen forward of the centre,
    // at toe height) the bare foot must be AIR — a runaway toe would read solid.
    const s = rig.sole.L;
    const footLen = s.length;
    const toed = buildFeet(api, rig, { toes: true }) as SdfNode;
    const px = s.point[0] + s.heading[0] * footLen * 0.6;
    const py = s.point[1] + s.heading[1] * footLen * 0.6;
    expect(toed.evaluate(px, py, s.groundZ + rig.r.foot * 0.4)).toBeGreaterThan(0); // outside the envelope
    // …and the toes don't push the foot materially past the smooth toe box.
    const smooth = (buildFeet(api, rig) as SdfNode).bounds();
    expect(toed.bounds().min[1]).toBeGreaterThan(smooth.min[1] - rig.r.foot * 0.4);
  });

  it('rejects unknown keys and non-boolean toes', () => {
    expect(() => buildFeet(api, rig, { toe: true })).toThrow();      // typo'd key
    expect(() => buildFeet(api, rig, { toes: 'yes' })).toThrow(/toes/); // must be a boolean
    expect(() => buildFeet(api, rig, { toes: false })).not.toThrow();
  });

  it('foot length is a realistic stature proportion (≈0.15·height), long not stubby', () => {
    // Foot length is a SEGMENT length → scales with stature (like the limbs),
    // not head-unit girth. Anthropometric foot length ≈ 0.15·stature. The old
    // foot was r.foot·2.4 ≈ 0.08–0.10·stature — about half real and looked short.
    const r2 = buildRig({ height: 60, headsTall: 7.5 });
    expect(r2.sole.L.length).toBeCloseTo(r2.opts.height * 0.15, 5);
    expect(r2.sole.R.length).toBeCloseTo(r2.opts.height * 0.15, 5);
    // The foot reads as a real foot: clearly longer than it is wide.
    expect(r2.sole.L.length).toBeGreaterThan(r2.sole.L.width * 2.5);
  });
});

describe('figure footDetail — detail-region helper', () => {
  const rig = buildRig({ height: 60, headsTall: 6 });

  it('returns one sphere per foot over the forefoot, finer than the figure grid', () => {
    const [L, R] = footDetail(rig);
    expect(L.edgeLength).toBeLessThan(0.4);            // finer than the 0.4–0.6 figure grid
    expect(L.radius).toBeGreaterThan(rig.r.foot);      // covers the toe row
    expect(L.center[2]).toBeLessThan(rig.joints.footL[2]); // below the ankle, near the ground
    expect(R.center[2]).toBeLessThan(rig.joints.footR[2]);
    expect(L.center[0]).toBeCloseTo(-R.center[0], 5);  // symmetric L/R
  });

  it('honours overrides and rejects unknown keys', () => {
    const [o] = footDetail(rig, { radius: 7, edgeLength: 0.1 });
    expect(o.radius).toBe(7);
    expect(o.edgeLength).toBe(0.1);
    expect(() => footDetail(rig, { density: 1 })).toThrow();
  });
});

describe('figure faceDetail — detail-region helper', () => {
  const rig = buildRig({ height: 60, headsTall: 5 });

  it('returns a head sphere covering every face anchor plus a finer mouth sphere', () => {
    const [head, mouth] = faceDetail(rig);
    expect(head.center).toEqual(rig.joints.head);
    for (const a of Object.values(rig.face)) {
      const dist = Math.hypot(a[0] - head.center[0], a[1] - head.center[1], a[2] - head.center[2]);
      expect(dist).toBeLessThan(head.radius);
    }
    expect(mouth.center).toEqual(rig.face.mouth);
    expect(mouth.edgeLength).toBeLessThan(head.edgeLength);
    expect(mouth.radius).toBeLessThan(head.radius);
  });

  it('scales the target edges with head size and stays fine', () => {
    const [chibi] = faceDetail(buildRig({ height: 60, headsTall: 3 }));
    const [adult] = faceDetail(buildRig({ height: 60, headsTall: 8 }));
    expect(chibi.edgeLength).toBeGreaterThan(adult.edgeLength);
    expect(adult.edgeLength).toBeLessThan(adult.radius * 0.1);
  });

  it('adds nested eye detail spheres (eyelid + finer iris/pupil) so the eye meshes smoothly', () => {
    const regions = faceDetail(rig);
    const [head] = regions;
    // Two spheres PER eye (a medium eyelid/eyeball one + a finer iris/pupil one),
    // all finer than the head grid and near an eye anchor → four in total.
    const near = (c: number[], a: number[]): boolean =>
      Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]) < rig.r.head * 0.4;
    // The brow spheres also sit near the eye, but they're centred EXACTLY on the
    // brow anchors (the eye spheres are pushed forward off the eye anchor), so
    // exclude an exact brow-anchor match — this counts only the eyeball/iris pair.
    const isAt = (c: number[], a: number[]): boolean =>
      Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]) < 1e-6;
    const isBrow = (c: number[]): boolean => isAt(c, rig.face.browL) || isAt(c, rig.face.browR);
    const eyeRegions = regions.filter((d) => d.edgeLength < head.edgeLength && !isBrow(d.center)
      && (near(d.center, rig.face.eyeL) || near(d.center, rig.face.eyeR)));
    expect(eyeRegions.length).toBe(4);
    // All finer than the head grid; the finest (iris/pupil) is finer still.
    for (const e of eyeRegions) expect(e.edgeLength).toBeLessThanOrEqual(rig.r.head * 0.05 + 0.03);
    const finest = Math.min(...eyeRegions.map((e) => e.edgeLength));
    expect(finest).toBeLessThanOrEqual(rig.r.head * 0.02);
    expect(() => faceDetail(rig, { eyeEdgeLength: 0.03, irisEdgeLength: 0.015 })).not.toThrow();
  });
});

describe('figure rig — head tilt (was a silent no-op)', () => {
  // Regression: tilt was applied as `rotY(hf, tilt)` to the forward vector and
  // then discarded by the cross-product frame rebuild, so it did nothing. It is
  // now a roll of the up/left axes about the forward axis.
  it('rolls the head toward a shoulder — headUp leans laterally', () => {
    const neutral = buildRig({});
    const tilted = buildRig({ pose: { head: { roll: 20 } } });
    // Positive tilt drops the crown toward the figure's LEFT shoulder (+X).
    expect(neutral.dir.headUp[0]).toBeCloseTo(0, 6);
    expect(tilted.dir.headUp[0]).toBeGreaterThan(0.2);
    // It is a pure roll: the forward direction is unchanged.
    expect(dist(tilted.dir.headForward, neutral.dir.headForward)).toBeLessThan(1e-9);
  });

  it('moves the face anchors (eyes follow the roll)', () => {
    const neutral = buildRig({});
    const tilted = buildRig({ pose: { head: { roll: 20 } } });
    expect(dist(tilted.face.eyeL, neutral.face.eyeL)).toBeGreaterThan(0.1);
  });

  it('roll: 0 is byte-identical to no head pose', () => {
    const a = buildRig({});
    const b = buildRig({ pose: { head: { roll: 0 } } });
    expect(b.dir.headUp).toEqual(a.dir.headUp);
    expect(b.face.eyeL).toEqual(a.face.eyeL);
  });
});

describe('figure rig — spine (was parsed but never applied)', () => {
  // Regression: spine.{lean,turn,side} were validated and stored but no FK ever
  // read them. They now rigidly rotate the above-waist mass about the navel.
  const neutral = buildRig({});

  it('lean bends the upper body forward (−Y) at the waist', () => {
    const leaned = buildRig({ pose: { spine: { lean: 25 } } });
    expect(leaned.joints.chest[1]).toBeLessThan(neutral.joints.chest[1] - 0.5);
    expect(leaned.joints.head[1]).toBeLessThan(neutral.joints.head[1] - 1);
    // legs stay planted — the figure bends at the waist, not the ankles.
    expect(leaned.joints.footL).toEqual(neutral.joints.footL);
    expect(leaned.joints.hips).toEqual(neutral.joints.hips);
  });

  it('side leans toward the figure-left shoulder (+X); turn twists the shoulders', () => {
    const sided = buildRig({ pose: { spine: { side: 25 } } });
    expect(sided.joints.head[0]).toBeGreaterThan(neutral.joints.head[0] + 0.5);
    const turned = buildRig({ pose: { spine: { turn: 30 } } });
    // the shoulder line rotates about Z — shoulders are no longer purely ±X.
    expect(Math.abs(turned.joints.upperArmL[1])).toBeGreaterThan(0.5);
  });

  it('is a rigid rotation: arms ride the spine but keep their bone lengths', () => {
    const leaned = buildRig({ pose: { spine: { lean: 25 }, armL: { raiseSide: 40, bend: 60 } } });
    const upright = buildRig({ pose: { armL: { raiseSide: 40, bend: 60 } } });
    // the whole arm moved with the torso…
    expect(dist(leaned.joints.handL, upright.joints.handL)).toBeGreaterThan(0.5);
    // …but the upper-arm bone length is preserved (rigid, still attached).
    const boneLen = (rig: typeof leaned) => dist(rig.joints.upperArmL, rig.joints.lowerArmL);
    expect(boneLen(leaned)).toBeCloseTo(boneLen(upright), 5);
  });

  it('zero spine is byte-identical to no spine (every existing pose unchanged)', () => {
    const z = buildRig({ pose: { spine: { lean: 0, turn: 0, side: 0 } } });
    for (const j of ['chest', 'head', 'upperArmL', 'handR', 'crown'] as const) {
      expect(z.joints[j]).toEqual(neutral.joints[j]);
    }
    expect(z.dir.headForward).toEqual(neutral.dir.headForward);
  });
});

describe('figure eyes — protrusion floor', () => {
  it('floors the eyeball push at ~2 face-detail cells so labels never bury', () => {
    // Regression: a `rad * 0.28` push was ~1 march cell and shrank to 0 on many
    // figures, collapsing the eye/iris/pupil labels. Now floored at r.head*0.09.
    const rig = buildRig({ height: 60, headsTall: 6 });
    const rad = rig.r.head * 0.16;            // the default eyes radius
    const solid = buildEyes(api, rig, { style: 'solid' }) as SdfNode;
    // forward (−Y) reach of the eyeball front past the eye anchor plane.
    const reach = -solid.bounds().min[1];
    expect(reach).toBeGreaterThan(-rig.face.eyeL[1] + rig.r.head * 0.09 + rad - 1e-6);
  });
});

describe('figure face.assemble — eyes default OFF', () => {
  const F = createFigureNamespace(api);
  const rig = buildRig({ height: 60, headsTall: 5 });
  const labelsOf = (node: unknown): string[] =>
    [...new Set(partitionByLabel(node as SdfNode).map(p => p.labelName).filter((n): n is string => !!n))].sort();

  it('omits eyes by default (so a later .label("skin") cannot flatten them)', () => {
    const face = F.face.assemble(F.head(rig), rig);
    expect(labelsOf(face)).not.toContain('iris');
    expect(labelsOf(face)).not.toContain('pupil');
  });

  it('eyes: true opts the in-face eyes back in', () => {
    const face = F.face.assemble(F.head(rig), rig, { eyes: true });
    expect(labelsOf(face)).toEqual(expect.arrayContaining(['eyes', 'iris', 'pupil']));
  });
});

describe('figure brows — validated options (were silently ignored)', () => {
  const F = createFigureNamespace(api);
  const rig = buildRig({});
  it('accepts thickness / lift and rejects unknown keys', () => {
    expect(() => F.face.brows(rig, { thickness: 2, lift: 1.5 })).not.toThrow();
    expect(() => F.face.brows(rig, { bogus: 1 })).toThrow();
  });
  it('thickness actually changes the ridge (no longer a no-op payload)', () => {
    const thin = (F.face.brows(rig, { thickness: 1 }) as SdfNode).bounds();
    const thick = (F.face.brows(rig, { thickness: 3 }) as SdfNode).bounds();
    // a heavier ridge has a larger bbox than a slim one.
    const span = (b: { min: number[]; max: number[] }) => b.max[2] - b.min[2];
    expect(span(thick)).toBeGreaterThan(span(thin));
  });
});

describe('figure hair — bald does not poison bounds()', () => {
  it('bald returns an empty node bounded at the head, not at z ≈ −1e6', () => {
    // Regression: bald returned sphere(1e-3) parked at z=−1e6, which broke
    // bounds()/placeAt (snapped a million units down).
    const rig = buildRig({ height: 60 });
    const b = (buildHair(api, rig, { style: 'bald' }) as SdfNode).bounds();
    const cz = (b.min[2] + b.max[2]) / 2;
    expect(cz).toBeCloseTo(rig.joints.head[2], 2);
    expect(cz).toBeGreaterThan(0);
  });
});

describe('figure rig — validation', () => {
  it('rejects unknown top-level keys', () => {
    expect(() => buildRig({ heigth: 60 })).toThrow();
  });
  it('rejects an unknown build preset', () => {
    expect(() => buildRig({ build: 'huge' })).toThrow(/build/);
  });
  it('rejects out-of-range headsTall', () => {
    expect(() => buildRig({ headsTall: 1 })).toThrow();
    expect(() => buildRig({ headsTall: 20 })).toThrow();
  });
  it('rejects unknown pose joint keys', () => {
    expect(() => buildRig({ pose: { armL: { flap: 90 } } })).toThrow();
    expect(() => buildRig({ pose: { wings: {} } })).toThrow();
  });
  it('accepts an empty / omitted opts object', () => {
    expect(() => buildRig(undefined)).not.toThrow();
    expect(() => buildRig({})).not.toThrow();
  });
});

describe('figure grip frames — connecting held props to the palm', () => {
  const unit = (v: number[]) => Math.hypot(v[0], v[1], v[2]);
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  it('exposes a grip frame per hand with orthonormal-ish axes', () => {
    const rig = buildRig({ height: 64 });
    for (const g of [rig.grip.L, rig.grip.R]) {
      expect(g.point).toHaveLength(3);
      // Axes are unit length.
      expect(unit(g.palmNormal)).toBeCloseTo(1, 6);
      expect(unit(g.gripAxis)).toBeCloseTo(1, 6);
      expect(unit(g.reach)).toBeCloseTo(1, 6);
      // palmNormal ⟂ gripAxis and ⟂ reach (it's their cross product).
      expect(dot(g.palmNormal, g.gripAxis)).toBeCloseTo(0, 5);
      expect(dot(g.palmNormal, g.reach)).toBeCloseTo(0, 5);
    }
  });

  it('offsets the grip point off the hand centre toward the palm', () => {
    const rig = buildRig({ height: 64 });
    // The cup is NOT the hand centre — that's the whole point (props seated at
    // the centre pass through the hand). It sits along +palmNormal from handL.
    const offL = [
      rig.grip.L.point[0] - rig.joints.handL[0],
      rig.grip.L.point[1] - rig.joints.handL[1],
      rig.grip.L.point[2] - rig.joints.handL[2],
    ];
    const offLen = unit(offL);
    expect(offLen).toBeGreaterThan(0.2);
    // The offset points purely along +palmNormal.
    expect(dot(offL.map((c) => c / offLen), rig.grip.L.palmNormal)).toBeCloseTo(1, 4);
  });

  it('tracks the pose — raising the arm moves the grip with the hand', () => {
    const down = buildRig({ height: 64, pose: { armL: { raiseSide: 0 } } });
    const up = buildRig({ height: 64, pose: { armL: { raiseSide: 150 } } });
    expect(up.grip.L.point[2]).toBeGreaterThan(down.grip.L.point[2]);
  });

  it('spine bend transforms the grip frame with the upper body', () => {
    const straight = buildRig({ height: 64 });
    const leaned = buildRig({ height: 64, pose: { spine: { lean: 30 } } });
    // The grip frame rides the spine rotation: both its point and its axes move.
    const movedPoint = dist(leaned.grip.L.point, straight.grip.L.point);
    expect(movedPoint).toBeGreaterThan(1);
    const axisDot = dot(leaned.grip.L.gripAxis, straight.grip.L.gripAxis);
    expect(axisDot).toBeLessThan(0.999); // the grip axis rotated, not identical
  });
});

describe('figure holdAt — orient + seat a prop into a grip', () => {
  const F = createFigureNamespace(api);

  it('aligns the prop long axis to the grip axis and seats it at the point', () => {
    // A capsule along local +Z, centred at the origin, length 6, radius 0.5.
    const bar = api.capsule([0, 0, -3], [0, 0, 3], 0.5);
    const grip = { point: [10, 2, 5], palmNormal: [0, 0, 1], gripAxis: [1, 0, 0], reach: [0, 1, 0] };
    const held = (F.holdAt(bar as unknown as SdfNode, grip as never) as SdfNode).bounds();
    // Long axis is now world X (extent = length 6 + 2×radius = 7); the other two
    // are the diameter (≈1).
    expect(held.max[0] - held.min[0]).toBeCloseTo(7, 4);
    expect(held.max[1] - held.min[1]).toBeCloseTo(1, 4);
    expect(held.max[2] - held.min[2]).toBeCloseTo(1, 4);
    // Centred on the grip point.
    expect((held.min[0] + held.max[0]) / 2).toBeCloseTo(10, 4);
    expect((held.min[1] + held.max[1]) / 2).toBeCloseTo(2, 4);
    expect((held.min[2] + held.max[2]) / 2).toBeCloseTo(5, 4);
  });

  it('honours along: a +X-axis prop aligns the same way', () => {
    const bar = api.capsule([-3, 0, 0], [3, 0, 0], 0.5);  // along local +X
    const grip = { point: [0, 0, 0], palmNormal: [1, 0, 0], gripAxis: [0, 0, 1], reach: [0, 1, 0] };
    const held = (F.holdAt(bar as unknown as SdfNode, grip as never, { along: 'x' }) as SdfNode).bounds();
    // gripAxis is world +Z, so the long extent (6 + 2×radius = 7) is now Z.
    expect(held.max[2] - held.min[2]).toBeCloseTo(7, 4);
    expect(held.max[0] - held.min[0]).toBeCloseTo(1, 4);
  });

  it('rejects unknown opts and non-boolean flip', () => {
    const bar = api.capsule([0, 0, -1], [0, 0, 1], 0.5);
    const grip = { point: [0, 0, 0], palmNormal: [0, 0, 1], gripAxis: [1, 0, 0], reach: [0, 1, 0] };
    expect(() => F.holdAt(bar as unknown as SdfNode, grip as never, { roll: 5 } as never)).toThrow();
    expect(() => F.holdAt(bar as unknown as SdfNode, grip as never, { flip: 'yes' } as never)).toThrow();
  });
});

describe('figure spanGrips — the two-anchor (two-hand prop) frame', () => {
  const F = createFigureNamespace(api);

  it('returns endpoints, unit axis, length, and midpoint between two grips', () => {
    const a = { point: [0, 0, 0], palmNormal: [0, 0, 1], gripAxis: [1, 0, 0], reach: [0, 1, 0] };
    const b = { point: [6, 0, 8], palmNormal: [0, 0, 1], gripAxis: [1, 0, 0], reach: [0, 1, 0] };
    const s = F.spanGrips(a as never, b as never);
    expect(s.a).toEqual([0, 0, 0]);
    expect(s.b).toEqual([6, 0, 8]);
    expect(s.length).toBeCloseTo(10, 6);           // 6-8-10 triangle
    expect(s.axis[0]).toBeCloseTo(0.6, 6);
    expect(s.axis[2]).toBeCloseTo(0.8, 6);
    expect(Math.hypot(...s.axis)).toBeCloseTo(1, 6); // unit
    expect(s.mid).toEqual([3, 0, 4]);
  });

  it('accepts raw [x,y,z] points on either side (joint ↔ grip)', () => {
    const grip = { point: [10, 0, 0], palmNormal: [0, 0, 1], gripAxis: [1, 0, 0], reach: [0, 1, 0] };
    const s = F.spanGrips([0, 0, 0] as never, grip as never);
    expect(s.b).toEqual([10, 0, 0]);
    expect(s.length).toBeCloseTo(10, 6);
    expect(s.axis).toEqual([1, 0, 0]);
  });

  it('a real rig spans hand-to-hand and the axis points L→R', () => {
    const rig = buildRig({ height: 64 });
    const s = F.spanGrips(rig.grip.L, rig.grip.R);
    expect(s.length).toBeGreaterThan(0);
    // L is +X side, R is −X side, so the span axis runs in −X.
    expect(s.axis[0]).toBeLessThan(0);
    // The capsule a/b end exactly on the two grip cups.
    expect(s.a).toEqual(rig.grip.L.point);
    expect(s.b).toEqual(rig.grip.R.point);
  });

  it('degenerate span (a == b) yields a safe unit axis, not NaN', () => {
    const s = F.spanGrips([1, 2, 3] as never, [1, 2, 3] as never);
    expect(s.length).toBe(0);
    expect(s.axis).toEqual([0, 0, 1]);
    expect(s.mid).toEqual([1, 2, 3]);
  });
});

describe('figure poseProbe — deterministic joint/grip dump', () => {
  const F = createFigureNamespace(api);

  it('reports rig opts, every joint, both grips, and a text summary', () => {
    const rig = buildRig({ height: 64, headsTall: 7, build: 'slim' });
    const p = F.poseProbe(rig);
    expect(p.height).toBe(64);
    expect(p.headsTall).toBe(7);
    expect(p.build).toBe('slim');
    // Every joint in the rig is present in the probe.
    expect(Object.keys(p.joints).sort()).toEqual(Object.keys(rig.joints).sort());
    // Grips carry the four frame vectors.
    expect(p.grips.L.point).toHaveLength(3);
    expect(p.grips.R.gripAxis).toHaveLength(3);
    // Values are rounded to 2 decimals (no long floats in the readout).
    for (const k of Object.keys(p.joints)) {
      for (const c of p.joints[k]) expect(Math.round(c * 100) / 100).toBe(c);
    }
    // The text summary names the joints and grips.
    expect(p.text).toContain('poseProbe');
    expect(p.text).toContain('handL');
    expect(p.text).toContain('grips:');
  });

  it('tracks the pose: a leaned spine moves the probed grip point', () => {
    const straight = F.poseProbe(buildRig({ height: 64 }));
    const leaned = F.poseProbe(buildRig({ height: 64, pose: { spine: { lean: 30 } } }));
    expect(leaned.grips.L.point).not.toEqual(straight.grips.L.point);
  });
});
