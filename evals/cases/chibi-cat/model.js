// Cat — Parametric chibi cat with pose, build, ears, tail, face variants
// Face points -Y, Z up. Default = sitting average cat (matches original v11 exactly).
// v12: parametric refactor with paramsSchema

const { sdf } = api;

// ============================================================
// PARAMS
// ============================================================
const p = api.params({
  pose:  { type: 'select', default: 'sitting',
           options: ['sitting', 'standing'],
           label: 'Pose' },
  build: { type: 'select', default: 'average',
           options: ['kitten', 'slim', 'average', 'chonky'],
           label: 'Build' },
  ears:  { type: 'select', default: 'pointed',
           options: ['pointed', 'folded', 'big'],
           label: 'Ears' },
  tail:  { type: 'select', default: 'curl',
           options: ['curl', 'short', 'fluffy'],
           label: 'Tail' },
  face:  { type: 'select', default: 'round',
           options: ['round', 'pointed'],
           label: 'Face' },
});

// ============================================================
// BUILD SCALE TABLE — controls body/head/limb proportions
// ============================================================
const BUILD = {
  kitten:  { bodyRx: 5.0,  bodyRy: 4.0,  bodyRz: 4.0,  headScale: 1.15, legThick: 1.6, legLength: 3.0 },
  slim:    { bodyRx: 4.8,  bodyRy: 3.8,  bodyRz: 4.2,  headScale: 0.95, legThick: 1.7, legLength: 4.5 },
  average: { bodyRx: 5.5,  bodyRy: 4.5,  bodyRz: 4.5,  headScale: 1.00, legThick: 2.0, legLength: 4.0 },
  chonky:  { bodyRx: 7.0,  bodyRy: 6.0,  bodyRz: 5.5,  headScale: 1.05, legThick: 2.5, legLength: 3.2 },
};
const bld = BUILD[p.build];

// ============================================================
// EYE GEOMETRY CONSTANTS
// ============================================================
const eyeR        = 2.8;
const eyeAnchorLx = -3.8;
const eyeAnchorRx =  3.8;
const eyeAnchorY  = -6.8;
const eyeAnchorZ  = 24.5;
const halfBoxY    = 50;
const eyeClipBox  = sdf.box([eyeR * 2 + 2, halfBoxY * 2, eyeR * 2 + 2]);
const eyeFrontY   = eyeAnchorY - eyeR;

// ============================================================
// FACE / MUZZLE GEOMETRY (shared, face=round vs pointed)
// ============================================================
const FACE = {
  round:   { headRx: 9.2, headRy: 7.5, headRz: 8.5, headY: -1, headZ: 22,
             muzzleRx: 2.0, muzzleRy: 0.32, muzzleRz: 1.4, muzzleZ: 20.8,
             muzzlePadRx: 2.3, muzzlePadRy: 0.50, muzzlePadRz: 1.55, muzzlePadZ: 20.8,
             muzzleY: -8.25, muzzlePadY: -8.55,
             noseY: -9.28, noseZ: 21.80 },
  pointed: { headRx: 8.0, headRy: 8.5, headRz: 8.0, headY: -1.5, headZ: 22,
             muzzleRx: 1.6, muzzleRy: 0.38, muzzleRz: 1.2, muzzleZ: 20.5,
             muzzlePadRx: 1.9, muzzlePadRy: 0.55, muzzlePadRz: 1.35, muzzlePadZ: 20.5,
             muzzleY: -9.0, muzzlePadY: -9.35,
             noseY: -10.1, noseZ: 21.5 },
};
const fc = FACE[p.face];

