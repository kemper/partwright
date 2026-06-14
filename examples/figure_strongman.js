// Classic flexing strongman — double-biceps pose.
//
// A vintage-circus bodybuilder, arms raised to the sides with elbows
// bent so fists come up by the head. Build 'stocky', 7 heads tall,
// short shorts, short hair, thick mustache on a display base.
//
// Strategy: the FK elbow joint only flexes in-plane with the upper-arm and
// body-front vector; for a horizontal arm that means the elbow only swings
// in the lateral plane, not vertically. To get a true double-biceps silhouette
// (horizontal upper arm → vertical forearm → fist beside the head), we skip
// F.arms/F.hands and place the arm segments as raw sdf.capsule primitives
// anchored to the rig's shoulder joints so they weld solidly into the body.
//
// Paint regions: skin, hair, mustache, trunks, base

const { sdf } = api;
const F = sdf.figure;

// 1. RIG — stocky, 7 heads, neutral arms (so the torso/traps compute correctly;
//    we do not call F.arms because we're placing arms manually below).
const rig = F.rig({
  height: 60,
  headsTall: 7,
  build: 'stocky',
  pose: {
    // Arms neutral so torso/shoulder geometry computes at the right position.
    // We override the arm geometry below with manual capsules.
    armL: { raiseSide: 0, raiseFwd: 0, bend: 0 },
    armR: { raiseSide: 0, raiseFwd: 0, bend: 0 },
    legL: { raiseSide: 14 },
    legR: { raiseSide: 14 },
    head: { pitch: -5 },
  },
});

const j = rig.joints;
const r = rig.r;

// --- Manual double-biceps arm geometry -----------------------------------
//
// Left arm (figure's left = +X side)
// Right arm (figure's right = −X side)
//
// For a stocky 7-head figure at height=60:
//   upperArmL = [7.9,  0, 48.5]
//   upperArmR = [-7.9, 0, 48.5]
//   head = [0, 0, 55.7]
//   chin = [0, 0, 51.4]
//
// Classic double-biceps: elbow directly OUT to the side (same Z as shoulder,
// further out in X), forearm pointing UP, fist beside the head.
// We offset slightly forward (−Y) so the pose reads from the front camera.

const upperArmLen = 60 * 0.165;   // 9.9
const foreArmLen  = 60 * 0.150;   // 9.0

// Elbows: directly out to the side at shoulder height, slightly forward.
// Classic double-biceps: elbow at same Z as shoulder, arm horizontal.
// Extend the upper arm a bit beyond the standard length for extra visual space.
const elbowLX = j.upperArmL[0] + upperArmLen * 1.05;  // ~18.7 — arm extended out
const elbowZ  = j.upperArmL[2] + 0.5;                 // 49 — barely above shoulder
const elbowY  = -1.5;                                  // slightly forward toward camera

const elbowL = [elbowLX,  elbowY, elbowZ];
const elbowR = [-elbowLX, elbowY, elbowZ];

// Wrists: come UP from elbow. Classic double-biceps has the forearm pointing
// mostly upward so fist lands at temple/ear height.
// Target: fist at Z ≈ 53-54 (temple = chin (51.4) + 2-3 units), X ≈ 14-16.
const wristZ  = elbowZ + foreArmLen * 0.50;    // ~53 — between chin and eyes
const wristLX = elbowLX - foreArmLen * 0.30;   // ~15 — slightly inward
const wristY  = elbowY + foreArmLen * 0.08;    // ~-0.8

const wristL = [wristLX,  wristY, wristZ];
const wristR = [-wristLX, wristY, wristZ];

// Fists: slightly past wrist
const fistZ  = wristZ + r.hand * 0.8;          // ~55.5 — at temple/ear
const fistLX = wristLX - r.hand * 0.2;         // ~14.4 — beside head
const fistY  = wristY;

const fistL = [fistLX,  fistY, fistZ];
const fistR = [-fistLX, fistY, fistZ];

// Build the arms as thick tapered capsule chains — bodybuilder scale
function makeArm(shoulderPos, elbow, wrist, fist) {
  const k = r.lowerArm * 0.85;
  // Bodybuilder arms — notably thicker than average
  const rU = r.upperArm * 1.25;   // thick upper arm
  const rF = r.lowerArm * 1.15;    // thick forearm
  // Upper arm: full capsule shoulder→elbow
  const upper = sdf.capsule(shoulderPos, elbow, rU);
  // Bicep peak: forward-offset sphere at the midpoint of the upper arm
  const upperMid = [
    (shoulderPos[0] + elbow[0]) * 0.5,
    (shoulderPos[1] + elbow[1]) * 0.5 - rU * 0.28, // forward of center
    (shoulderPos[2] + elbow[2]) * 0.5 + rU * 0.18, // slightly above
  ];
  const bicepPeak = sdf.sphere(rU * 0.95).translate(upperMid);
  // Deltoid: rounded cap at the shoulder joint
  const deltoid = sdf.sphere(rU * 1.08).translate(shoulderPos);

  // Forearm: elbow → wrist
  const fore = sdf.capsule(elbow, wrist, rF);

  // Fist
  const fistSphere = sdf.sphere(r.hand * 1.05).translate(fist);

  return upper
    .smoothUnion(bicepPeak, k * 0.7)
    .smoothUnion(deltoid, r.upperArm * 0.6)
    .smoothUnion(fore, k)
    .smoothUnion(fistSphere, r.lowerArm * 0.9);
}

