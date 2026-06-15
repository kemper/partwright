// Lil' Flexer — a tiny big-headed kid flexing a proud double-biceps pose,
// beaming with joy and showing off their tiny muscles.
//
// Showcases: low headsTall (~4.2) + age:7 for chibi proportions (big head,
// short legs); double-biceps pose (arms: raiseSide:95, bend:100, twist:90);
// small muscle (~0.3) so the little biceps still bulge; big open grin
// via mouthAccents (teeth + lips, render:'painted' for print safety);
// spiked hair; shorts + sneakers.
//
// Paint regions: skin, eyes, iris, pupil, lids, teeth, lips, hair, shorts,
//                shoes, sole, base
// Front = −Y, Z up, figure's left = +X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — chibi kid proportions + double-biceps pose.
//    headsTall:4.2 → huge head, cute stubby body. age:7 shifts torso narrower.
//    Symmetric double-biceps: arms raised 95° to side, bent 100° (fists by temples),
//    twist:90 rotates the curl plane so bent forearms go UP not forward.
const rig = F.rig({
  height: 55,
  headsTall: 4.2,
  sex: 'neutral',
  build: 'average',
  age: 7,
  weight: 0.45,
  muscle: 0.3,
  pose: {
    // Classic double-biceps: arms straight out then bent up, curl plane UP via twist:90
    arms: { raiseSide: 95, bend: 100, twist: 90 },
    // Confident wide stance
    legL: { raiseSide: 10 },
    legR: { raiseSide: 10 },
    // Head slightly tilted — proud, self-satisfied pose
    head: { pitch: -4, roll: 6 },
  },
});

const r = rig.r;
const j = rig.joints;

// 2. HEAD + FACE — chibi face: round head, big grin, cute button nose.
//    Big open smile with painted teeth (print-safe, no carved cavity).
const mouthOpts = {
  style: 'open',
  open: 0.55,
  expression: 'bigSmile',
  render: 'painted',
  teeth: 'both',
};
const head = F.head(rig, { faceShape: 'round', jaw: 0.75, chin: 0.7, cheek: 1.1 });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { type: 'button', tipRadius: r.head * 0.10, nostrils: false },
  mouth: false,          // mouth via mouthAccents at top level
  ears: { size: r.head * 0.24 },
  brows: { thickness: 0.9, lift: 0.3 },
});

// Mouth accents at the top level for painted render
const mouthParts = F.face.mouthAccents(rig, mouthOpts);

// Big happy eyes — wide open, looking slightly up (pride look), with upper lid
const eyes = F.face.eyes(rig, {
  radius: r.head * 0.20,   // big chibi eyes
  lids: { upper: 0.22, lower: 0.06 },
  gaze: 'up',
  style: 'iris',
});

// 3. WELDED SKIN
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'fist' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. SHORTS — cute kid shorts, mid-rise
const shorts = F.clothing.pants(rig, {
  rise: 'mid',
  leg: 'slim',
  length: 'briefs',
}).label('shorts');

// 5. TINY TANK TOP — short-sleeved top showing off the arms
const tanktop = F.clothing.top(rig, {
  sleeve: 'none',
  hemZ: j.spine[2] + r.head * 0.1,
}).label('tanktop');

// 6. SNEAKERS — kid sneakers with a chunky sole
const shoes = F.clothing.shoes(rig, {
  thickness: r.foot * 0.20,
  sole: { style: 'welt', thickness: r.foot * 0.35 },
}).label('shoes');

// 7. SPIKED HAIR — spiky anime-style hair, very cute on a big chibi head
const hair = F.hair(rig, {
  style: 'spiked',
  volume: 0.85,
}).label('hair');

// 8. BASE
const base = F.base(rig, { radius: rig.opts.height * 0.24 }).label('base');

// 9. Hard-union and build with faceDetail + handDetail
return sdf.union(skin, eyes, mouthParts, shorts, tanktop, shoes, hair, base)
  .build({ edgeLength: 0.58, detail: [...F.faceDetail(rig), ...F.handDetail(rig)] });
