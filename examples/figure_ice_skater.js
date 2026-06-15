// Figure skater in a layback spin — balanced on the LEFT skate, right leg
// lifted back, head tilted back, one arm raised overhead (armL), one arm
// out to the side (armR), gentle spine arch. Blades welded under each sole
// via F.standOn. Ponytail hair, skating dress (flared), almond lids.
// Showcases: blade-under-foot via F.standOn/sole frame, one-skate balance,
// head tilt-back (pitch -20), almond eyelids, ponytail hair.
// Different from figure_ballerina (arms overhead in fifth) and figure_arabesque
// (arabesque line). This is a spin: one foot down on a blade, head arched back.
// Front = −Y, Z up, figure's left = +X, right = −X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — slim adult female, layback spin pose.
// Balanced on LEFT skate; RIGHT leg lifted back.
// One arm raised overhead (armL: raiseSide 150, bend 50, twist 90).
// Other arm out to the side (armR: raiseSide 80).
// Head tilted back (pitch -20) for the dramatic layback.
// Spine arched back slightly (lean -6) to complete the layback.
const rig = F.rig({
  height: 50,
  headsTall: 7.6,
  sex: 'female',
  weight: 0.34,
  muscle: 0.3,
  build: 'slim',
  pose: {
    // Standing left leg: grounded, slight stance
    legL: { raiseSide: 4 },
    // Lifted right leg: back and up, slight knee bend
    legR: { raiseFwd: -45, raiseSide: 6, bend: 25 },
    // Raised arm overhead: raiseSide 150, bend 50, twist 90 so forearm arcs up
    armL: { raiseSide: 150, bend: 50, twist: 90 },
    // Side arm: gracefully out to the right side
    armR: { raiseSide: 80, raiseFwd: 10, bend: 12 },
    // Head tilted back — the defining layback feature
    head: { pitch: -20, roll: 3 },
    // Gentle spine arch (lean negative = arch back)
    spine: { lean: -6 },
  },
});
const r = rig.r;

// 2. HEAD + FACE — almond lids, serene expression, lips.
const head = F.head(rig, { faceShape: 'oval', chin: 0.85 });
const face = F.face.assemble(head, rig, {
  eyes:  false,
  nose:  { type: 'straight', tipRadius: r.head * 0.088, projection: 0.82 },
  mouth: false,
  ears:  false,
  brows: { lift: 0.1 },
});

// Almond eyelids — both lids visible, almond-shaped opening
const eyes = F.face.eyes(rig, {
  radius: r.head * 0.135,
  lids: 'almond',
  gaze: { yaw: -2, pitch: -8 },
});

// Painted lips — elegant and subtle
const lips = F.face.mouthAccents(rig, {
  style: 'lips',
  lipShape: 'natural',
  expression: 'slightSmile',
  width: r.head * 0.29,
});

// 3. SKIN — weld all body masses. Relaxed hands for spin pose.
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'relaxed' }),
  F.legs(rig),
  F.feet(rig),   // feet covered by boots/skates — no toes needed
  face,
]).label('skin');

// 4. SKATING DRESS — flared dress (hemZ below pelvis for the skater skirt silhouette).
// hemZ near the hips so the flared skirt cone covers the upper thighs.
const hipsZ = rig.joints.hips[2];
const dressHemZ = hipsZ - r.hipsX * 0.6;   // slightly below hips

const dress = F.clothing.top(rig, {
  sleeve: 'none',
  hemZ: dressHemZ,
  thickness: r.chestY * 0.18,
}).label('dress');

// 5. SKATES — boots up to the ankle, then blade welded under each sole.
// F.clothing.boots handles the shaft/ankle coverage.
// shaftZ targets the ankle-ish area (just above footL/footR joints).
const ankleZ = rig.joints.footL[2] + r.lowerLeg * 0.3;
const skates = F.clothing.boots(rig, {
  shaftZ: ankleZ,
  label: 'skates',
  sole: { label: 'skates' },   // fold sole into the skates label
});

// 6. BLADES — thin long blade under each sole via F.standOn.
// Each blade is a thin tall roundedBox (long along the foot heading, very narrow,
// thin vertically). F.standOn anchors its TOP to the sole point.
const bladeLen  = r.foot * 3.0;   // slightly longer than the foot
const bladeW    = r.foot * 0.14;  // very narrow (ice blade)
const bladeH    = r.foot * 0.35;  // blade height (the vertical fin)

const bladeShape = () => sdf.roundedBox(
  [bladeLen, bladeW, bladeH],
  bladeW * 0.4
);

// Stand-on anchors the blade TOP to the sole so the blade hangs below the foot.
const bladeL = F.standOn(bladeShape(), rig.sole.L).label('blade');
const bladeR = F.standOn(bladeShape(), rig.sole.R).label('blade');

// 7. HAIR — ponytail (flowing back in the spin)
const hair = F.hair(rig, { style: 'ponytail', length: 'mid', volume: 1.1 }).label('hair');

// 8. BASE — auto-sized for the spin pose (one foot on the ground, one back/up).
const base = F.base(rig, {
  radius: rig.opts.height * 0.20,
  thickness: rig.opts.height * 0.04,
}).label('base');

// 9. Hard-union all labelled regions and build.
return sdf.union(skin, eyes, lips, dress, skates, bladeL, bladeR, hair, base)
  .build({
    edgeLength: 0.5,
    detail: [
      ...F.faceDetail(rig),
      ...F.handDetail(rig),
    ],
  });
