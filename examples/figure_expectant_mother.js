// Expectant Mother — a serene pregnant woman in a long-sleeve maternity dress,
// arms relaxed at her sides, gently smiling. The dress drapes over a rounded
// abdominal bump and flares to a mid-calf hem; the sleeves are independent
// garment tubes that follow the arms (fully clothed).
// Front = −Y, Z up, figure's left = +X, right = −X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — adult female, average build, slight bust, and a native pregnant
// `belly` swell. `belly` grows the abdomen ellipsoid FORWARD (and modestly in
// girth/height) while raising its centre so its bottom stays above the hips —
// the swell reads as a belly and can never drop between the legs. Because the
// torso masses feed both the body AND the coverage underlayer of
// `F.clothing.top`, the dress drapes over the bump automatically (no hand-rolled
// drape). Arms relaxed at the sides, slightly abducted with a soft elbow bend so
// the hands hang at the hips clear of the belly. Head slightly down, soft gaze.
const rig = F.rig({
  height: 56,
  headsTall: 7.5,
  sex: 'female',
  build: 'average',
  weight: 0.5,
  bust: 0.55,
  belly: 0.7,                               // pronounced third-trimester swell
  pose: {
    // Arms relaxed at the sides, slightly abducted (raiseSide 10) so they stand
    // off the body and the sleeves read as independent arms, with a soft elbow
    // bend. Hands hang at the hips, clear of the belly.
    arms: { raiseSide: 10, raiseFwd: 0, bend: 12 },
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
  brows: false,                           // built at top level so the 'brows' colour survives
});
const eyes = F.face.eyes(rig, {
  radius: r.head * 0.13,
  lids: 'half',
  gaze: 'down',                           // serene down-forward look toward the belly
});
// Flush, painted-on brows (labelled 'brows'). Kept OUT of the skin weld and
// hard-unioned at the top level (like the eyes) so the dark brow colour isn't
// flattened into skin. Soft 'natural' arch to match the serene expression.
const brows = F.face.brows(rig, { shape: 'natural' });
const lips = F.face.mouthAccents(rig, {
  style: 'lips',
  lipShape: 'natural',
  expression: 'slightSmile',
});

// 3. SKIN — plain body masses (no navel: the dress covers the belly). The rig's
// `belly` swell shapes the abdomen, so the pregnant silhouette is built into the
// body itself; the dress (§4) simply drapes over it.
const skin = F.weld(rig, [
  F.torso(rig, { navel: false }),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'relaxed' }),
  F.legs(rig),
  F.feet(rig, { toes: true }),
  face,
]).label('skin');

// 4. DRESS BODY — a SLEEVELESS maternity dress (its own region). F.clothing.top
// with a hem below the pelvis and sleeve:'none' gives a bodice + flared cone
// skirt + a coverage underlayer with NO sleeves (the arm garment stays
// independent, §5). The coverage underlayer is offset from the rig's torso —
// which now carries the `belly` swell — so the dress bulges over the abdomen for
// free; no hand-rolled belly drape is needed.
const t = r.chestY * 0.4;                             // garment thickness
const dressHemZ = rig.opts.height * 0.18;             // ≈ 10 — lower-calf hem
const dress = F.clothing.top(rig, {
  sleeve: 'none',
  hemZ: dressHemZ,
  thickness: t,
}).label('dress');

// 5. SLEEVES — INDEPENDENT garment tubes that follow each arm (shoulder → elbow
// → wrist), their own labelled region so they read as sleeves rather than a blob
// fused into the bodice. A shoulder cap sphere bridges the bare-shouldered bodice
// to the sleeve top so no skin shows at the deltoid. Hands stay bare past the
// wrist, hanging at the sides clear of the belly.
const sleeveRad = r.upperArm + t * 0.7;
function makeSleeve(S, E, W) {
  return sdf.capsule(S, E, sleeveRad)
    .smoothUnion(sdf.capsule(E, W, sleeveRad * 0.9), r.lowerArm * 0.7)
    .smoothUnion(sdf.sphere(sleeveRad * 1.1).translate(S), r.upperArm * 0.6);
}
const sleeves = sdf.union(
  makeSleeve(j.upperArmL, j.lowerArmL, j.wristL),
  makeSleeve(j.upperArmR, j.lowerArmR, j.wristR),
).label('sleeves');

// 6. HAIR — long.
const hair = F.hair(rig, { style: 'long' }).label('hair');

// 7. BASE — disc under the feet.
const base = F.base(rig, {
  radius: rig.opts.height * 0.22,
  thickness: rig.opts.height * 0.035,
}).label('base');

// 8. Hard-union labelled regions and build.
return sdf.union(skin, eyes, brows, lips, dress, sleeves, hair, base)
  .build({
    edgeLength: 0.78,
    // Only faceDetail — feet are hidden under the long dress and the hands hang
    // small at the sides, so footDetail/handDetail aren't worth the triangles.
    detail: [...F.faceDetail(rig)],
  });
