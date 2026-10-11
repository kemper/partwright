// Lotus Meditation Yogi — adult seated cross-legged on a cushion (lotus-style).
// Both legs folded with the shins crossed, hands resting on the knees, eyes closed.
// Bare chest with a wrapped cloth (dhoti) over the seat. Bald, serene.
// Front = −Y, Z up, figure's left = +X, right = −X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — slim adult, 6.5 heads. SEATED CROSS-LEGGED (lotus-style) pose.
//    The rig's pelvis is fixed at standing hip height, so the seat is made by
//    folding the legs and letting a cushion meet the thighs/shins (see BASE):
//      - raiseFwd 84 swings each thigh to NEAR-HORIZONTAL, forward;
//      - raiseSide 24 splays the knees out to either side (knees wide + low,
//        the thighs resting on the cushion);
//      - bend (104 left / 122 right) folds the shin back and twist 90 rolls the
//        knee-bend plane so the shin folds INWARD across the front of the body —
//        the two shins cross in an X with the feet tucked at the midline, the
//        right shin slightly behind the left.
//    spine.lean 10 tips the torso forward so the open hands land on the knees.
//    (The rig's hips are fixed and its shins are short, so the feet cannot be
//    lifted onto the opposite thighs — the shins cross with the feet tucked.)
const rig = F.rig({
  height: 50,
  headsTall: 6.5,
  build: 'slim',
  age: 35,
  muscle: 0.3,
  pose: {
    legL: { raiseSide: 24, raiseFwd: 84, bend: 104, twist: 90 },
    legR: { raiseSide: 24, raiseFwd: 84, bend: 122, twist: 90 },
    // Arms reach forward and down so the open palms land on the knee tops.
    armL: { raiseSide: 10, raiseFwd: 36, bend: 4 },
    armR: { raiseSide: 10, raiseFwd: 36, bend: 4 },
    // A slight chin-tuck: calm, downcast meditative gaze.
    head: { pitch: 14 },
    spine: { lean: 10 },
  },
});
const j = rig.joints,
  r = rig.r;

// 2. HEAD + FACE — oval face, straight nose, ears, closed lids (meditating),
//    very slight serene additive lips. headsTall 6.5 → additive lips, not carved.
const head = F.head(rig, { faceShape: 'oval' });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { type: 'straight', tipRadius: r.head * 0.10 },
  mouth: false,
  ears: { size: r.head * 0.24 },
  brows: {},
});
// Eyes closed for meditation. gaze forward (irrelevant under closed lids).
const eyes = F.face.eyes(rig, { radius: r.head * 0.14, lids: 'closed', gaze: 'middle' });
const lips = F.face.mouthAccents(rig, { style: 'lips', lipShape: 'natural', expression: 'slightSmile' });

// 3. SKIN — bare chest (navel), open palms resting on the knees, barefoot toes (tucked).
const skin = F.weld(rig, [
  F.torso(rig, { navel: true }),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'open' }),
  F.legs(rig),
  F.feet(rig, { toes: true }),
  face,
], { k: r.lowerLeg * 1.3 }).label('skin');

// 4. NIPPLES — top-level part, self-labels 'areola'. Bare chest.
const nipples = F.nipples(rig, { on: skin });

// 5. DHOTI — short wrapped cloth over the seat/hips (briefs-length pants).
const dhoti = F.clothing.pants(rig, {
  rise: 'mid',
  length: 'briefs',
  thickness: r.upperLeg * 0.24,
}).label('dhoti');

// 6. HAIR — bald.
// (no hair part)

// 7. BASE — wide low cushion/mat (zafu). The seated figure's pelvis is fixed at
//    standing hip height, so the cushion top is set from the folded legs rather
//    than the feet: it meets the underside of the thighs and the shins (they
//    sink into it ~0.5 and weld) and sits under the pelvis. The tucked feet's
//    flat soles (z ≈ 17.3) are buried inside the cushion, which extends below.
const cushionTop = rig.joints.upperLegL[2] - r.upperLeg * 1.0 + 0.4; // thigh underside at the hip + 0.4 weld
const cushionH = 3.0;
const cushion = sdf.roundedCylinder(rig.opts.height * 0.40, cushionH, 1.0)
  .translate([0, -3, cushionTop - cushionH / 2]);
const base = cushion.label('base');

// 8. Hard-union all labelled regions and build.
//    detail: faceDetail (smooth face) + handDetail (open fingers) + footDetail (toes).
const built = sdf.union(skin, eyes, lips, nipples, dhoti, base)
  .build({
    edgeLength: 0.6,
    detail: [...F.faceDetail(rig), ...F.handDetail(rig), ...F.footDetail(rig)],
  });
// Seat the cushion on the floor: shift so the model's underside is exactly z = 0.
return built.translate([0, 0, -built.boundingBox().min[2]]);
