// Zen Meditator — a serene older person sitting cross-legged in easy lotus
// pose, bare-chested, hands resting on the knees. Eyes fully closed.
// Showcases: closed eyelids, bare-torso anatomy (nipples/areola + navel),
// bare feet with toes, older age, roman nose, and brows.
//
// Paint regions: skin, areola, eyes, lids, iris, pupil, hair, base

const { sdf } = api;
const F = sdf.figure;

// 1. RIG — older heavier build, cross-legged seated pose.
// We approximate the cross-legged sit as:
//   raiseFwd ~58 + raiseSide ~42 + bend ~95 + twist ~45
// This lifts the thighs forward/outward, bends the knees so feet tuck in,
// and applies hip turnout so knees point sideways.
// Arms: slight raiseFwd + bend so forearms rest on/near the knees.
const rig = F.rig({
  height: 56,
  headsTall: 6,
  build: 'average',
  sex: 'neutral',
  age: 60,
  weight: 0.60,
  pose: {
    // Lotus-approximate: thighs lift forward+sideways, shins fold back in
    // beneath the body. raiseFwd lifts the hip-thigh angle, bend folds the
    // shins back so the feet are near the torso base.
    legL: { raiseSide: 50, raiseFwd: 78, bend: 112, twist: 52 },
    legR: { raiseSide: 50, raiseFwd: 78, bend: 112, twist: -52 },
    // Arms resting palm-up on the knees — forward and low.
    armL: { raiseSide: 18, raiseFwd: 48, bend: 28 },
    armR: { raiseSide: 18, raiseFwd: 48, bend: 28 },
    head: { pitch: 7 },       // slightly bowed in meditation
    spine: { lean: 4 },       // gentle forward lean
  },
});

const r = rig.r;
const j = rig.joints;

// 2. HEAD + FACE — calm older face, roman nose, closed eyes with brows.
const head = F.head(rig, { faceShape: 'oval', jaw: 1.0, chin: 0.88 });
const face = F.face.assemble(head, rig, {
  eyes: false,            // eyes hard-unioned at top level for paint labels
  nose: { type: 'roman', length: 1.05, bridge: 1.1, projection: 1.0 },
  mouth: { style: 'smile', expression: 'slightSmile', curve: 0.15 },
  ears: { size: r.head * 0.27 },
  brows: { thickness: 1.0, lift: 0.0 },
});

// Eyes fully closed — 'closed' preset: upper+lower ≥ 1 so lids meet.
// Self-labels: 'eyes', 'lids', 'iris', 'pupil'.
const eyes = F.face.eyes(rig, {
  radius: r.head * 0.155,
  lids: 'closed',
  gaze: 'down',
});

// 3. SKIN — weld body. Bare torso with navel. Bare feet with toes.
const skin = F.weld(rig, [
  F.torso(rig, { navel: true }),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'open' }),
  F.legs(rig),
  F.feet(rig, { toes: true }),
  face,
]).label('skin');

// 4. AREOLAE — flush discs, self-label 'areola'. Hard-unioned at top level.
const nipples = F.nipples(rig);

// 5. HAIR — small bun topknot for a meditator look.
const hair = F.hair(rig, { style: 'bun', volume: 0.7 }).label('hair');

// 6. BASE SYSTEM — The cross-legged pose elevates both feet above z=0, so
// F.base would float at foot height. Instead, build an explicit ground disc
// plus a zafu cushion to visually seat the figure.
const height = rig.opts.height;
const hipZ = j.hips[2];   // Z of the hip joint (~24 for this rig)

// Ground disc — wide and thin, at z=0 (explicit, not auto-risen).
const groundDisc = sdf.roundedCylinder(height * 0.36, height * 0.038, height * 0.01)
  .translate([0, j.hips[1], height * 0.019])
  .label('base');

// Zafu (meditation cushion) — squat cylinder from z=0 up to near hip level.
// Width slightly inside the figure's seated spread for visual authenticity.
const zafuR = r.hipsX * 2.0;
const zafuH = hipZ * 0.82;     // reaches up to ~82% of the hip height
const zafu = sdf.roundedCylinder(zafuR, zafuH, zafuH * 0.18)
  .translate([0, j.hips[1], zafuH * 0.5])
  .label('base');   // same label — one paint region

// 7. Build with face + hand + foot detail.
// edgeLength 0.68 keeps the triangle count under the catalog budget while
// still resolving the closed-lid rims, the nipple nubs, and the toe row.
return sdf.union(skin, eyes, nipples, hair, groundDisc, zafu)
  .build({
    edgeLength: 0.72,
    detail: [
      ...F.faceDetail(rig),
      ...F.handDetail(rig),
      ...F.footDetail(rig),
    ],
  });