// ============================================================
// BODY GEOMETRY (pose-dependent)
// ============================================================
function buildSittingBody() {
  const haunches = sdf.ellipsoid(7, 5.5, 4.2).translate(0, 0, 4.2);
  const torso = sdf.ellipsoid(bld.bodyRx, bld.bodyRy, bld.bodyRz).translate(0, -0.5, 8.5);
  let bodyMass = haunches.smoothUnion(torso, 2.5);

  const baseDisc = sdf.ellipsoid(7.5, 5.2, 2.5).translate(0, 0, 2.5);
  bodyMass = bodyMass.smoothUnion(baseDisc, 2.2);

  const pawFront = sdf.capsule([2.5, -4.2, 6.5], [2.7, -4.5, 1.0], 2.0).mirrorPair('x');
  bodyMass = bodyMass.smoothUnion(pawFront, 1.8);

  const neck = sdf.capsule([0, -1, 12.5], [0, -1, 14.5], 2.5);
  bodyMass = bodyMass.smoothUnion(neck, 2.5);

  const headSdf = sdf.ellipsoid(fc.headRx * bld.headScale, fc.headRy * bld.headScale, fc.headRz * bld.headScale)
    .translate(0, fc.headY, fc.headZ);
  bodyMass = bodyMass.smoothUnion(headSdf, 3.0);

  const muzzleBodyBump = sdf.ellipsoid(fc.muzzleRx, fc.muzzleRy, fc.muzzleRz).translate(0, fc.muzzleY, fc.muzzleZ);
  bodyMass = bodyMass.smoothUnion(muzzleBodyBump, 0.45);

  return { bodyMass, headCenter: [0, fc.headY, fc.headZ] };
}

function buildStandingBody() {
  const lt = bld.legThick;
  const ll = bld.legLength;
  // Legs: paw sphere center at z = lt (so the sphere bottom touches z=0)
  //        top of leg attaches at z = lt + ll (= body bottom)
  // Body center at z = lt + ll + bodyRz
  const legBottom = lt;                    // paw center z — sphere bottom at z≈0
  const legTop    = lt + ll;              // where leg meets body undercarriage
  const bodyBaseZ = legTop + bld.bodyRz;  // body ellipsoid center

  // Four legs: front pair forward (-Y), back pair rearward (+Y)
  const frontLegX = bld.bodyRx * 0.55;
  const backLegX  = bld.bodyRx * 0.48;
  const frontLegY = -bld.bodyRy * 0.55;
  const backLegY  =  bld.bodyRy * 0.55;

  // Leg capsules: paw center → under-body attachment
  const legFL = sdf.capsule([ frontLegX, frontLegY, legBottom], [ frontLegX, frontLegY, legTop], lt);
  const legFR = sdf.capsule([-frontLegX, frontLegY, legBottom], [-frontLegX, frontLegY, legTop], lt);
  const legBL = sdf.capsule([ backLegX,  backLegY,  legBottom], [ backLegX,  backLegY,  legTop], lt);
  const legBR = sdf.capsule([-backLegX,  backLegY,  legBottom], [-backLegX,  backLegY,  legTop], lt);

  // Paw pads: slightly flattened sphere at each foot
  const pawFL = sdf.ellipsoid(lt * 1.3, lt * 1.1, lt * 0.8).translate( frontLegX, frontLegY, legBottom);
  const pawFR = sdf.ellipsoid(lt * 1.3, lt * 1.1, lt * 0.8).translate(-frontLegX, frontLegY, legBottom);
  const pawBL = sdf.ellipsoid(lt * 1.2, lt * 1.3, lt * 0.8).translate( backLegX,  backLegY,  legBottom);
  const pawBR = sdf.ellipsoid(lt * 1.2, lt * 1.3, lt * 0.8).translate(-backLegX,  backLegY,  legBottom);

  // Torso (horizontal-ish body)
  const torso    = sdf.ellipsoid(bld.bodyRx, bld.bodyRy, bld.bodyRz).translate(0, 0, bodyBaseZ);
  const haunches = sdf.ellipsoid(bld.bodyRx * 0.82, bld.bodyRy * 0.90, bld.bodyRz * 0.82)
    .translate(0, bld.bodyRy * 0.35, bodyBaseZ - 1.2);

  let bodyMass = torso.smoothUnion(haunches, 2.5)
    .smoothUnion(legFL, 2.0).smoothUnion(legFR, 2.0)
    .smoothUnion(legBL, 2.0).smoothUnion(legBR, 2.0)
    .smoothUnion(pawFL, 1.5).smoothUnion(pawFR, 1.5)
    .smoothUnion(pawBL, 1.5).smoothUnion(pawBR, 1.5);

  // Neck: rise from front-top of torso toward head
  const neckBaseZ = bodyBaseZ + bld.bodyRz * 0.5;
  const neckBaseY = -bld.bodyRy * 0.6;
  const neckTopZ  = neckBaseZ + 3.0;
  const neckTopY  = neckBaseY - 1.0;
  const neck = sdf.capsule([0, neckBaseY, neckBaseZ], [0, neckTopY, neckTopZ], 2.5);
  bodyMass = bodyMass.smoothUnion(neck, 2.5);

  // Head: sits above neck, face pointing forward (-Y)
  const headRx = fc.headRx * bld.headScale;
  const headRy = fc.headRy * bld.headScale;
  const headRz = fc.headRz * bld.headScale;
  const headZ  = neckTopZ + headRz * 0.7;
  const headY  = neckTopY - 0.5;
  const headSdf = sdf.ellipsoid(headRx, headRy, headRz).translate(0, headY, headZ);
  bodyMass = bodyMass.smoothUnion(headSdf, 3.0);

  const muzzleBodyBump = sdf.ellipsoid(fc.muzzleRx, fc.muzzleRy, fc.muzzleRz)
    .translate(0, headY + fc.muzzleY - fc.headY, headZ + fc.muzzleZ - fc.headZ);
  bodyMass = bodyMass.smoothUnion(muzzleBodyBump, 0.45);

  return {
    bodyMass,
    headCenter: [0, headY, headZ],
    bodyBaseZ, legBottom,
    frontLegX, frontLegY, backLegX, backLegY,
    headY, headZ,
    headDeltaY: headY - fc.headY,
    headDeltaZ: headZ - fc.headZ,
  };
}

