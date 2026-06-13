// Yoga Tree Pose — adult female figure in vrikshasana (tree pose).
// One leg standing straight, the other foot tucked against the inner thigh,
// both arms raised overhead with palms together.
// Showcases: sex:'female', weight:0.32 (new anthropometric axes on F.rig).
// Front = −Y, Z up, figure's left = +X, right = −X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — slim adult female with tree-pose posture.
// sex:'female' adds hourglass: wider hips, narrower shoulders, bust.
// weight:0.32 = lean, athletic.
// Tree pose: left leg standing, right leg raised and tucked.
// Both arms raised overhead: raiseSide ~160, twist 90 so palms come together.
const rig = F.rig({
  height: 46,
  headsTall: 7.5,
  sex: 'female',
  weight: 0.32,
  build: 'slim',
  pose: {
    // Arms: raised overhead, palms together (prayer/namaste).
    // raiseSide 160 = nearly vertical; twist 90 = palm faces inward (toward center).
    // bend 60 brings the forearms inward so palms approach each other overhead.
    // raiseFwd 10 swings arms slightly forward to center them over the body.
    arms: { raiseSide: 160, raiseFwd: 10, bend: 60, twist: 90 },
    // Standing leg (left): straight, slight outward stance
    legL: { raiseSide: 5 },
    // Tree leg (right): raised sideways, knee bent upward to tuck foot near
    // the standing inner thigh. raiseSide lifts the upper leg out, bend brings
    // the lower leg up. raiseFwd ~−5 opens the hip slightly for a natural tuck.
    legR: { raiseSide: 38, raiseFwd: -8, bend: 95, twist: -5 },
    // Head: upward gaze, serene
    head: { pitch: -8, roll: 2 },
    // Slight spine side-lean toward standing leg for balance
    spine: { side: -3 },
  },
});
const r = rig.r;

// 2. HEAD + FACE — serene expression
const head = F.head(rig);
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose:  { tipRadius: r.head * 0.09 },
  mouth: { smirk: 0.15 },
  ears:  { size: r.head * 0.20 },
  brows: {},
});
const eyes = F.face.eyes(rig, { radius: r.head * 0.13 });

// 3. SKIN — relaxed hands (palms-together overhead)
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'open' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. SPORTS BRA — sleeveless top, hem near the ribs
// hemZ just below the chest for a cropped top look.
// The chest joint is at roughly rig.joints.chest[2].
const chesZ = rig.joints.chest[2];
const hemZ  = chesZ - r.chestX * 0.5;   // ~midrib height
const top = F.clothing.top(rig, {
  sleeve: 'none',
  hemZ: hemZ,
  thickness: r.chestX * 0.12,
}).label('top');

// 5. LEGGINGS — full length, slim leg
const leggings = F.clothing.pants(rig, {
  rise: 'high',
  leg: 'slim',
}).label('leggings');

// 6. HAIR — bun (practical yoga style)
const hair = F.hair(rig, { style: 'bun' }).label('hair');

// 7. BASE — circular stand under the standing foot.
// The raised right leg means only the left foot is on the ground.
// F.base auto-sizes to cover the stance footprint.
const base = F.base(rig, {
  radius: rig.opts.height * 0.20,
  thickness: rig.opts.height * 0.035,
}).label('base');

// 8. Hard-union all labelled regions and build.
return sdf.union(skin, eyes, top, leggings, hair, base)
  .build({ edgeLength: 0.5, detail: [...F.faceDetail(rig), ...F.handDetail(rig)] });
