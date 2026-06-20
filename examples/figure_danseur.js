// Ballet Danseur (en tournant) — a male ballet dancer in a controlled turning
// pose: the right arm curved up overhead, the left extended out to the side
// (port de bras), the torso slightly turned, balanced on the balls of the feet,
// focused gaze to the side. Bare chest, ballet tights, soft slippers. ~8 heads
// tall, lean. Front = −Y, Z up, figure's left = +X, right = −X.
//
// SHOWCASE: a rounded overhead arc (twist 90), an extended second-position arm,
// a spine turn with a counter-turned head, bare chest with F.nipples + navel,
// and ballet-slipper footwear.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — tall, slim, toned (muscle 0.5, low weight). Right arm sweeps up
// overhead in a rounded arc (raiseSide 150, bend 50, twist 90 rolls the
// elbow-curl plane so the forearm arcs over the head); left arm extended out to
// the side just below shoulder height (raiseSide 95, soft bend). Spine turned a
// touch, head counter-turned with the gaze to the side. Legs in a gentle
// turnout, balanced.
const rig = F.rig({
  height: 64,
  headsTall: 8,
  sex: 'male',
  build: 'slim',
  muscle: 0.5,
  weight: 0.3,
  pose: {
    armR: { raiseSide: 150, bend: 50, twist: 90 },
    armL: { raiseSide: 95, bend: 10 },
    spine: { turn: 12 },
    head: { yaw: -14 },
    legL: { raiseSide: 8, twist: 30 },
    legR: { raiseSide: 8, twist: 30 },
  },
});
const r = rig.r;

// 2. HEAD + FACE — long face, straight nose, serene set mouth. At headsTall 8
// the head is small, so the mouth is ADDITIVE painted lips (a carved groove
// would tear). 'flat' lipShape + a slight downward set reads as a controlled,
// focused expression.
const head = F.head(rig, { faceShape: 'long' });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { type: 'straight' },
  mouth: false,            // the painted lips below ARE the mouth
  ears: true,
  brows: {},
});

// Paintable eyes — defined upper lid, gaze off to the side (the focused look).
const eyes = F.face.eyes(rig, { radius: r.head * 0.18, lids: 'upper', gaze: 'right' });
// Serene flat-set lips ('lips' label) — additive ridge.
const lips = F.face.mouthAccents(rig, { style: 'lips', lipShape: 'flat', expression: 'slightFrown' });

// 3. SKIN — bare torso with a navel; relaxed hands. nipples added at top level.
const skin = F.weld(rig, [
  F.torso(rig, { navel: true }),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'relaxed' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 3b. NIPPLES — top-level part, self-labels 'areola' (don't .label() it).
const nipples = F.nipples(rig, { on: skin });

// 4. TIGHTS — high-waisted slim ballet tights, full length.
const tights = F.clothing.pants(rig, {
  rise: 'high',
  leg: 'slim',
  length: 'full',
}).label('tights');

// 5. SLIPPERS — thin soft ballet slippers (own their 'slippers' + 'sole'
// regions; don't .label() over them).
const slippers = F.clothing.shoes(rig, { label: 'slippers', thickness: r.foot * 0.18 });

// 6. HAIR — short, neat.
const hair = F.hair(rig, { style: 'short' }).label('hair');

// 7. BASE — circular stand.
const base = F.base(rig, { radius: rig.opts.height * 0.24 }).label('base');

// 8. Union all labelled regions and build with face + hand + foot detail (toes
// are barefoot but slippers wrap them; faceDetail keeps the small head crisp).
return sdf.union(skin, eyes, lips, nipples, tights, slippers, hair, base)
  .build({
    edgeLength: 0.62,
    detail: [...F.faceDetail(rig), ...F.handDetail(rig)],
  });
