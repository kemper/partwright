// Waving princess — floor-length gown, gold crown, ponytail, painted lips.
// One open hand raised in a royal wave (palm forward at head height), other relaxed.
// ~7 heads tall, slim build. Front = −Y, Z up.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG
// Royal wave pose — right arm.
// raiseSide 97: upper arm nearly horizontal (7° above horizontal). Arm extends straight
// out to figure's right (+X).
// bend 55: forearm curls 55° from the upper arm's axis. Without twist, this curves
// the forearm forward (−Y). With twist 90 this plane rotates so the forearm curves UP.
// twist 90: rotates the elbow-curl plane so the forearm bends upward rather than forward.
// Result: upper arm horizontal to the right, forearm angled upward from the elbow,
// wrist/hand near head height on the right side. The open palm faces the audience (−Y).
// raiseFwd 4: slight forward sweep of the shoulder — keeps the arm visible from front.
const rig = F.rig({
  height: 68,
  headsTall: 7,
  build: 'slim',
  pose: {
    armR: { raiseSide: 100, raiseFwd: 14, bend: 50, twist: 90 },  // royal wave: palm out at head height, flex brings arm forward for front-view palm read
    armL: { raiseSide: 15, raiseFwd: 5, bend: 18 },              // relaxed at side
    legL: { raiseSide: 5 },
    legR: { raiseSide: 5 },
    head: { roll: 4, yaw: -8 },  // slight tilt toward waving side, face toward audience
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
const eyes = F.face.eyes(rig, { radius: r.head * 0.145, lids: 'almond' }); // iris style: labels eyes/iris/pupil itself
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
const hair = F.hair(rig, { style: 'long', texture: 'wavy' }).label('hair');

// 6. CROWN — gold coronet (ring + 5 upward spikes), built centred on the ORIGIN
// then seated ON TOP OF THE HAIR with F.placeOnHead. A tiara sized to the bare
// skull sinks into the hair volume; placeOnHead rests the ring on the hair's
// top surface (a small `embed` welds it into one piece) so it sits ON the
// hairstyle instead of embedding — the headwear analog of the hand grip frame.
const crownR = r.headX * 0.46;     // coronet that rests on top of the flowing hair
const bandR = r.head * 0.095;     // capsule radius for the ring band

// 18-segment ring in the local z=0 plane, spikes rising along +Z.
const CSEG = 18;
let crownBand;
for (let i = 0; i < CSEG; i++) {
  const a0 = (2 * Math.PI * i) / CSEG;
  const a1 = (2 * Math.PI * (i + 1)) / CSEG;
  const p = (a) => [crownR * Math.cos(a), crownR * Math.sin(a), 0];
  const seg = sdf.capsule(p(a0), p(a1), bandR);
  crownBand = crownBand === undefined ? seg : crownBand.union(seg);
}

// 5 prominent spikes, wide base at the ring, tapering up. Front spike at -π/2.
const spikeH = r.head * 0.68;
const spikeBaseR = r.head * 0.072;
for (let i = 0; i < 5; i++) {
  const a = (2 * Math.PI * i) / 5 - Math.PI / 2;
  const bx = crownR * Math.cos(a), by = crownR * Math.sin(a);
  const spike = sdf.capsule([bx, by, -bandR * 0.3], [bx * 0.92, by * 0.92, spikeH], spikeBaseR);
  crownBand = crownBand.union(spike);
}
// Seat the coronet on the hair: its bbox bottom (the ring) lands on the hair's
// top, embedded a touch so the band welds into the hairdo as one printable piece.
const crown = F.placeOnHead(crownBand, rig, { rest: hair, embed: r.head * 0.42 }).label('crown');

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