// ============================================================
// BUILD THE BODY
// ============================================================
let bodyResult, eyeZ, eyeY, muzzleOffsetY, noseOffsetY, noseZ;

if (p.pose === 'sitting') {
  bodyResult = buildSittingBody();
  eyeZ = eyeAnchorZ;
  eyeY = eyeAnchorY;
  muzzleOffsetY = 0;
  noseOffsetY = 0;
  noseZ = fc.noseZ;
} else {
  bodyResult = buildStandingBody();
  const dY = bodyResult.headDeltaY;
  const dZ = bodyResult.headDeltaZ;
  eyeZ = eyeAnchorZ + dZ;
  eyeY = eyeAnchorY + dY;
  muzzleOffsetY = dY;
  noseOffsetY   = dY;
  noseZ = fc.noseZ + dZ;
}

// ============================================================
// EARS  (ear position relative to head top)
// ============================================================
function buildEars(headCenter, headRx, headRy, headRz) {
  const hx = headRx * bld.headScale;
  const hz = headRz * bld.headScale;
  const [hcx, hcy, hcz] = headCenter;
  const earBaseZ = hcz + hz * 0.72;
  const earCenterX = hx * 0.55;
  const earCenterY = hcy - 0.5;

  if (p.ears === 'pointed') {
    const earShaftL = sdf.ellipsoid(3.2, 0.9, 3.5).rotate(0, -15, 0).translate(-earCenterX, earCenterY, earBaseZ + 2.5);
    const earShaftR = sdf.ellipsoid(3.2, 0.9, 3.5).rotate(0,  15, 0).translate( earCenterX, earCenterY, earBaseZ + 2.5);
    const earTipL = sdf.sphere(1.0).translate(-earCenterX, earCenterY, earBaseZ + 5.5);
    const earTipR = sdf.sphere(1.0).translate( earCenterX, earCenterY, earBaseZ + 5.5);
    return { earShaftL, earShaftR, earTipL, earTipR,
             innerEarLPos: [-earCenterX, earCenterY - 0.6, earBaseZ + 2.5],
             innerEarRPos: [ earCenterX, earCenterY - 0.6, earBaseZ + 2.5] };
  } else if (p.ears === 'folded') {
    // Scottish fold: short, bent forward/down
    const earShaftL = sdf.ellipsoid(2.6, 1.0, 2.2).rotate(35, -10, 0).translate(-earCenterX, earCenterY - 1.0, earBaseZ + 1.2);
    const earShaftR = sdf.ellipsoid(2.6, 1.0, 2.2).rotate(35,  10, 0).translate( earCenterX, earCenterY - 1.0, earBaseZ + 1.2);
    const earTipL = sdf.sphere(1.2).translate(-earCenterX, earCenterY - 2.2, earBaseZ + 2.0);
    const earTipR = sdf.sphere(1.2).translate( earCenterX, earCenterY - 2.2, earBaseZ + 2.0);
    return { earShaftL, earShaftR, earTipL, earTipR,
             innerEarLPos: [-earCenterX, earCenterY - 1.5, earBaseZ + 1.5],
             innerEarRPos: [ earCenterX, earCenterY - 1.5, earBaseZ + 1.5] };
  } else {
    // big: oversized tall triangles
    const earShaftL = sdf.ellipsoid(3.8, 0.9, 4.8).rotate(0, -12, 0).translate(-earCenterX * 1.1, earCenterY, earBaseZ + 4.0);
    const earShaftR = sdf.ellipsoid(3.8, 0.9, 4.8).rotate(0,  12, 0).translate( earCenterX * 1.1, earCenterY, earBaseZ + 4.0);
    const earTipL = sdf.sphere(1.2).translate(-earCenterX * 1.1, earCenterY, earBaseZ + 8.0);
    const earTipR = sdf.sphere(1.2).translate( earCenterX * 1.1, earCenterY, earBaseZ + 8.0);
    return { earShaftL, earShaftR, earTipL, earTipR,
             innerEarLPos: [-earCenterX * 1.1, earCenterY - 0.6, earBaseZ + 4.0],
             innerEarRPos: [ earCenterX * 1.1, earCenterY - 0.6, earBaseZ + 4.0] };
  }
}

