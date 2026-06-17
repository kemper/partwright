// Expectant Mother — a serene pregnant woman cradling her belly with both
// hands, gently smiling. Bare midriff shows the navel on a rounded baby bump
// (cropped top + low skirt). Both hands meet under the belly.
// Front = −Y, Z up, figure's left = +X, right = −X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — adult female, average build, slight bust. Both hands cradle the
// belly: arms raised forward and bent so the relaxed hands rest on the bump
// front/underside around navel height. Head slightly down, soft gaze.
const rig = F.rig({
  height: 56,
  headsTall: 7.5,
  sex: 'female',
  build: 'average',
  weight: 0.5,
  bust: 0.55,
  pose: {
    // Classic cradle: upper arm slightly back (raiseFwd -5 drops elbow back),
    // raiseSide -10 tucks arms toward body, bend 90 brings forearms forward
    // and slightly down. Hands should land at ~hip/belly height, Z~32-35,
    // forward of the body at Y~-8 to -11, framing the front of the bump.
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

// 3. BELLY BUMP — a moderate rounded ellipsoid centred just below the navel,
// projecting forward as a natural gravid belly. Sized so it reads as a low,
// rounded bump rather than a mass on the chest:
//   width  half-axis ≈ 4.5 (just under hipsX), depth ≈ 5.1 (the forward swell),
//   height half-axis ≈ 4.7 → the bump spans ≈ Z 24.5–34, staying well below the
//   chest joint (Z 40.5). The center is seated back into the torso so only the
//   front half swells out; the front face lands ≈ Y −9.8, where the cradling
//   hands rest. The navel carve (by F.torso) sits on the bump's front face.
const navel = rig.torso.navel;            // front-surface landmark on the belly
const bumpW = r.hipsX * 1.02;             // half-width, just under the hips
const bumpD = r.chestY * 1.72;            // forward projection (≈5.1) — the swell
const bumpH = r.chestX * 0.95;            // half-height — low gravid bump, not a chest mass
const bumpCenter = [
  navel[0],
  navel[1] - bumpD * 0.34,                // seat the bulk back; front face ≈ Y −9.8
  navel[2] - 1.5,                          // centre just below the navel
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
    edgeLength: 0.72,
    // Drop footDetail — feet are hidden inside the long skirt; save ~15-20k tris.
    detail: [...F.faceDetail(rig), ...F.handDetail(rig)],
  });
