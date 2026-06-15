// Disco Dancer — Saturday-Night-Fever pose: one arm punched up to the sky,
// other hand on the hip, hip cocked in contrapposto, confident smirk, big
// afro with coil texture. Showcases spine.side (cocked hip), afro + coils,
// sidelong gaze, and flared disco pants.
// Front = −Y, Z up, figure's left = +X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — adult proportions, slim dancer build.
// Pose: right arm punched straight up (Saturday Night Fever icon),
// left hand on hip (raiseSide low, raiseFwd back, bent at elbow).
// spine.side cocks the hip for contrapposto weight-shift.
const rig = F.rig({
  height: 62,
  headsTall: 7,
  build: 'slim',
  sex: 'neutral',
  pose: {
    // Right arm: punched straight up to the sky.
    // raiseSide 165 = nearly overhead; twist 90 so the forearm curls upward.
    armR: { raiseSide: 165, bend: 10, twist: 90 },

    // Left arm: hand on the hip — side-raised low, forearm back/inward.
    // raiseSide 20: arm barely lifted from the body (resting on the hip).
    // raiseFwd −30: elbow swings back so the hand presses the hip.
    // bend 95: forearm folded back toward the torso.
    armL: { raiseSide: 20, raiseFwd: -30, bend: 95 },

    // Legs: slight stance; right leg bears weight, left toe-out.
    legL: { raiseSide: 8, twist: 12 },
    legR: { raiseSide: 6 },

    // Head: yaw −10 (look to figure's right — sidelong look),
    // roll −4 (slight tilt away from the raised arm for attitude).
    head: { yaw: -10, roll: -4, pitch: -5 },

    // Spine: side −10 shifts the whole upper body toward the figure's right
    // (weight on that hip), turn 6 adds a slight twist for depth.
    spine: { side: -10, turn: 6 },
  },
});
const r = rig.r;

// 2. HEAD + FACE — confident smirk, sidelong look.
// Heart face shape suits a stylish dancer.
const head = F.head(rig, { faceShape: 'oval', chin: 0.85 });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { type: 'straight', tipRadius: r.head * 0.08, bridge: 0.9 },
  mouth: { smirk: 0.4, expression: 'slightSmile' },
  ears: false,   // afro covers ears
  brows: { thickness: 1.1, lift: 0.1 },
});

// Eyes: sidelong gaze toward figure's right (negative yaw = figure's right).
const eyes = F.face.eyes(rig, {
  radius: r.head * 0.135,
  lids: 'almond',
  gaze: { yaw: -18, pitch: 0 },
});

// 3. SKIN — both hands: right is open (pointed up), left open on hip.
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'open' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. CLOTHES — snug top, flared disco pants, platform shoes.
// Top: tight short-sleeve shirt.
const top = F.clothing.top(rig, {
  sleeve: 'short',
  thickness: r.chestY * 0.12,
}).label('top');

// Pants: cargo leg base, then we add a flare cone at the cuff.
// hemZ slightly above ground so the flare cone reaches the shoe.
const pants = F.clothing.pants(rig, {
  rise: 'mid',
  leg: 'cargo',
}).label('pants');

// Platform shoes — disco style, chunky sole welt.
const shoes = F.clothing.shoes(rig, {
  thickness: r.foot * 0.22,
  sole: { style: 'welt', lip: r.foot * 0.18 },
}).label('shoes');

// 5. HAIR — the showcase: big afro with tight coil texture.
// volume 1.6 puffs it prominently; coils give the 4c spring relief.
// edgeLength must stay ≤ 0.45 for coils to resolve — handled in build.
const hair = F.hair(rig, {
  style: 'afro',
  volume: 1.6,
  texture: 'coils',
}).label('hair');

// 6. BASE — slightly wider to catch the dancer's cocked stance.
const base = F.base(rig, {
  radius: rig.opts.height * 0.21,
  thickness: rig.opts.height * 0.04,
}).label('base');

// 7. Union and build.
// edgeLength 0.5 — coils resolve at this grid via the head detail sphere.
// handDetail resolves the open fingers. faceDetail slightly coarser to stay
// under the ~200k catalog budget alongside the coil + hand geometry.
return sdf.union(skin, eyes, top, pants, shoes, hair, base)
  .build({
    edgeLength: 0.5,
    detail: [...F.faceDetail(rig, { edgeLength: r.head * 0.07, eyeEdgeLength: r.head * 0.04 }), ...F.handDetail(rig)],
  });
