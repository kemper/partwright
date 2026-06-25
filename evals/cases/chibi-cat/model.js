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
  pattern: { type: 'select', default: 'solid',
           options: ['solid', 'tuxedo', 'points', 'tabby', 'calico', 'spotted', 'siamese'],
           label: 'Pattern' },
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

  // ── Ground plane: paw capsule bottoms reach z ≈ 0 ──
  // Capsule endpoint at (x, y, pawZ); capsule radius lt → bottom of sphere at pawZ - lt
  // We want that bottom at z = 0, so:  pawZ = lt
  const pawZ   = lt;              // capsule foot-center z; sphere bottom at z≈0
  const legTopZ = pawZ + ll;     // where capsule top meets the body undercarriage

  // ── Body is a HORIZONTAL barrel — long axis is FRONT-TO-BACK (Y axis) ──
  // bld.bodyRx = side-to-side half-width; we use a dedicated front-back half-length.
  // For a quadruped cat the torso front-to-back needs to be ~2× the side width.
  const bodyRx = bld.bodyRx * 0.75;  // side (X) — narrower than the sitting blob
  const bodyRY = bld.bodyRx * 1.55;  // front-to-back (Y) — long axis
  const bodyRz = bld.bodyRz * 0.80;  // height (Z) — slightly flattened barrel
  const bodyCenterZ = legTopZ + bodyRz;  // body ellipsoid center height

  // ── Leg attachment points (under the four corners of the barrel) ──
  const legX  = bodyRx  * 0.72;   // side offset
  const legFY = -bodyRY * 0.52;   // front legs: under chest (toward -Y / viewer)
  const legBY =  bodyRY * 0.52;   // back legs:  under hips  (toward +Y / rear)

  // Straight vertical leg capsules: foot → body undercarriage
  const legFL = sdf.capsule([ legX, legFY, pawZ], [ legX, legFY, legTopZ], lt);
  const legFR = sdf.capsule([-legX, legFY, pawZ], [-legX, legFY, legTopZ], lt);
  const legBL = sdf.capsule([ legX, legBY, pawZ], [ legX, legBY, legTopZ], lt);
  const legBR = sdf.capsule([-legX, legBY, pawZ], [-legX, legBY, legTopZ], lt);

  // Paw pads: flattened ellipsoids at each foot
  const pawFL = sdf.ellipsoid(lt * 1.25, lt * 1.10, lt * 0.75).translate( legX, legFY, pawZ);
  const pawFR = sdf.ellipsoid(lt * 1.25, lt * 1.10, lt * 0.75).translate(-legX, legFY, pawZ);
  const pawBL = sdf.ellipsoid(lt * 1.15, lt * 1.25, lt * 0.75).translate( legX, legBY, pawZ);
  const pawBR = sdf.ellipsoid(lt * 1.15, lt * 1.25, lt * 0.75).translate(-legX, legBY, pawZ);

  // ── Horizontal torso (belly slightly lower toward front) ──
  const torso    = sdf.ellipsoid(bodyRx, bodyRY, bodyRz).translate(0, 0, bodyCenterZ);
  // Haunches: slightly wider & taller bulge at rear end of barrel
  const haunchY  = bodyRY * 0.55;
  const haunches = sdf.ellipsoid(bodyRx * 0.88, bodyRY * 0.55, bodyRz * 0.92)
    .translate(0, haunchY, bodyCenterZ + bodyRz * 0.08);
  // Chest: a matching narrower bulge at front
  const chestY  = -bodyRY * 0.55;
  const chest   = sdf.ellipsoid(bodyRx * 0.72, bodyRY * 0.45, bodyRz * 0.80)
    .translate(0, chestY, bodyCenterZ + bodyRz * 0.10);

  let bodyMass = torso
    .smoothUnion(haunches, 2.8)
    .smoothUnion(chest,    2.4)
    .smoothUnion(legFL, 2.2).smoothUnion(legFR, 2.2)
    .smoothUnion(legBL, 2.2).smoothUnion(legBR, 2.2)
    .smoothUnion(pawFL, 1.6).smoothUnion(pawFR, 1.6)
    .smoothUnion(pawBL, 1.6).smoothUnion(pawBR, 1.6);

  // ── Neck: rises from front-chest toward head ──
  // Neck root at front-top of torso; angled forward and up
  const neckRootZ = bodyCenterZ + bodyRz * 0.60;
  const neckRootY = -bodyRY * 0.62;
  const neckTipZ  = neckRootZ + 3.5;
  const neckTipY  = neckRootY - 2.0;
  const neck = sdf.capsule([0, neckRootY, neckRootZ], [0, neckTipY, neckTipZ], 2.6);
  bodyMass = bodyMass.smoothUnion(neck, 2.8);

  // ── Head: forward of the chest, face pointing toward -Y (front camera = az 270) ──
  const headRxS = fc.headRx * bld.headScale;
  const headRyS = fc.headRy * bld.headScale;
  const headRzS = fc.headRz * bld.headScale;
  // Position head at neck tip, shifted forward and slightly up
  const headY  = neckTipY - headRyS * 0.55;
  const headZ  = neckTipZ + headRzS * 0.30;
  const headSdf = sdf.ellipsoid(headRxS, headRyS, headRzS).translate(0, headY, headZ);
  bodyMass = bodyMass.smoothUnion(headSdf, 3.2);

  // Muzzle body bump (same relative offset as sitting)
  const muzzleBodyBump = sdf.ellipsoid(fc.muzzleRx, fc.muzzleRy, fc.muzzleRz)
    .translate(0, headY + (fc.muzzleY - fc.headY), headZ + (fc.muzzleZ - fc.headZ));
  bodyMass = bodyMass.smoothUnion(muzzleBodyBump, 0.45);

  return {
    bodyMass,
    headCenter: [0, headY, headZ],
    bodyBaseZ: bodyCenterZ,
    legBottom: pawZ,
    frontLegX: legX, frontLegY: legFY,
    backLegX:  legX, backLegY:  legBY,
    headY, headZ,
    headDeltaY: headY - fc.headY,
    headDeltaZ: headZ - fc.headZ,
    // rear of barrel — tail root
    rearY: bodyRY * 0.88,
    rearZ: bodyCenterZ,
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
  // Standing: tail sprouts from the rump (rear/+Y end of horizontal body),
  // sweeps further back (+Y) and upward (+Z) — like a cat with tail up.
  const rY = bodyResult.rearY  || 8.0;
  const rZ = bodyResult.rearZ  || 10.0;
  // Build a standing-specific tail: root at rump, arcing upward/backward
  if (p.tail === 'curl') {
    // Rises from rump, curls up and slightly forward at the tip
    const t0 = sdf.capsule([0, rY,       rZ + 0.5], [0, rY + 2.0, rZ + 4.0], 2.0);
    const t1 = sdf.capsule([0, rY + 2.0, rZ + 4.0], [0, rY + 1.5, rZ + 8.0], 1.8);
    const t2 = sdf.capsule([0, rY + 1.5, rZ + 8.0], [0, rY - 1.0, rZ + 10.5], 1.5);
    const t3 = sdf.capsule([0, rY - 1.0, rZ + 10.5],[0, rY - 3.0, rZ + 11.5], 1.3);
    const t4 = sdf.capsule([0, rY - 3.0, rZ + 11.5],[0, rY - 4.5, rZ + 11.0], 1.1);
    tail = t0.smoothUnion(t1, 1.6).smoothUnion(t2, 1.4).smoothUnion(t3, 1.2).smoothUnion(t4, 1.1);
  } else if (p.tail === 'short') {
    const t0 = sdf.capsule([0, rY, rZ + 0.5], [0, rY + 2.5, rZ + 3.0], 1.9);
    const t1 = sdf.sphere(1.7).translate(0, rY + 3.0, rZ + 4.5);
    tail = t0.smoothUnion(t1, 1.2);
  } else {
    // fluffy: thicker and fuller arc upward
    const t0 = sdf.capsule([0, rY,       rZ + 0.5], [0, rY + 2.5, rZ + 4.5], 2.6);
    const t1 = sdf.capsule([0, rY + 2.5, rZ + 4.5], [0, rY + 2.0, rZ + 8.5], 2.4);
    const t2 = sdf.capsule([0, rY + 2.0, rZ + 8.5], [0, rY - 0.5, rZ + 11.0], 2.2);
    const t3 = sdf.sphere(2.0).translate(0, rY - 1.5, rZ + 12.0);
    tail = t0.smoothUnion(t1, 1.9).smoothUnion(t2, 1.7).smoothUnion(t3, 1.6);
  }
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
// PATTERN MARKINGS (colorway patterns: tuxedo, points)
// Markings are PROUD labeled blobs blended into the body surface (the muzzle
// recipe) so the nearest-centroid color remap paints them cleanly flush — an
// `intersect`'d coincident patch would tie with `body` and salt-and-pepper.
// `solid` adds none, so the default render is unchanged (baseline-safe).
// ============================================================
function markAnchorsFor() {
  if (p.pose === 'sitting') {
    return {
      pawPts: [[2.7, -5.0, 2.3], [-2.7, -5.0, 2.3]],
      chest: [0, -4.6, 9.2], chestR: [3.3, 4.7, 5.0],
      faceCenter: [0, fc.muzzleY + 2.7, fc.muzzleZ + 0.6], faceR: [4.3, 2.5, 3.7],
      tailPts: [[5.2, -2.5, 3.2], [3.0, -6.0, 2.2]],
      earPts: [ears.innerEarLPos, ears.innerEarRPos],
    };
  }
  const br = bodyResult;
  return {
    pawPts: [
      [br.frontLegX, br.frontLegY, br.legBottom], [-br.frontLegX, br.frontLegY, br.legBottom],
      [br.backLegX, br.backLegY, br.legBottom], [-br.backLegX, br.backLegY, br.legBottom],
    ],
    chest: [0, br.frontLegY - 1.2, br.legBottom + 3.5], chestR: [3.2, 3.0, 4.0],
    faceCenter: [0, br.headY - 4.6, br.headZ - 1.6], faceR: [4.4, 3.2, 4.0],
    tailPts: [[0, br.rearY + 0.5, br.rearZ + 6.0]],
    earPts: [ears.innerEarLPos, ears.innerEarRPos],
  };
}

function buildMarkings() {
  if (p.pattern === 'solid') return [];
  const a = markAnchorsFor();
  const out = [];
  if (p.pattern === 'tuxedo') {
    // White bib (chest) + white socks (paws)
    out.push(sdf.ellipsoid(a.chestR[0], a.chestR[1], a.chestR[2])
      .translate(a.chest[0], a.chest[1], a.chest[2]).label('bib'));
    for (const [x, y, z] of a.pawPts) {
      out.push(sdf.ellipsoid(2.7, 2.3, 2.5).translate(x, y, z).label('socks'));
    }
  } else if (p.pattern === 'points') {
    // Siamese-style darker extremities: ears, face mask, paws, tail tip
    for (const [x, y, z] of a.earPts) {
      out.push(sdf.ellipsoid(2.4, 1.4, 3.0).translate(x, y, z + 0.5).label('points'));
    }
    out.push(sdf.ellipsoid(a.faceR[0], a.faceR[1], a.faceR[2])
      .translate(a.faceCenter[0], a.faceCenter[1], a.faceCenter[2]).label('points'));
    for (const [x, y, z] of a.pawPts) {
      out.push(sdf.ellipsoid(2.5, 2.5, 1.9).translate(x, y, z).label('points'));
    }
    for (const [x, y, z] of a.tailPts) {
      out.push(sdf.ellipsoid(2.2, 2.4, 2.2).translate(x, y, z).label('points'));
    }
  }
  return out;
}
const markings = buildMarkings();

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
  innerEarL, innerEarR,
  ...markings
);

