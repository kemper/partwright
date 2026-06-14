// Muscular Hero — a bodybuilder in a relaxed front stance, lats so developed
// the arms ride out from the torso. Showcases the figure rig's `muscle` axis:
// `muscle: 0.85` adds pectorals, abdominals, lats and traps to the torso and
// biceps/triceps/deltoids/forearm swell to the arms (plus quads/calves/glutes),
// all anchored to the rig so they track the pose — no hand-rolled muscle masses.
// Front = −Y, Z up, figure's left = +X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — tall, athletic male, heavy MUSCLE (not weight — lean + defined).
//    Front-stance: arms held out from the body (lat spread), elbows softly bent,
//    a wide planted stance. The muscle masses flex with these joint angles.
const rig = F.rig({
  height: 60,
  headsTall: 7.5,
  sex: 'male',
  build: 'average',
  weight: 0.5,
  muscle: 0.85,
  pose: {
    // Arms ride out (raiseSide 26) — the classic "can't put my arms down" look
    // a wide back/lats forces — with a soft elbow bend and the forearms turned
    // slightly forward so the biceps read from the front camera.
    armL: { raiseSide: 26, raiseFwd: 6, bend: 22, twist: 18 },
    armR: { raiseSide: 26, raiseFwd: 6, bend: 22, twist: 18 },
    // Wide, grounded stance.
    legL: { raiseSide: 12 },
    legR: { raiseSide: 12 },
    // Chin slightly down — a focused, competitive set.
    head: { pitch: -4 },
  },
});
const r = rig.r;
const j = rig.joints;

// 2. HEAD + FACE — a determined set jaw; strong brow, square head.
const mouthOpts = { style: 'smile', smirk: 0.1, width: r.head * 0.5 };
const head = F.head(rig, { faceShape: 'square', jaw: 1.15, cheek: 1.05 });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { tipRadius: r.head * 0.12, length: r.head * 0.24, bridge: 1.1 },
  mouth: mouthOpts,
  ears: { size: r.head * 0.26 },
  brows: { thickness: 1.3, lift: 0.1 },
});

// Paintable eyes — iris style self-labels (eyes/iris/pupil), union at top level.
const eyes = F.face.eyes(rig, { radius: r.head * 0.17, lids: 'upper' });

// 3. SKIN — weld every body mass. Loose fists at the ends of the arms.
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'fist' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. POSING TRUNKS — high-cut competition briefs so the torso musculature shows.
const trunks = F.clothing.pants(rig, {
  rise: 'mid',
  leg: 'slim',
  length: 'briefs',
}).label('trunks');

// 5. HAIR — short crop.
const hair = F.hair(rig, { style: 'short' }).label('hair');

// 6. BASE — a posing stage disc, wide enough for the planted stance.
const base = F.base(rig, { radius: rig.opts.height * 0.26 }).label('base');

// 7. Hard-union the labelled regions and build. faceDetail meshes the head
//    finely; handDetail resolves the fists.
return sdf.union(skin, eyes, trunks, hair, base)
  .build({ edgeLength: 0.52, detail: [...F.faceDetail(rig), ...F.handDetail(rig)] });
