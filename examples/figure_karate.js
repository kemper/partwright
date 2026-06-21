// Karate master — zenkutsu-dachi (front stance), oi-tsuki (straight punch).
// White gi with black belt (knot + tails), red headband across the forehead,
// gritted-teeth focused expression. ~7 heads tall, slim build.
// Left arm punches straight forward (−Y), right fist chambered at the hip.
// Front = −Y, Z up, figure's left = +X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — front stance.
//    Left arm: raiseFwd 88 = nearly straight forward punch; low raiseSide keeps it
//    close to the centreline. bend 5 = arm nearly straight.
//    Right arm: raiseFwd -10 (slight behind), bend 60 folds forearm down, twist 25
//    orients elbow outward → fist at waist/hip height at the side.
//    Front leg (left): raiseFwd 40, bend 44 — knee forward over foot.
//    Back leg (right): raiseFwd -30, bend 5 — nearly straight.
const rig = F.rig({
  height: 64,
  headsTall: 7,
  build: 'slim',
  pose: {
    armL: { raiseSide: 8,  raiseFwd: 88,  bend: 5  },   // left: straight punch forward at shoulder height
    armR: { raiseSide: 5,  raiseFwd: -10, bend: 60, twist: 25 },   // right: chambered fist at the hip
    legL: { raiseSide: 5,  raiseFwd: 42,  bend: 46  },   // front leg bent
    legR: { raiseSide: 8,  raiseFwd: -32, bend: 5   },   // back leg nearly straight
    head: { pitch: 3 },                              // head slightly forward — focused
    spine: { lean: 5 },                            // lean into the punch (5°: clears the deep-stance graze that lean 7 caused now that spine is live)
  },
});
const j = rig.joints, r = rig.r;

// 2. HEAD + FACE — gritted teeth: slim open carve + white teeth band.
const mouthOpts = { style: 'open', open: 0.22, width: r.head * 0.52, lips: false };
const head = F.head(rig);
const face = F.face.assemble(head, rig, {
  eyes:  false,
  nose:  { tipRadius: r.head * 0.10 },
  mouth: mouthOpts,
  ears:  { size: r.head * 0.25 },
  brows: {},
});
const eyes = F.face.eyes(rig, { radius: r.head * 0.17, lids: 'upper' });
const mouthParts = F.face.mouthAccents(rig, mouthOpts);  // provides 'teeth' label

// 3. SKIN — fists on both hands.
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'fist' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. GI — white long-sleeve top + pants.
//    Top hem sits just below the navel to give the jacket length without
//    creating a deep overlap with the pants that bloats tri count.
//    Pants: slim cut — cleaner silhouette for karate gi trousers.
const giHemZ = j.spine[2] - r.hipsY * 0.30;
const giTop = F.clothing.top(rig, {
  sleeve:    'long',
  thickness: r.chestY * 0.26,
  hemZ:      giHemZ,
}).label('gi');

const giPants = F.clothing.pants(rig, {
  leg:  'slim',
  rise: 'high',
}).label('giPants');

// 5. BELT — an elliptical band around the natural waist.
//    Sits just outside the gi top surface (gi thickness ~ chestY*0.26).
//    The belt is at beltCenterZ, slightly below the gi hem.
const beltCenterZ = j.spine[2] - r.hipsY * 0.22;
const beltC = [0, 0, beltCenterZ];
// Radial clearance: waist radius + gi shell + a little more to read clearly.
const beltR   = r.waist + r.chestY * 0.40;
const beltThk = r.chestY * 0.19;
const BSEGS   = 16;
let belt;
for (let i = 0; i < BSEGS; i++) {
  const a0 = (2 * Math.PI * i)       / BSEGS;
  const a1 = (2 * Math.PI * (i + 1)) / BSEGS;
  const pt = (a) => [
    beltC[0] + beltR * Math.cos(a),
    beltC[1] + beltR * 0.82 * Math.sin(a),
    beltC[2],
  ];
  const seg = sdf.capsule(pt(a0), pt(a1), beltThk);
  belt = belt === undefined ? seg : belt.union(seg);
}
// Knot at front-centre with two hanging tails.
const knotY = beltC[1] - beltR * 0.85;
const knotC = [0, knotY, beltCenterZ];
const knot  = sdf.roundedBox(
  [r.chestY * 0.76, r.chestY * 0.50, r.chestY * 0.54],
  r.chestY * 0.10,
).translate(knotC);
const tailDrop = r.chestY * 1.75;
const tailSprd = r.chestY * 0.40;
const tailL = sdf.capsule(
  [knotC[0] + tailSprd,       knotC[1] - 0.05, knotC[2]             ],
  [knotC[0] + tailSprd * 0.6, knotC[1] - 0.10, knotC[2] - tailDrop  ],
  beltThk * 0.86,
);
const tailR = sdf.capsule(
  [knotC[0] - tailSprd,       knotC[1] - 0.05, knotC[2]             ],
  [knotC[0] - tailSprd * 0.6, knotC[1] - 0.10, knotC[2] - tailDrop  ],
  beltThk * 0.86,
);
belt = belt.union(knot).union(tailL).union(tailR).label('belt');

