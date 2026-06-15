// Soccer Striker — a footballer mid-kick: planted left leg, right leg swung
// forward hard, arms out for balance, open-mouth shout of effort, cornrows.
// A soccer ball welded to the base ahead of the kicking foot reads the kick
// instantly. Showcases: big leg*.raiseFwd kick, cornrows hair, muscle ~0.4.
// Front = −Y, Z up, figure's left = +X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — kick pose.
//    legR raiseFwd:55 swings the right leg hard forward (the kick).
//    legL is the planted leg, grounded, slight side spread.
//    Arms out wide for balance. Spine twisted and leaned forward into the kick.
const rig = F.rig({
  height: 62,
  headsTall: 7,
  build: 'average',
  sex: 'male',
  muscle: 0.40,
  weight: 0.38,
  pose: {
    armL: { raiseSide: 62, raiseFwd: 12, bend: 18 },
    armR: { raiseSide: 36, raiseFwd: -22, bend: 22 },
    legL: { raiseSide: 7, raiseFwd: -5, bend: 6 },     // planted leg
    legR: { raiseSide: 9, raiseFwd: 55, bend: 15 },    // kicking leg
    spine: { lean: 8, turn: -6, side: 3 },
    head: { pitch: -5, yaw: 5 },
  },
});
const j = rig.joints, r = rig.r;

// 2. HEAD + FACE — square jaw, broad nose, open-mouth shout of effort.
const mouthOpts = {
  style: 'open',
  open: 0.58,
  expression: 'bigSmile',
  render: 'painted',
  teeth: 'upper',
  width: r.head * 0.5,
};
const head = F.head(rig, { faceShape: 'square', jaw: 1.1, chin: 0.92 });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { type: 'broad', width: 1.08 },
  mouth: mouthOpts,
  ears: { size: r.head * 0.24 },
  brows: { lift: 0.65, thickness: 1.1 },
});
const eyes = F.face.eyes(rig, {
  radius: r.head * 0.155,
  lids: 'upper',
  gaze: { yaw: 5, pitch: -6 },
});
const mouthParts = F.face.mouthAccents(rig, mouthOpts);

// 3. SKIN — open hands for balance.
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'open' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. CORNROWS — tight braided rows running back to nape.
const hair = F.hair(rig, { style: 'cornrows', volume: 1.08 }).label('hair');

// 5. JERSEY + SHORTS + CLEATS.
const jersey = F.clothing.top(rig, {
  sleeve: 'short',
  hemZ: j.spine[2] - r.hipsY * 0.1,
  thickness: r.chestY * 0.24,
}).label('jersey');

const shorts = F.clothing.pants(rig, {
  rise: 'mid',
  leg: 'slim',
  length: 'full',
  cuffZ: j.lowerLegL[2] + (j.footL[2] - j.lowerLegL[2]) * 0.5,
}).label('shorts');

const cleats = F.clothing.shoes(rig, {
  label: 'cleats',
  sole: { style: 'welt', label: 'cleatSole' },
});

// 6. SOCCER BALL + base — weld the ball into the base so it is ONE component.
//    Strategy: build the base first, then smoothUnion the ball onto it.
//    The ball sits ahead of the kicking (right) foot, bottom tangent at Z=0.
//    We use smoothUnion with a generous k to fuse the ball into the base disc.
const baseNode = F.base(rig, { radius: rig.opts.height * 0.30 });

const ballR = 4.0;
// Ball position: forward of the figure (−Y) on the right side (−X side = figure right).
const ballX = j.footR[0] * 0.55;           // toward figure's right
const ballY = j.footL[1] - r.foot * 2.0;   // forward of the planted foot
const ballZ = ballR;                         // bottom tangent at Z=0

// Build the ball fused to the base with smoothUnion so they share geometry.
// k=2.5 gives a generous weld radius ensuring no gap between ball and base.
const base = baseNode.label('base');
// Ball labelled separately (so it paints white, not base-grey) and sunk into the
// base disc so the two still weld into one printable component.
const ball = sdf.sphere(ballR).translate(ballX, ballY, ballZ - 1.4).label('ball');

// 8. Hard-union + build.
return sdf.union(skin, eyes, mouthParts, hair, jersey, shorts, cleats, base, ball)
  .build({
    edgeLength: 0.70,
    detail: [...F.faceDetail(rig), ...F.handDetail(rig)],
  });
