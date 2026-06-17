// Boxer in Guard — a muscular fighter in a high guard stance: both fists up by
// the cheeks, a slight forward crouch with knees bent, bare chest to show the
// build (muscle 0.7, stocky), and an intense focused stare. Boxing trunks +
// short boots. Spotlights the male + muscle + stocky silhouette and the carved
// jaw / broken-looking bulbous nose.
// Front = −Y, Z up, figure's left = +X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — short, broad, muscular man. The guard:
//   Both arms tuck the elbows low-and-forward (raiseSide 10, raiseFwd 78) and the
//   forearms fold up hard (bend 152) so the fists ride up beside the cheeks at
//   temple height — verified via poseProbe: handL/R ≈ ±[6.8, -3.8, 50.5], chin at
//   [0, -2.5, 48.4], so the fists flank the face (~1 unit off the cheeks).
//   Knees softly bent (legs raiseSide 12, bend 15) in a wide planted crouch.
//   Spine leaned 8° forward, head dipped slightly (pitch 8) — eyes up and locked
//   forward over the gloves.
const rig = F.rig({
  height: 56,
  headsTall: 7.5,
  sex: 'male',
  build: 'stocky',
  muscle: 0.7,
  weight: 0.4,
  pose: {
    // Symmetric high guard — both fists up by the face.
    arms: { raiseSide: 10, raiseFwd: 78, bend: 152, twist: 0 },
    // Wide, bent-knee crouch.
    legs: { raiseSide: 12, bend: 15 },
    // Forward lean of the upper body; chin tucked, eyes up.
    spine: { lean: 8 },
    head: { pitch: 8 },
  },
});
const r = rig.r;

// 2. HEAD + FACE — square head, strong wide jaw, a flattened/broken bulbous nose.
//    Tough set: flat lips with a slight frown (additive lips — clean on a tall
//    head, no carved groove to tear). Intense upper-lid eyes, gaze forward.
const mouthOpts = { style: 'lips', lipShape: 'flat', expression: 'slightFrown', width: r.head * 0.5 };
const head = F.head(rig, { faceShape: 'square', jaw: 1.3, cheek: 1.05 });
const face = F.face.assemble(head, rig, {
  eyes: false,
  // Bulbous nose, low bridge + slight downturn so it reads as a flattened,
  // broken boxer's nose.
  nose: { type: 'bulbous', bridge: 0.7, upturn: -0.15, width: 1.4 },
  mouth: false,
  ears: { size: r.head * 0.24 },
  brows: { thickness: 1.4, lift: 0 },
});

// Painted flat lips (additive) + paintable iris eyes, hard upper-lid set,
// gaze straight forward over the gloves.
const lips = F.face.mouthAccents(rig, mouthOpts);
const eyes = F.face.eyes(rig, { radius: r.head * 0.15, lids: 'upper', gaze: 'middle' });

// 3. SKIN — weld every body mass. Bare torso carries a navel; the hands close to
//    fists (grip 'fist') for the guard. Areolae are a SEPARATE top-level region.
const skin = F.weld(rig, [
  F.torso(rig, { navel: true }),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'fist' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. AREOLAE — flush paintable discs + tiny nipples, hard-unioned at the top
//    level so the 'areola' region survives the body weld. The muscle:0.7 pectoral
//    mass sits proud of the *base* chest the areola anchors ride, so nudge the
//    discs forward (−Y) onto the pec surface; ~0.72× skin shade in the palette.
const nipples = F.nipples(rig, { size: r.chestX * 0.16, nipple: r.chestX * 0.05 })
  .translate([0, -r.chestY * 0.28, 0]);

// 5. BOXING TRUNKS — high-rise briefs (seat + hip coverage only).
const trunks = F.clothing.pants(rig, {
  rise: 'high',
  leg: 'slim',
  length: 'briefs',
}).label('trunks');

// 6. HAIR — short buzzcut: low volume.
const hair = F.hair(rig, { style: 'short', volume: 0.6 }).label('hair');

// 7. BOXING BOOTS — short-shaft boots keyed off the sole frame (own their 'sole'
//    region). A low shaft up the ankle reads as a boxing boot.
const boots = F.clothing.boots(rig, { shaftZ: rig.opts.height * 0.18, label: 'boots' });

// 8. BASE — sizes to the wide stance footprint; rises to meet the lower foot so
//    the whole figure rests as one component.
const base = F.base(rig, { radius: rig.opts.height * 0.28 }).label('base');

// 9. Hard-union the labelled regions and build. faceDetail meshes the head finely;
//    handDetail resolves the fists held up by the face.
return sdf.union(skin, eyes, lips, nipples, trunks, hair, boots, base)
  .build({ edgeLength: 0.6, detail: [...F.faceDetail(rig), ...F.handDetail(rig)] });