const armL = makeArm(j.upperArmL, elbowL, wristL, fistL);
const armR = makeArm(j.upperArmR, elbowR, wristR, fistR);

// 2. HEAD + FACE
// eyes: false — eyes are lifted to the top-level hard-union with their own label
// so they can be painted independently (paintable-eyes pattern).
// Mouth: a gritted confident smile with a slight smirk — fits a strongman mid-flex.
// style 'smile' carves a clean smile line into the face.
// Gritted effortful mouth: a slim open carve filled by the white teeth band.
const mouthOpts = { style: 'open', open: 0.26, width: r.head * 0.56, lips: false };
const head = F.head(rig);
const face = F.face.assemble(head, rig, {
  eyes:  false,
  nose:  { tipRadius: r.head * 0.14, length: r.head * 0.22 },
  mouth: mouthOpts,
  ears:  { size: r.head * 0.28 },
  brows: {},
});

// Paintable eyes — hard-union at top level with their own label
const eyes = F.face.eyes(rig, { radius: r.head * 0.17, lids: 'hooded' }); // iris style: labels eyes/iris/pupil itself
// Clenched teeth filling the open carve ('teeth' label; no lip ring under the mustache).
const mouthParts = F.face.mouthAccents(rig, mouthOpts);

// 3. EXTRA MUSCLE MASSES — puffed chest, big traps
// Keep the puffed chest BELOW the chin — taller/higher masses bury the
// lower face inside the torso (the mouth carve lands inside solid chest).
const chestPuff = sdf.ellipsoid(
  r.chestX * 1.25, r.chestY * 1.2, r.chestY * 1.6,
).translate([0, -r.chestY * 0.35, j.chest[2] - r.chestY * 0.1]);

const trapL = sdf.ellipsoid(
  r.upperArm * 1.2, r.upperArm * 0.75, r.upperArm * 1.0,
).translate([j.upperArmL[0] * 0.65, -r.chestY * 0.2, j.upperArmL[2] + r.upperArm * 0.1]);
const trapR = sdf.ellipsoid(
  r.upperArm * 1.2, r.upperArm * 0.75, r.upperArm * 1.0,
).translate([j.upperArmR[0] * 0.65, -r.chestY * 0.2, j.upperArmR[2] + r.upperArm * 0.1]);

// 4. WELDED SKIN — note: F.arms and F.hands are NOT included here; we use
//    our manual arm geometry above instead.
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.legs(rig),
  F.feet(rig),
  face,
  chestPuff,
  trapL,
  trapR,
  armL,
  armR,
], { k: r.lowerArm * 0.7 }).label('skin');

// 5. SHORT TRUNKS — high-cut bodybuilding shorts
const trunkCuffZ = j.upperLegL[2] + r.upperLeg * 0.4;
const trunks = F.clothing.pants(rig, {
  rise: 'mid',
  leg: 'slim',
  cuffZ: trunkCuffZ,
}).label('trunks');

// 6. HAIR — short
const hair = F.hair(rig, { style: 'short' }).label('hair');

// 7. MUSTACHE — thick handlebar between nose and mouth
const nosePos  = rig.face.nose;
const mouthPos = rig.face.mouth;
const hl       = rig.dir.headLeft;

// Push the bar forward of the lip surface so the mustache visibly protrudes
// (a capsule centred between the anchors sits buried under the nose/cheek
// welds — its label then resolves to 0 paintable triangles).
const hf = rig.dir.headForward;
const mustachePush = r.head * 0.22;
const mustacheCenter = [
  (nosePos[0] + mouthPos[0]) * 0.5 + hf[0] * mustachePush,
  (nosePos[1] + mouthPos[1]) * 0.5 + hf[1] * mustachePush,
  nosePos[2] + (mouthPos[2] - nosePos[2]) * 0.30 + hf[2] * mustachePush,
];
const halfSpan = r.headX * 0.52;
const mustacheA = [
  mustacheCenter[0] + hl[0] * halfSpan,
  mustacheCenter[1] + hl[1] * halfSpan,
  mustacheCenter[2] + hl[2] * halfSpan,
];
const mustacheB = [
  mustacheCenter[0] - hl[0] * halfSpan,
  mustacheCenter[1] - hl[1] * halfSpan,
  mustacheCenter[2] - hl[2] * halfSpan,
];
const mustache = sdf.capsule(mustacheA, mustacheB, r.head * 0.09).label('mustache');

// 8. BASE
const base = F.base(rig, { radius: rig.opts.height * 0.28 }).label('base');

// 9. Hard-union all labelled regions and build.
// eyes are at the top level (not inside skin weld) so they carry their own paint label.
// F.faceDetail(rig) refines the head mesh locally — smooth smile groove, round eye domes —
// without raising the global edgeLength (which would balloon triangle count).
return sdf.union(skin, eyes, mouthParts, trunks, hair, mustache, base)
  .build({ edgeLength: 0.5, detail: F.faceDetail(rig) });
