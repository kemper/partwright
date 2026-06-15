// Old tai chi master in "Golden Rooster" one-leg balance — serene crane stance.
// Standing leg straight on the base, right leg lifted and bent, arms flowing
// in a slow arc, eyes softly closed, long wispy beard, topknot, loose robe.
// Showcases: one-leg balance, closed lids, old age + lean build, custom beard.
// Front = −Y, Z up, figure's left = +X, right = −X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — old master proportions. age:72 shifts torso girth toward older build.
// weight:0.55 gives a slightly fuller abdomen. headsTall:7 = dignified adult.
// ONE-LEG BALANCE: legL is the standing leg (straight, slight outward stance).
//   legR is the lifted "crane" leg: raiseFwd pulls the knee forward, bend brings
//   the shank back up. The figure's right is −X side.
// ARMS: flowing — armL sweeps upward-outward, armR curves lower-inward.
// HEAD: slight upward pitch for serene skyward gaze.
const rig = F.rig({
  height: 60,
  headsTall: 7.0,
  build: 'slim',
  sex: 'male',
  age: 72,
  weight: 0.52,
  pose: {
    // Standing leg (left = +X): slight stance
    legL: { raiseSide: 5 },
    // Crane leg (right = −X): knee lifted forward, shank tucked back
    legR: { raiseFwd: 35, bend: 95 },
    // Left arm: sweeping upward and outward — the high flowing arm
    armL: { raiseSide: 38, raiseFwd: 28, bend: 62 },
    // Right arm: lower and inward — the receiving/balancing arm
    armR: { raiseSide: 22, raiseFwd: -18, bend: 82 },
    // Head: gentle upward pitch, slight yaw for serenity
    head: { pitch: -8, yaw: 5, roll: 2 },
    // Spine: very slight forward lean for meditative posture
    spine: { lean: 3, side: -2 },
  },
});
const r = rig.r;

// 2. HEAD + FACE — a weathered older face. Long face, prominent nose, thin lips.
// Brows are thick and expressive on an elder.
const head = F.head(rig, { faceShape: 'long', jaw: 0.88, chin: 0.95, cheek: 0.75 });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { type: 'roman', length: 1.1, bridge: 1.15, projection: 1.0 },
  mouth: { style: 'lips', lipShape: 'flat', expression: 'slightFrown', fullness: 0.75 },
  ears:  { size: r.head * 0.24 },
  brows: { thickness: 1.3, lift: 0.05 },
});

// EYES — softly CLOSED for the serene tai chi state.
const eyes = F.face.eyes(rig, {
  radius: r.head * 0.145,
  lids: 'closed',
  style: 'iris',
});

// 3. SKIN — relaxed open hands for the flowing arms
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'open' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. TOPKNOT HAIR — bun style for the tai chi master's topknot
const hair = F.hair(rig, { style: 'bun', volume: 0.8 }).label('hair');

// 5. ROBE — loose flowing robe with long hem down past the knees.
// A hemZ well below the pelvis triggers the robe-skirt flare in F.clothing.top.
// The lifted right leg pokes through the skirt — which is correct for a wide robe.
const robeHemZ = rig.joints.hips[2] - r.hipsX * 2.8;
const robe = F.clothing.top(rig, {
  sleeve: 'long',
  hemZ: robeHemZ,
  thickness: r.chestX * 0.16,
}).label('robe');

// 6. SASH BELT — a thin cylinder band at the waist, oriented along Z
// Sized to the waist, anchored at rig.joints.spine
const sashR = r.waist * 1.15;
const sashH = r.chestX * 0.28;
const sash = sdf.cylinder(sashR, sashH)
  .translate(rig.joints.spine)
  .label('sash');

// 7. BASE — auto-sizes to the stance; the STANDING left foot meets it.
// F.base rises to meet the lower of the two feet, so the standing foot welds.
const base = F.base(rig, {
  radius: rig.opts.height * 0.20,
  thickness: rig.opts.height * 0.032,
}).label('base');

// 8. BEARD — long wispy sage beard, tapering from chin downward.
// chinTip is on the front (-Y) face of the head. Push forward for clear visibility.
const chinPos = rig.face.chinTip;
const beardFwdY = chinPos[1] - r.head * 0.22;  // noticeably forward of chin surface

// Wide top blob at the chin — moustache/goatee blending into upper beard
const beardTop = sdf.ellipsoid(r.head * 0.40, r.head * 0.22, r.head * 0.26)
  .translate([chinPos[0], beardFwdY, chinPos[2] - r.head * 0.04]);

// Upper middle: broadens as it flows downward
const beardMid1 = sdf.ellipsoid(r.head * 0.32, r.head * 0.18, r.head * 0.50)
  .translate([chinPos[0], beardFwdY - r.head * 0.02, chinPos[2] - r.head * 0.62]);

// Lower middle: thinning, flowing toward chest
const beardMid2 = sdf.ellipsoid(r.head * 0.22, r.head * 0.13, r.head * 0.52)
  .translate([chinPos[0], beardFwdY - r.head * 0.04, chinPos[2] - r.head * 1.38]);

// Wispy tapered lower tip — a thin capsule reaching to the upper chest
const beardTip = sdf.capsule(
  [chinPos[0], beardFwdY - r.head * 0.05, chinPos[2] - r.head * 1.75],
  [chinPos[0], beardFwdY - r.head * 0.08, chinPos[2] - r.head * 2.50],
  r.head * 0.08
);

const kb = r.head * 0.20;
const beard = beardTop
  .smoothUnion(beardMid1, kb)
  .smoothUnion(beardMid2, kb * 0.85)
  .smoothUnion(beardTip, kb * 0.50)
  .label('beard');

// 9. Build — faceDetail for the closed-lid elder face, handDetail for open hands.
// footDetail for the bare toes.
return sdf.union(skin, eyes, hair, robe, sash, beard, base)
  .build({
    edgeLength: 0.60,
    detail: [
      ...F.faceDetail(rig, { edgeLength: r.head * 0.062 }),
      ...F.handDetail(rig),
    ],
  });
