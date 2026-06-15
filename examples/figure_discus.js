// Discus Thrower — a classic athletic wind-up: torso twisted, one arm wound
// far back holding a discus, wide braced stance. Showcases: big spine.turn
// (~-32) twist, athletic muscle (~0.55), a flat discus lens welded into the
// right hand via rig.grip, wide braced stance with bent knee brace.
// Front = −Y, Z up, figure's left = +X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — classic discus wind-up.
//    spine.turn:-32 = upper body wound strongly toward figure's right (−X).
//    armR wound back and up (the throwing arm), holding the discus.
//    armL reaching across for counterbalance.
//    legR (figure's right) braced/bent; legL straight, wide stance.
//    Head turned to look back toward the throwing arm.
const rig = F.rig({
  height: 66,
  headsTall: 7.5,
  build: 'stocky',
  sex: 'male',
  muscle: 0.55,
  weight: 0.42,
  pose: {
    // Right (throwing) arm — wound back and out, slightly above horizontal.
    armR: { raiseSide: 68, raiseFwd: -36, bend: 8 },
    // Left (balance) arm — reaching forward and across.
    armL: { raiseSide: 52, raiseFwd: -38, bend: 22 },
    // Wide braced stance — right knee bent for power, left leg straight and out.
    legR: { raiseSide: 16, raiseFwd: 5, bend: 28 },
    legL: { raiseSide: 18, raiseFwd: -8, bend: 4 },
    // Upper body wound back.
    spine: { turn: -32, lean: 12, side: -5 },
    // Head looks back toward throwing arm.
    head: { yaw: -18, pitch: 5 },
  },
});
const j = rig.joints, r = rig.r;

// 2. HEAD + FACE — strong classical look: oval-long face, prominent nose, set lips.
const head = F.head(rig, { faceShape: 'oval', jaw: 1.12, cheek: 1.1 });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { type: 'straight', bridge: 1.1, length: 1.15, projection: 1.1 },
  mouth: { style: 'lips', lipShape: 'flat', expression: 'neutral', fullness: 0.9 },
  ears: { size: r.head * 0.22 },
  brows: { thickness: 1.15, lift: 0.1 },
});
const eyes = F.face.eyes(rig, {
  radius: r.head * 0.148,
  lids: 'almond',
  gaze: { yaw: -14, pitch: 4 },
});

// 3. SKIN — bare chest (classical/athletic); fists gripping the discus.
const skin = F.weld(rig, [
  F.torso(rig, { navel: true }),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'relaxed' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// Nipples — bare-chest top-level parts (pre-labelled 'areola').
const nipples = F.nipples(rig);

// 4. DISCUS — a flat lens held in the right hand.
//    Build a flat lens shape: a cylinder with spherical top and bottom facings,
//    i.e., a short cylinder blended with a squashed sphere.
//    Built at origin along Z, then placed via F.holdAt into the right grip.
const discusR = r.hand * 2.1;      // discus radius
const discusThk = r.hand * 0.55;   // discus thickness

// Lens: intersection of two spheres (thick lens) — a sphere squashed along Z
// intersected with its own box to clip into a disc shape.
// Simpler: a rounded cylinder approximates a discus well.
const discusShape = sdf.roundedCylinder(discusR, discusThk, discusThk * 0.38);

// Place the discus in the right hand, held flat (long axis = Z = along the arm/grip).
// F.holdAt aligns the discus Z-axis to gripAxis and seats it in the right grip cup.
const discus = F.holdAt(discusShape, rig.grip.R).label('discus');

// 5. CLOTHING — a thin singlet top (sleeveless) + shorts (thigh-length).
const singlet = F.clothing.top(rig, {
  sleeve: 'none',
  hemZ: j.spine[2] - r.hipsY * 0.05,
  thickness: r.chestY * 0.2,
}).label('singlet');

const shorts = F.clothing.pants(rig, {
  rise: 'mid',
  leg: 'slim',
  length: 'full',
  cuffZ: j.lowerLegL[2] + (j.footL[2] - j.lowerLegL[2]) * 0.4,
}).label('shorts');

// 6. ATHLETIC SHOES — flat on the ground.
const shoes = F.clothing.shoes(rig, {
  label: 'shoes',
  sole: { style: 'welt', label: 'sole' },
});

// 7. BASE — wide to accommodate the braced stance.
const base = F.base(rig, { radius: rig.opts.height * 0.28 }).label('base');

// 8. Hard-union + build.
return sdf.union(skin, nipples, eyes, discus, singlet, shorts, shoes, base)
  .build({
    edgeLength: 0.70,
    detail: [...F.faceDetail(rig), ...F.handDetail(rig)],
  });