// Lift to ensure min-z ≈ 0.
// sitting: haunches bottom ~0 after +0.9 lift
// standing: paw sphere centers at z=legThick, bottom of paw sphere at z≈0 already
// +0.25 for standing to clear paw sphere bottom (paw centers at z=lt, bottom at z≈lt-lt=0 but sdf smoothUnion bulges slightly below)
const liftZ = p.pose === 'sitting' ? 0.9 : 0.25;

const result = cat.translate(0, 0, liftZ).build({
  edgeLength: 0.45,
  detail: detailRegions,
});

// ============================================================
// PROCEDURAL COLORWAYS (flush surface paint — api.paint.pattern, not geometry)
// Algorithmic colour fields (the colour twin of api.surface.* textures) paint
// each body triangle one palette colour, so the coat stays perfectly flush (no
// raised welt). Scoped to the 'body' label so eyes/nose/muzzle (separate labeled
// solids, palette-coloured) are never touched. Coords are POST-lift.
//  - tabby   stripes  (warm-brown mackerel + fBm warp)
//  - calico  patches  (cream / orange / dark-brown blotches)
//  - spotted spots    (Worley leopard rosettes)
//  - siamese gradient (dark points on the extremities via ear/paw/tail/face anchors)
// ============================================================
function applyColorway() {
  const a = markAnchorsFor();
  const lift = (pt) => [pt[0], pt[1], pt[2] + liftZ];
  switch (p.pattern) {
    case 'tabby':
      api.paint.pattern({ pattern: 'stripes', colors: ['#D6913E', '#5A3A1F'],
                          scope: 'body', axis: 'z', scale: 5, warp: 0.45 });
      break;
    case 'calico':
      api.paint.pattern({ pattern: 'patches', colors: ['#F2EAD6', '#E0892F', '#3A2A22'],
                          scope: 'body', scale: 5 });
      break;
    case 'spotted':
      api.paint.pattern({ pattern: 'spots', colors: ['#E8C07A', '#5A3A1F'],
                          scope: 'body', scale: 4, coverage: 0.4 });
      break;
    case 'siamese': {
      const anchors = [
        ...a.earPts.map(lift), ...a.pawPts.map(lift), ...a.tailPts.map(lift), lift(a.faceCenter),
      ];
      api.paint.pattern({ pattern: 'gradient', colors: ['#EDE2CE', '#4A3329'],
                          scope: 'body', anchors, scale: 5.5, warp: 0.18 });
      break;
    }
  }
}
applyColorway();

return result;
