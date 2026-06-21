// Standing adult figure wearing a CUIRASS (breastplate) over a short-sleeve shirt.
// Front = −Y, Z up, figure's left = +X.
//
// LAYERING STRATEGY — Worn conformal shell:
//   1. Skin (torso/neck/arms/legs/feet/head/face).
//   2. Under-shirt: F.clothing.top, sleeve 'short', thickness t_shirt.
//   3. Cuirass: inflate bare torso by t_cuirass (> t_shirt), clip to chest→waist
//      band AND to a lateral width narrower than the arm's outer edge, so shirt
//      sleeves are visible at the sides. Front/back plates fuse into one piece.
//   4. Pauldrons: spheres at shoulder joints, sized to sit over the shirt.
//   5. All union'd into one solid.

const { sdf } = api;
const F = sdf.figure;

// ── 1. RIG ───────────────────────────────────────────────────────────────────
const rig = F.ground(F.rig({
  height: 66,
  headsTall: 6,
  build: 'average',
  muscle: 0.4,
  pose: {
    armL: { raiseSide: 12, bend: 8 },
    armR: { raiseSide: 12, bend: 8 },
    legL: { raiseSide: 5 },
    legR: { raiseSide: 5 },
    head: { pitch: -2 },
  },
}), { mode: 'plant' });
const j = rig.joints, r = rig.r;

// ── 2. HEAD + FACE + EYES ────────────────────────────────────────────────────
const head = F.head(rig);
const face = F.face.assemble(head, rig, {
  eyes:  false,
  nose:  { tipRadius: r.head * 0.09 },
  mouth: { style: 'lips', width: r.head * 0.34 },
  ears:  { size: r.head * 0.21 },
  brows: {},
});
const eyes = F.face.eyes(rig, { radius: r.head * 0.14, lids: 'upper' });

// ── 3. SKIN ───────────────────────────────────────────────────────────────────
const skin = F.weld(rig, [
  F.torso(rig), F.neck(rig), F.arms(rig), F.hands(rig),
  F.legs(rig), F.feet(rig), face,
]).label('skin');

// ── 4. UNDER-SHIRT ────────────────────────────────────────────────────────────
const shirtThickness = r.chestX * 0.12;
const shirt = F.clothing.top(rig, {
  sleeve: 'short',
  thickness: shirtThickness,
}).label('shirt');

// ── 5. PANTS ──────────────────────────────────────────────────────────────────
const pants = F.clothing.pants(rig, { leg: 'slim', rise: 'mid' }).label('pants');

// ── 6. CUIRASS ────────────────────────────────────────────────────────────────
// The cuirass is a conformal shell built from the bare torso SDF.
// Inflate by t_cuirass (which clears the shirt on all sides), then clip to the
// chest→waist zone. Lateral clip removes the side "wings" so shirt sleeves show.
//
// t_cuirass must be > t_shirt to always clear it. Keep it a tight hard plate
// (not a fat pillow) — just enough over the shirt to read as a separate shell.
const t_cuirass = shirtThickness + r.chestX * 0.09;

// Bare torso node — the conforming surface we inflate from.
const torsoNode = F.torso(rig);

// Inflated armor surface.
const armorMass = torsoNode.round(t_cuirass);

// ── Vertical clip ──────────────────────────────────────────────────────────
// Top = just below the neck ring (collar visible above armor),
// Bottom = at the waist — the fauld line.
const armorTopZ    = j.upperArmL[2] - r.upperArm * 0.05;  // ~shoulder height
const armorBottomZ = j.spine[2] + r.chestY * 0.10;        // at the waist

// ── Lateral clip — narrower than the shoulders so the sleeves show ──────────
const armorHalfX = r.chestX * 1.02 + t_cuirass * 0.5;

const armorH = armorTopZ - armorBottomZ;
const bigD = (r.chestY + t_cuirass) * 4;  // depth: full front+back wrap

