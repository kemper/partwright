// Skater Kid — cheeky teen skateboarder with playful expressive face.
// Showcases: strong asymmetric smirk + upper-right gaze + raised brows (cheeky
// face approximating a wink); held skateboard prop; hoodie + cargo jeans +
// sneakers; beanie; casual contrapposto teen stance.
//
// NOTE on the wink: F.face.eyes() applies lids to BOTH eyes simultaneously —
// no per-eye lid override exists. True one-eye wink is not expressible.
// We approximate with: strong smirk (0.6), 'upper-right' gaze, raised brows,
// and 'hooded' lids for a heavy-lidded cheeky look.
//
// Paint regions: skin, lids, eyes, iris, pupil, teeth, lips,
//               hoodie, jeans, sneaker, sole, hair, beanie, deck, wheels, base
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — teen proportions: headsTall 6.5, slim build, age 14.
// Casual weight-on-one-hip contrapposto: spine leans toward figure's right,
// right arm raised near shoulder for finger-gun, left arm down with skateboard.
const rig = F.rig({
  height: 48,
  headsTall: 6.5,
  build: 'slim',
  age: 14,
  pose: {
    // Right arm: raised, bent at elbow — finger-gun near shoulder
    armR: { raiseSide: 24, raiseFwd: 30, bend: 120, twist: 18 },
    // Left arm: hanging down, holding the skateboard upright
    armL: { raiseSide: 10, raiseFwd: -6, bend: 22 },
    // Relaxed casual stance, legs slightly apart
    legL: { raiseSide: 8 },
    legR: { raiseSide: 6 },
    // Head turned toward raised arm, slight tilt — cocky look
    head: { yaw: -16, roll: -5, pitch: -4 },
    // Hip weight shift contrapposto: lean right, slight forward shoulder turn
    spine: { side: -7, lean: 3, turn: 7 },
  },
});

const j = rig.joints;
const r = rig.r;

// 2. HEAD + FACE — cheeky grin expression
const head = F.head(rig, { faceShape: 'oval', jaw: 0.88, chin: 0.95 });

const mouthOpts = {
  style: 'open',
  open: 0.44,
  expression: 'bigSmile',
  smirk: 0.60,         // strong asymmetric smirk = cheeky "almost-wink" look
  width: r.head * 0.50,
  render: 'painted',
  teeth: 'upper',
};

const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { type: 'straight', tipRadius: r.head * 0.082, bridge: 0.82 },
  mouth: false,         // using mouthAccents at top level
  ears: { size: r.head * 0.20 },
  brows: { thickness: 1.15, lift: 0.25 },  // raised expressive brows
});

// Heavy-hooded lids + upper-right sidelong gaze = cheeky "knowing wink" read
const eyes = F.face.eyes(rig, {
  radius: r.head * 0.155,
  lids: 'hooded',       // heavy upper lid approximates a half-wink
  gaze: 'upper-right',  // corner gaze reads as cheeky/sly
});

const mouthParts = F.face.mouthAccents(rig, mouthOpts);

// 3. SKIN — slim teen body, relaxed hands
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'relaxed' }),
  F.legs(rig),
  F.feet(rig),
  face,
], { k: r.lowerArm * 1.2 }).label('skin');

// 4. CLOTHES — hoodie + cargo jeans + sneakers
const hoodie = F.clothing.top(rig, {
  sleeve: 'long',
  thickness: r.chestY * 0.26,
}).label('hoodie');

const jeans = F.clothing.pants(rig, {
  leg: 'cargo',
  rise: 'low',
  thickness: r.upperLeg * 0.24,
}).label('jeans');

// Sneakers — own labels 'sneaker' + 'sole'; do NOT add .label() on top
const shoes = F.clothing.shoes(rig, {
  label: 'sneaker',
  sole: { style: 'welt', lip: r.foot * 0.12, thickness: r.foot * 0.42 },
});

// 5. HAIR + BEANIE
const hair = F.hair(rig, { style: 'short', volume: 1.05 }).label('hair');

// Beanie: short squat cylinder with slight top taper, placed on the hair
const beanieRaw = sdf.cylinder(r.head * 0.76, r.head * 0.70)
  .taper(-0.14, 'z');   // soft beanie silhouette

const beanie = F.placeOnHead(beanieRaw, rig, {
  rest: hair,
  embed: r.head * 0.20,  // sink into hair so it welds flush
}).label('beanie');

// 6. SKATEBOARD PROP — held upright beside the left leg.
// Board stood vertically: long axis = Z, deck is the thin deckThk dimension.
// Wheels embedded INTO the deck sides (large overlap) so they fuse in the union.
const deckLen  = r.foot * 4.8;
const deckW    = r.foot * 1.45;
const deckThk  = r.foot * 0.28;
const wR       = r.foot * 0.48;   // wheel radius
const wW       = r.foot * 0.30;   // wheel width

// Deck: flat rounded box — corner radius < deckThk/2
const deckRaw = sdf.roundedBox([deckW, deckThk, deckLen], deckThk * 0.38)
  .taper(-0.08, 'z');

// Position board: overlapping the left hand so it welds into one component.
// Bring it close enough that the deck overlaps the hand/wrist (≥0.5 unit overlap).
const bX = j.handL[0] + r.hand * 0.6;  // only slightly outward of hand centre
const bY = j.handL[1];
const bZ = j.spine[2];  // midpoint at hip height

// Wheels: placed so they EMBED into the deck faces (overlap by ~wR*0.4)
// Axis along Y (deck's thin direction), so wheels push through the deck face
const tFZ = bZ + deckLen * 0.30;
const tBZ = bZ - deckLen * 0.30;
// Wheel axis along Y: cylinder(radius, height) — rotate 0,0,0 = axis along Z
// We need axis along Y: rotate([90,0,0])
// Wheels sit at Y = bY ± (deckThk/2 + wW/2 - wR*0.35) so they overlap the deck face
const wEmbedY = deckThk * 0.5 + wW * 0.5 - wR * 0.35;

function wheel(dy, tz) {
  return sdf.cylinder(wR, wW).rotate([90, 0, 0])
    .translate([bX, bY + dy, tz]);
}
// Two trucks, two wheels each (one each side of deck in Y direction)
const wheels = sdf.union(
  wheel(+wEmbedY, tFZ), wheel(-wEmbedY, tFZ),
  wheel(+wEmbedY, tBZ), wheel(-wEmbedY, tBZ),
).label('wheels');

const deck = deckRaw.translate([bX, bY, bZ]).label('deck');

// 7. BASE
const base = F.base(rig, {
  radius: rig.opts.height * 0.32,
  thickness: rig.opts.height * 0.04,
}).label('base');

// 8. Hard-union everything and build
// Skateboard overlaps the left hand/thigh region — welds into one component.
// edgeLength: 0.65 to keep tris within the ~230k catalog budget.
return sdf.union(skin, eyes, mouthParts, hoodie, jeans, shoes, hair, beanie, deck, wheels, base)
  .build({ edgeLength: 0.65, detail: [...F.faceDetail(rig), ...F.handDetail(rig)] });
