// Arabesque ballet dancer — single-leg balance on the left leg, right leg
// extended straight back and high, front arm reaching forward/up, back arm
// trailing low behind. Showcases: extreme back-leg extension (raiseFwd -60),
// single-leg balance, eyelids (lids:'upper'), female silhouette, tutu at waist,
// bare pointed feet with toes (footDetail), bun hair.
// Different from figure_ballerina (arms-overhead fifth) — this is the horizontal
// arabesque line, front-to-back, one-arm-reaching pose.
// Front = −Y, Z up, figure's left = +X, right = −X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — slim adult female, 7.8 heads tall (elegant adult proportions).
// Arabesque pose:
//   Standing on LEFT leg (straight, slight ballet turnout).
//   RIGHT leg swept back and up: raiseFwd -60 (back), tiny raiseSide.
//     Small bend (8°) on the working leg keeps the foot close to the body volume.
//   Front arm (LEFT): reaching forward and slightly up — raiseFwd 70, raiseSide 12.
//     Gentle bend 10 for a graceful curve.
//   Back arm (RIGHT): trailing behind and low — raiseFwd -40, raiseSide 30.
//   Head forward gaze, serene (pitch -8 = slight upward).
//   Spine: lean forward 8° — a classical arabesque tilts the torso forward
//     as the leg rises behind, creating the horizontal line.
const rig = F.rig({
  height: 50,
  headsTall: 7.8,
  sex: 'female',
  build: 'slim',
  weight: 0.3,
  pose: {
    // Standing leg: slight ballet turnout
    legL: { raiseSide: 6, twist: 20 },
    // Working leg extended straight back and up
    legR: { raiseFwd: -60, raiseSide: 3, bend: 8 },
    // Front arm reaching forward and up
    armL: { raiseFwd: 70, raiseSide: 12, bend: 10 },
    // Back arm trailing low and back
    armR: { raiseFwd: -40, raiseSide: 30, bend: 12 },
    // Head: serene, gaze forward/slightly up
    head: { pitch: -8, yaw: 2 },
    // Spine: lean forward into the arabesque line
    spine: { lean: 8 },
  },
});
const r = rig.r;

// 2. HEAD + FACE — serene arabesque expression, upper lids, delicate lips.
const head = F.head(rig, { faceShape: 'oval', chin: 0.9 });
const face = F.face.assemble(head, rig, {
  eyes:  false,
  nose:  { type: 'straight', tipRadius: r.head * 0.09, projection: 0.85 },
  mouth: false,    // additive lips via mouthAccents below
  ears:  false,
  brows: { lift: 0.1 },
});

// Eyes with defined upper lids for a serene, focused look
const eyes = F.face.eyes(rig, {
  radius: r.head * 0.13,
  lids: 'upper',
  gaze: { yaw: 2, pitch: 5 },
});

// Delicate painted lips
const lips = F.face.mouthAccents(rig, {
  style: 'lips',
  lipShape: 'natural',
  expression: 'slightSmile',
  width: r.head * 0.28,
});

// 3. SKIN — weld body masses. Relaxed hands for the arms-extended pose.
// Bare feet with toes for a pointed ballet foot look.
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'relaxed' }),
  F.legs(rig),
  F.feet(rig, { toes: true }),
  face,
]).label('skin');

// 4. LEOTARD — sleeveless top + briefs, combined as one garment.
const bodice = F.clothing.top(rig, {
  sleeve: 'none',
  thickness: r.chestY * 0.15,
});
const briefs = F.clothing.pants(rig, {
  rise: 'high',
  length: 'briefs',
  thickness: r.upperLeg * 0.20,
});
const leotard = bodice.union(briefs).label('leotard');

// 5. TUTU — short flat disk skirt at the natural waist (spine joint).
// Per the API note: anchor at rig.joints.spine, size off rig.r.waist.
const tutuCenter = rig.joints.spine;
const tutuOuterR = r.waist * 3.2;
const tutuThick  = r.waist * 0.45;

const tutuMain = sdf.roundedCylinder(tutuOuterR, tutuThick, tutuThick * 0.35)
  .translate(tutuCenter);
const tutuUpper = sdf.roundedCylinder(tutuOuterR * 0.62, tutuThick * 0.70, tutuThick * 0.22)
  .translate([tutuCenter[0], tutuCenter[1], tutuCenter[2] + tutuThick * 0.25]);
const tutuLower = sdf.roundedCylinder(tutuOuterR * 0.52, tutuThick * 0.58, tutuThick * 0.20)
  .translate([tutuCenter[0], tutuCenter[1], tutuCenter[2] - tutuThick * 0.55]);

const tutu = tutuMain
  .smoothUnion(tutuUpper, tutuThick * 0.48)
  .smoothUnion(tutuLower, tutuThick * 0.42)
  .label('tutu');

// 6. HAIR — tight bun (classical ballet updo)
const hair = F.hair(rig, { style: 'bun', volume: 1.4 }).label('hair');

// 7. BASE — sized to cover the arabesque stance (one foot grounded, one back/up)
const base = F.base(rig, {
  radius: rig.opts.height * 0.22,
  thickness: rig.opts.height * 0.038,
}).label('base');

// 8. Hard-union all labelled regions and build.
// footDetail resolves sculpted toes; faceDetail refines the face; handDetail for fingers.
return sdf.union(skin, eyes, lips, leotard, tutu, hair, base)
  .build({
    edgeLength: 0.5,
    detail: [
      ...F.faceDetail(rig),
      ...F.handDetail(rig),
      ...F.footDetail(rig),
    ],
  });