const armorZone = sdf.box([armorHalfX * 2, bigD * 2, armorH])
  .translate([0, 0, armorBottomZ + armorH / 2]);

// HARD intersect → crisp horizontal collar line at the top and a defined fauld
// edge at the waist (the soft smoothIntersect is what made it read as a pillow).
const armorPlate = armorMass.intersect(armorZone);

// ── Breastplate keel — a raised centre ridge down the chest ─────────────────
// A vertical half-buried rounded bar gives the flat plate a forged 3-D ridge so
// it reads as a breastplate, not an inflated torso. Sits on the front surface.
const frontY = -(r.chestY + t_cuirass);
const ridge = sdf.capsule(
  [0, frontY * 0.90, armorTopZ - r.chestY * 0.30],
  [0, frontY * 0.90, armorBottomZ + r.chestY * 0.15],
  r.chestX * 0.20,
).intersect(armorZone);

// ── Peascod point — the breastplate's forward point at the waist centre, the
// silhouette cue that most reads "plate cuirass" rather than "vest". ──────────
const peascod = sdf.sphere(r.chestX * 0.42)
  .translate([0, frontY * 0.82, armorBottomZ + r.chestY * 0.05]);

// ── Neckline scoop — expose the shirt collar at the front top ───────────────
const necklineZ = armorTopZ - r.chestY * 0.12;
const necklineY = frontY * 0.6;
const necklineSphere = sdf.sphere(r.neck * 1.7).translate([0, necklineY, necklineZ]);

// ── Fauld rim — a short flared band at the bottom edge for a finished waist ──
const fauldBand = torsoNode.round(t_cuirass + r.chestX * 0.06)
  .intersect(sdf.box([armorHalfX * 2.4, bigD * 2, r.chestY * 0.5])
    .translate([0, 0, armorBottomZ + r.chestY * 0.1]));

const armorBody = armorPlate.union(ridge).smoothUnion(peascod, r.chestX * 0.25).union(fauldBand)
  .smoothSubtract(necklineSphere, r.neck * 0.4);

// ── 7. PAULDRONS — layered shoulder lames (distinct caps, not blobs) ─────────
// Two stacked flattened ellipsoids per shoulder (a big upper lame + a smaller
// lower lame) read as articulated plate, hard-unioned so the step stays crisp.
const pR = r.upperArm * 1.35 + shirtThickness;
const pauldron = (cx, cy, cz) => {
  // A bold domed cap over the shoulder + a smaller lame stepping down the arm,
  // so it reads as distinct articulated plate rather than a soft shoulder.
  const top = sdf.ellipsoid(pR * 1.25, pR * 1.05, pR * 0.7).translate([cx, cy, cz]);
  const low = sdf.ellipsoid(pR * 1.0, pR * 0.82, pR * 0.5)
    .translate([cx * 1.10, cy, cz - pR * 0.7]);
  return top.union(low);
};
const pauldronL = pauldron(j.upperArmL[0] * 1.06, j.upperArmL[1], j.upperArmL[2] + r.upperArm * 0.45);
const pauldronR_ = pauldron(j.upperArmR[0] * 1.06, j.upperArmR[1], j.upperArmR[2] + r.upperArm * 0.45);

// Fuse pauldrons in with a small k so the cap-to-plate seam stays defined.
const armorFull = armorBody
  .smoothUnion(pauldronL, r.upperArm * 0.18)
  .smoothUnion(pauldronR_, r.upperArm * 0.18)
  .label('armor');

// ── 8. BASE ──────────────────────────────────────────────────────────────────
const base = F.base(rig).label('base');

// ── 9. ASSEMBLY ──────────────────────────────────────────────────────────────
// The armor overlaps the shirt/body by construction → one solid piece.
return sdf.union(skin, eyes, pants, shirt, armorFull, base)
  .build({ edgeLength: 0.4, detail: [...F.faceDetail(rig), ...F.handDetail(rig)] });
