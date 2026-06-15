// The Proposal — a romantic figure down on one knee, open right hand extended
// forward offering a tiny ring, gazing up adoringly with a hopeful smile.
//
// SHOWCASE: gaze:'up', a kneeling pose (front leg planted, rear knee toward base),
// a held ring prop (torus + gem sphere) welded into the open right palm via
// F.holdAt, and almond eyelids.
//
// Front = −Y, Z up, figure's left = +X, right = −X. ~7 heads tall, slim build.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — kneeling pose.
// Right leg (front): raiseFwd + bend ~100 so the knee rises and the shin
// angles forward, right foot plants near the front of the base.
// Left leg (rear): raiseFwd negative (hip tilts back) + large bend so the
// shin folds back and the rear knee/shin rests low near the base.
// Right arm extended forward at chest height, open hand offering the ring.
// Left arm folded across the heart.
// Head pitch:-16 — looking UP adoringly at the recipient.
const rig = F.rig({
  height: 62,
  headsTall: 7,
  build: 'slim',
  sex: 'male',
  pose: {
    legR: { raiseFwd: 28, bend: 100, raiseSide: 8 },
    legL: { raiseFwd: -14, bend: 132, raiseSide: 8 },
    armR: { raiseSide: 10, raiseFwd: 55, bend: 28, twist: 0 },
    armL: { raiseSide: 22, raiseFwd: 38, bend: 42 },
    head: { pitch: -16, yaw: 4 },
    spine: { lean: 6 },
  },
});
const r = rig.r;

// 2. HEAD + FACE — warm smile, almond lids, gaze up
const head = F.head(rig, { faceShape: 'oval', jaw: 1.05 });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { type: 'straight', tipRadius: r.head * 0.10 },
  mouth: { style: 'lips', lipShape: 'natural', expression: 'smile', fullness: 1.1 },
  ears: { size: r.head * 0.20 },
  brows: { lift: 0.3 },
});
// Both eyes gaze 'up' to match the upward head tilt
const eyes = F.face.eyes(rig, {
  radius: r.head * 0.145,
  lids: 'almond',
  gaze: 'up',
});

// 3. SKIN — right hand open to cradle the ring, left hand relaxed
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'open' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. CLOTHES — smart long-sleeve shirt + slim trousers + shoes
const shirt = F.clothing.top(rig, {
  sleeve: 'long',
  hemZ: rig.joints.hips[2] + r.chestX * 0.3,
  thickness: r.chestX * 0.09,
}).label('shirt');

const trousers = F.clothing.pants(rig, {
  rise: 'mid',
  leg: 'slim',
}).label('trousers');

const shoes = F.clothing.shoes(rig).label('shoes');

// 5. HAIR — neat short cut with a left part
const hair = F.hair(rig, { style: 'short', part: 'left' }).label('hair');

// 6. BASE — extra radius to span the kneeling figure's footprint
const base = F.base(rig, {
  radius: rig.opts.height * 0.32,
  thickness: rig.opts.height * 0.046,
}).label('base');

// 7. RING PROP — torus (band) + gem sphere, built in local space centred at origin.
// The torus sits in the local XY plane; the gem perches above at +Z.
// F.holdAt maps local +Z → gripAxis so the gem faces upward in the open palm.
// Ring is made slightly larger than a real ring would be for catalog legibility.
const bandR  = r.hand * 0.34;    // torus major radius (generous for readability)
const tubeR  = r.hand * 0.075;   // torus minor (tube) radius
const gemR   = r.hand * 0.13;    // gem sphere radius

const band      = sdf.torus(bandR, tubeR);
const gemLocal  = sdf.sphere(gemR).translate([0, 0, bandR + gemR * 0.4]);
const ringLocal = band.smoothUnion(gemLocal, gemR * 0.30);

// Seat into the open right palm; local +Z → gripAxis
const heldRing = F.holdAt(ringLocal, rig.grip.R, { along: 'z' });

// Bridge between hand centre and grip cup ensures the ring welds to one piece
const bridge = sdf.capsule(rig.joints.handR, rig.grip.R.point, r.hand * 0.45);
const ring   = heldRing.smoothUnion(bridge, r.hand * 0.38).label('ring');

// 8. Union + build — edgeLength 0.58 to stay under 200k triangles
return sdf.union(skin, eyes, shirt, trousers, shoes, hair, ring, base)
  .build({ edgeLength: 0.62, detail: [...F.faceDetail(rig), ...F.handDetail(rig)] });