// 6. HAIR (short, high hairline) + HEADBAND.
//    High hairline means the hair sits further back, leaving the forehead bare
//    so the headband ring can sit clearly ON the forehead skin.
const hair = F.hair(rig, { style: 'short', hairline: 'high' }).label('hair');

// Headband: a ring centered on the forehead, in the head's left/forward plane.
// Position: offset from the head joint toward the crown + slightly forward.
// The forehead is approx r.headZ * 0.25 above the head joint along headUp,
// and r.headZ * 0.15 forward along headForward.
const hf = rig.dir.headForward;
const hl = rig.dir.headLeft;
const hu = rig.dir.headUp;
const hc = j.head;

// On the FOREHEAD: above the brow arcs (u ≈ 0.4·headZ) and below the 'high'
// hairline. At 0.18 the band sat across the EYES like a blindfold — it
// buried the eye domes entirely (their paint labels resolved to 0 triangles
// at bake time, which is how this was caught).
const bandCenter = [
  hc[0] + hu[0] * r.headZ * 0.52 + hf[0] * r.headZ * 0.04,
  hc[1] + hu[1] * r.headZ * 0.52 + hf[1] * r.headZ * 0.04,
  hc[2] + hu[2] * r.headZ * 0.52 + hf[2] * r.headZ * 0.04,
];

// Ring centerline pinned ON the hair-cap surface (skull + hair thickness)
// so the band crosses the hair shell TRANSVERSALLY all the way around — a
// centerline slightly inside or outside that surface leaves the band
// grazing the shell at near-tangent angles (genus 5, measured). Fat enough
// that both faces clear the shell by ≥ 2 march cells.
const hairT       = r.head * 0.12;          // F.hair default thickness
const bandRadLR   = r.headX + hairT;
const bandRadFB   = r.head * 1.12;
const bandThick   = r.head  * 0.14;
const NBAND = 14;
let band;
for (let i = 0; i < NBAND; i++) {
  const a0 = (2 * Math.PI * i)       / NBAND;
  const a1 = (2 * Math.PI * (i + 1)) / NBAND;
  const pt = (a) => [
    bandCenter[0] + hl[0] * bandRadLR * Math.cos(a) + hf[0] * bandRadFB * Math.sin(a),
    bandCenter[1] + hl[1] * bandRadLR * Math.cos(a) + hf[1] * bandRadFB * Math.sin(a),
    bandCenter[2] + hl[2] * bandRadLR * Math.cos(a) + hf[2] * bandRadFB * Math.sin(a),
  ];
  const seg = sdf.capsule(pt(a0), pt(a1), bandThick);
  band = band === undefined ? seg : band.union(seg);
}
band = band.label('headband');

// 7. BASE — auto-sizes to the front-stance footprint.
const base = F.base(rig, { radius: rig.opts.height * 0.28 }).label('base');

// 8. Hard-union + build.
//    Global edgeLength 0.58 to stay under the ~200k budget.
//    detail: faceDetail (smooth face) + handDetail (fist knuckles).
return sdf.union(skin, eyes, mouthParts, giTop, giPants, belt, hair, band, base)
  .build({
    edgeLength: 0.58,
    detail: [...F.faceDetail(rig), ...F.handDetail(rig)],
  });
