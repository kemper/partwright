// Warrior II (virabhadrasana II) — yoga practitioner in a wide lunge.
// SHOWCASE: head.yaw + eye gaze together (looking over the front/right hand),
// wide lunge stance mechanics, bare midriff with navel, female athletic silhouette,
// coily short natural hair.
// Front = −Y, Z up, figure's left = +X, right = −X.
// Sex: female, height ~50, headsTall 7.5, muscle ~0.4, weight ~0.35.
// Front leg = legR (figure's right), back leg = legL (straight, turned out).
// Both arms straight out to the sides at shoulder height.
// Head turned to look over the front (right) hand (negative yaw).
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — Warrior II pose.
//    Warrior II is a wide lateral lunge stance:
//      Front leg (legR = figure's right, −X direction):
//        raiseFwd:35 swings the thigh forward, bend:85 deep knee, twist:-20 toe out.
//      Back leg (legL): wide raiseSide:22, nearly straight, twist:20 foot turned out.
//      Arms: both raiseSide:90 — straight out at shoulder height (T-arms).
//      Head: yaw −30 (toward figure's right = over front arm). Spine slight lean.
const rig = F.rig({
  height: 50,
  headsTall: 7.5,
  sex: 'female',
  muscle: 0.4,
  weight: 0.35,
  build: 'average',
  pose: {
    // Both arms: straight out to the sides at shoulder height, no bend.
    arms: { raiseSide: 90, raiseFwd: 0, bend: 0 },
    // Front leg (right): wide lunge — thigh forward, deep knee bend, toe turned out.
    legR: { raiseSide: 8, raiseFwd: 35, bend: 85, twist: -20 },
    // Back leg (left): wide open stance, nearly straight, foot turned out.
    legL: { raiseSide: 22, raiseFwd: -8, bend: 5, twist: 20 },
    // Head turned to look over the front (right) arm: negative yaw.
    head: { yaw: -30, pitch: 2 },
    // Slight spine lean for Warrior II balance.
    spine: { lean: 3, side: -3 },
  },
});
const j = rig.joints;
const r = rig.r;

// 2. HEAD + FACE — calm, focused Warrior II gaze.
//    Lips as mouthAccents (additive, clean at 7.5 headsTall).
//    Oval face, prominent cheeks, broad natural nose.
//    Ears visible (short hair).
const head = F.head(rig, { faceShape: 'oval', cheek: 1.1 });
const face = F.face.assemble(head, rig, {
  eyes:  false,
  nose:  { type: 'broad', tipRadius: r.head * 0.09, flare: 0.6 },
  mouth: false,
  ears:  { size: r.head * 0.22 },
  brows: { lift: 0.1 },
});
// Eyes gaze toward figure's right (same direction as head.yaw: -30).
// gaze yaw < 0 = figure's own right.
const eyes = F.face.eyes(rig, {
  radius: r.head * 0.135,
  lids:   'almond',
  gaze:   { yaw: -18, pitch: 0 },
});
// Gentle natural lips for the focused pose.
const lips = F.face.mouthAccents(rig, {
  style:      'lips',
  lipShape:   'natural',
  expression: 'slightSmile',
  fullness:   1.0,
});

// 3. SKIN — bare midriff with navel showcase.
//    navel:true carves the belly dimple on the exposed midriff.
//    Open hands for the outstretched arms.
const skin = F.weld(rig, [
  F.torso(rig, { navel: true }),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'open' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. SPORTS BRA — sleeveless, hem at mid-rib to expose the midriff.
//    hemZ: below the chest joint, leaving the belly visible.
const chestZ = j.chest[2];
const hemZ   = chestZ - r.chestX * 0.55;
const top = F.clothing.top(rig, {
  sleeve:    'none',
  hemZ:      hemZ,
  thickness: r.chestX * 0.11,
}).label('top');

// 5. LEGGINGS — high-rise, slim cut (yoga leggings).
const leggings = F.clothing.pants(rig, {
  rise: 'high',
  leg:  'slim',
}).label('leggings');

// 6. HAIR — short coily natural hair (tight 4c crop).
const hair = F.hair(rig, {
  style:   'short',
  texture: 'coils',
  volume:  1.1,
}).label('hair');

// 7. BASE — wide enough to cover the lunge footprint.
const base = F.base(rig, {
  radius:    rig.opts.height * 0.30,
  thickness: rig.opts.height * 0.032,
}).label('base');

// 8. Hard-union all labelled regions and build.
//    detail: faceDetail (smooth face + iris circles) + handDetail (open fingers).
return sdf.union(skin, eyes, lips, top, leggings, hair, base)
  .build({
    edgeLength: 0.5,
    detail: [...F.faceDetail(rig), ...F.handDetail(rig)],
  });
