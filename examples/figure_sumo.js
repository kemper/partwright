// Sumo Wrestler — wide low stance, pre-bout crouch, topknot hair, mawashi.
// Spotlights the weight + male axes: sex:'male', weight:1, build:'stocky'.
// Big belly from the weight axis, broad shoulders from sex:'male'.
// Pose: low wide stance (legs spread + slight bend), arms out+forward
//       (pre-bout slap/crouch), slight forward spine lean.
//
// Paint regions: skin, mawashi, hair, base
// Eyes self-label: eyes, iris, pupil

const { sdf } = api;
const F = sdf.figure;

// 1. RIG — heavy male, 6 heads tall, stocky build, low crouch pose
const rig = F.rig({
  height: 46,
  headsTall: 6,
  sex: 'male',
  weight: 1,
  build: 'stocky',
  pose: {
    // Wide low stance — legs spread out to sides, slight forward crouch bend
    legs: { raiseSide: 22, bend: 18 },
    // Arms out and forward — pre-bout slap crouch
    arms: { raiseSide: 55, raiseFwd: 25, bend: 40 },
    // Slight forward lean for the crouch/intimidation pose
    spine: { lean: 14 },
    // Head slightly down/forward — focused stare
    head: { pitch: 10, yaw: 0 },
  },
});

// 2. HEAD + FACE — fierce concentration; slight frown, strong brows
const head = F.head(rig);
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { tipRadius: rig.r.head * 0.15, length: rig.r.head * 0.20 },
  mouth: { smirk: -0.15 },   // slight downward set — focused intensity
  ears: { size: rig.r.head * 0.25 },
  brows: { lift: 0 },        // flat brows — concentration/intensity
});

// Paintable eyes — hard-unioned at top level with their own label
const eyes = F.face.eyes(rig, { radius: rig.r.head * 0.16 });

// 3. SKIN — weld all body masses
// Use relaxed hands — palms ready for the slap
const skin = F.weld(rig, [
  // Shirtless — relief the nipples + navel so the bare chest/belly read as
  // anatomy. They track the wide weight:1 belly and broad male chest.
  F.torso(rig, { nipples: true, navel: true }),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'relaxed' }),
  F.legs(rig),
  F.feet(rig),
  face,
], { k: rig.r.lowerArm * 1.0 }).label('skin');

// 4. MAWASHI — the sumo belt/loincloth: briefs-length pants, high rise
// The weight:1 makes the waist/belly wide, so briefs here reads as a
// traditional mawashi wrap covering the hips and seat.
const mawashi = F.clothing.pants(rig, {
  rise: 'high',
  leg: 'slim',
  length: 'briefs',
  thickness: rig.r.upperLeg * 0.18,
}).label('mawashi');

// 5. HAIR — topknot (chonmage) bun on top of the head
const hair = F.hair(rig, {
  style: 'bun',
  volume: 0.7,
}).label('hair');

// 6. BASE — wide disc to match the broad stance
const base = F.base(rig, {
  radius: rig.opts.height * 0.35,
  thickness: rig.opts.height * 0.04,
}).label('base');

// 7. Hard-union all labelled regions and build.
// Face detail for smooth features; relaxed hands don't need hand detail.
return sdf.union(skin, eyes, mawashi, hair, base)
  .build({ edgeLength: 0.5, detail: F.faceDetail(rig) });
