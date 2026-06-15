// Sneaky Ninja — low ready crouch, one hand reaching toward the ground,
// tapered half-lids with a side gaze, strong square jaw, deep crouch pose.
// Hood built over the skull; face window left open for eyes. Belt wraps.
// Front = −Y, Z up, figure's left = +X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — deep low ready crouch.
//    legs: raiseSide 18, bend 70 = low crouched squat stance.
//    armR: raiseFwd 50, bend 20 = right hand reaching low-forward toward ground.
//    armL: raiseSide 30, bend 90 = left arm raised/guarded.
//    head: yaw -8 = looking slightly to the right (focused gaze).
//    spine: lean 12 = forward lean into the crouch.
const rig = F.rig({
  height: 60,
  headsTall: 7.0,
  build: 'slim',
  sex: 'neutral',
  muscle: 0.35,
  pose: {
    legs:  { raiseSide: 18, bend: 70 },
    legL:  { raiseFwd: 5 },
    legR:  { raiseFwd: -5 },
    // Right arm reaches low-forward (toward the ground)
    armR:  { raiseFwd: 50, raiseSide: 12, bend: 20 },
    // Left arm raised as guard
    armL:  { raiseSide: 30, raiseFwd: 14, bend: 90 },
    head:  { yaw: -8, pitch: 5 },
    spine: { lean: 12, turn: -6 },
  },
});

const j = rig.joints, r = rig.r;

// 2. HEAD + FACE — square face, strong jaw, tapered half-lids, side gaze.
const head = F.head(rig, { faceShape: 'square', jaw: 1.25, chin: 0.95, cheek: 0.85 });
const face = F.face.assemble(head, rig, {
  eyes:  false,
  nose:  { type: 'straight', bridge: 1.1, projection: 1.0, tipSize: 0.85 },
  mouth: { style: 'lips', lipShape: 'flat', expression: 'slightFrown' },
  ears:  false,   // ears hidden by hood
  brows: { thickness: 1.2, lift: 0 },  // heavy brows, no lift (stern/menacing)
});

// Tapered lids (narrowed, focused) with a slight side gaze — stealthy look
const eyes = F.face.eyes(rig, {
  radius: r.head * 0.148,
  lids:   'tapered',
  gaze:   { yaw: -15, pitch: 2 },  // looking slightly right — the side gaze
});

// 3. SKIN — fist on right hand (reaching down), relaxed on left (guard).
const skin = F.weld(rig, [
  F.torso(rig), F.neck(rig),
  F.arms(rig), F.hands(rig, { grip: 'relaxed' }),
  F.legs(rig), F.feet(rig),
  face,
]).label('skin');

// 4. NINJA GARB — full body suit (dark top + trousers).
const gi = F.clothing.top(rig, {
  sleeve: 'long',
  thickness: r.chestY * 0.24,
}).label('gi');

const trousers = F.clothing.pants(rig, {
  leg:  'slim',
  rise: 'high',
}).label('trousers');

// 5. BELT / SASH — wrapped band at the waist.
const beltZ   = j.spine[2];
const beltR   = r.waist + r.chestY * 0.36;
const beltThk = r.chestY * 0.17;
const NSEGS   = 14;
let belt;
for (let i = 0; i < NSEGS; i++) {
  const a0 = (2 * Math.PI * i)       / NSEGS;
  const a1 = (2 * Math.PI * (i + 1)) / NSEGS;
  const pt  = (a) => [
    beltR * Math.cos(a),
    beltR * 0.82 * Math.sin(a),
    beltZ,
  ];
  const seg = sdf.capsule(pt(a0), pt(a1), beltThk);
  belt = belt === undefined ? seg : belt.union(seg);
}
belt = belt.label('belt');

// 6. HOOD — dark head wrap/cowl built as a back-of-skull cap using F.hair.
//    'short' style naturally hugs the back and top of the skull with a face
//    window cutout, leaving the face geometry visible underneath. The hood
//    just needs to wrap the non-face portion of the head.
const hood = F.hair(rig, {
  style:    'short',
  hairline: 'mid',
  volume:   1.22,
}).label('hood');

// 7. FACE MASK — lower face covering: a capsule band across the nose-to-chin
//    region. Uses rig.face anchors for positioning.
const nosePos  = rig.face.nose;
const mouthPos = rig.face.mouth;
const hf = rig.dir.headForward;  // unit vector pointing from head toward face front (-Y)
const maskCz   = (nosePos[2] + mouthPos[2]) * 0.5;
// Push the mask to the front face surface
const maskFwd  = [
  j.head[0] + hf[0] * r.headZ * 0.70,
  j.head[1] + hf[1] * r.headZ * 0.70,
  maskCz,
];
const mask = sdf.roundedBox(
  [r.headX * 1.15, r.headZ * 0.25, r.headZ * 0.50],
  r.headZ * 0.06,
).translate(maskFwd).label('mask');

// 8. BASE
const base = F.base(rig, { radius: rig.opts.height * 0.28 }).label('base');

// 9. Hard-union + build.
//    Scaled-back faceDetail for budget; handDetail for reaching fingers.
return sdf.union(skin, eyes, gi, trousers, belt, hood, mask, base)
  .build({
    edgeLength: 0.64,
    detail: [
      ...F.faceDetail(rig, { edgeLength: r.head * 0.10, eyeEdgeLength: r.head * 0.05 }),
      ...F.handDetail(rig),
    ],
  });
