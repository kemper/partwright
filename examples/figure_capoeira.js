// Capoeira Ginga — a capoeirista low in the esquiva (dodge/crouch).
// Deep dynamic crouch with wide bent knees; right hand reaching toward the
// ground; left arm raised and bent guarding the face; spine leans into the
// movement. Bare chest showcases nipples + navel; white capoeira pants.
//
// Showcased features:
//  • Deep dynamic crouch: legs bend:~60, raiseSide:~20, hand-to-ground reach
//  • Bare-torso anatomy: F.nipples (areola label) + F.torso navel:true
//  • Coily short hair / small afro texture
//  • Athletic muscle definition (muscle:0.6)
//  • Gaze toward the reaching hand (downward)
//
// Front = −Y, Z up, figure's left = +X, right = −X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — esquiva / ginga crouch pose.
//    Both legs: wide stance (raiseSide ~20), deeply bent (bend ~60).
//    Spine: lean forward + turn for the dynamic twist.
//    Right arm: reaches toward the ground (raiseFwd ~80, bend ~30 partially
//      straightened so fingers extend toward the floor; raiseSide low keeps
//      it central/downward).
//    Left arm: guard — raised to the side and bent sharply (raiseSide ~40,
//      bend ~120 so the forearm is roughly in front of the face).
//    Head: pitch down (looking toward the reaching hand) + slight yaw right
//      toward the reaching side.
const rig = F.rig({
  height: 54,
  headsTall: 7.5,
  build: 'average',
  muscle: 0.6,
  weight: 0.35,
  pose: {
    // Both legs: wide, deeply bent — the signature capoeira crouch.
    // raiseSide:22 opens the stance wide; bend:70 = deep knee bend crouch.
    // Slight raiseFwd differentiation: right leg steps slightly forward,
    // left leg back for the lunge-crouch shape.
    legR: { raiseSide: 22, raiseFwd: 15, bend: 70, twist: -12 },
    legL: { raiseSide: 24, raiseFwd: -10, bend: 65, twist: 14 },
    // Right arm: reaches down toward the ground.
    // raiseFwd:90 swings the arm nearly straight forward/down; bend:50
    // lets the forearm angle lower toward the floor so the hand reaches down.
    armR: { raiseSide: 5, raiseFwd: 90, bend: 50 },
    // Left arm: raised guard — elbow up and wide, forearm screening the face.
    // raiseSide:45 lifts the elbow wide; bend:125 folds the forearm acutely
    // so it comes in front of the head.
    armL: { raiseSide: 45, raiseFwd: 20, bend: 125, twist: -20 },
    // Head: looks toward the right reaching hand (down + slightly right).
    // pitch:22 looks down; yaw:-15 turns toward figure's right.
    head: { pitch: 22, yaw: -15 },
    // Spine: lean forward + slight turn for the dynamic esquiva torso.
    // Keep lean moderate so the nipple anchors track the skin surface correctly.
    spine: { lean: 15, turn: -10, side: -4 },
  },
});
const j = rig.joints;
const r  = rig.r;

// 2. HEAD + FACE — focused, intense capoeirista expression.
//    Round face shape; broad nose; slight frown of concentration.
const head = F.head(rig, { faceShape: 'round', cheek: 1.0, jaw: 1.05 });
const face = F.face.assemble(head, rig, {
  eyes:  false,
  nose:  { type: 'broad', flare: 0.65, tipRadius: r.head * 0.10, bridge: 0.7 },
  mouth: { style: 'lips', lipShape: 'natural', expression: 'slightFrown', fullness: 1.1 },
  ears:  { size: r.head * 0.23 },
  brows: { thickness: 1.1, lift: 0 },
});
// Eyes: gaze downward and slightly right (toward the reaching hand).
const eyes = F.face.eyes(rig, {
  radius: r.head * 0.14,
  lids:   'almond',
  gaze:   { yaw: -10, pitch: -15 },
});

// 3. SKIN — bare chest (no top). navel:true for the exposed belly.
//    Fist on the reaching hand (right), open/relaxed on the guard hand (left).
const skin = F.weld(rig, [
  F.torso(rig, { navel: true }),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'relaxed' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. NIPPLES — top-level (NOT inside the skin weld) so the 'areola' label
//    survives and can be painted distinctly. Self-labels as 'areola'.
const nipples = F.nipples(rig, { size: r.chestX * 0.13 });

// 5. CAPOEIRA PANTS — white traditional abadá.
//    Full length, loose (cargo-style), high rise.
const pants = F.clothing.pants(rig, {
  rise: 'high',
  leg:  'cargo',
  length: 'full',
}).label('pants');

// 6. HAIR — short coily crop / tight natural texture.
//    'short' style with 'coils' texture for the tight springy 4c look.
//    volume:1.15 gives a slight puff without full afro size.
const hair = F.hair(rig, {
  style:   'short',
  texture: 'coils',
  volume:  1.15,
}).label('hair');

// 7. BASE — the deep crouch lowers the center of mass; auto-sizing handles
//    the wide footprint. Extra radius to cover the wide stance.
const base = F.base(rig, {
  radius:    rig.opts.height * 0.32,
  thickness: rig.opts.height * 0.034,
}).label('base');

// 8. Hard-union all labelled regions and build.
//    detail: faceDetail (smooth face + iris) + handDetail (sculpted fingers).
//    Note: nipples is a TOP-LEVEL region alongside eyes — NOT inside skin.
return sdf.union(skin, eyes, nipples, pants, hair, base)
  .build({
    edgeLength: 0.55,
    detail: [...F.faceDetail(rig), ...F.handDetail(rig)],
  });
