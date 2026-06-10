// Ballerina figurine — elegant ~8 heads tall, arms raised overhead in high
// fifth position (rounded O), one leg lifted back (arabesque-lite), hair in
// a tight bun, tutu at the hips. Stylized art-toy aesthetic.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — elongated elegant proportions (8 heads = very tall/slim).
// Arms raised in high fifth: abduct 165, elbow 78 creates graceful forearm curve.
// Arabesque: right leg back (flex -38, knee 30) — knee bend keeps foot close
// enough to the standing leg/base to remain connected.
const rig = F.rig({
  height: 72,
  headsTall: 8,
  build: 'slim',
  pose: {
    // Arms raised, forearms arc gracefully overhead
    armL: { abduct: 165, flex: 0, elbow: 78 },
    armR: { abduct: 165, flex: 0, elbow: 78 },
    // Standing left leg: ballet turnout
    legL: { abduct: 8 },
    // Arabesque right leg: swept back and up
    legR: { abduct: 2, flex: -38, knee: 30 },
    // Head: upward gaze
    head: { nod: -13, tilt: 2 },
    spine: { lean: 2 },
  },
});

// 2. HEAD + FACE
const head = F.head(rig);
const face = F.face.assemble(head, rig, {
  eyes: { radius: rig.r.head * 0.14 },
  nose: { tipRadius: rig.r.head * 0.09 },
  mouth: { smirk: 0.1, width: rig.r.head * 0.40 },
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

// 4. LEOTARD — snug sleeveless top
const leotard = F.clothing.top(rig, {
  sleeve: 'none',
  thickness: rig.r.chestY * 0.16,
}).label('leotard');

// 5. TUTU — wide disk skirt placed at the NAVEL/waist level.
// rig.joints.navel Z ≈ 40.1, which is the natural waistline.
// Tutu at the waist means: torso is visible above it, legs below it.
// This creates the correct visual read of a skirt from the front.
const navelPos  = rig.joints.navel;
const navelZ    = navelPos[2];    // ≈ 40.1
const bodyR     = rig.r.pelvisX;  // ≈ 5.1 (body half-width at hip level)

// The tutu disk center is at waist level
// Lowered slightly from navel so it sits at the top of the hip area
const tutuCenterZ = navelZ - 2.5;   // ≈ 37.6 — just below navel

// Wide outer radius for clear tutu silhouette
const tutuOuterR  = rig.opts.height * 0.248;   // ≈ 17.9 units
const tutuThick   = rig.opts.height * 0.050;   // ≈ 3.6 units

// Main wide horizontal disk
const tutuMain = sdf.roundedCylinder(tutuOuterR, tutuThick, tutuThick * 0.36)
  .translate([0, 0, tutuCenterZ]);

// Upper layer: slightly smaller, above the main disk, for tutu layered volume
const tutuUpper = sdf.roundedCylinder(tutuOuterR * 0.60, tutuThick * 0.72, tutuThick * 0.24)
  .translate([0, 0, tutuCenterZ + tutuThick * 0.22]);

// Lower flounce: thin small layer below for depth
const tutuLower = sdf.roundedCylinder(tutuOuterR * 0.50, tutuThick * 0.60, tutuThick * 0.22)
  .translate([0, 0, tutuCenterZ - tutuThick * 0.55]);

const tutu = tutuMain
  .smoothUnion(tutuUpper, tutuThick * 0.50)
  .smoothUnion(tutuLower, tutuThick * 0.45)
  .label('tutu');

// 6. HAIR — tight bun
const hair = F.hair(rig, { style: 'bun' }).label('hair');

// 7. BASE — circular stand (wider to support arabesque extent)
const base = F.base(rig, {
  radius: rig.opts.height * 0.25,
  thickness: rig.opts.height * 0.038,
}).label('base');

// 8. Hard-union all labeled regions and build
return sdf.union(skin, leotard, tutu, hair, base).build({ edgeLength: 0.52 });
