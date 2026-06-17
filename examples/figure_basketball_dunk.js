// Basketball Dunk — a tall athlete leaping for a dunk, mid-air. One arm raised
// high palming the ball, the other arm out for balance, the lead leg tucked up
// and the trail leg extended back, gaze up at the rim. ~8.5 heads tall, lean
// athletic, ebony skin, sleeveless jersey + shorts + basketball shoes.
// Front = −Y, Z up, figure's left = +X, right = −X.
//
// Airborne: the figure is in flight, so F.base auto-rises to the lowest
// (trailing) foot. The leap is kept moderate so a foot still connects to the
// base and the welded result stays ONE component. The ball is a sphere held at
// the raised right hand (open grip), smooth-unioned into the palm so it welds.
//
// Paint regions: skin, eyes, iris, pupil, lids, hair, jersey, shorts, shoes,
//                sole, ball, base
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — tall, lean athlete in a leap. Right arm reaching high (palming the
//    ball), left arm out for balance, lead leg tucked, trail leg extended back.
const rig = F.rig({
  height: 66,
  headsTall: 8.5,
  sex: 'male',
  build: 'average',
  muscle: 0.55,
  weight: 0.35,
  pose: {
    // Right arm reaching HIGH overhead — palming the ball up at the rim.
    armR: { raiseSide: 165, raiseFwd: -6, bend: 14 },
    // Left arm out to the side for balance, slight bend.
    armL: { raiseSide: 55, raiseFwd: 10, bend: 22 },
    // Lead (right) leg tucked UP off the ground: hip drives the knee high and
    // forward, deep knee bend pulls the foot up under the body (mid-air tuck).
    legR: { raiseFwd: 62, bend: 95, raiseSide: 8 },
    // Trail (left) leg extended back, slight bend — THIS foot meets the base.
    legL: { raiseFwd: -20, bend: 10, raiseSide: 6 },
    // Head up, gaze toward the rim.
    head: { pitch: -18 },
    // A touch of forward drive in the torso.
    spine: { lean: 4 },
  },
});
const j = rig.joints, r = rig.r;

// 2. HEAD + FACE — long face, straight nose, eyes up at the rim, effort look.
// A slightly-open mouth (additive 'open' lips) gives the straining-for-it look;
// it self-labels 'lips'+'teeth' so it's folded into the SKIN paint by using
// render:'painted' inside assemble (no extra label) to match the label list.
const head = F.head(rig, { faceShape: 'long' });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { type: 'straight', tipRadius: r.head * 0.10 },
  mouth: { style: 'open', open: 0.32, expression: 'neutral', width: r.head * 0.42, render: 'painted', teeth: false, lips: false },
  ears: { size: r.head * 0.22 },
  brows: {},
});

// Paintable eyes — gaze up at the rim, upper lids.
// gaze: a MODEST upward pitch (not the full 'up' preset) so the pupil stays in
// the eye opening — 'up' + an 'upper' lid tucks the pupil behind the lid (paints
// to 0 triangles). The head is already pitched up, so this still reads as looking
// at the rim.
const eyes = F.face.eyes(rig, { radius: r.head * 0.14, lids: 'upper', gaze: { yaw: 0, pitch: 12 } });

// 3. SKIN — weld every body mass. Open grip on the ball hand; relaxed on the
//    balance hand. (F.hands grip is global; 'open' splays the palm to cup the
//    ball — fine for the balance hand too.)
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'open' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. JERSEY — sleeveless basketball jersey, hem low (long tank).
const jersey = F.clothing.top(rig, {
  sleeve: 'none',
  hemZ: rig.joints.hips[2] + r.hipsY * 0.1,
  thickness: r.chestY * 0.16,
}).label('jersey');

// 5. SHORTS — slim, short basketball shorts.
const shorts = F.clothing.pants(rig, {
  rise: 'mid',
  leg: 'slim',
  cuffZ: rig.joints.upperLegL[2] - r.upperLeg * 1.4,
}).label('shorts');

// 6. HAIR — short crop with tight coils. volume kept slightly low so the coil
//    relief stays inside the catalog triangle budget on this tall (8.5-head) figure.
const hair = F.hair(rig, { style: 'short', texture: 'coils', volume: 0.58 }).label('hair');

// 7. BASKETBALL SHOES — high-tops keyed off the sole frame ('shoes' + 'sole').
const shoes = F.clothing.shoes(rig, { label: 'shoes' });

// 8. BASE — auto-rises to the lowest (trailing) foot of the leap.
const base = F.base(rig, { radius: rig.opts.height * 0.26 }).label('base');

// 9. BASKETBALL — a sphere palmed at the raised right hand. Placed on the grip
//    cup (rig.grip.R.point — the finger cup, NOT handR) and pushed a touch into
//    the palm normal so it overlaps the hand, then smooth-unioned in so it welds
//    (one component). Radius ≈ 0.85·head.
const ballR = r.head * 0.85;
const gR = rig.grip.R;
// Seat the ball centre just off the palm so it overlaps the open hand and the
// finger tips cup over it. Pull it slightly along palmNormal into the hand.
const ballC = [
  gR.point[0] - gR.palmNormal[0] * ballR * 0.45,
  gR.point[1] - gR.palmNormal[1] * ballR * 0.45,
  gR.point[2] - gR.palmNormal[2] * ballR * 0.45,
];
const ball = sdf.sphere(ballR).translate(ballC).label('ball');

// 10. Hard-union the human + clothing + base + ball. The ball is built to
//     overlap the palm, so a HARD union keeps the assembly ONE component while
//     PRESERVING every paint label — a trailing smoothUnion would blend the
//     whole labelled figure and wipe all labels ("smooth blends can't carry
//     labels").
return sdf.union(skin, eyes, jersey, shorts, hair, shoes, base, ball)
  .build({ edgeLength: 0.7, detail: [...F.faceDetail(rig), ...F.handDetail(rig)] });
