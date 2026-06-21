// Kneeling Gardener — a middle-aged gardener down on one knee, planting with a
// trowel, wearing a wide flat-brimmed sun hat, looking down at the soil.
// ~7 heads tall, average build, age 50. Front = −Y, Z up, figure's left = +X.
//
// SHOWCASE: a kneel built within the rig's fixed-hip skeleton — the right knee
// rests on a raised SOIL MOUND (the base rises to meet it) while the left foot
// plants forward, so the whole figure + soil prints as ONE piece. Plus
// F.placeOnHead (wide sun hat embedded into the hair) and a hand trowel welded
// into the right fist.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — kneeling. Right leg: thigh forward-down, shin folded back so the knee
// drops onto the soil. Left leg: planted foot forward. Both arms reach down to
// the soil — right with the trowel, left resting near the forward knee. Head
// nodded down at the planting.
const rig = F.rig({
  height: 58,
  headsTall: 7,
  build: 'average',
  age: 50,
  weight: 0.55,
  muscle: 0.2,
  pose: {
    // Right (kneeling) leg: knee forward-down, shin folded back onto the soil.
    legR: { raiseFwd: 40, bend: 135 },
    // Left (planted) leg: foot planted forward, knee up.
    legL: { raiseFwd: 45, bend: 60 },
    // Right arm: reaching down-forward with the trowel.
    armR: { raiseFwd: 45, bend: 40, twist: 0 },
    // Left arm: resting forward over the planted knee.
    armL: { raiseFwd: 30, bend: 90 },
    // Head down, nodded toward the soil.
    head: { pitch: 25 },
    // Gentle forward lean over the work.
    spine: { lean: 12 },
  },
});
const j = rig.joints, r = rig.r;

// 2. HEAD + FACE — round face, broad low-bridge nose, ears, soft upper lids with
// a downward gaze, a gentle natural smile.
const head = F.head(rig, { faceShape: 'round' });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { type: 'broad', tipRadius: r.head * 0.11 },
  mouth: { style: 'lips', lipShape: 'natural', expression: 'slightSmile', width: r.head * 0.34 },
  ears: true,
  brows: {},
});
// Upper lids, irises cast DOWN to the soil (on top of the nodded-down head).
const eyes = F.face.eyes(rig, { radius: r.head * 0.15, lids: 'upper', gaze: 'down' });

// 3. SKIN — fist grip: the right hand grips the trowel; the trowel welds in via
// its bridge regardless of the shared grip.
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'fist' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. CLOTHES — long-sleeve shirt under bib overalls (high rise).
const shirt = F.clothing.top(rig, {
  sleeve: 'long',
  thickness: r.chestY * 0.20,
}).label('shirt');
const overalls = F.clothing.pants(rig, {
  rise: 'high',
  thickness: r.upperLeg * 0.24,
}).label('overalls');

// 5. BOOTS — owns its 'boots' upper + 'sole' regions.
const boots = F.clothing.boots(rig, { label: 'boots' });

// 6. HAIR — short gray, high hairline.
const hair = F.hair(rig, { style: 'short', hairline: 'high' }).label('hair');

// 7. SUN HAT — a broad thin flat brim disc + a low rounded crown, built centred
// on the ORIGIN, then seated ON the hair and embedded so it welds to one piece.
const brimR = r.head * 2.0;
const brimH = r.head * 0.12;
const brim = sdf.cylinder(brimR, brimH).translate([0, 0, brimH / 2]);
// Low crown: a short wide dome cap above the brim.
const crownR = r.head * 1.05;
const crownH = r.head * 0.9;
const crown = sdf.cylinder(crownR, crownH).taper(-0.5 / crownH, 'z')
  .translate([0, 0, brimH * 0.5 + crownH / 2]);
const hatLocal = brim.smoothUnion(crown, r.head * 0.25);
const hat = F.placeOnHead(hatLocal, rig, { rest: hair, embed: r.head * 0.3 }).label('hat');

// 8. BASE — a soil bed. A wide low ground slab to the planted foot, PLUS a mound
// rising under the kneeling knee/shin so the knee rests on the soil and the whole
// figure stays ONE component.
const lowFoot = Math.min(rig.sole.L.groundZ, rig.sole.R.groundZ);  // planted foot
const slabTop = lowFoot + r.foot * 0.4;
const slabCy = (j.footL[1] + j.footR[1]) * 0.4;
const slab = sdf.roundedCylinder(rig.opts.height * 0.34, slabTop, 0.6)
  .translate([0, slabCy, slabTop / 2]);
// Mound under the kneeling knee + tucked foot.
const kneeR = j.lowerLegR, footR = j.footR;
const moundTop = Math.max(kneeR[2], footR[2]) - r.lowerLeg * 0.4;
const mound = sdf.roundedCylinder(r.foot * 3.2, moundTop, 0.5)
  .translate([(kneeR[0] + footR[0]) / 2, (kneeR[1] + footR[1]) / 2, moundTop / 2]);
const base = slab.smoothUnion(mound, r.foot * 1.2).label('base');

// 9. TROWEL — a short handle + a flat pointed blade, held in the RIGHT fist.
// The right arm reaches down-forward; its gripAxis is roughly horizontal, so the
// trowel is built along local +Z and F.holdAt aligns + seats it in the fist.
const handleLen = r.hand * 2.6;
const handleR = r.hand * 0.42;
const handle = sdf.capsule([0, 0, -handleLen], [0, 0, 0], handleR);
// Flat pointed scoop blade past the handle's far (−Z) end.
const bladeLen = r.hand * 3.4;
const bladeW = r.hand * 1.7;
const bladeT = r.hand * 0.5;
let blade = sdf.box([bladeW, bladeT, bladeLen])
  .taper(-0.9 / bladeLen, 'z')                       // taper to a point at −Z
  .translate([0, 0, -handleLen - bladeLen / 2]);
// Curl the blade into a shallow scoop and a ferrule joining handle↔blade.
const ferrule = sdf.capsule([0, 0, -handleLen - handleR], [0, 0, -handleLen + handleR], handleR * 1.2);
const trowelLocal = handle.union(ferrule).smoothUnion(blade, handleR * 0.6);
let held = F.holdAt(trowelLocal, rig.grip.R);
// Weld bridge from the hand centre to the grip cup so the trowel fuses to the fist.
const bridge = sdf.capsule(j.handR, rig.grip.R.point, r.hand * 0.55);
const trowel = held.smoothUnion(bridge, r.hand * 0.45).label('trowel');

// 10. Union + build.
return sdf.union(skin, eyes, shirt, overalls, boots, hair, hat, trowel, base)
  .build({ edgeLength: 0.7, detail: [...F.faceDetail(rig), ...F.handDetail(rig)] });