// ============================================================
// TAIL
// ============================================================
function buildTail(rootX, rootY, rootZ) {
  if (p.tail === 'curl') {
    const tailRoot = sdf.capsule([rootX, rootY + 2.0, rootZ],      [rootX + 3.0, rootY + 1.5, rootZ - 1.5], 2.2);
    const tailMid  = sdf.capsule([rootX + 3.0, rootY + 1.5, rootZ - 1.5], [rootX + 2.5, rootY - 2.0, rootZ - 2.5], 1.9);
    const tailBend = sdf.capsule([rootX + 2.5, rootY - 2.0, rootZ - 2.5], [rootX, rootY - 5.5, rootZ - 3.0], 1.6);
    const tailFront= sdf.capsule([rootX, rootY - 5.5, rootZ - 3.0], [rootX - 2.0, rootY - 7.0, rootZ - 3.5], 1.4);
    const tailTip  = sdf.capsule([rootX - 2.0, rootY - 7.0, rootZ - 3.5], [rootX - 3.7, rootY - 7.8, rootZ - 3.8], 1.2);
    return tailRoot.smoothUnion(tailMid, 1.6).smoothUnion(tailBend, 1.4).smoothUnion(tailFront, 1.3).smoothUnion(tailTip, 1.2);
  } else if (p.tail === 'short') {
    // Bobtail: just a small stubby bit
    const stub = sdf.capsule([rootX, rootY + 1.0, rootZ], [rootX + 2.0, rootY + 0.5, rootZ - 1.0], 2.0);
    const tip  = sdf.sphere(1.8).translate(rootX + 2.5, rootY + 0.0, rootZ - 1.5);
    return stub.smoothUnion(tip, 1.2);
  } else {
    // fluffy: thicker, rounded, slight curve
    const tailRoot2 = sdf.capsule([rootX, rootY + 2.0, rootZ],      [rootX + 3.5, rootY + 1.5, rootZ - 1.5], 2.8);
    const tailMid2  = sdf.capsule([rootX + 3.5, rootY + 1.5, rootZ - 1.5], [rootX + 3.0, rootY - 1.5, rootZ - 2.0], 2.5);
    const tailBend2 = sdf.capsule([rootX + 3.0, rootY - 1.5, rootZ - 2.0], [rootX + 0.5, rootY - 4.5, rootZ - 2.5], 2.3);
    const tailTip2  = sdf.sphere(2.2).translate(rootX - 0.5, rootY - 5.5, rootZ - 3.0);
    return tailRoot2.smoothUnion(tailMid2, 2.0).smoothUnion(tailBend2, 1.8).smoothUnion(tailTip2, 1.8);
  }
}

