// Bedtime — sleepy toddler rubbing one eye and yawning.
// Showcases: 'half' eyelids (sleepy both eyes), open yawning mouth, toddler
// proportions (headsTall:4, age:3), eye-rub pose (right fist near eye), stuffed
// bunny hugged to chest (left arm), footed pajamas covering legs + feet.
//
// Paint regions: skin, lids, eyes, iris, pupil, teeth, lips, pajamas, bunny, hair, base
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — toddler proportions: age 3, headsTall 4, short and chubby
// Pose: right arm raised so fist reaches the eye area (raiseFwd high + bend),
//       left arm cradling the bunny against the chest (bent across the body),
//       slight head tilt (rolled toward the rubbing side), slight slouch.
const rig = F.rig({
  height: 34,
  headsTall: 4,
  build: 'average',
  age: 3,
  weight: 0.55,   // slightly chubby toddler
  pose: {
    // Right arm: raised forward and up so the bent fist reaches up to the eye
    armR: { raiseSide: 10, raiseFwd: 65, bend: 145, twist: -20 },
    // Left arm: cradles the bunny against the chest — raised forward and bent
    armL: { raiseSide: 25, raiseFwd: 55, bend: 128 },
    // Toddler wide stance
    legL: { raiseSide: 14 },
    legR: { raiseSide: 14 },
    // Head tilted and slightly drooped — tired/sleepy
    head: { yaw: 8, pitch: 12, roll: 10 },
    // Slight sleepy slouch forward
    spine: { lean: 5, side: 3 },
  },
});

const j = rig.joints;
const r = rig.r;

// 2. HEAD + FACE — sleepy yawning expression
// Mouth: open yawn. Eyes: 'half' preset (sleepy, both eyes).
// Eyes stay OUT of the weld (top-level union).
const head = F.head(rig, { faceShape: 'round', cheek: 1.2, jaw: 0.85, chin: 0.8 });

const mouthOpts = {
  style: 'open',
  open: 0.50,
  expression: 'neutral',  // yawn is open and round, not smiling
  width: r.head * 0.44,
  render: 'painted',
  teeth: false,           // toddler yawn — teeth omitted for cleaner print
};

const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { type: 'button', tipRadius: r.head * 0.09, width: 0.85 },
  mouth: false,           // using mouthAccents at the top level
  ears: { size: r.head * 0.26 },
  brows: { thickness: 1.0, lift: 0 },  // neutral/low brows — tired look
});

// 'half' preset = { upper:0.40, lower:0.12 } — the sleepy half-closed look
const eyes = F.face.eyes(rig, {
  radius: r.head * 0.195,  // big toddler eyes
  lids: 'half',
  gaze: 'down',            // looking down/drowsy
});

const mouthParts = F.face.mouthAccents(rig, mouthOpts);

// 3. SKIN — welded toddler body, fist on right hand (rubbing eye), relaxed left
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'fist' }),   // fist for the eye-rub hand
  F.legs(rig),
  F.feet(rig),           // feet covered by pajamas; no toes needed
  face,
], { k: r.lowerArm * 1.35 }).label('skin');

// 4. FOOTED PAJAMAS — top + pants both labelled 'pajamas'
// Low hem on the top covers down to hip; pants cover legs + feet.
const pajamaTop = F.clothing.top(rig, {
  sleeve: 'long',
  thickness: r.chestY * 0.22,
}).label('pajamas');

const pajamaBottom = F.clothing.pants(rig, {
  rise: 'high',
  leg: 'slim',
  length: 'full',
  thickness: r.upperLeg * 0.22,
}).label('pajamas');

// 5. STUFFED BUNNY — cradled in the left arm against the chest
// Body: sphere + slightly smaller head sphere; two long ear capsules.
// Position: nestled in the crook of the left forearm at chest level.
const bScale = r.head * 0.48;  // bunny body size relative to toddler head

// Bunny centre: just in front of the chest, at mid-torso height, on left side
const bCX = j.spine[0] + r.chestX * 0.30;
const bCY = j.spine[1] - r.chestY * 1.10;  // well forward of chest
const bCZ = j.spine[2] + r.chestY * 0.10;

const bunnyBody = sdf.sphere(bScale)
  .translate([bCX, bCY, bCZ]);

const bunnyHead = sdf.sphere(bScale * 0.70)
  .translate([bCX, bCY - bScale * 0.05, bCZ + bScale * 1.30]);

// Long floppy rabbit ears (capsules pointing upward, slightly apart)
const earLen = bScale * 1.10;
const earR   = bScale * 0.18;
const earZ0  = bCZ + bScale * 1.30 + bScale * 0.55;
const bunnyEarL = sdf.capsule(
  [bCX + bScale * 0.28, bCY - bScale * 0.06, earZ0],
  [bCX + bScale * 0.32, bCY - bScale * 0.10, earZ0 + earLen],
  earR
);
const bunnyEarR = sdf.capsule(
  [bCX - bScale * 0.28, bCY - bScale * 0.06, earZ0],
  [bCX - bScale * 0.32, bCY - bScale * 0.10, earZ0 + earLen],
  earR
);

// Small paw nubs
const bunnyPawL = sdf.sphere(bScale * 0.22)
  .translate([bCX + bScale * 0.72, bCY - bScale * 0.05, bCZ + bScale * 0.35]);
const bunnyPawR = sdf.sphere(bScale * 0.22)
  .translate([bCX - bScale * 0.72, bCY - bScale * 0.05, bCZ + bScale * 0.35]);

// Bunny feet (round blob nubs at the bottom)
const bunnyFootL = sdf.sphere(bScale * 0.26)
  .translate([bCX + bScale * 0.36, bCY, bCZ - bScale * 0.72]);
const bunnyFootR = sdf.sphere(bScale * 0.26)
  .translate([bCX - bScale * 0.36, bCY, bCZ - bScale * 0.72]);

const bunny = bunnyBody
  .smoothUnion(bunnyHead,  bScale * 0.16)
  .smoothUnion(bunnyEarL,  bScale * 0.10)
  .smoothUnion(bunnyEarR,  bScale * 0.10)
  .smoothUnion(bunnyPawL,  bScale * 0.10)
  .smoothUnion(bunnyPawR,  bScale * 0.10)
  .smoothUnion(bunnyFootL, bScale * 0.10)
  .smoothUnion(bunnyFootR, bScale * 0.10)
  .label('bunny');

// 6. HAIR — soft short toddler bed-head with bangs
const hair = F.hair(rig, {
  style: 'bangs',
  volume: 1.0,
}).label('hair');

// 7. BASE
const base = F.base(rig, {
  radius: rig.opts.height * 0.36,
  thickness: rig.opts.height * 0.05,
}).label('base');

// 8. Hard-union everything and build.
// Bunny overlaps the left forearm/chest — welds into one component.
// faceDetail + handDetail for crisp eyes/lids and sculpted fist.
return sdf.union(skin, eyes, mouthParts, pajamaTop, pajamaBottom, bunny, hair, base)
  .build({ edgeLength: 0.5, detail: [...F.faceDetail(rig), ...F.handDetail(rig)] });
