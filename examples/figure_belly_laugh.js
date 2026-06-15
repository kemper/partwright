// Belly Laugh — a jolly heavyset character mid-guffaw: head tipped back,
// huge open-mouth laugh with teeth, both hands clutching a big round belly.
// Showcases: open mouth + teeth + lips (painted), high weight (round belly),
// navel, bulbous nose, round faceShape.
//
// Paint regions: skin, eyes, iris, pupil, teeth, lips, pants, top, base

const { sdf } = api;
const F = sdf.figure;

// 1. RIG — heavyset jolly figure, head tipped WAY back laughing.
// Arms: raiseFwd small (arm stays low), bend large so the forearm curls
// inward and the hands rest on/near the belly. raiseSide small to keep arms
// close to the torso. Head pitched back (-28 = clear head-thrown-back laugh).
const rig = F.rig({
  height: 60,
  headsTall: 5.5,           // slightly big head — jolly/cartoon feel
  build: 'stocky',
  sex: 'neutral',
  weight: 0.88,             // very round belly
  pose: {
    head: { pitch: -28, roll: 2 },   // head thrown back, laughing at the sky
    // For hands resting on the belly: arms hang fairly low (small raiseSide
    // + raiseFwd), moderate bend so the forearms tuck inward toward the belly.
    // The big belly pushes the hands out in front.
    armL: { raiseSide: 30, raiseFwd: 22, bend: 75 },
    armR: { raiseSide: 30, raiseFwd: 22, bend: 75 },
    legs: { raiseSide: 12 },
    spine: { lean: -8 },             // torso leans back with the laugh
  },
});

const r = rig.r;

// 2. HEAD + FACE — round face, bulbous nose. No mouth in assemble —
//    the open laugh is added via mouthAccents at the top level.
const head = F.head(rig, { faceShape: 'round', cheek: 1.45, jaw: 0.92 });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { type: 'bulbous', tipSize: 1.3, width: 1.25, flare: 1.1 },
  mouth: false,   // painted open mouth from mouthAccents below
  ears: { size: r.head * 0.27 },
  brows: { thickness: 1.2, lift: 0.35 },   // raised brows — surprise + joy
});

// Eyes — wide open, looking forward (laughing open eyes).
// lids 'upper' gives a slightly-open friendly eye.
const hf = rig.dir.headForward, eyePush = r.head * 0.17;
const eyes = F.face.eyes(rig, {
  radius: r.head * 0.165,
  lids: 'upper',
  gaze: 'up',    // glancing upward mid-laugh
})
  .translate([hf[0] * eyePush, hf[1] * eyePush, hf[2] * eyePush]);

// Big laughing open mouth with teeth + lips, painted (print-safe, no cavity).
const mouthOpts = {
  style: 'open',
  open: 0.58,
  expression: 'bigSmile',
  render: 'painted',
  teeth: 'both',
};
const mouthParts = F.face.mouthAccents(rig, mouthOpts);

// 3. SKIN — weld body. Bare belly with navel showing above waistband.
const skin = F.weld(rig, [
  F.torso(rig, { navel: true }),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'open' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. CLOTHING — trousers + a short-sleeved top with a high hem so the
//    big belly and navel remain visible (the round belly pushes through).
//    Trousers cover the lower half; top covers the chest but NOT the belly.
const pants = F.clothing.pants(rig, {
  rise: 'mid',
  leg: 'slim',
  thickness: r.upperLeg * 0.18,
}).label('pants');

const top = F.clothing.top(rig, {
  sleeve: 'short',
  hemZ: rig.joints.spine[2] + r.chestY * 0.8,  // hem stops above the belly
  thickness: r.chestY * 0.18,
}).label('top');

// 5. HAIR — short receding hair (balding with remnants at sides).
const hair = F.hair(rig, { style: 'short', volume: 0.6, hairline: 'high' }).label('hair');

// 6. BASE — wider to support the stocky stance.
const base = F.base(rig, {
  radius: rig.opts.height * 0.27,
  thickness: rig.opts.height * 0.04,
}).label('base');

// 7. Build with face + hand detail. No foot toes (figure wears solid feet
//    inside shoes — just flat bare feet here, smooth is fine).
return sdf.union(skin, eyes, mouthParts, pants, top, hair, base)
  .build({
    edgeLength: 0.58,
    detail: [...F.faceDetail(rig), ...F.handDetail(rig)],
  });