// ============================================================
// ASSEMBLE BODY + EARS + TAIL
// ============================================================
let { bodyMass } = bodyResult;
const headCenter = bodyResult.headCenter;

// Ear positions
const ears = buildEars(headCenter, fc.headRx, fc.headRy, fc.headRz);
bodyMass = bodyMass
  .smoothUnion(ears.earShaftL, 2.8).smoothUnion(ears.earShaftR, 2.8)
  .smoothUnion(ears.earTipL, 1.5).smoothUnion(ears.earTipR, 1.5);

// Tail
let tail;
if (p.pose === 'sitting') {
  tail = buildTail(5.5, 0, 5.0);
} else {
  // Standing: tail sprouts from rump at rear of torso, elevated
  const bz = bodyResult.bodyBaseZ || 8.0;
  const by = (bodyResult.backLegY || 2) + 1.0;
  tail = buildTail(bld.bodyRx * 0.75, by, bz + bld.bodyRz * 0.5);
}
bodyMass = bodyMass.smoothUnion(tail, 1.8);

const bodyLabeled = bodyMass.label('body');

// ============================================================
// MUZZLE PAD
// ============================================================
// Shift muzzle outward (-Y) by (headScale-1)*headRy to keep it proud of the
// scaled face surface — at headScale=1 this is 0 (no change), for kitten(1.15)
// it moves ~1.1 units forward.
const muzzleYscaleShift = (bld.headScale - 1.0) * fc.headRy;
const muzzleY_actual = fc.muzzlePadY + muzzleOffsetY - muzzleYscaleShift;
const muzzleZ_actual = noseZ + (fc.muzzlePadZ - fc.noseZ);
const muzzlePad = sdf.ellipsoid(fc.muzzlePadRx, fc.muzzlePadRy, fc.muzzlePadRz)
  .translate(0, muzzleY_actual, muzzleZ_actual)
  .label('muzzle');

// ============================================================
// INNER-EAR PADS (follow ear positions)
// ============================================================
const [ielx, iely, ielz] = ears.innerEarLPos;
const [ierx, iery, ierz] = ears.innerEarRPos;

const innerEarL = sdf.ellipsoid(2.0, 0.65, 2.9)
  .rotate(0, -15, 0).translate(ielx, iely, ielz).label('innerEar');
const innerEarR = sdf.ellipsoid(2.0, 0.65, 2.9)
  .rotate(0,  15, 0).translate(ierx, iery, ierz).label('innerEar');

