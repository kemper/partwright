// Elderly Gardener — older woman kneeling to tend a potted plant.
// Showcases: age:66, sex:'female', old-age axis (hooded eyelids, long face),
// kneeling one-knee pose, gaze:'down', sun hat via F.placeOnHead,
// cardigan + pants, small potted-plant prop on the base.
//
// Paint regions: skin, lids, cardigan, pants, hair, hat, pot, plant, base
// Eyes self-label: eyes, iris, pupil

const { sdf } = api;
const F = sdf.figure;

// 1. RIG — elderly woman: age:66, sex:'female', height:50, headsTall:7.2
// Kneeling pose: right knee down, left foot forward.
// armR: reaching forward-down (raiseFwd:78, bend:75) — hand drops to ~knee level
// armL: resting on left knee (raiseSide:22, raiseFwd:15, bend:85)
// legR: kneeling — thigh forward (raiseFwd:60), shin well back (bend:115)
// legL: foot planted forward — partial squat (raiseFwd:28, bend:80)
// spine.lean:28 — forward lean while tending
// head.pitch:22 — looking down at the plant
const rig = F.rig({
  height: 50,
  headsTall: 7.2,
  sex: 'female',
  age: 66,
  build: 'average',
  weight: 0.55,
  pose: {
    // Right arm: swings forward and down (raiseFwd:78) then bends (bend:75)
    // to bring the hand to roughly knee/shin height for tending gesture
    armR: { raiseSide: 8, raiseFwd: 78, bend: 75 },
    // Left arm: relaxed rest on the raised left knee
    armL: { raiseSide: 22, raiseFwd: 15, bend: 85 },
    // Right leg: kneeling — thigh tipped well forward, shin folded back
    legR: { raiseFwd: 60, bend: 115, raiseSide: 12 },
    // Left leg: foot planted forward in a half-lunge stance
    legL: { raiseFwd: 28, bend: 80, raiseSide: 12 },
    // Forward lean — tending posture
    spine: { lean: 28 },
    // Head looking down at the plant
    head: { pitch: 22, yaw: -8 },
  },
});
const r = rig.r;
const j = rig.joints;

// 2. HEAD + FACE — long face shape (elderly woman), gentle smile, hooded lids
const head = F.head(rig, { faceShape: 'long', cheek: 0.9, jaw: 0.85 });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { type: 'straight', tipRadius: r.head * 0.10, bridge: 0.9 },
  mouth: { style: 'smile', expression: 'slightSmile', width: r.head * 0.38 },
  ears: { size: r.head * 0.22 },
  brows: { lift: 0.0, thickness: 0.8 },
});

// Hooded eyelids for age, gaze looking down
const eyes = F.face.eyes(rig, {
  radius: r.head * 0.13,
  gaze: 'down',
  lids: 'hooded',
});

// 3. SKIN — weld all body masses
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'relaxed' }),
  F.legs(rig),
  F.feet(rig),
  face,
], { k: r.lowerArm * 1.2 }).label('skin');

// 4. CARDIGAN — long-sleeved top; hem at lower hip
const cardigan = F.clothing.top(rig, {
  sleeve: 'long',
  hemZ: rig.opts.height * 0.30,
  thickness: r.chestX * 0.14,
}).label('cardigan');

// 5. PANTS — mid-rise, slim fit
const pants = F.clothing.pants(rig, {
  rise: 'mid',
  leg: 'slim',
  thickness: r.upperLeg * 0.18,
}).label('pants');

// 6. HAIR — gray bun
const hair = F.hair(rig, {
  style: 'bun',
  volume: 0.9,
}).label('hair');

// 7. SUN HAT — wide-brim hat built at origin, placed on top of the hair.
// Use placeOnHead with a deep embed so the hat band overlaps the hair volume,
// guaranteeing a solid union (no floating second component).
const hatBrimR = r.head * 1.9;
const hatBrimH = r.head * 0.15;
const hatCrownR = r.head * 0.78;
const hatCrownH = r.head * 0.65;

const hatBrim = sdf.cylinder(hatBrimR, hatBrimH)
  .translate([0, 0, hatBrimH / 2]);
const hatCrown = sdf.cylinder(hatCrownR, hatCrownH)
  .taper(-0.10, 'z')
  .translate([0, 0, hatBrimH + hatCrownH / 2]);
const hatShape = hatBrim.smoothUnion(hatCrown, hatBrimH * 0.35);

// Deep embed: sinks the hat well into the hair so they share solid volume.
// embed = r.head * 0.6 ensures the hat band cuts through the hair cap,
// creating robust contact for a single-component print.
const hat = F.placeOnHead(hatShape, rig, {
  rest: hair,
  embed: r.head * 0.65,
}).label('hat');

// 8. POTTED PLANT — prop on the base in front of the figure.
// The right hand (after pose adjustment) reaches toward the plant area.
// Place the pot directly on the base surface (groundZ ≈ 3.5 from sole data).
// Use the right hand XY position, scaled to sit in the forward direction.
const handR = j.handR;
const groundZ = 3.5;  // base surface level (from sole probe: soles.L.groundZ ≈ 3.5)

// Pot sits at the right-hand XY, at ground level
// Pot is sized generously so it reads clearly in the final model
const potX = handR[0] * 0.5;   // slightly inward from the hand X
const potY = handR[1] * 0.6;   // between the figure center and hand Y
const potR  = r.hand * 3.2;    // generous radius for clear visibility
const potH  = r.hand * 4.5;    // tall enough to read as a real pot

// Pot: tapered cylinder (narrower at bottom, wider at top)
const potGeom = sdf.cylinder(potR, potH)
  .taper(-0.22, 'z')
  .translate([potX, potY, groundZ + potH / 2])
  .label('pot');

// Plant leaves: cluster of spheres rising from the pot opening
const leafCx = potX;
const leafCy = potY;
const leafTopZ = groundZ + potH;
const leafR = r.hand * 1.8;

const leaf1 = sdf.sphere(leafR).translate([leafCx, leafCy - leafR * 0.3, leafTopZ + leafR * 0.9]);
const leaf2 = sdf.sphere(leafR * 0.78).translate([leafCx + leafR * 0.85, leafCy, leafTopZ + leafR * 0.6]);
const leaf3 = sdf.sphere(leafR * 0.78).translate([leafCx - leafR * 0.85, leafCy, leafTopZ + leafR * 0.6]);

const plantGeom = leaf1
  .smoothUnion(leaf2, leafR * 0.32)
  .smoothUnion(leaf3, leafR * 0.32)
  .label('plant');

// 9. BASE — wide flat disc; must support the kneeling pose + plant prop.
// Kneeling figure has a wide footprint with right knee and left foot planted.
const base = F.base(rig, {
  radius: rig.opts.height * 0.38,
  thickness: rig.opts.height * 0.04,
}).label('base');

// 10. Hard-union all labelled regions and build.
// faceDetail for smooth elderly face features + handDetail for relaxed hands.
return sdf.union(skin, eyes, cardigan, pants, hair, hat, potGeom, plantGeom, base)
  .build({
    edgeLength: 0.88,
    detail: [...F.faceDetail(rig), ...F.handDetail(rig)],
  });
