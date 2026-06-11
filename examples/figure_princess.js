// Waving princess — floor-length gown, gold crown, ponytail, painted lips.
// One open hand raised in a royal wave (palm forward at head height), other relaxed.
// ~7 heads tall, slim build. Front = −Y, Z up.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG
// Royal wave pose — right arm.
// abduct 97: upper arm nearly horizontal (7° above horizontal). Arm extends straight
// out to figure's right (+X).
// elbow 55: forearm curls 55° from the upper arm's axis. Without twist, this curves
// the forearm forward (−Y). With twist 90 this plane rotates so the forearm curves UP.
// twist 90: rotates the elbow-curl plane so the forearm bends upward rather than forward.
// Result: upper arm horizontal to the right, forearm angled upward from the elbow,
// wrist/hand near head height on the right side. The open palm faces the audience (−Y).
// flex 4: slight forward sweep of the shoulder — keeps the arm visible from front.
const rig = F.rig({
  height: 68,
  headsTall: 7,
  build: 'slim',
  pose: {
    armR: { abduct: 100, flex: 14, elbow: 50, twist: 90 },  // royal wave: palm out at head height, flex brings arm forward for front-view palm read
    armL: { abduct: 15, flex: 5, elbow: 18 },              // relaxed at side
    legL: { abduct: 5 },
    legR: { abduct: 5 },
    head: { tilt: 4, turn: -8 },  // slight tilt toward waving side, face toward audience
    spine: { lean: 2 },
  },
});
const j = rig.joints, r = rig.r;

// 2. HEAD + FACE — painted lips (additive ridge → assemble gets mouth: false).
const head = F.head(rig);
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { tipRadius: r.head * 0.09 },
  mouth: false,     // additive lips ridge is the mouth — assemble must get mouth: false
  ears: false,      // hair + crown cover the sides
  brows: {},
});
const eyes = F.face.eyes(rig, { radius: r.head * 0.145 }); // iris style: labels eyes/iris/pupil itself
const lips = F.face.mouthAccents(rig, { style: 'lips', width: r.head * 0.32, smirk: 0.08 });

// 3. SKIN — both hands open (right reads as waving palm, left natural).
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'open' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. GOWN — floor-length dress with a wide flared hem reaching to the base.
// hemZ near the ground so the cone flare extends all the way down.
// thickness generous to hide legs completely beneath the gown.
const gown = F.clothing.top(rig, {
  sleeve: 'short',
  hemZ: rig.opts.height * 0.045,   // ≈ 3.1 units — nearly at base height
  thickness: r.chestY * 0.40,       // thick to fully hide legs inside gown volume
}).label('gown');

// 5. HAIR — ponytail (gathered back, swinging down behind the head).
const hair = F.hair(rig, { style: 'ponytail' }).label('hair');

// 6. CROWN — gold ring + 5 upward spikes resting on the skull.
// The ring is sunk into the skull (ringZ below crownJ apex) for one-piece welding.
// crownJ is the rig's skull apex in world space.
const crownJ = j.crown;
const crownR = r.headX * 0.80;   // ring radius wraps around the head without flying off

// Place the ring center far enough below the apex that it sits ON the head surface
// and intersects the skull mesh — this is the weld anchor.
const ringZ = crownJ[2] - r.headZ * 0.30;
const bandR = r.head * 0.095;     // capsule radius for the ring band

// 18-segment ring for a smooth circular band.
const CSEG = 18;
let crownBand;
for (let i = 0; i < CSEG; i++) {
  const a0 = (2 * Math.PI * i) / CSEG;
  const a1 = (2 * Math.PI * (i + 1)) / CSEG;
  const p = (a) => [crownJ[0] + crownR * Math.cos(a), crownJ[1] + crownR * Math.sin(a), ringZ];
  const seg = sdf.capsule(p(a0), p(a1), bandR);
  crownBand = crownBand === undefined ? seg : crownBand.union(seg);
}

// 5 prominent spikes. Front spike at -π/2 (toward −Y = toward audience).
// Spikes taper: wide base at ring level, narrow at tip.
const spikeH = r.head * 0.75;     // tall — clearly visible above hair/head
const spikeBaseR = r.head * 0.072;
for (let i = 0; i < 5; i++) {
  const a = (2 * Math.PI * i) / 5 - Math.PI / 2;  // first spike at front (-Y)
  const bx = crownJ[0] + crownR * Math.cos(a);
  const by = crownJ[1] + crownR * Math.sin(a);
  const spike = sdf.capsule(
    [bx, by, ringZ - bandR * 0.3],
    [bx * 0.92, by * 0.92, ringZ + spikeH],
    spikeBaseR
  );
  crownBand = crownBand.union(spike);
}
const crown = crownBand.label('crown');

// 7. BASE — disc that the gown hem reaches, fusing figure to stand.
const base = F.base(rig, {
  radius: rig.opts.height * 0.22,
  thickness: rig.opts.height * 0.050,
}).label('base');

// 8. Hard-union all labeled regions and build.
// faceDetail: fine head mesh (smooth lips groove, round eyes).
// handDetail: resolves sculpted open fingers (needed for grip: 'open').
return sdf.union(skin, eyes, lips, gown, hair, crown, base)
  .build({ edgeLength: 0.52, detail: [...F.faceDetail(rig), ...F.handDetail(rig)] });
