// Expectant Mother — a serene pregnant woman in a short-sleeve maternity
// sundress, both hands resting on her belly, gently smiling. The dress drapes
// over a rounded abdominal bump and flares to a mid-calf hem (fully clothed).
// Front = −Y, Z up, figure's left = +X, right = −X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — adult female, average build, slight bust. Both hands rest on the
// front of the belly: arms tucked in and bent so the relaxed hands meet over
// the bump around navel height. Head slightly down with a soft gaze.
const rig = F.rig({
  height: 56,
  headsTall: 7.5,
  sex: 'female',
  build: 'average',
  weight: 0.5,
  bust: 0.55,
  pose: {
    // Hands rest on the bump: raiseSide -10 tucks the arms in, raiseFwd -5
    // drops the elbows back, bend 90 brings the forearms forward over the
    // belly (hands land ≈ Z 33–35, Y −8 to −10, framing the front of the bump).
    arms: { raiseSide: -10, raiseFwd: -5, bend: 90 },
    // Relaxed stance, slight outward spread.
    legL: { raiseSide: 7 },
    legR: { raiseSide: 7 },
    // Head slightly down, soft serene look.
    head: { pitch: 10, roll: 1 },
  },
});
const r = rig.r;
const j = rig.joints;

// 2. HEAD + FACE — oval face, straight nose, serene half-lids, downward gaze,
// natural lips with a slight smile. Small/tall head → additive lips, not carved.
const head = F.head(rig, { faceShape: 'oval' });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { type: 'straight', tipRadius: r.head * 0.09 },
  mouth: false,
  ears: { size: r.head * 0.20 },
  brows: {},
});
const eyes = F.face.eyes(rig, {
  radius: r.head * 0.13,
  lids: 'half',
  gaze: 'down',                           // serene down-forward look toward the belly
});
const lips = F.face.mouthAccents(rig, {
  style: 'lips',
  lipShape: 'natural',
  expression: 'slightSmile',
});

// 3. SKIN — plain body masses (no bare bump, no navel: the dress covers the
// belly). The pregnant silhouette is carried by the dress drape (§5), so the
// body underneath stays a normal abdomen the dress bulges over.
const skin = F.weld(rig, [
  F.torso(rig, { navel: false }),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'relaxed' }),
  F.legs(rig),
  F.feet(rig, { toes: true }),
  face,
]).label('skin');

// 4. BELLY BUMP shape — a rounded abdominal ellipsoid centred just ABOVE the
// navel, with its bulk over the abdomen and its bottom kept above the hip joint
// (Z 26.1) so the swell reads as a belly, not a low mass at the hips. The dress
// drapes over this; the body itself stays plain.
const navel = rig.torso.navel;            // front-surface landmark on the belly
const bumpW = r.hipsX * 0.95;             // half-width, just under the hips
const bumpD = r.chestY * 1.6;             // forward projection (≈4.7) — the swell
const bumpH = r.chestX * 0.8;             // half-height — bump spans ≈ Z 28–36
const bumpCenter = [
  navel[0],
  navel[1] - bumpD * 0.32,                // seat the bulk back; front face ≈ Y −9.2
  navel[2] + 1.0,                          // centre just above the navel — abdominal
];

// 5. MATERNITY DRESS — a short-sleeve sundress. F.clothing.top with a hem below
// the pelvis auto-becomes a dress: shoulders + sleeves + a flared cone skirt to
// the hem, with a guaranteed-coverage underlayer so no skin shows through. We
// then smooth-union a belly drape (the bump ellipsoid grown by the garment
// thickness) so the dress bulges out over the abdomen — the gravid silhouette.
const t = r.chestY * 0.4;                             // garment thickness
const dressHemZ = rig.opts.height * 0.18;             // ≈ 10 — lower-calf hem
const dressBase = F.clothing.top(rig, {
  sleeve: 'short',
  hemZ: dressHemZ,
  thickness: t,
});
// Belly drape — the bump ellipsoid grown by the garment thickness, so the dress
// bulges out over the abdomen (the gravid silhouette).
const bellyDrape = sdf.ellipsoid(bumpW + t, bumpD + t, bumpH + t).translate(bumpCenter);
// A-line skirt overlay — a generous flared cone from the waist to the hem,
// clearly WIDER than the hips/thighs so the dress stands off the legs. Without
// it the auto-skirt narrows at the hip and the body sits at the dress surface
// there, flipping those triangles to the skin colour (a tan patch on the dress).
const skirtTopZ = j.spine[2];                         // waist line ≈ 30.8
const skirtH = skirtTopZ - dressHemZ;
const skirtOverlay = sdf.cylinder(r.hipsX * 1.25 + t, skirtH)
  .taper(-0.03, 'z')                                  // gentle A-line flare to the hem
  .translate([0, 0, (skirtTopZ + dressHemZ) / 2]);
const dress = dressBase
  .smoothUnion(bellyDrape, t * 1.6)
  .smoothUnion(skirtOverlay, t * 1.2)
  .label('dress');

// 6. HAIR — long.
const hair = F.hair(rig, { style: 'long' }).label('hair');

// 7. BASE — disc under the feet.
const base = F.base(rig, {
  radius: rig.opts.height * 0.22,
  thickness: rig.opts.height * 0.035,
}).label('base');

// 8. Hard-union labelled regions and build.
return sdf.union(skin, eyes, lips, dress, hair, base)
  .build({
    edgeLength: 0.72,
    // Drop footDetail — feet are hidden under the long dress; save ~15-20k tris.
    detail: [...F.faceDetail(rig), ...F.handDetail(rig)],
  });
