// Lotus Meditation Yogi — adult seated cross-legged in full lotus (padmasana).
// Both legs folded, hands resting palm-up on the knees, eyes closed, spine tall.
// Bare chest with a wrapped cloth (dhoti) over the seat. Bald, serene.
// Front = −Y, Z up, figure's left = +X, right = −X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — slim adult, 6.5 heads. Full-lotus seated pose:
//    legs folded high and forward with strong turnout so the shins cross in
//    front of the pelvis. raiseFwd lifts the thigh forward, bend folds the
//    shin back, raiseSide spreads the knees out, twist turns the hips out so
//    the soles face up. Tuned so the folded shins/thighs DON'T interpenetrate
//    the torso or each other and the figure stays ONE component.
//    arms eased down/out so the open palms land on the knee tops.
const rig = F.rig({
  height: 50,
  headsTall: 6.5,
  build: 'slim',
  age: 35,
  muscle: 0.3,
  pose: {
    legs: { raiseSide: 40, raiseFwd: 80, bend: 124, twist: 22 },
    armL: { raiseSide: 14, raiseFwd: 24, bend: 16 },
    armR: { raiseSide: 14, raiseFwd: 24, bend: 16 },
    head: { pitch: 0 },
    spine: { lean: 0 },
  },
});
const j = rig.joints, r = rig.r;

// 2. HEAD + FACE — oval face, straight nose, ears, closed lids (meditating),
//    very slight serene additive lips. headsTall 6.5 → additive lips, not carved.
const head = F.head(rig, { faceShape: 'oval' });
const face = F.face.assemble(head, rig, {
  eyes:  false,
  nose:  { type: 'straight', tipRadius: r.head * 0.10 },
  mouth: false,
  ears:  { size: r.head * 0.24 },
  brows: {},
});
// Eyes closed for meditation. gaze forward (irrelevant under closed lids).
const eyes = F.face.eyes(rig, { radius: r.head * 0.14, lids: 'closed', gaze: 'middle' });
const lips = F.face.mouthAccents(rig, { style: 'lips', lipShape: 'natural', expression: 'slightSmile' });

// 3. SKIN — bare chest (navel), open palms resting up, barefoot toes (soles up).
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
const nipples = F.nipples(rig);

// 5. DHOTI — short wrapped cloth over the seat/hips (briefs-length pants).
const dhoti = F.clothing.pants(rig, {
  rise: 'mid',
  length: 'briefs',
  thickness: r.upperLeg * 0.24,
}).label('dhoti');

// 6. HAIR — bald.
// (no hair part)

// 7. BASE — wide low cushion/mat: seated figure needs a broad base so the
//    folded knees rest on it. F.base auto-rises to meet the lowest contact.
const base = F.base(rig, {
  radius: rig.opts.height * 0.40,
  thickness: rig.opts.height * 0.04,
}).label('base');

// 8. Hard-union all labelled regions and build.
//    detail: faceDetail (smooth face) + handDetail (open fingers) + footDetail (toes).
return sdf.union(skin, eyes, lips, nipples, dhoti, base)
  .build({
    edgeLength: 0.6,
    detail: [...F.faceDetail(rig), ...F.handDetail(rig), ...F.footDetail(rig)],
  });
