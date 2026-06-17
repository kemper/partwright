// Tai Chi Master — "white crane spreads its wings" balance.
// Elderly man on a slightly bent standing left leg, right knee raised forward,
// right arm raised up-and-forward with an open palm, left arm low with a
// downward open palm. Serene half-lidded gaze, open-robe bare chest, topknot.
// Front = −Y, Z up, figure's left = +X, right = −X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — tall elderly man, 7 heads, average build, light/lean (weight 0.5),
//    a touch of muscle tone (0.2). The white-crane balance:
//      legL: standing, slightly bent knee, small stance.
//      legR: raised — knee lifted forward (raiseFwd 25), lifted a little to the
//            side (raiseSide 14), knee bent up (bend 70).
//      armR: raised up-and-forward (raiseSide 55, raiseFwd 35) — open palm.
//      armL: low, slightly forward and out (raiseSide 20, raiseFwd 20) — palm down.
//      head: level, gaze level forward; gentle spine.
const rig = F.rig({
  height: 60,
  headsTall: 7,
  build: 'average',
  sex: 'male',
  age: 68,
  weight: 0.5,
  muscle: 0.2,
  pose: {
    armR: { raiseSide: 58, raiseFwd: 38, bend: 16 },   // raised up-forward, open palm
    armL: { raiseSide: 22, raiseFwd: 18, bend: 12 },   // low, palm angled down
    legL: { raiseSide: 6, bend: 14 },                  // standing, slightly bent
    legR: { raiseSide: 14, raiseFwd: 28, bend: 74 },   // knee raised forward
    head: { pitch: 0 },                                // level gaze
    spine: { lean: 2, side: -2 },                      // gentle weight shift over standing leg
  },
});
const j = rig.joints, r = rig.r;

// 2. HEAD + FACE — long face, roman nose, ears, serene half-lids, calm lips.
//    headsTall 7 → use additive lips (mouthAccents), not a carved mouth.
const head = F.head(rig, { faceShape: 'long' });
const face = F.face.assemble(head, rig, {
  eyes:  false,
  nose:  { type: 'roman', tipRadius: r.head * 0.09 },
  mouth: false,
  ears:  { size: r.head * 0.24 },
  brows: {},
});
// Serene half-lids, gaze straight forward.
const eyes = F.face.eyes(rig, { radius: r.head * 0.14, lids: { upper: 0.4, lower: 0.1 }, gaze: 'middle' });
const lips = F.face.mouthAccents(rig, { style: 'lips', lipShape: 'natural', expression: 'slightSmile' });

// 3. SKIN — bare chest (navel) + open palms on both hands + barefoot toes.
const skin = F.weld(rig, [
  F.torso(rig, { navel: true }),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'open' }),
  F.legs(rig),
  F.feet(rig, { toes: true }),
  face,
]).label('skin');

// 4. NIPPLES — top-level part, self-labels 'areola'. Bare open-robe chest.
const nipples = F.nipples(rig);

// 5. TROUSERS — loose full-length pants.
const pants = F.clothing.pants(rig, {
  rise: 'mid',
  leg: 'cargo',
  thickness: r.upperLeg * 0.26,
}).label('pants');

// 6. HAIR — grayed topknot (bun), receding 'high' hairline.
const hair = F.hair(rig, { style: 'bun', hairline: 'high' }).label('hair');

// 7. BASE — auto-sizes to the standing footprint (only the left foot grounds).
const base = F.base(rig, { radius: rig.opts.height * 0.22 }).label('base');

// 8. Hard-union all labelled regions and build.
//    detail: faceDetail (smooth face) + handDetail (open fingers) + footDetail (toes).
return sdf.union(skin, eyes, lips, nipples, pants, hair, base)
  .build({
    edgeLength: 0.62,
    detail: [...F.faceDetail(rig), ...F.handDetail(rig), ...F.footDetail(rig)],
  });
