// Expectant Mother — a serene pregnant woman cradling her belly with both
// hands, gently smiling. Bare midriff shows the navel on a rounded baby bump
// (cropped top + low skirt). Both hands meet under the belly.
// Front = −Y, Z up, figure's left = +X, right = −X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — adult female, average build, slight bust. Both hands cradle UNDER
// the belly: arms raised forward a little and bent ~85 so the relaxed hands
// meet at the front of the bump. Head slightly down with a soft downward gaze.
const rig = F.rig({
  height: 56,
  headsTall: 7.5,
  sex: 'female',
  build: 'average',
  weight: 0.5,
  bust: 0.55,
  pose: {
    // Both arms cradle the front of the belly: a slight inward tuck
    // (raiseSide −6), gentle forward lift (raiseFwd 18) and a moderate elbow
    // bend (75) bring the relaxed hands together low and forward
    // (≈[±3.1, −12.9, 37.8]) so they meet at the front of the bump. (grip is a
    // hands option, not a pose field — see F.hands below.)
    arms: { raiseSide: -6, raiseFwd: 18, bend: 75 },
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

// 3. BELLY BUMP — a large, high rounded ellipsoid welded onto the front torso so
// it becomes part of 'skin'. Centred above the navel and projected well forward
// (−Y) so its lower-front face rises to meet the cradling hands (≈Z 36, Y −12).
// Tuned so the relaxed hands rest on the underside/front of the bump without
// interpenetrating; the navel (carved by F.torso) sits on its lower face.
const navel = rig.torso.navel;            // front-surface landmark on the belly
const bumpW = r.chestX * 1.12;            // half-width
const bumpD = r.chestY * 1.95;            // forward projection (depth) so the front meets the hands
const bumpH = r.chestX * 1.45;            // half-height
const bumpCenter = [
  navel[0],
  navel[1] - bumpD * 0.32,                // seat the bulk into the torso, only the front swells out
  navel[2] + r.chestX * 0.78,             // raise so the swell spans navel→lower-ribs
];
const bump = sdf.ellipsoid(bumpW, bumpD, bumpH).translate(bumpCenter);

// 4. SKIN — weld body masses + the belly bump (so it shares the skin region),
// then carve the navel on the bump-bearing torso.
const skin = F.weld(rig, [
  F.torso(rig, { navel: true }),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'relaxed' }),
  F.legs(rig),
  F.feet(rig, { toes: true }),
  face,
  bump,
]).label('skin');

// 5. CROPPED TOP — short-sleeve top, hem set above the belly so the midriff
// and navel are bare.
const chestZ = j.chest[2];
const topHemZ = chestZ + r.chestX * 0.15;     // above the bump, baring the midriff
const top = F.clothing.top(rig, {
  sleeve: 'short',
  hemZ: topHemZ,
  thickness: r.chestX * 0.12,
}).label('top');

// 6. LOW SKIRT — long skirt cone seated low at the hips (below the bump), gently
// flaring toward the hem so the belly stays bare above. .taper rate is small
// (scale = 1 + rate·z about the cone centre): a negative rate widens toward −Z
// (the hem) and narrows toward +Z (the waistband). Tuned so the waistband hugs
// the hips (~3.5) and the hem flares (~6.5).
const skirtTopZ = j.upperLegL[2] + r.hipsX * 0.2;   // ≈ 25.7 — low at the hips
const skirtBotZ = rig.opts.height * 0.16;           // ≈ 9.0 — mid-shin hem
const skirtH = skirtTopZ - skirtBotZ;
const skirtMidZ = (skirtTopZ + skirtBotZ) / 2;
const skirt = sdf.cylinder(r.hipsX * 1.15, skirtH)
  .taper(-0.045, 'z')                               // flare downward toward the hem
  .translate([0, 0, skirtMidZ])
  .label('skirt');

// 7. HAIR — long.
const hair = F.hair(rig, { style: 'long' }).label('hair');

// 8. BASE — disc under the feet.
const base = F.base(rig, {
  radius: rig.opts.height * 0.22,
  thickness: rig.opts.height * 0.035,
}).label('base');

// 9. Hard-union labelled regions and build.
return sdf.union(skin, eyes, lips, top, skirt, hair, base)
  .build({
    edgeLength: 0.58,
    detail: [...F.faceDetail(rig), ...F.handDetail(rig), ...F.footDetail(rig)],
  });
