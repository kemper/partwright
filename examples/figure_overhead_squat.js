// Overhead Squatter — a muscular weightlifter in a deep overhead squat,
// gripping a barbell locked straight above with both hands.
//
// Showcases: high `muscle` (0.8) — pecs, abs, lats, traps, biceps, quads,
// hamstrings, glutes; deep squat legs (knees wide); two-handed barbell via
// F.spanGrips with fat weight plates — welded into ONE solid component via
// smoothUnion with the skin so it's one printable piece; nipples on the bare
// muscular chest; gritted open-mouth effort expression (render:'painted').
//
// Paint regions: skin, areola, barbell, shorts, shoes, sole, hair, base
// Front = −Y, Z up, figure's left = +X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — athletic male, high muscle, deep overhead squat.
//    Arms locked overhead (raiseSide:162, slight bend, twist:90 keeps fists up).
//    Legs in deep squat: knees out (raiseSide:14), hips forward (raiseFwd:75),
//    heavily bent (bend:100) for a true ass-to-grass squat.
const rig = F.rig({
  height: 60,
  headsTall: 7,
  sex: 'male',
  build: 'average',
  weight: 0.4,
  muscle: 0.8,
  pose: {
    arms: { raiseSide: 162, bend: 8, twist: 90 },
    legL: { raiseSide: 14, raiseFwd: 75, bend: 100 },
    legR: { raiseSide: 14, raiseFwd: 75, bend: 100 },
    spine: { lean: 10 },
    head: { pitch: -8 },
  },
});

const r = rig.r;
const j = rig.joints;

// 2. HEAD + FACE — gritted effort expression, open mouth with painted render
//    (no carved cavity — print-safe with the bar overhead)
const mouthOpts = {
  style: 'open',
  open: 0.35,
  expression: 'deepFrown',
  render: 'painted',
  teeth: 'both',
};
const head = F.head(rig, { faceShape: 'square', jaw: 1.1, cheek: 1.05 });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { type: 'straight', length: r.head * 0.26, bridge: 1.0 },
  mouth: false,
  ears: { size: r.head * 0.26 },
  brows: { thickness: 1.4, lift: 0.0 },
});

// Mouth accents at top level for painted render
const mouthParts = F.face.mouthAccents(rig, mouthOpts);

// Paintable eyes — squinting under load, looking slightly up at the bar
const eyes = F.face.eyes(rig, {
  radius: r.head * 0.17,
  lids: { upper: 0.36, lower: 0.14 },
  gaze: { yaw: 0, pitch: -8 },
});

// 3. NIPPLES — bare chest, top-level so 'areola' label survives
const nipples = F.nipples(rig);

// 4. TWO-HANDED BARBELL via F.spanGrips
//    spanGrips returns the frame: {a, b, axis, length, mid}
//    a = left grip cup, b = right grip cup, axis = unit direction a→b
const s = F.spanGrips(rig.grip.L, rig.grip.R);

// Bar shaft: extends past each grip cup so plates clear the fists
const barR  = r.lowerArm * 0.30;  // barbell shaft radius
const ext   = r.hand * 3.0;       // extension past each grip cup

const barA = [
  s.a[0] + s.axis[0] * ext,
  s.a[1] + s.axis[1] * ext,
  s.a[2] + s.axis[2] * ext,
];
const barB = [
  s.b[0] - s.axis[0] * ext,
  s.b[1] - s.axis[1] * ext,
  s.b[2] - s.axis[2] * ext,
];
const shaft = sdf.capsule(barA, barB, barR);

// Weight plates: large flat discs near each end of the bar.
// To make convincing FLAT discs: use a large smoothIntersect of a big sphere
// (defining the radius) with a slab (defining the thickness).
// The slab is the space between two parallel planes along the bar axis.
const plateR    = r.lowerArm * 2.2;   // 45-lb plate radius (large)
const plateHalf = r.lowerArm * 0.14;  // half-thickness along bar axis (thin disc)

// Plate centres: inboard from bar tips
const pOffsetA = ext * 0.60;
const pOffsetB = ext * 0.60;
const plateCtrA = [
  s.a[0] + s.axis[0] * pOffsetA,
  s.a[1] + s.axis[1] * pOffsetA,
  s.a[2] + s.axis[2] * pOffsetA,
];
const plateCtrB = [
  s.b[0] - s.axis[0] * pOffsetB,
  s.b[1] - s.axis[1] * pOffsetB,
  s.b[2] - s.axis[2] * pOffsetB,
];

// Build plate: intersect a big sphere with a thin slab (box extent in bar direction)
// For bar axis ≈ +X direction: box in Y/Z is large (plate radius), tiny in X (thickness).
// But since bar axis varies with pose, use the capsule-as-disc trick with extreme aspect ratio.
// plateHalf = 0.14 * rLowerArm; radius = 2.2 * rLowerArm → very flat at the ends of the capsule.
const mkPlate = (ctr) => sdf.capsule(
  [ctr[0] - s.axis[0]*plateHalf, ctr[1] - s.axis[1]*plateHalf, ctr[2] - s.axis[2]*plateHalf],
  [ctr[0] + s.axis[0]*plateHalf, ctr[1] + s.axis[1]*plateHalf, ctr[2] + s.axis[2]*plateHalf],
  plateR,
);

const plateA = mkPlate(plateCtrA);
const plateB = mkPlate(plateCtrB);

// Barbell: weld plates onto shaft with smooth blend
const barbell = shaft
  .smoothUnion(plateA, barR * 0.6)
  .smoothUnion(plateB, barR * 0.6)
  .label('barbell');

// 5. WELDED SKIN — weld all body masses PLUS the barbell together
//    so the bar overlaps the fists and the whole assembly is ONE component.
//    The smoothUnion k must be large enough (≥ 0.5 units) to guarantee overlap.
const weldK = r.hand * 0.7;
const body = F.weld(rig, [
  F.torso(rig, { navel: true }),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'fist', fingers: false }),
  F.legs(rig),
  F.feet(rig),
  face,
]);
// Weld the barbell into the body before labelling — this ensures the shaft
// overlaps the fist capsules and creates ONE component.
// Body alone is 'skin'; the barbell keeps its own 'barbell' label and is
// hard-unioned at the top level (it already overlaps the fists via spanGrips, so
// the assembly stays ONE component) — a relabel-to-skin painted it flesh-coloured.
const skin = body.label('skin');

// 6. SHORTS — compression lifting shorts, show the legs
const shorts = F.clothing.pants(rig, {
  rise: 'mid',
  leg: 'slim',
  length: 'briefs',
}).label('shorts');

// 7. LIFTING SHOES — flat-soled squat shoes
const shoes = F.clothing.shoes(rig, {
  thickness: r.foot * 0.16,
  sole: { style: 'welt', thickness: r.foot * 0.26 },
}).label('shoes');

// 8. HAIR — short athletic crop
const hair = F.hair(rig, { style: 'short' }).label('hair');

// 9. BASE — wide disc for the squat stance
const base = F.base(rig, { radius: rig.opts.height * 0.28 }).label('base');

// 10. Build — faceDetail for smooth face + handDetail for fists
//     Note: barbell is already welded into skin via smoothUnion above,
//     so it is NOT listed separately in sdf.union (it's part of skin).
return sdf.union(skin, barbell, eyes, nipples, mouthParts, shorts, shoes, hair, base)
  .build({ edgeLength: 0.66, detail: F.faceDetail(rig) });
