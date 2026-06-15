// Sneaky Shusher — a tiptoe-creeping character pressing one finger to the lips
// in a dramatic "shh!" gesture. Wide side-glancing eyes, hooded lids, big ears,
// button nose, and raised brows sell the sneaky conspirator look.
//
// Showcase features: side gaze ('right'), hooded lids, big ears, button nose,
// raised brows, one-arm "shh" pose with raised forearm.
//
// Paint regions: skin, eyes, iris, pupil, lids, shirt, pants, hair, base
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — compact adult proportions (6 heads). One leg raised forward slightly
//    to suggest tiptoe creep; right arm raised so the hand reaches toward the face.
const rig = F.rig({
  height: 60,
  headsTall: 6,
  build: 'slim',
  sex: 'neutral',
  age: 28,
  weight: 0.4,
  pose: {
    // Right arm raised forward-and-up to bring hand toward mouth — shh gesture
    armR: { raiseSide: 18, raiseFwd: 52, bend: 112 },
    // Left arm low, slightly back — counterbalance for sneaky creep
    armL: { raiseSide: 12, raiseFwd: -8, bend: 22 },
    // Slight stagger for tiptoe read
    legL: { raiseSide: 9, raiseFwd: 5, bend: 4 },
    legR: { raiseSide: 9, raiseFwd: -4 },
    // Head turned sideways to show gaze direction, but not so far face disappears from front
    head: { yaw: 22, roll: 4, pitch: 2 },
    // Upper body leans slightly forward — sneaky stoop
    spine: { lean: 4, side: -2 },
  },
});

const r = rig.r;

// 2. HEAD + FACE — button nose, big ears, raised brows, hooded eyes glancing right
const head = F.head(rig, { faceShape: 'round', cheek: 1.2, chin: 0.85 });

const face = F.face.assemble(head, rig, {
  eyes: false,
  // Button nose — small, upturned, suits the cartoonish sneaky look
  nose: { type: 'button', projection: 0.85, tipSize: 0.9 },
  // Simple pressed-lips smile — not open, just a knowing smirk
  mouth: { style: 'smile', smirk: 0.1, expression: 'slightSmile' },
  // Big ears are a hallmark of this character
  ears: { size: r.head * 0.38 },
  // Raised brows signal alarm / mischief
  brows: { lift: 0.45, thickness: 0.9 },
});

// Eyes — hooded lids, side gaze to the figure's right (toward viewer's left)
// This is the showcase: lids:'hooded' + gaze:'right'
// Round/cheeky faces bulge past F.face.eyes' built-in forward push, burying the
// domes (the eyes/iris/pupil/lids labels then resolve to 0 paintable triangles).
// Nudge the whole eye assembly a hair further along headForward so it clears the
// cheek — labels ride along with the translate.
const hf = rig.dir.headForward;
const eyePush = r.head * 0.07;
const eyes = F.face.eyes(rig, {
  radius: r.head * 0.17,
  lids: 'hooded',
  gaze: 'right',
}).translate([hf[0] * eyePush, hf[1] * eyePush, hf[2] * eyePush]);

// 3. SKIN — weld body. Right hand uses 'open' grip; the index finger will
//    be suggested by the raised arm aiming at the mouth area.
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'open' }),
  F.legs(rig),
  F.feet(rig),
  face,
], { k: r.lowerArm * 1.2 }).label('skin');

// 4. CLOTHES — simple dark outfit, slim-fit
const pants = F.clothing.pants(rig, {
  leg: 'slim',
  rise: 'mid',
  thickness: r.upperLeg * 0.22,
}).label('pants');

const shirt = F.clothing.top(rig, {
  sleeve: 'long',
  thickness: r.chestY * 0.20,
}).label('shirt');

// 5. HAIR — short hair
const hair = F.hair(rig, {
  style: 'short',
  volume: 0.9,
}).label('hair');

// 6. BASE
const base = F.base(rig, {
  radius: rig.opts.height * 0.26,
  thickness: rig.opts.height * 0.04,
}).label('base');

// 7. Build — face + hand detail for clean features and fingers
return sdf.union(skin, eyes, pants, shirt, hair, base)
  .build({ edgeLength: 0.66, detail: [...F.faceDetail(rig), ...F.handDetail(rig)] });
