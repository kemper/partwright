// Funk dancer with a big curly afro — shows off the figure API's new hair
// system: the 'afro' style puffs a textured sphere around the skull, and the
// default 'curls' relief is real displaced geometry (it prints, unlike a
// screen-only hair texture). The head tilts and turns, and the hair tracks the
// head pose because it anchors on the head frame. ~6.5 heads tall, slim build.
// Front = −Y, Z up.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — a mid-groove pose: one arm thrown up, one out, a hip-cocked stance,
// head cocked to the side so the afro leans with it.
const rig = F.rig({
  height: 64,
  headsTall: 6.5,
  build: 'slim',
  pose: {
    armR: { raiseSide: 150, raiseFwd: 10, bend: 30, twist: 20 }, // right arm up high
    armL: { raiseSide: 70, raiseFwd: 20, bend: 40 },              // left arm out + bent
    legL: { raiseSide: 6 },
    legR: { raiseSide: 10, twist: 14 },                           // weight on the right leg, toe out
    head: { roll: 10, yaw: -12, pitch: -4 },                      // cocked toward the raised arm
    spine: { side: 6, turn: 8 },
  },
});
const j = rig.joints, r = rig.r;

// 2. HEAD + FACE — smiling, painted.
const head = F.head(rig);
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { tipRadius: r.head * 0.085 },
  mouth: { smirk: 0.25 },
  ears: false,        // the afro covers the sides
  brows: {},
});
const eyes = F.face.eyes(rig, { radius: r.head * 0.14, lids: 'upper' });

// 3. SKIN — both hands open for the dance.
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'open' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. CLOTHES — a fitted tee and slim trousers.
const tee = F.clothing.top(rig, { sleeve: 'short' }).label('tee');
const pants = F.clothing.pants(rig, { rise: 'mid', leg: 'slim' }).label('pants');

// 5. HAIR — the showcase. A voluminous afro with curl relief.
const hair = F.hair(rig, { style: 'afro', volume: 1.5 }).label('hair');

// 6. BASE — a low disc to stand the dancer on.
const base = F.base(rig, {
  radius: rig.opts.height * 0.20,
  thickness: rig.opts.height * 0.04,
}).label('base');

// 7. Hard-union all labeled regions and build.
// faceDetail: fine head mesh so the eyes/mouth and the afro curls resolve.
// handDetail: resolves the sculpted open fingers.
// faceDetail edgeLength bumped a touch coarser than the default so the afro
// curls inside the head detail sphere don't blow the ~200k catalog budget; the
// finer mouth sub-sphere (its own edgeLength) still resolves the smile.
return sdf.union(skin, eyes, tee, pants, hair, base)
  .build({ edgeLength: 0.55, detail: [...F.faceDetail(rig, { edgeLength: r.head * 0.06 }), ...F.handDetail(rig)] });
