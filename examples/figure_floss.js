// Floss Dancer — a kid doing the "floss" dance with a goofy cross-eyed face.
// Showcases: per-eye crossed gaze (gazeL/gazeR — both toward the nose),
// open-mouth goofy grin (painted), spine.turn + spine.side for the floss
// hip-swing, and spiked hair. Full body on a base.
// Front = −Y, Z up, figure's left = +X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — kid proportions, average build.
// The floss: arms swung to one side while hips go the other.
// armL swings far FORWARD (toward the camera/front −Y),
// armR swings far BEHIND the hip (+Y back).
// spine.turn rotates the torso so this asymmetry is visible from the front.
const rig = F.rig({
  height: 56,
  headsTall: 5,       // big head for cute/goofy kid proportions
  build: 'average',
  age: 10,
  pose: {
    // Left arm: swings FORWARD and down — classic floss "front arm"
    armL: { raiseSide: 10, raiseFwd: 65, bend: 30 },
    // Right arm: swings behind the body — classic floss "back arm"
    armR: { raiseSide: 10, raiseFwd: -50, bend: 28 },
    // Wide kid stance
    legL: { raiseSide: 11 },
    legR: { raiseSide: 11 },
    // Head tilted slightly back for goofy expression, slight roll for personality
    head: { pitch: -5, roll: 10, yaw: 8 },
    // THE FLOSS: hips go one way, arms go the other.
    // spine.turn rotates shoulders right while hip stays planted.
    // spine.side cocks the hip pop to the left.
    spine: { turn: 20, side: -8 },
  },
});

const r = rig.r;

// 2. HEAD + FACE — goofy round kid face.
const head = F.head(rig, { faceShape: 'round', cheek: 1.2, jaw: 0.82, chin: 0.75 });

// Big open goofy grin painted (no carve = print-safe)
const mouthOpts = {
  style: 'open',
  open: 0.55,
  expression: 'bigSmile',
  render: 'painted',
  teeth: 'upper',
};

const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { type: 'button', tipRadius: r.head * 0.09, upturn: 0.35, nostrils: false },
  mouth: false,   // painted open mouth via mouthAccents
  ears: { size: r.head * 0.26 },
  brows: { thickness: 1.1, lift: 0.4 },  // raised surprised brows add goofiness
});

// THE SHOWCASE: cross-eyed gaze.
// gazeL = figure's left eye drifts toward the nose (to its RIGHT = 'right').
// gazeR = figure's right eye drifts toward the nose (to its LEFT = 'left').
// Both eyes pull INWARD toward the nose = classic cross-eyed look.
// Nudge eyes forward along headForward so a round/heart/cheeky face does not
// swallow the domes (else eyes/iris/pupil/lids paint to 0 triangles).
const hf = rig.dir.headForward, eyePush = r.head * 0.07;
const eyes = F.face.eyes(rig, {
  radius: r.head * 0.165,
  lids: 'upper',
  gazeL: 'right',   // left eye drifts right (toward nose)
  gazeR: 'left',    // right eye drifts left (toward nose)
})
  .translate([hf[0] * eyePush, hf[1] * eyePush, hf[2] * eyePush]);

// Open goofy grin with teeth band
const mouthParts = F.face.mouthAccents(rig, mouthOpts);

// 3. SKIN — weld body masses. Relaxed fists fit the arm-swinging pose.
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'fist' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. CLOTHES — jeans + t-shirt + sneakers.
const pants = F.clothing.pants(rig, {
  rise: 'mid',
  leg: 'slim',
  thickness: r.upperLeg * 0.20,
}).label('jeans');

const shirt = F.clothing.top(rig, {
  sleeve: 'short',
  thickness: r.chestY * 0.18,
}).label('shirt');

const sneakers = F.clothing.shoes(rig, {
  thickness: r.foot * 0.16,
  sole: { style: 'welt', lip: r.foot * 0.12 },
}).label('sneakers');

// 5. HAIR — spiked hair for the goofy kid. Anime-style spikes.
const hair = F.hair(rig, {
  style: 'spiked',
  volume: 1.0,
}).label('hair');

// 6. BASE
const base = F.base(rig, {
  radius: rig.opts.height * 0.25,
  thickness: rig.opts.height * 0.038,
}).label('base');

// 7. Union and build.
// Hand detail resolves fists; face detail keeps the eyes/mouth crisp.
return sdf.union(skin, eyes, mouthParts, pants, shirt, sneakers, hair, base)
  .build({
    edgeLength: 0.55,
    detail: [...F.faceDetail(rig), ...F.handDetail(rig)],
  });
