// Meditating Monk — cross-legged lotus pose, eyes closed, bald head, bare torso.
//
// SHOWCASE:
//   • Cross-legged lotus leg-fold — raiseSide + raiseFwd + bend + twist per leg
//   • Eyes CLOSED — F.face.eyes(rig, { lids: 'closed' })
//   • Prominent ears — ears: { size: r.head * 0.24 }
//   • Bald head — F.hair(rig, { style: 'bald' })
//   • Bare-torso anatomy — F.nipples(rig) + F.torso(rig, { navel: true })
//   • Saffron lower robe, serene neutral-smile face
//
// Front = −Y, Z up, figure's left = +X, right = −X.

const { sdf } = api;
const F = sdf.figure;

// 1. RIG — lotus cross-legged seated pose.
// Chair-sit baseline: raiseFwd:90 + bend:90 places pelvis at rest height,
// shins vertical. For lotus cross-legged we additionally spread with raiseSide
// and add twist to turn feet outward. Less raiseFwd than the chair-sit
// (the thighs lift less since legs cross in front at the ground plane).
// spine.lean kept neutral (0) so torso stays upright.
const rig = F.rig({
  height: 50,
  headsTall: 7,
  build: 'average',
  sex: 'male',
  age: 50,
  muscle: 0.15,
  pose: {
    legL: { raiseSide: 55, raiseFwd: 88, bend: 120, twist: 55 },
    legR: { raiseSide: 55, raiseFwd: 88, bend: 120, twist: -55 },
    // Arms: raiseSide ~55 spread outward to where the folded knees are;
    // raiseFwd ~35 swings the arm forward-down to lap level;
    // bend ~85 — elbows bent, hands rest palms-up on the knees.
    armL: { raiseSide: 55, raiseFwd: 35, bend: 85 },
    armR: { raiseSide: 55, raiseFwd: 35, bend: 85 },
    head: { pitch: 10 },
    spine: { lean: 3 },
  },
});

const j = rig.joints;
const r = rig.r;

// 2. HEAD + FACE — oval face, prominent ears, serene expression.
const head = F.head(rig, { faceShape: 'oval', jaw: 0.88, chin: 0.9 });
const face = F.face.assemble(head, rig, {
  eyes:  false,
  nose:  { type: 'straight', tipSize: 0.9, projection: 0.85 },
  mouth: { style: 'smile', expression: 'slightSmile', width: r.head * 0.36 },
  ears:  { size: r.head * 0.24 },
  brows: { lift: 0.05 },
});

// Closed eyes — lids: 'closed' preset causes upper + lower to meet → shut lids.
// Self-labelled ('eyes', 'iris', 'pupil', 'lids') — do NOT wrap in .label().
const eyes = F.face.eyes(rig, {
  radius: r.head * 0.155,
  lids: 'closed',
  gaze: 'down',
});

// 3. SKIN — bare torso (navel added here), bare feet with sculpted toes.
const skin = F.weld(rig, [
  F.torso(rig, { navel: true }),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'open' }),
  F.legs(rig),
  F.feet(rig, { toes: true }),
  face,
]).label('skin');

// 4. NIPPLES — self-labelled 'areola'; hard-union at top level (NOT in weld).
const nipples = F.nipples(rig);

// 5. ROBE — briefs-length lower garment (saffron/maroon wrapped robe).
// Covers pelvis and upper thighs only; the crossed legs are mostly bare.
const robe = F.clothing.pants(rig, {
  rise: 'mid',
  leg: 'slim',
  length: 'briefs',
  thickness: r.hipsX * 0.18,
}).label('robe');

// Extra robe volume — a low disc at the lap/seat to suggest the wrapped cloth
// pooling where the figure sits. Kept narrow so it doesn't read as a skirt.
const robeSkirt = sdf.roundedCylinder(r.hipsX * 1.3, r.hipsY * 0.8, r.hipsX * 0.25)
  .translate([j.hips[0], j.hips[1] + r.hipsX * 0.2, j.hips[2] - r.hipsY * 0.85])
  .label('robe');

// 6. HAIR — bald scalp cap.
const hair = F.hair(rig, { style: 'bald' }).label('scalp');

// 7. BASE — auto-sizes to the lotus pose; generous radius covers the folded legs.
const base = F.base(rig, {
  radius: rig.opts.height * 0.44,
  thickness: rig.opts.height * 0.055,
}).label('base');

// 8. Hard-union all labelled regions and build.
// faceDetail + handDetail (open palms) + footDetail (bare toes).
return sdf.union(skin, eyes, nipples, robe, robeSkirt, hair, base)
  .build({
    edgeLength: 0.5,
    detail: [
      ...F.faceDetail(rig),
      ...F.handDetail(rig),
      ...F.footDetail(rig),
    ],
  });
