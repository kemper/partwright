// Morning Yawner — a just-woke-up character mid-stretch, both arms reaching
// overhead, enormous open-mouth yawn, sleepy half-closed eyes, messy spiked
// bedhead, bare torso with navel and areolae, pajama bottoms, bare feet with toes.
//
// Showcase features: half lids (sleepy eyes), open-mouth yawn (painted render),
// spiked messy hair (bedhead), bare torso navel + nipples, bare feet with toes.
//
// Paint regions: skin, eyes, iris, pupil, lids, areola, bottoms, hair, base
// Eyes self-label: eyes, iris, pupil, lids
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — relaxed adult, medium proportions. Both arms overhead in a big stretch.
//    Spine arching slightly back; head tilted back for a wide-open yawn.
const rig = F.rig({
  height: 60,
  headsTall: 6.5,
  build: 'average',
  sex: 'neutral',
  age: 30,
  weight: 0.48,
  pose: {
    // Both arms reaching up — big overhead morning stretch
    // twist:90 makes the forearms curl UP when arms are raised high
    arms: { raiseSide: 155, bend: 32, twist: 90 },
    // Feet slightly apart — relaxed standing
    legs: { raiseSide: 8 },
    // Head neutral/slightly back — yawn shown via open mouth, not head pitch
    head: { pitch: 0, yaw: 8, roll: -3 },
    // Slight back-arch — natural morning stretch
    spine: { lean: -4, side: 1 },
  },
});

const r = rig.r;

// 2. HEAD + FACE — wide yawn open mouth, half-lid sleepy eyes, messy look
const head = F.head(rig, { faceShape: 'oval', jaw: 0.9, chin: 1.0 });

// Open mouth yawn options — big gape, painted (no carved cavity = print-safe)
const mouthOpts = {
  style: 'open',
  open: 0.75,
  width: r.head * 0.52,
  expression: 'neutral',
  render: 'painted',
  teeth: false,
};

const face = F.face.assemble(head, rig, {
  eyes:  false,
  nose:  { type: 'snub', projection: 0.9, width: 1.0, upturn: 0.3 },
  mouth: false,      // using mouthAccents for painted version
  ears:  { size: r.head * 0.26 },
  brows: { lift: 0.05, thickness: 1.0 }, // low, heavy brows — groggy
});

// Painted mouth accents — lips ring around the painted open mouth
const mouthParts = F.face.mouthAccents(rig, mouthOpts);

// Eyes — half lids for sleepy drowsy look (showcase feature)
const eyes = F.face.eyes(rig, {
  radius: r.head * 0.155,
  lids:   'half',
  gaze:   { yaw: 6, pitch: -5 },   // slightly downward and sideways — drowsy
});

// 3. SKIN — bare torso with navel dimple
const skin = F.weld(rig, [
  F.torso(rig, { navel: true }),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'relaxed' }),
  F.legs(rig),
  F.feet(rig, { toes: true }),
  face,
], { k: r.lowerArm * 1.3 }).label('skin');

// 4. AREOLAE — flush paintable discs, hard-unioned at top level
const nipples = F.nipples(rig);

// 5. PAJAMA BOTTOMS — loose, low-rise so the navel stays visible
const bottoms = F.clothing.pants(rig, {
  rise: 'low',
  leg: 'slim',
  thickness: r.upperLeg * 0.28,   // slightly loose/baggy like PJ bottoms
}).label('bottoms');

// 6. HAIR — spiked messy bedhead (showcase: spiked style)
const hair = F.hair(rig, {
  style: 'spiked',
  volume: 0.85,      // kept lower so it doesn't balloon too much
}).label('hair');

// 7. BASE
const base = F.base(rig, {
  radius:    rig.opts.height * 0.28,
  thickness: rig.opts.height * 0.04,
}).label('base');

// 8. Hard-union all labelled regions and build.
//    foot detail required for toes; face + hand detail for features.
return sdf.union(skin, eyes, mouthParts, nipples, bottoms, hair, base)
  .build({ edgeLength: 0.72, detail: [
    ...F.faceDetail(rig),
    ...F.handDetail(rig),
    ...F.footDetail(rig),
  ] });
