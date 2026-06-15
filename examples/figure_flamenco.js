// Flamenco Dancer — mid-pose, back dramatically arched (spine.lean back),
// one arm raised overhead in a graceful curve, other hand low at the hip.
// Showcases: dramatic spine arch + side lean, curved arm overhead, head.yaw
// + head.roll + side gaze + almond lids, full lips, low bun with flower,
// tiered ruffled floor-length dress, heeled shoes.
// sex: 'female', height ~52, headsTall 7.6, weight ~0.4, bust ~0.4.
// Front = −Y, Z up, figure's left = +X, right = −X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — dramatic flamenco arch pose.
//    spine.lean -16: strong back arch — chest lifts and projects forward.
//    spine.side  8: lean toward the raised (left) arm, classic contrapposto.
//    spine.turn -6: slight torso turn to match head direction.
//    armL: raised well overhead — raiseSide 155, bend 65, twist 90
//          (twist 90 rotates curl plane so forearm arcs UP toward the face)
//    armR: elbow strongly bent, hand drifting toward hip/skirt front
//    legL: slight forward shift — "planted" foot (weight-bearing side)
//    legR: mild heel lift (raiseFwd -8) for the characteristic flamenco stance
//    head: yaw -20 (turned further toward figure's right side), roll 10
//          (tilted toward raised arm shoulder) — intense side look
const rig = F.rig({
  height: 52,
  headsTall: 7.6,
  sex: 'female',
  weight: 0.4,
  bust: 0.4,
  build: 'slim',
  pose: {
    // Left arm: raised dramatically overhead in a graceful flamenco arc
    armL: { raiseSide: 155, raiseFwd: 12, bend: 65, twist: 90 },
    // Right arm: elbow bent strongly, hand near hip level gesturing the skirt
    armR: { raiseSide: 35, raiseFwd: 20, bend: 115, twist: -15 },
    // Stance: close together, classical flamenco
    legL: { raiseSide: 5, raiseFwd: 4 },
    legR: { raiseSide: 10, twist: 18, raiseFwd: -6 },
    // Head: strongly turned to figure's right + rolled toward raised arm
    head: { yaw: -20, roll: 10, pitch: -4 },
    // The dramatic arch: strong lean back + strong side lean + slight turn
    spine: { lean: -16, side: 8, turn: -6 },
  },
});
const j = rig.joints, r = rig.r;

// 2. HEAD + FACE — full lips, almond eyes with side gaze, intense expression.
const mouthOpts = {
  style: 'lips',
  lipShape: 'full',
  fullness: 1.3,
  expression: 'neutral',
  width: r.head * 0.46,
};
const head = F.head(rig, { faceShape: 'oval', chin: 0.9, cheek: 1.1 });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { type: 'straight', tipRadius: r.head * 0.08, length: r.head * 0.22, bridge: 0.9 },
  mouth: false,       // mouthAccents handles the lips label at top level
  ears: { size: 0.85 },
  brows: { thickness: 1.1, lift: 0.1 },
});

// Mouth accents — full lips with the 'lips' label, no skin version in assemble
const mouthParts = F.face.mouthAccents(rig, mouthOpts);

// Eyes — almond lids, gaze toward figure's right (the audience side)
const eyes = F.face.eyes(rig, {
  radius: r.head * 0.13,
  lids: 'almond',
  gaze: 'right',
});

// 3. SKIN — open hands (graceful finger pose)
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'open' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. DRESS — long flamenco dress.
//    hemZ near the ground for a floor-length dress.
//    The built-in top(hemZ) creates a flared cone skirt reaching the hem.
const dressHemZ = r.foot * 0.5;  // just above ground
const dress = F.clothing.top(rig, {
  sleeve: 'none',
  hemZ: dressHemZ,
  thickness: r.chestY * 0.38,
}).label('dress');