// ============================================================
// EYES (follow head center)
// ============================================================
const eyeSphereL = sdf.sphere(eyeR).translate(eyeAnchorLx, eyeY, eyeZ);
const eyeSphereR = sdf.sphere(eyeR).translate(eyeAnchorRx, eyeY, eyeZ);
const eyeClipL   = eyeClipBox.translate(eyeAnchorLx, eyeY - halfBoxY, eyeZ);
const eyeClipR   = eyeClipBox.translate(eyeAnchorRx, eyeY - halfBoxY, eyeZ);
const eyeballL   = eyeSphereL.intersect(eyeClipL).label('eye');
const eyeballR   = eyeSphereR.intersect(eyeClipR).label('eye');

const eyeFrontY_actual = eyeY - eyeR;

// Iris
const irisDiscR     = eyeR * 0.55;
const irisProtrude  = eyeR * 0.12;
const irisBallRadius = (irisDiscR * irisDiscR + irisProtrude * irisProtrude) / (2 * irisProtrude);
const irisBallCY    = eyeFrontY_actual + irisBallRadius - irisProtrude;

const irisBallL = sdf.sphere(irisBallRadius).translate(eyeAnchorLx, irisBallCY, eyeZ);
const irisBallR = sdf.sphere(irisBallRadius).translate(eyeAnchorRx, irisBallCY, eyeZ);
const irisClipL = sdf.cylinder(irisDiscR, irisBallRadius * 3.0)
  .rotate(90, 0, 0).translate(eyeAnchorLx, irisBallCY, eyeZ);
const irisClipR = sdf.cylinder(irisDiscR, irisBallRadius * 3.0)
  .rotate(90, 0, 0).translate(eyeAnchorRx, irisBallCY, eyeZ);
const irisCapL = irisBallL.intersect(irisClipL).label('iris');
const irisCapR = irisBallR.intersect(irisClipR).label('iris');

// Pupil
const irisCapFrontY      = eyeFrontY_actual - irisProtrude;
const pupilDiscR         = eyeR * 0.33;
const pupilExtraProtrude = eyeR * 0.18;
const pupilBallRadius    = (pupilDiscR * pupilDiscR + pupilExtraProtrude * pupilExtraProtrude) / (2 * pupilExtraProtrude);
const pupilBallCY        = irisCapFrontY + pupilBallRadius - pupilExtraProtrude;

const pupilBallL  = sdf.sphere(pupilBallRadius).translate(eyeAnchorLx, pupilBallCY, eyeZ);
const pupilBallRn = sdf.sphere(pupilBallRadius).translate(eyeAnchorRx, pupilBallCY, eyeZ);
const pupilClipL  = sdf.cylinder(pupilDiscR, pupilBallRadius * 3.0)
  .rotate(90, 0, 0).translate(eyeAnchorLx, pupilBallCY, eyeZ);
const pupilClipR  = sdf.cylinder(pupilDiscR, pupilBallRadius * 3.0)
  .rotate(90, 0, 0).translate(eyeAnchorRx, pupilBallCY, eyeZ);
const pupilCapL = pupilBallL.intersect(pupilClipL).label('pupil');
const pupilCapR = pupilBallRn.intersect(pupilClipR).label('pupil');

// ============================================================
// NOSE (follow head + scale shift)
// ============================================================
const noseYscaleShift = (bld.headScale - 1.0) * fc.headRy;  // same as muzzle
const nY = fc.noseY + noseOffsetY - noseYscaleShift;
const nZ = noseZ;
const noseTopBar = sdf.capsule([-0.90, nY, nZ + 0.30], [0.90, nY, nZ + 0.30], 0.46);
const noseSideL  = sdf.capsule([-0.90, nY, nZ + 0.30], [0, nY - 0.05, nZ - 0.55], 0.24);
const noseSideR  = sdf.capsule([ 0.90, nY, nZ + 0.30], [0, nY - 0.05, nZ - 0.55], 0.24);
const nosePoint  = sdf.sphere(0.26).translate(0, nY - 0.05, nZ - 0.55);
const noseFull   = noseTopBar.smoothUnion(noseSideL, 0.22).smoothUnion(noseSideR, 0.22)
  .smoothUnion(nosePoint, 0.20).label('nose');

