// EVAL CASE: shoulders — bare upper body, neutral A-pose, focus on the
// deltoid/shoulder transition where the arm meets the torso. No clothing or
// hair, so the judge scores the shoulder geometry itself. This is the model
// the eval loop iterates: improving F.arms / F.torso shoulder modeling should
// raise this case's score without regressing the rest of the corpus.
//
// Front = −Y, Z up. Arms held slightly out (A-pose) so the deltoid cap and the
// arm-torso seam are both visible from front and 3/4.
const { sdf } = api;
const F = sdf.figure;

const rig = F.rig({
  height: 60,
  headsTall: 7.5,        // realistic adult proportions (not chibi)
  build: 'stocky',       // broader shoulders read the deltoid better
  sex: 'male',
  muscle: 0.8,
  pose: {
    armR: { raiseSide: 18 },   // slight A-pose: deltoid + seam visible
    armL: { raiseSide: 18 },
  },
});

const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'relaxed' }),
  F.legs(rig),
  F.feet(rig),
  F.head(rig),
]).label('skin');

const base = F.base(rig, {
  radius: rig.opts.height * 0.18,
  thickness: rig.opts.height * 0.03,
}).label('base');

return sdf.union(skin, base).build({ edgeLength: 0.5 });
