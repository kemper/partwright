// The Thinker — classical contemplative seated nude in the Rodin pose.
//
// SHOWCASE:
//   • Seated-on-plinth pose with chin-on-fist (hand-to-face mechanics)
//   • Bare-torso anatomy — F.nipples(rig) + F.torso(rig, { navel: true })
//   • Downward brooding gaze + brows
//   • Strong facial features — square jaw + roman nose
//   • Short curly hair, bare feet with toes
//   • Plinth + ground slab = one component
//
// The figure sits on a low cube/plinth. Right arm crosses toward the left knee
// with chin resting on the back of the right fist. Left forearm rests on the
// left thigh. Head bows in contemplation.
// Front = −Y, Z up, figure's left = +X, right = −X.

const { sdf } = api;
const F = sdf.figure;

// Constants
const figH = 54;  // figure height

// Plinth seat height — a comfortable sit height (~27% of figure height).
const plinthH = figH * 0.27;   // ~14.6 — the seat surface Z

// 1. RIG — seated on plinth, chin-on-fist brooding pose.
// Chair-sit baseline: legs raiseFwd:90, bend:90 (thighs horizontal, shins down).
// Spine forward lean + slight twist. Head pitching down (bowing).
// Right arm: raiseFwd ~55 (swings arm forward), bend ~135 (folds forearm up
//   toward face), twist ~-85 (rotates so elbow-curl points the fist upward).
// Left arm: raiseSide ~18, raiseFwd ~40, bend ~55 (forearm rests on left thigh).
const rig = F.rig({
  height: figH,
  headsTall: 7.5,
  build: 'average',
  sex: 'male',
  muscle: 0.45,
  pose: {
    legL: { raiseSide: 12, raiseFwd: 90, bend: 90 },
    legR: { raiseSide: 12, raiseFwd: 90, bend: 90 },
    armR: { raiseSide: 12, raiseFwd: 56, bend: 136, twist: -85 },
    armL: { raiseSide: 18, raiseFwd: 38, bend: 55 },
    head:  { pitch: 24, yaw: 5 },
    spine: { lean: 10, turn: -8 },
  },
});

const j = rig.joints;
const r = rig.r;

// Inspect where the figure actually sits and its foot positions.
// For the plinth: its top should be at or just below the pelvis bottom.
// j.hips[2] is the pelvis center Z; plinth top ≈ j.hips[2] - r.hipsY.
// For the base/feet: the lowest point of the figure tells us where to put a floor.
// In a chair-sit pose the feet hang below the seat at roughly z ≈ j.hips[2] - upper leg − lower leg.

// 2. PLINTH — the low block the figure sits on. The plinth wraps the pelvis/hips.
// Its top Z must meet the pelvis bottom. Set it to be positioned so its top is at
// the foot of the hips. The plinth center Z = plinthH/2.
// Size it to overlap both the hips (which are at j.hips) AND to be wide
// enough that the figure's pelvis (± hipsX, ± hipsY) sits inside it.
const plinthW = r.hipsX * 3.2;
const plinthD = r.hipsY * 3.0;
// Plinth height: from z=0 to just below the pelvis bottom.
// Pelvis bottom is approximately j.hips[2] - r.hipsY.
// We want plinthH ≈ j.hips[2] - r.hipsY + a small buffer to ensure overlap.
const seatZ = j.hips[2] - r.hipsY * 0.5;  // where the plinth top meets the body
const actualPlinthH = seatZ;
const plinthCz = actualPlinthH / 2;

const plinth = sdf.roundedBox([plinthW, plinthD, actualPlinthH], r.foot * 0.4)
  .translate([0, 0, plinthCz])
  .label('plinth');

// 3. GROUND SLAB — a wide flat disc at z=0 that the feet rest on.
// The feet in the chair-sit pose hang below the seat. We need the slab to
// reach the feet AND connect to the plinth base. The slab is wider than the
// plinth and extends to cover the foot positions.
// Foot Y is approximately j.footL[1] (negative Y, in front of body).
const slabR = figH * 0.42;
const slabH = figH * 0.038;
// Center the slab between the plinth front face and the foot Y.
const footAvgY = (j.footL[1] + j.footR[1]) / 2;
const slabCy = (footAvgY - plinthD / 2) / 2;   // midpoint: foot Y to plinth front
const groundSlab = sdf.roundedCylinder(slabR, slabH, r.foot * 0.25)
  .translate([0, slabCy, slabH / 2])
  .label('plinth');

// 4. HEAD + FACE — square jaw, roman nose, brooding brow.
const head = F.head(rig, { faceShape: 'square', jaw: 1.1, chin: 1.0, cheek: 1.05 });
const face = F.face.assemble(head, rig, {
  eyes:  false,
  nose:  { type: 'roman', projection: 1.05, bridge: 1.1 },
  mouth: { style: 'lips', lipShape: 'flat', expression: 'slightFrown' },
  ears:  { size: r.head * 0.22 },
  brows: { thickness: 1.2, lift: 0 },
});

// Eyes with upper lids and downward gaze — brooding look.
const eyes = F.face.eyes(rig, {
  radius: r.head * 0.155,
  lids: 'upper',
  gaze: 'lower-right',
});

// 5. SKIN — bare torso (navel: true), bare feet with sculpted toes.
const skin = F.weld(rig, [
  F.torso(rig, { navel: true }),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'fist' }),
  F.legs(rig),
  F.feet(rig, { toes: true }),
  face,
]).label('skin');

// 6. NIPPLES — self-labelled 'areola'; hard-union at top level.
const nipples = F.nipples(rig);

// 7. SHORT CURLY HAIR
const hair = F.hair(rig, { style: 'short', texture: 'curls', volume: 1.1 }).label('hair');

// 8. Hard-union skin + features + plinth + slab.
// The plinth meets the figure's pelvis bottom; the ground slab meets the feet.
// Both the plinth and slab overlap to form one connected base piece.
return sdf.union(skin, eyes, nipples, hair, plinth, groundSlab)
  .build({
    edgeLength: 0.60,
    detail: [
      ...F.faceDetail(rig),
      ...F.handDetail(rig),
      ...F.footDetail(rig),
    ],
  });