// 5. RUFFLES — two tiered ruffle rings near the hem of the dress.
//    Built as wide tapered cylinders (cones) that flare outward — the classic
//    flamenco tiered skirt silhouette. Place them slightly inside the dress hem
//    so they weld solidly to the dress cone.
const ruffleR = r.waist * 3.4;   // wide flare — dominant flamenco silhouette

// Ruffle 1: lowest tier, widest, closest to the hem
const ruffle1Z = dressHemZ + r.waist * 0.9;
const ruffle1 = sdf.cylinder(ruffleR * 1.12, r.waist * 0.55)
  .taper(0.22, 'z')               // flares wider downward
  .translate([0, 0, ruffle1Z])
  .label('ruffle');

// Ruffle 2: mid tier, slightly narrower, higher up
const ruffle2Z = dressHemZ + r.waist * 2.6;
const ruffle2 = sdf.cylinder(ruffleR * 0.88, r.waist * 0.48)
  .taper(0.18, 'z')
  .translate([0, 0, ruffle2Z])
  .label('ruffle');

// 6. HEELS — flamenco footwear
// Footwear OWNS 'shoes' + 'sole' labels — no extra .label()
const shoes = F.clothing.shoes(rig, {
  size: 1.12,
  thickness: r.foot * 0.22,
  label: 'shoes',
  sole: { style: 'welt', lip: r.foot * 0.08 },
});

// 7. HAIR — low bun at the nape/back of head.
const hair = F.hair(rig, { style: 'bun', volume: 1.5 }).label('hair');

// 8. FLOWER at the bun — a few overlapping flattened spheres.
//    Position: near the back of the head, low (bun location).
//    The bun for this style sits roughly behind and below the crown.
const hf = rig.dir.headForward;
const hl = rig.dir.headLeft;
const hu = rig.dir.headUp;
const hc = j.head;

// Bun center: behind the head, low — approximately at the base of the skull
const flowerCenter = [
  hc[0] - hf[0] * r.head * 0.85 + hu[0] * r.head * (-0.2),
  hc[1] - hf[1] * r.head * 0.85 + hu[1] * r.head * (-0.2),
  hc[2] - hf[2] * r.head * 0.85 + hu[2] * r.head * (-0.2),
];

// Each petal is a flattened ellipsoid slightly offset from the center
// rx = extent along head-left, ry = front-back depth, rz = extent along head-up
function petal(offX, offZ, rx, ry, rz) {
  return sdf.ellipsoid(rx, ry, rz)
    .translate([
      flowerCenter[0] + hl[0] * offX + hu[0] * offZ,
      flowerCenter[1] + hl[1] * offX + hu[1] * offZ,
      flowerCenter[2] + hl[2] * offX + hu[2] * offZ,
    ]);
}

const flowerR = r.head * 0.22;
const flower = petal(0,  0,  flowerR, flowerR * 0.45, flowerR)       // center
  .union(petal( flowerR * 0.85,  0,      flowerR * 0.75, flowerR * 0.4, flowerR * 0.75))
  .union(petal(-flowerR * 0.85,  0,      flowerR * 0.75, flowerR * 0.4, flowerR * 0.75))
  .union(petal( 0,               flowerR * 0.85, flowerR * 0.75, flowerR * 0.4, flowerR * 0.75))
  .union(petal( 0,              -flowerR * 0.85, flowerR * 0.75, flowerR * 0.4, flowerR * 0.75))
  .label('flower');

// 9. BASE — auto-sizes to the stance footprint.
const base = F.base(rig, { radius: rig.opts.height * 0.24 }).label('base');

// 10. Hard-union all labelled regions and build.
//     faceDetail: smooth face features. handDetail: graceful open fingers.
return sdf.union(skin, eyes, mouthParts, dress, ruffle1, ruffle2, shoes, hair, flower, base)
  .build({ edgeLength: 0.52, detail: [...F.faceDetail(rig), ...F.handDetail(rig)] });