// ============================================================
// MOUTH (follow nose)
// ============================================================
const mY  = nY - 0.06;
const mZ0 = nZ - 0.55;
const mZ1 = mZ0 - 0.42;
const mZ2 = mZ0 - 0.95;
const philtrum = sdf.capsule([0, mY, mZ0], [0, mY, mZ1], 0.16);
const arcL = sdf.capsule([0, mY, mZ1], [-0.90, mY - 0.05, mZ2], 0.16);
const arcR = sdf.capsule([0, mY, mZ1], [ 0.90, mY - 0.05, mZ2], 0.16);
const curlL = sdf.capsule([-0.90, mY - 0.05, mZ2], [-1.10, mY - 0.04, mZ2 + 0.22], 0.15);
const curlR = sdf.capsule([ 0.90, mY - 0.05, mZ2], [ 1.10, mY - 0.04, mZ2 + 0.22], 0.15);
const mouth = philtrum.smoothUnion(arcL, 0.14).smoothUnion(arcR, 0.14)
  .smoothUnion(curlL, 0.12).smoothUnion(curlR, 0.12).label('mouth');

// ============================================================
// EYELIDS
// ============================================================
const LID_SCALE    = 1.06;
const LID_TILT_DEG = 18;
const UPPER_FRAC   = 0.30;
const LOWER_FRAC   = 0.12;

const lidR = eyeR * LID_SCALE;
const big  = lidR * 4;

function makeLidCap(dir, frac) {
  const mz = dir * (1 - 2 * frac) * eyeR;
  const halfSpace = sdf.box([big, big, big])
    .translate([0, 0, dir * big / 2])
    .rotate([dir * LID_TILT_DEG, 0, 0])
    .translate([0, 0, mz]);
  return sdf.sphere(lidR).intersect(halfSpace);
}

const lidsAtOrigin = sdf.union(makeLidCap(1, UPPER_FRAC), makeLidCap(-1, LOWER_FRAC));
const lidsL = lidsAtOrigin.translate(eyeAnchorLx, eyeY, eyeZ).label('lids');
const lidsR = lidsAtOrigin.translate(eyeAnchorRx, eyeY, eyeZ).label('lids');

// ============================================================
// DETAIL REGIONS FOR BUILD
// ============================================================
const detailRegions = [
  { center: headCenter,                                          radius: 15,  edgeLength: 0.20 },
  { center: [0, nY - 0.3, nZ - 0.2],                           radius: 5.0, edgeLength: 0.07 },
  { center: [eyeAnchorLx, eyeY, eyeZ],                         radius: 5.0, edgeLength: 0.05 },
  { center: [eyeAnchorRx, eyeY, eyeZ],                         radius: 5.0, edgeLength: 0.05 },
  { center: [ielx, iely, ielz + 1.5],                          radius: 5.0, edgeLength: 0.12 },
  { center: [ierx, iery, ierz + 1.5],                          radius: 5.0, edgeLength: 0.12 },
];

// ============================================================
// ASSEMBLE & LIFT TO z≥0
// ============================================================
const cat = sdf.union(
  bodyLabeled,
  muzzlePad,
  eyeballL, eyeballR,
  irisCapL, irisCapR,
  pupilCapL, pupilCapR,
  lidsL, lidsR,
  noseFull,
  mouth,
  innerEarL, innerEarR
);

// Lift to ensure min-z ≈ 0.
// sitting: haunches bottom ~0 after +0.9 lift
// standing: paw sphere centers at z=legThick, bottom of paw sphere at z≈0 already
// +0.25 for standing to clear paw sphere bottom (paw centers at z=lt, bottom at z≈lt-lt=0 but sdf smoothUnion bulges slightly below)
const liftZ = p.pose === 'sitting' ? 0.9 : 0.25;

return cat.translate(0, 0, liftZ).build({
  edgeLength: 0.45,
  detail: detailRegions,
});
