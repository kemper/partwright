// Quarterback — American football throwing motion.
// Showcases: spine.turn (upper-body twist for the throw), wide throwing stride,
// head.yaw (looking downfield), downfield gaze, held football, muscle build.
// male, height ~56, headsTall 7.5, build 'average', muscle ~0.55.
// Front = −Y, Z up, figure's left = +X, right = −X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — the throwing motion.
//    RIGHT arm cocked back and up with the ball: raiseSide ~100, raiseFwd ~ -30
//    (back = negative raiseFwd), bend ~90, twist ~-30 (fist behind ear, palm
//    forward — the cocked throw position).
//    LEFT arm extended forward pointing downfield: raiseFwd ~80, raiseSide ~18.
//    LEGS: wide stride — legL stepping forward (raiseFwd +45, bend 30),
//    legR trailing back (raiseFwd -30, bend 8).
//    spine.turn ~22 (twist toward figure's left = toward the throw follow-through).
//    head.yaw ~-25 (turned downfield = toward figure's right, looking the throw).
const rig = F.rig({
  height: 56,
  headsTall: 7.5,
  sex: 'male',
  build: 'average',
  muscle: 0.55,
  weight: 0.42,
  pose: {
    // Right arm: cocked back with the ball — shoulder raised, elbow bent back.
    // raiseSide 100: above horizontal (shoulder raised in the wind-up).
    // raiseFwd -32: swept behind (negative = back), the classic cocked position.
    // bend 88: forearm folded back, ball near the ear.
    // twist -35: elbow points up/back, wrist cocks the ball outward.
    armR: { raiseSide: 100, raiseFwd: -32, bend: 88, twist: -35 },

    // Left arm: extended forward pointing downfield — the guiding arm.
    // raiseFwd 80: nearly straight forward toward −Y.
    // raiseSide 20: slightly to the left side.
    // bend 15: minimal bend for a pointed, extended look.
    armL: { raiseFwd: 80, raiseSide: 20, bend: 15 },

    // Stride: left leg (figure's left = +X) stepping forward, right leg trailing.
    // legL = forward leg: raiseFwd 38, bend 30 (knee over the foot, planted).
    // legR = trailing leg: raiseFwd -28, bend 8 (nearly straight, pushing off).
    legL: { raiseFwd: 38, raiseSide: 14, bend: 30 },
    legR: { raiseFwd: -28, raiseSide: 16, bend: 8 },

    // Head: turned downfield (toward figure's right = −X direction = yaw negative).
    // slight pitch: -5 = looking slightly downfield-up (scanning the field).
    head: { yaw: -22, pitch: -3, roll: -4 },

    // Spine: twist toward the throw direction — the throwing shoulder leads.
    // turn ~22: rotate upper body toward figure's left (+) — toward the throw arm.
    // lean 4: slight forward lean (in-the-pocket intensity).
    spine: { turn: 22, lean: 4, side: -3 },
  },
});
const j = rig.joints, r = rig.r;

// 2. HEAD + FACE — focused, determined expression. Slight jaw set, eyes
// downfield (gaze right = toward the figure's right side = field direction).
const head = F.head(rig, { faceShape: 'square', jaw: 1.1, chin: 1.0 });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { type: 'straight', tipRadius: r.head * 0.10, bridge: 0.95 },
  mouth: { style: 'lips', lipShape: 'flat', expression: 'slightFrown', fullness: 0.9 },
  ears: { size: 0.9 },
  brows: { thickness: 1.1, lift: 0 },
});

// Eyes: looking right/downfield (yaw toward figure's right = negative yaw).
// lids: 'upper' — focused, alert.
const eyes = F.face.eyes(rig, {
  radius: r.head * 0.15,
  lids: 'upper',
  gaze: 'right',
});

// 3. SKIN — right hand fist (holding the ball), left hand open (pointing).
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'fist' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. JERSEY — short sleeve football jersey.
const jersey = F.clothing.top(rig, {
  sleeve: 'short',
  thickness: r.chestY * 0.22,
  hemZ: j.spine[2] - r.hipsY * 0.25,
}).label('jersey');

// 5. PANTS — football pants (mid-rise, slim cut).
const pants = F.clothing.pants(rig, {
  leg: 'slim',
  rise: 'mid',
  thickness: r.upperLeg * 0.20,
}).label('pants');

// 6. CLEATS — football cleats.
// Footwear OWNS 'cleats' + 'sole' labels — no extra .label().
const cleats = F.clothing.shoes(rig, {
  size: 1.1,
  thickness: r.foot * 0.20,
  label: 'cleats',
  sole: { style: 'welt', thickness: r.foot * 0.22 },
});

// 7. HAIR — short hair / close crop.
const hair = F.hair(rig, { style: 'short', hairline: 'mid' }).label('hair');

// 8. FOOTBALL — a prolate ovoid (American football) held in the cocked right hand.
//    Build the football as a scaled ellipsoid: longer along Z (the grip axis)
//    so it reads as a football, with narrow ends tapering.
//    Use F.holdAt to orient it into the right hand grip, then union it so it
//    welds into one component with the hand/body.
//
//    The football's long axis aligns to the grip axis (the line a held bar lies
//    along). We build it as an elongated capsule + two smaller spheres at tips
//    to mimic the pointed ends of a football.
//
const gR = rig.grip.R;   // right hand grip frame (the throwing/cocked arm)

// Football dimensions: ~1.8× head radius long, ~0.55× head radius across.
const fbLen = r.head * 1.85;   // total length tip-to-tip
const fbR = r.head * 0.52;     // equatorial radius

// Build football centered at origin with long axis along +Z.
// The capsule gives a rounded cylinder body; we use an ellipsoid for a proper
// prolate shape — elongated Z, squished X/Y.
const footballBody = sdf.ellipsoid(fbR, fbR, fbLen * 0.5)
  .translate([0, 0, 0]);

// Place football in the right hand cocked behind the head.
// F.holdAt aligns the football's +Z to gripAxis and moves its center to grip.point.
const football = F.holdAt(footballBody, gR).label('ball');

// 9. BASE — auto-sizes to the wide stride footprint.
const base = F.base(rig, {
  radius: rig.opts.height * 0.28,
  thickness: rig.opts.height * 0.045,
}).label('base');

// 10. Hard-union all labelled regions and build.
//     faceDetail: smooth face, crisp features. handDetail: fist knuckles.
return sdf.union(skin, eyes, jersey, pants, cleats, hair, football, base)
  .build({ edgeLength: 0.55, detail: [...F.faceDetail(rig), ...F.handDetail(rig)] });
