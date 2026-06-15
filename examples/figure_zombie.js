// Shuffling Zombie — a classic stiff shambling undead with both arms outstretched,
// head lolled to one shoulder, and a vacant half-lidded stare.
// Showcases: head.roll (lolled head), half-lid gaze drift (vacant stare),
// open hanging mouth (painted), stiff straight-legged shuffle, tattered clothes.
// Front = −Y, Z up, figure's left = +X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — adult zombie proportions. Stiff shuffling pose.
// Both arms thrust FORWARD stiffly (raiseFwd positive = toward front −Y).
// Legs nearly straight with a slight stagger (one slightly raised forward).
// spine.lean hunches the upper body forward — the classic zombie lurch.
const rig = F.rig({
  height: 60,
  headsTall: 6.5,   // adult proportions, slightly gaunt
  build: 'slim',
  age: 35,
  weight: 0.3,      // gaunt undead frame
  pose: {
    // Both arms thrust FORWARD stiffly — the classic zombie reach.
    // Low raiseSide keeps arms parallel to each other (not spread wide).
    arms: { raiseSide: 8, raiseFwd: 78, bend: 7 },
    // Stiff nearly-straight legs — zombies don't bend their knees.
    // Slight stagger: left leg just barely forward.
    legL: { raiseSide: 7, raiseFwd: 8, bend: 5 },
    legR: { raiseSide: 7, raiseFwd: -4, bend: 5 },
    // THE SHOWCASE: head lolled heavily to the RIGHT shoulder (figure's right = −X direction).
    // roll negative = toward figure's RIGHT shoulder.
    // pitch positive = slightly looking down (slack-jawed).
    head: { roll: -22, pitch: 10, yaw: 4 },
    // Slight forward hunch — zombie slouch. spine.lean forward.
    spine: { lean: 10, side: -3 },
  },
});

const r = rig.r;

// 2. HEAD + FACE — gaunt zombie face.
// Slightly sunken cheeks, longer jaw for the undead look.
const head = F.head(rig, {
  faceShape: 'long',
  jaw: 0.92,
  chin: 1.1,
  cheek: 0.6,    // sunken cheeks
});

// Hanging open mouth — slack-jawed, painted (no carve = print-safe).
const mouthOpts = {
  style: 'open',
  open: 0.60,             // wide-open slack jaw
  expression: 'frown',   // slightly downturned for the blank undead look
  render: 'painted',
  teeth: 'both',          // upper and lower teeth visible in hanging mouth
  lips: true,
};

const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { type: 'straight', bridge: 0.9, tipRadius: r.head * 0.08, nostrils: false },
  mouth: false,    // painted open mouth via mouthAccents
  ears: { size: r.head * 0.26 },
  brows: { thickness: 0.9, lift: 0.0 },  // heavy flat brows, low and furrowed
});

// THE SHOWCASE: half-lidded eyes drifting to the side — vacant zombie stare.
// lids 'half' = upper:0.40, lower:0.12 — sleepy, barely-open lids.
// gaze 'right' — both eyes drift to the figure's own right (further off-kilter).
const eyes = F.face.eyes(rig, {
  radius: r.head * 0.155,
  lids: 'half',           // heavy drooping half-lids
  gaze: 'lower-right',   // vacant drift to the side and slightly down
});

// Hanging slack mouth with teeth
const mouthParts = F.face.mouthAccents(rig, mouthOpts);

// 3. SKIN — undead greenish-grey skin. Weld the body masses.
// Open hands — fingers splayed forward as if reaching/grasping.
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'open' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. CLOTHES — tattered shirt and torn trousers. Ragged zombie attire.
// We use a regular top and pants (the torn look comes from the color/paint step).
const pants = F.clothing.pants(rig, {
  rise: 'low',
  leg: 'slim',
  length: 'full',
  thickness: r.upperLeg * 0.19,
}).label('rags_bottom');

const shirt = F.clothing.top(rig, {
  sleeve: 'short',         // short/tattered sleeves — tattered look via color
  thickness: r.chestY * 0.17,
}).label('rags_top');

// Bare feet — zombies lose their shoes.
// Boots would cover but bare feet add to the decrepit look.
// (No footwear call — skin feet show through.)

// 5. HAIR — disheveled short hair (zombies have messy hair).
// Short style, no part, slightly volumed up for the wild disheveled look.
const hair = F.hair(rig, {
  style: 'short',
  volume: 0.9,    // slightly reduced — disheveled but not puffed out
  part: 'none',
}).label('hair');

// 6. BASE — flat disc to keep the figure stable.
const base = F.base(rig, {
  radius: rig.opts.height * 0.24,
  thickness: rig.opts.height * 0.038,
}).label('base');

// 7. Union and build.
// Face detail gives crisp eyes/mouth; hand detail resolves the open fingers.
return sdf.union(skin, eyes, mouthParts, pants, shirt, hair, base)
  .build({
    edgeLength: 0.62,
    detail: [...F.faceDetail(rig), ...F.handDetail(rig)],
  });
