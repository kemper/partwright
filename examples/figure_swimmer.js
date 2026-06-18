// Pool Swimmer — a lean athletic figure in low-rise swim trunks, showcasing the
// figure rig's anatomical torso relief: the bare chest carries subtly placed
// nipples and the midriff a navel, both derived from rig.torso surface
// landmarks (so they track the build/sex/weight proportions automatically).
//
// Low-rise trunks deliberately leave the whole midriff bare so the navel reads.
// Relaxed standing pose, arms a touch out from the body, friendly half-smile.
//
// Paint regions: skin, eyes, iris, pupil, trunks, hair, base
// Eyes self-label: eyes, iris, pupil

const { sdf } = api;
const F = sdf.figure;

// 1. RIG — lean athletic male, 7.5 heads tall, average build.
const rig = F.rig({
  height: 60,
  headsTall: 7.5,
  build: 'average',
  sex: 'male',
  weight: 0.35,                       // lean swimmer's build
  pose: {
    arms: { raiseSide: 13 },          // arms relaxed, slightly off the body
    legs: { raiseSide: 7 },
    head: { yaw: -8 },                // slight 3/4 turn for the thumbnail
  },
});

const r = rig.r;

// 2. HEAD + FACE — relaxed, friendly half-smile.
const head = F.head(rig, { faceShape: 'oval', jaw: 1.05 });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { width: 1.0, bridge: 1.05 },
  mouth: { smirk: 0.3 },
  ears: { size: r.head * 0.26 },
  brows: {},
});

// Paintable eyes — hard-unioned at top level with their own labels.
const eyes = F.face.eyes(rig, { radius: r.head * 0.16, lids: 'upper' });

// 3. SKIN — weld the body masses. The bare torso carries a navel; the areolae
//    are a SEPARATE paint region added at the top level (step 4b), like the eyes.
const skin = F.weld(rig, [
  F.torso(rig, { navel: true }),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'relaxed' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4b. AREOLAE — flush paintable discs + tiny nipples, hard-unioned at the top
//     level so the 'areola' paint region survives the body weld.
const nipples = F.nipples(rig, { on: skin });

// 4. SWIM TRUNKS — low rise + briefs length so the whole midriff stays bare and
//    the navel reads. Sits on the hips like swimwear.
const trunks = F.clothing.pants(rig, {
  rise: 'low',
  leg: 'slim',
  length: 'briefs',
  thickness: r.upperLeg * 0.16,
}).label('trunks');

// 5. HAIR — short.
const hair = F.hair(rig, { style: 'short' }).label('hair');

// 6. BASE — display disc.
const base = F.base(rig, { radius: rig.opts.height * 0.24 }).label('base');

// 7. Hard-union all labelled regions and build with face + hand detail so the
//    features (and the subtle nipple/navel relief) mesh cleanly.
return sdf.union(skin, eyes, nipples, trunks, hair, base)
  .build({ edgeLength: 0.42, detail: [...F.faceDetail(rig), ...F.handDetail(rig)] });
