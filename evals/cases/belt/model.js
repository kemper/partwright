// Standing figure wearing pants with a belt (Ringed attachment mode) + buckle.
// Front = −Y, Z up, figure's left = +X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — relaxed standing
const rig = F.ground(F.rig({
  height: 64,
  headsTall: 6,
  build: 'average',
  pose: {
    armL: { raiseSide: 10, bend: 12 },
    armR: { raiseSide: 10, bend: 12 },
    legL: { raiseSide: 4 },
    legR: { raiseSide: 4 },
    head: { pitch: -2 },
  },
}), { mode: 'plant' });
const j = rig.joints, r = rig.r;

// 2. HEAD + FACE
const head = F.head(rig);
const face = F.face.assemble(head, rig, {
  eyes:  false,
  nose:  { tipRadius: r.head * 0.09 },
  mouth: { style: 'smile', width: r.head * 0.36 },
  ears:  { size: r.head * 0.21 },
  brows: {},
});
const eyes = F.face.eyes(rig, { radius: r.head * 0.15, lids: 'upper' });

// 3. SKIN
const skin = F.weld(rig, [
  F.torso(rig), F.neck(rig), F.arms(rig), F.hands(rig),
  F.legs(rig), F.feet(rig), face,
]).label('skin');

// 4. CLOTHES — pants + short-sleeve top
const pants = F.clothing.pants(rig, { leg: 'slim', rise: 'mid' }).label('pants');
const shirt = F.clothing.top(rig, { sleeve: 'short' }).label('shirt');

// 5. BELT — closed elliptical band around the waist, sitting OVER the pants.
// The pants thickness is r.upperLeg * 0.3 outward; we add another clearance to
// sit the belt band cleanly over the pants without sinking into them.
const pantsThickness = r.upperLeg * 0.3;
const beltTube = r.waist * 0.16;
// Clearance measured from the body surface. Pants add ~pantsThickness outward,
// then we need the tube to be FULLY outside → clearance = pantsThickness + beltTube + small margin.
const beltClearance = pantsThickness + beltTube * 0.5 + 0.6;

const beltFrame = rig.ring.waist;
const belt = F.ring(beltFrame, {
  tube: beltTube,
  clearance: beltClearance,
  segments: 64,
  drop: 0,
}).label('belt');

// 6. BUCKLE — a rounded rectangular plate at the front (az=0 = −Y direction).
// Generously sized so it reads clearly at figurine scale.
const buckleW = beltTube * 3.0;   // width (lateral X)
const buckleH = beltTube * 2.6;   // height (vertical Z) — taller than the band
const buckleD = beltTube * 2.0;   // depth (forward, −Y) — protrudes clearly

// ringPoint az=0 gives the front-centre of the band at the correct clearance.
const fp = F.ringPoint(beltFrame, 0, { clearance: beltClearance });
// Centre the buckle on the band line so its BACK half overlaps the tube (fuses)
// and its FRONT half stands proud of the band.
const buckleCenter = [fp[0], fp[1], fp[2]];

const buckle = sdf.roundedBox([buckleW, buckleD, buckleH], beltTube * 0.28)
  .translate(buckleCenter)
  .label('belt'); // same label as belt so they paint together

// 7. HAIR + BASE
const hair = F.hair(rig, { style: 'short' }).label('hair');
const base = F.base(rig).label('base');

// 8. ASSEMBLE — everything union'd into one solid
return sdf.union(skin, eyes, pants, shirt, belt, buckle, hair, base)
  .build({ edgeLength: 0.42, detail: [...F.faceDetail(rig), ...F.handDetail(rig)] });
