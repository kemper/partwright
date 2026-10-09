// Ballerina figurine — elegant ~8 heads tall, arms raised overhead in high
// fifth position (rounded O), one leg lifted back (arabesque-lite), hair in
// a tight bun, tutu at the hips. Stylized art-toy aesthetic.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — elongated elegant proportions (8 heads = very tall/slim).
// Arms raised in high fifth: raiseSide 165, bend 78, twist 90 — the twist rolls
// the (forward) elbow-curl plane inward so the forearms arc toward each other
// over the head, the rounded ballet-fifth "O".
// Arabesque: right leg back (raiseFwd -38, bend 30) — knee bend keeps foot close
// enough to the standing leg/base to remain connected.
const rig = F.rig({
  height: 72,
  headsTall: 8,
  build: 'slim',
  pose: {
    // Arms raised, forearms arc gracefully inward overhead. raiseSide 157 keeps
    // the sculpted fingertips MEETING over the head — at 165 the two hands
    // overlap and the fingers interpenetrate in a tangle.
    arms: { raiseSide: 157, raiseFwd: 0, bend: 78, twist: 90 },
    // Standing left leg: ballet turnout
    legL: { raiseSide: 8 },
    // Arabesque right leg: swept back and up
    legR: { raiseSide: 2, raiseFwd: -38, bend: 30 },
    // Head: upward gaze
    head: { pitch: -13, roll: 2 },
    spine: { lean: 2 },
  },
});

// 2. HEAD + FACE — eyes: false so they get their own paint label at the top level.
// Mouth: delicate carved smile — narrow width, gentle rightward smirk for elegance.
const head = F.head(rig);
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { tipRadius: rig.r.head * 0.09 },
  mouth: false, // the painted lips ridge below IS the mouth
  ears: false,
  brows: {},
});

// 3. SKIN — weld all body parts
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'relaxed' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 3b. EYES — hard-unioned at the top level with their own label so they can be
// painted white/black separately from the skin.
const eyes = F.face.eyes(rig, { radius: rig.r.head * 0.14, lids: 'almond' }); // iris style: labels eyes/iris/pupil itself
// Delicate painted lips ('lips' label) — an additive ridge, so assemble gets mouth: false.
const lips = F.face.mouthAccents(rig, { style: 'lips', width: rig.r.head * 0.3, smirk: 0.12 });

// 4. LEOTARD — snug sleeveless top + briefs (one piece, one label), so the
// pelvis under the tutu is dressed, not bare skin.
const bodice = F.clothing.top(rig, {
  sleeve: 'none',
  thickness: rig.r.chestY * 0.16,
});
const briefs = F.clothing.pants(rig, {
  rise: 'high',
  length: 'briefs',
  thickness: rig.r.upperLeg * 0.22,
});
const leotard = bodice.union(briefs).label('leotard');

// 5. TUTU — wide disk skirt placed at the NAVEL/waist level.
// rig.joints.spine Z ≈ 40.1, which is the natural waistline.
// Tutu at the waist means: torso is visible above it, legs below it.
// This creates the correct visual read of a skirt from the front.
const navelPos = rig.joints.spine;
const navelZ = navelPos[2]; // ≈ 40.1
const bodyR = rig.r.hipsX; // ≈ 5.1 (body half-width at hip level)

// The tutu disk center is at waist level
// Lowered slightly from navel so it sits at the top of the hip area
const tutuCenterZ = navelZ - 2.5; // ≈ 37.6 — just below navel

// Wide outer radius for clear tutu silhouette
const tutuOuterR = rig.opts.height * 0.248; // ≈ 17.9 units
const tutuThick = rig.opts.height * 0.050; // ≈ 3.6 units

// THREE clearly separate tiers stepped in radius AND height — a layered tutu,
// not one melted saucer. Each tier is a thin rounded disc with a clear air gap
// (~0.8) to the next; they stay attached because every tier's disc swallows the
// waist (radius > body), and a SMALL blend (k 0.3) welds them to the body only.
const tierT = tutuThick * 0.44; // ≈ 1.6 units per tier
const tierDz = tutuThick * 0.66; // ≈ 2.4 vertical pitch (gap ≈ 0.8)
const tutuLowerT = sdf.roundedCylinder(tutuOuterR, tierT, tierT * 0.42)
  .translate([0, 0, tutuCenterZ - tierDz]);
const tutuMidT = sdf.roundedCylinder(tutuOuterR * 0.74, tierT, tierT * 0.42)
  .translate([0, 0, tutuCenterZ]);
const tutuTopT = sdf.roundedCylinder(tutuOuterR * 0.48, tierT, tierT * 0.42)
  .translate([0, 0, tutuCenterZ + tierDz]);

const tutu = tutuLowerT
  .smoothUnion(tutuMidT, 0.3)
  .smoothUnion(tutuTopT, 0.3)
  .label('tutu');

// 6. HAIR — tight bun
const hair = F.hair(rig, { style: 'bun' }).label('hair');

// 7. BASE — circular stand (wider to support arabesque extent)
const base = F.base(rig, {
  radius: rig.opts.height * 0.25,
  thickness: rig.opts.height * 0.038,
}).label('base');

// 8. Hard-union all labeled regions and build.
// detail: faceDetail meshes the head finely (~3x finer grid) so the carved
// smile and eye domes are smooth; handDetail resolves the sculpted fingers.
const built = sdf.union(skin, eyes, lips, leotard, tutu, hair, base)
  .build({ edgeLength: 0.52, detail: [...F.faceDetail(rig), ...F.handDetail(rig)] });
// The rig's base disc extends below the soles' z=0 by convention; shift the
// model so the base's underside rests exactly on z = 0.
return built.translate([0, 0, -built.boundingBox().min[2]]);
