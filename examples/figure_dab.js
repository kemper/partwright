// Teen doing "The Dab" — classic street-dance pose.
// Left arm flung up-and-across with the head ducked into the crook of that
// raised elbow; right arm extended diagonally out; long locs swinging.
// Showcases: dab arm geometry, head tuck (head.pitch + roll), locs hair.
// Front = −Y, Z up, figure's left = +X, right = −X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — teen proportions (5.5 heads tall), slim build.
// THE DAB: armL is the "up-and-across" arm the head ducks into.
//   raiseSide 115 lifts the upper arm above shoulder level,
//   raiseFwd 40 swings it across the body toward −Y (forward),
//   bend 130 + twist 80 crooks the forearm so the fist meets the cheekbone.
// armR: the "out" arm — sideways with a slight forward swing.
// head: ducked DOWN (pitch 22) and rolled toward the raised left arm (roll 18).
const rig = F.rig({
  height: 58,
  headsTall: 5.5,
  build: 'slim',
  sex: 'male',
  age: 16,
  pose: {
    armL: { raiseSide: 115, raiseFwd: 40, bend: 130, twist: 80 },
    armR: { raiseSide: 50, raiseFwd: 30, bend: 12 },
    legL: { raiseSide: 7 },
    legR: { raiseSide: 9, twist: 5 },
    head: { pitch: 22, roll: 18, yaw: 12 },
    spine: { lean: 4, turn: 8, side: -3 },
  },
});
const r = rig.r;

// 2. HEAD + FACE — round youthful face, medium nose, big grin.
const head = F.head(rig, { faceShape: 'round', jaw: 0.85, chin: 0.82 });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { type: 'button', width: 0.90, bridge: 0.80 },
  mouth: { style: 'smile', expression: 'bigSmile', width: r.head * 0.32 },
  ears:  { size: r.head * 0.22 },
  brows: {},
});
const eyes = F.face.eyes(rig, { radius: r.head * 0.155, lids: 'upper' });

// 3. SKIN — fist on both hands for the punchy dab energy.
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'fist' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. LOCS HAIR — locs worn loose, shorter length avoids stray strands with the
// tucked-head dab pose.
const hair = F.hair(rig, { style: 'locs', length: 'short', volume: 1.05 }).label('hair');

// 5. HOODIE — pullover hoodie (long sleeve, dropped hem).
const hoodie = F.clothing.top(rig, {
  sleeve: 'long',
  hemZ: rig.joints.hips[2] - r.hipsY * 0.3,
  thickness: r.chestX * 0.14,
}).label('hoodie');

// 6. JEANS — mid-rise slim.
const jeans = F.clothing.pants(rig, { rise: 'mid', leg: 'slim' }).label('jeans');

// 7. SNEAKERS.
const sneakers = F.clothing.shoes(rig, { thickness: r.foot * 0.22 });

// 8. BASE.
const base = F.base(rig, {
  radius: rig.opts.height * 0.24,
  thickness: rig.opts.height * 0.03,
}).label('base');

// 9. Build — edgeLength 0.65 for budget; faceDetail + handDetail for face/fist.
return sdf.union(skin, eyes, hair, hoodie, jeans, sneakers, base)
  .build({
    edgeLength: 0.65,
    detail: [...F.faceDetail(rig, { edgeLength: r.head * 0.065 }), ...F.handDetail(rig)],
  });
