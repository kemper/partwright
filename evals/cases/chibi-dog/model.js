// Dog — Parametric chibi dog with pose, build, ears, tail, face, pattern variants
// Face points -Y, Z up.  Brought to cat-parity: figure-API eyelids, colored
// muzzle/nose/mouth/inner-ear labels, parametric builder + paramsSchema, and the
// shared proud-blob pattern markings (tuxedo, tan-points).
// v5: parity rewrite (was a single hand-tuned spaniel).

const { sdf } = api;

// ============================================================
// PARAMS
// ============================================================
const p = api.params({
  pose:  { type: 'select', default: 'sitting',
           options: ['sitting', 'standing'],
           label: 'Pose' },
  build: { type: 'select', default: 'average',
           options: ['puppy', 'slim', 'average', 'chonky'],
           label: 'Build' },
  ears:  { type: 'select', default: 'floppy',
           options: ['floppy', 'perky', 'long'],
           label: 'Ears' },
  tail:  { type: 'select', default: 'curl',
           options: ['curl', 'short', 'fluffy'],
           label: 'Tail' },
  face:  { type: 'select', default: 'snouty',
           options: ['snouty', 'round'],
           label: 'Face' },
  pattern: { type: 'select', default: 'solid',
           options: ['solid', 'tuxedo', 'tan-points'],
           label: 'Pattern' },
});

// ============================================================
// BUILD SCALE TABLE
// ============================================================
const BUILD = {
  puppy:   { bodyRx: 6.0, bodyRy: 4.8, bodyRz: 4.4, headScale: 1.18, legThick: 1.8, legLength: 3.0 },
  slim:    { bodyRx: 5.6, bodyRy: 4.4, bodyRz: 4.8, headScale: 0.95, legThick: 1.8, legLength: 5.0 },
  average: { bodyRx: 6.6, bodyRy: 5.2, bodyRz: 5.0, headScale: 1.00, legThick: 2.1, legLength: 4.2 },
  chonky:  { bodyRx: 8.0, bodyRy: 6.6, bodyRz: 5.8, headScale: 1.06, legThick: 2.6, legLength: 3.4 },
};
const bld = BUILD[p.build];

// ============================================================
// EYE GEOMETRY CONSTANTS  (big soulful puppy eyes, recessed for lids)
// ============================================================
const eyeR        = 2.6;   // chibi-sized eyes
const eyeAnchorLx = -3.5;
const eyeAnchorRx =  3.5;
const eyeAnchorY  = -7.0;  // slightly recessed in head for natural look (head front ≈ -8.2)
const eyeAnchorZ  = 24.0;
const halfBoxY    = 50;
const eyeClipBox  = sdf.box([eyeR * 2 + 2, halfBoxY * 2, eyeR * 2 + 2]);

// ============================================================
// FACE / SNOUT GEOMETRY (face = snouty vs round)
// A real projecting dog snout (ellipsoid long in -Y) with nose at the tip.
// snoutRy controls how far the muzzle projects forward — key for dog vs cat.
// ============================================================
const FACE = {
  snouty: { headRx: 8.4, headRy: 7.2, headRz: 7.8, headY: -1.0, headZ: 22.5,
            snoutRx: 3.6, snoutRy: 5.5, snoutRz: 3.2, snoutY: -9.8, snoutZ: 19.8,
            muzzleRx: 3.2, muzzleRy: 1.4, muzzleRz: 2.2, muzzleY: -14.0, muzzleZ: 19.6,
            noseY: -15.0, noseZ: 20.2 },
  round:  { headRx: 8.6, headRy: 7.8, headRz: 8.0, headY: -1.0, headZ: 22.5,
            snoutRx: 3.6, snoutRy: 3.8, snoutRz: 3.0, snoutY: -8.4, snoutZ: 19.2,
            muzzleRx: 3.0, muzzleRy: 1.1, muzzleRz: 2.1, muzzleY: -11.4, muzzleZ: 19.0,
            noseY: -12.4, noseZ: 19.8 },
};
const fc = FACE[p.face];

// ============================================================
// BODY GEOMETRY (pose-dependent)
// ============================================================
function buildSittingBody() {
  const haunches = sdf.ellipsoid(8.0, 6.0, 4.6).translate(0, 0, 4.4);
  const torso = sdf.ellipsoid(bld.bodyRx, bld.bodyRy, bld.bodyRz).translate(0, -0.5, 9.5);
  let bodyMass = haunches.smoothUnion(torso, 2.5);

  const baseDisc = sdf.ellipsoid(8.2, 5.6, 2.5).translate(0, 0, 2.5);
  bodyMass = bodyMass.smoothUnion(baseDisc, 2.2);

  // Front legs/paws — forward-placed sitting pose
  const pawFront = sdf.capsule([3.2, -4.0, 8.0], [3.4, -4.4, 1.2], 2.1).mirrorPair('x');
  bodyMass = bodyMass.smoothUnion(pawFront, 2.0);

  const neck = sdf.capsule([0, -1.0, 13.5], [0, -1.0, 15.5], 2.9);
  bodyMass = bodyMass.smoothUnion(neck, 2.4);

  const headSdf = sdf.ellipsoid(fc.headRx * bld.headScale, fc.headRy * bld.headScale, fc.headRz * bld.headScale)
    .translate(0, fc.headY, fc.headZ);
  bodyMass = bodyMass.smoothUnion(headSdf, 3.0);

  // Projecting snout
  const snout = sdf.ellipsoid(fc.snoutRx, fc.snoutRy, fc.snoutRz).translate(0, fc.snoutY, fc.snoutZ);
  bodyMass = bodyMass.smoothUnion(snout, 2.0);

  return { bodyMass, headCenter: [0, fc.headY, fc.headZ] };
}

function buildStandingBody() {
  const lt = bld.legThick;
  const ll = bld.legLength;
  const pawZ   = lt;
  const legTopZ = pawZ + ll;

  const bodyRx = bld.bodyRx * 0.72;
  const bodyRY = bld.bodyRx * 1.50;
  const bodyRz = bld.bodyRz * 0.82;
  const bodyCenterZ = legTopZ + bodyRz;

  const legX  = bodyRx  * 0.74;
  const legFY = -bodyRY * 0.50;
  const legBY =  bodyRY * 0.52;

  const legFL = sdf.capsule([ legX, legFY, pawZ], [ legX, legFY, legTopZ], lt);
  const legFR = sdf.capsule([-legX, legFY, pawZ], [-legX, legFY, legTopZ], lt);
  const legBL = sdf.capsule([ legX, legBY, pawZ], [ legX, legBY, legTopZ], lt);
  const legBR = sdf.capsule([-legX, legBY, pawZ], [-legX, legBY, legTopZ], lt);

  const pawFL = sdf.ellipsoid(lt * 1.25, lt * 1.10, lt * 0.75).translate( legX, legFY, pawZ);
  const pawFR = sdf.ellipsoid(lt * 1.25, lt * 1.10, lt * 0.75).translate(-legX, legFY, pawZ);
  const pawBL = sdf.ellipsoid(lt * 1.15, lt * 1.25, lt * 0.75).translate( legX, legBY, pawZ);
  const pawBR = sdf.ellipsoid(lt * 1.15, lt * 1.25, lt * 0.75).translate(-legX, legBY, pawZ);

  const torso    = sdf.ellipsoid(bodyRx, bodyRY, bodyRz).translate(0, 0, bodyCenterZ);
  const haunchY  = bodyRY * 0.55;
  const haunches = sdf.ellipsoid(bodyRx * 0.92, bodyRY * 0.55, bodyRz * 0.94)
    .translate(0, haunchY, bodyCenterZ + bodyRz * 0.08);
  const chestY  = -bodyRY * 0.55;
  const chest   = sdf.ellipsoid(bodyRx * 0.78, bodyRY * 0.45, bodyRz * 0.84)
    .translate(0, chestY, bodyCenterZ + bodyRz * 0.10);

  let bodyMass = torso
    .smoothUnion(haunches, 2.8)
    .smoothUnion(chest,    2.4)
    .smoothUnion(legFL, 2.2).smoothUnion(legFR, 2.2)
    .smoothUnion(legBL, 2.2).smoothUnion(legBR, 2.2)
    .smoothUnion(pawFL, 1.6).smoothUnion(pawFR, 1.6)
    .smoothUnion(pawBL, 1.6).smoothUnion(pawBR, 1.6);

  const neckRootZ = bodyCenterZ + bodyRz * 0.60;
  const neckRootY = -bodyRY * 0.60;
  const neckTipZ  = neckRootZ + 3.5;
  const neckTipY  = neckRootY - 2.0;
  const neck = sdf.capsule([0, neckRootY, neckRootZ], [0, neckTipY, neckTipZ], 2.8);
  bodyMass = bodyMass.smoothUnion(neck, 2.8);

  const headRxS = fc.headRx * bld.headScale;
  const headRyS = fc.headRy * bld.headScale;
  const headRzS = fc.headRz * bld.headScale;
  const headY  = neckTipY - headRyS * 0.55;
  const headZ  = neckTipZ + headRzS * 0.28;
  const headSdf = sdf.ellipsoid(headRxS, headRyS, headRzS).translate(0, headY, headZ);
  bodyMass = bodyMass.smoothUnion(headSdf, 3.2);

  const snout = sdf.ellipsoid(fc.snoutRx, fc.snoutRy, fc.snoutRz)
    .translate(0, headY + (fc.snoutY - fc.headY), headZ + (fc.snoutZ - fc.headZ));
  bodyMass = bodyMass.smoothUnion(snout, 2.0);

  return {
    bodyMass,
    headCenter: [0, headY, headZ],
    legBottom: pawZ,
    frontLegX: legX, frontLegY: legFY,
    backLegX:  legX, backLegY:  legBY,
    headY, headZ,
    headDeltaY: headY - fc.headY,
    headDeltaZ: headZ - fc.headZ,
    rearY: bodyRY * 0.86,
    rearZ: bodyCenterZ,
  };
}

// ============================================================
// BUILD THE BODY + face-feature offsets
// ============================================================
let bodyResult, eyeZ, eyeY, faceDY, faceDZ;

if (p.pose === 'sitting') {
  bodyResult = buildSittingBody();
  eyeZ = eyeAnchorZ;  eyeY = eyeAnchorY;  faceDY = 0;  faceDZ = 0;
} else {
  bodyResult = buildStandingBody();
  faceDY = bodyResult.headDeltaY;  faceDZ = bodyResult.headDeltaZ;
  eyeZ = eyeAnchorZ + faceDZ;  eyeY = eyeAnchorY + faceDY;
}

// ============================================================
// EARS
// ============================================================
function buildEars(headCenter) {
  const hx = fc.headRx * bld.headScale;
  const hz = fc.headRz * bld.headScale;
  const [hcx, hcy, hcz] = headCenter;
  const sideX = hx * 0.86;
  const topZ  = hcz + hz * 0.45;

  if (p.ears === 'floppy') {
    // Spaniel floppy ears: root at the temple/side of the head, drape downward.
    // Three-point capsule chain for a gentle outward-then-down hang.
    const earRootZ  = hcz + hz * 0.15;   // attach mid-height on head side
    const earMidZ   = earRootZ - 3.0;    // swings outward as it drops
    const earTipZ   = earRootZ - 8.5;    // hangs well below chin
    const earOutX   = hx * 0.92;         // just at the head side
    const earMidX   = hx * 1.08;         // swings slightly wider at mid
    const earCY     = hcy - 0.5;         // at the face center plane

    const earTopL = sdf.capsule([-earOutX, earCY, earRootZ], [-earMidX, earCY + 0.4, earMidZ], 2.1);
    const earBotL = sdf.capsule([-earMidX, earCY + 0.4, earMidZ], [-earMidX * 0.9, earCY + 0.8, earTipZ], 1.6);
    const earL = earTopL.smoothUnion(earBotL, 1.5);

    const earTopR = sdf.capsule([ earOutX, earCY, earRootZ], [ earMidX, earCY + 0.4, earMidZ], 2.1);
    const earBotR = sdf.capsule([ earMidX, earCY + 0.4, earMidZ], [ earMidX * 0.9, earCY + 0.8, earTipZ], 1.6);
    const earR = earTopR.smoothUnion(earBotR, 1.5);

    return { earL, earR, blend: 1.8,
             innerEarLPos: [-earOutX, earCY - 0.5, earRootZ - 1.0],
             innerEarRPos: [ earOutX, earCY - 0.5, earRootZ - 1.0] };
  } else if (p.ears === 'perky') {
    // Upright triangular ears
    const earL = sdf.ellipsoid(2.4, 0.9, 3.6).rotate(0, -18, 0).translate(-hx * 0.55, hcy - 0.3, topZ + 3.0);
    const earR = sdf.ellipsoid(2.4, 0.9, 3.6).rotate(0,  18, 0).translate( hx * 0.55, hcy - 0.3, topZ + 3.0);
    return { earL, earR, blend: 2.4,
             innerEarLPos: [-hx * 0.55, hcy - 1.0, topZ + 3.0],
             innerEarRPos: [ hx * 0.55, hcy - 1.0, topZ + 3.0] };
  } else {
    // long: basset hound — very long floppy ears, hanging well below the chin.
    // Keep ears at sides (don't pull inward at the tip) to avoid topology tunnels.
    const earRootZ  = hcz + hz * 0.10;
    const earMidZ   = earRootZ - 4.5;
    const earTipZ   = earRootZ - 10.0;   // long but not so long they encircle the body
    const earOutX   = hx * 0.90;
    const earMidX   = hx * 1.05;         // swings out slightly at mid
    const earCY     = hcy - 0.3;

    const earTopL = sdf.capsule([-earOutX, earCY, earRootZ], [-earMidX, earCY + 0.5, earMidZ], 2.2);
    const earBotL = sdf.capsule([-earMidX, earCY + 0.5, earMidZ], [-earMidX, earCY + 0.8, earTipZ], 1.7);
    const earL = earTopL.smoothUnion(earBotL, 1.6);

    const earTopR = sdf.capsule([ earOutX, earCY, earRootZ], [ earMidX, earCY + 0.5, earMidZ], 2.2);
    const earBotR = sdf.capsule([ earMidX, earCY + 0.5, earMidZ], [ earMidX, earCY + 0.8, earTipZ], 1.7);
    const earR = earTopR.smoothUnion(earBotR, 1.6);

    return { earL, earR, blend: 1.8,
             innerEarLPos: [-earOutX, earCY - 0.6, earRootZ - 1.5],
             innerEarRPos: [ earOutX, earCY - 0.6, earRootZ - 1.5] };
  }
}

// ============================================================
// TAIL
// ============================================================
function buildTail(rootX, rootY, rootZ) {
  if (p.tail === 'curl') {
    const t0 = sdf.capsule([rootX, rootY + 1.5, rootZ],      [rootX + 2.5, rootY + 2.0, rootZ + 3.0], 1.9);
    const t1 = sdf.capsule([rootX + 2.5, rootY + 2.0, rootZ + 3.0], [rootX + 1.5, rootY + 1.0, rootZ + 5.5], 1.6);
    const t2 = sdf.capsule([rootX + 1.5, rootY + 1.0, rootZ + 5.5], [rootX - 0.5, rootY + 1.5, rootZ + 6.0], 1.4);
    return t0.smoothUnion(t1, 1.5).smoothUnion(t2, 1.3);
  } else if (p.tail === 'short') {
    const stub = sdf.capsule([rootX, rootY + 1.0, rootZ], [rootX + 1.5, rootY + 2.5, rootZ + 2.0], 1.9);
    const tip  = sdf.sphere(1.8).translate(rootX + 1.8, rootY + 3.2, rootZ + 3.0);
    return stub.smoothUnion(tip, 1.3);
  } else {
    // fluffy: thick plumed tail
    const t0 = sdf.capsule([rootX, rootY + 1.5, rootZ],      [rootX + 3.0, rootY + 2.5, rootZ + 3.5], 2.6);
    const t1 = sdf.capsule([rootX + 3.0, rootY + 2.5, rootZ + 3.5], [rootX + 2.0, rootY + 1.0, rootZ + 6.5], 2.3);
    const t2 = sdf.sphere(2.1).translate(rootX + 0.5, rootY + 1.5, rootZ + 7.0);
    return t0.smoothUnion(t1, 2.0).smoothUnion(t2, 1.8);
  }
}

// ============================================================
// ASSEMBLE BODY + EARS + TAIL
// ============================================================
let { bodyMass } = bodyResult;
const headCenter = bodyResult.headCenter;

const ears = buildEars(headCenter);
bodyMass = bodyMass.smoothUnion(ears.earL, ears.blend).smoothUnion(ears.earR, ears.blend);

let tail;
if (p.pose === 'sitting') {
  tail = buildTail(4.5, 4.5, 6.0);
} else {
  const rY = bodyResult.rearY || 8.0;
  const rZ = bodyResult.rearZ || 10.0;
  if (p.tail === 'short') {
    const t0 = sdf.capsule([0, rY, rZ + 0.5], [0, rY + 2.5, rZ + 3.0], 1.8);
    const t1 = sdf.sphere(1.7).translate(0, rY + 3.0, rZ + 4.5);
    tail = t0.smoothUnion(t1, 1.3);
  } else if (p.tail === 'fluffy') {
    const t0 = sdf.capsule([0, rY,       rZ + 0.5], [0, rY + 2.5, rZ + 4.5], 2.6);
    const t1 = sdf.capsule([0, rY + 2.5, rZ + 4.5], [0, rY + 2.0, rZ + 8.5], 2.3);
    const t2 = sdf.sphere(2.0).translate(0, rY + 1.0, rZ + 9.5);
    tail = t0.smoothUnion(t1, 1.9).smoothUnion(t2, 1.7);
  } else {
    // curl up
    const t0 = sdf.capsule([0, rY,       rZ + 0.5], [0, rY + 2.0, rZ + 4.0], 1.9);
    const t1 = sdf.capsule([0, rY + 2.0, rZ + 4.0], [0, rY + 1.0, rZ + 7.5], 1.6);
    const t2 = sdf.capsule([0, rY + 1.0, rZ + 7.5], [0, rY - 1.5, rZ + 8.5], 1.4);
    tail = t0.smoothUnion(t1, 1.6).smoothUnion(t2, 1.4);
  }
}
bodyMass = bodyMass.smoothUnion(tail, 1.8);

const bodyLabeled = bodyMass.label('body');

// ============================================================
// MUZZLE PAD (lighter snout underside / mouth area)
// ============================================================
const muzzleY = fc.muzzleY + faceDY;
const muzzleZ = fc.muzzleZ + faceDZ;
const muzzlePad = sdf.ellipsoid(fc.muzzleRx, fc.muzzleRy, fc.muzzleRz)
  .translate(0, muzzleY, muzzleZ).label('muzzle');

// ============================================================
// INNER-EAR PADS
// ============================================================
const [ielx, iely, ielz] = ears.innerEarLPos;
const [ierx, iery, ierz] = ears.innerEarRPos;
// Inner ear pads: must be placed on the INNER face of the ear (facing the head / -Y)
// and protrude slightly outward from the ear surface so the nearest-centroid remap
// correctly assigns them the innerEar color.
// For floppy ears the ear face points somewhat forward (-Y), so we offset slightly in -Y.
let innerEarL, innerEarR;
if (p.ears === 'floppy' || p.ears === 'long') {
  // Place on the face of the ear that looks toward the viewer (-Y side of the ear capsule).
  // The ear capsule has radius ~2.1-2.2, so we need to protrude past that in -Y.
  // Use a larger Y protrusion to reliably sit on the outside surface of the ear.
  const ieOffY = -1.8;
  innerEarL = sdf.ellipsoid(1.3, 0.4, 2.6).translate(ielx, iely + ieOffY, ielz).label('innerEar');
  innerEarR = sdf.ellipsoid(1.3, 0.4, 2.6).translate(ierx, iery + ieOffY, ierz).label('innerEar');
} else {
  innerEarL = sdf.ellipsoid(1.3, 0.7, 2.6).rotate(0, -18, 0).translate(ielx, iely - 0.5, ielz).label('innerEar');
  innerEarR = sdf.ellipsoid(1.3, 0.7, 2.6).rotate(0,  18, 0).translate(ierx, iery - 0.5, ierz).label('innerEar');
}

// ============================================================
// EYES — ball-in-ball iris/pupil caps (cat recipe)
// ============================================================
const eyeSphereL = sdf.sphere(eyeR).translate(eyeAnchorLx, eyeY, eyeZ);
const eyeSphereR = sdf.sphere(eyeR).translate(eyeAnchorRx, eyeY, eyeZ);
const eyeClipL   = eyeClipBox.translate(eyeAnchorLx, eyeY - halfBoxY, eyeZ);
const eyeClipR   = eyeClipBox.translate(eyeAnchorRx, eyeY - halfBoxY, eyeZ);
const eyeballL   = eyeSphereL.intersect(eyeClipL).label('eye');
const eyeballR   = eyeSphereR.intersect(eyeClipR).label('eye');

const eyeFrontY_actual = eyeY - eyeR;

const irisDiscR     = eyeR * 0.80;   // big iris fills the eye (soft, not startled)
const irisProtrude  = eyeR * 0.18;   // more dome = looks glossy
const irisBallRadius = (irisDiscR * irisDiscR + irisProtrude * irisProtrude) / (2 * irisProtrude);
const irisBallCY    = eyeFrontY_actual + irisBallRadius - irisProtrude;
const irisBallL = sdf.sphere(irisBallRadius).translate(eyeAnchorLx, irisBallCY, eyeZ);
const irisBallR = sdf.sphere(irisBallRadius).translate(eyeAnchorRx, irisBallCY, eyeZ);
const irisClipL = sdf.cylinder(irisDiscR, irisBallRadius * 3.0).rotate(90, 0, 0).translate(eyeAnchorLx, irisBallCY, eyeZ);
const irisClipR = sdf.cylinder(irisDiscR, irisBallRadius * 3.0).rotate(90, 0, 0).translate(eyeAnchorRx, irisBallCY, eyeZ);
const irisCapL = irisBallL.intersect(irisClipL).label('iris');
const irisCapR = irisBallR.intersect(irisClipR).label('iris');

const irisCapFrontY      = eyeFrontY_actual - irisProtrude;
const pupilDiscR         = eyeR * 0.44;
const pupilExtraProtrude = eyeR * 0.20;
const pupilBallRadius    = (pupilDiscR * pupilDiscR + pupilExtraProtrude * pupilExtraProtrude) / (2 * pupilExtraProtrude);
const pupilBallCY        = irisCapFrontY + pupilBallRadius - pupilExtraProtrude;
const pupilBallL  = sdf.sphere(pupilBallRadius).translate(eyeAnchorLx, pupilBallCY, eyeZ);
const pupilBallRn = sdf.sphere(pupilBallRadius).translate(eyeAnchorRx, pupilBallCY, eyeZ);
const pupilClipL  = sdf.cylinder(pupilDiscR, pupilBallRadius * 3.0).rotate(90, 0, 0).translate(eyeAnchorLx, pupilBallCY, eyeZ);
const pupilClipR  = sdf.cylinder(pupilDiscR, pupilBallRadius * 3.0).rotate(90, 0, 0).translate(eyeAnchorRx, pupilBallCY, eyeZ);
const pupilCapL = pupilBallL.intersect(pupilClipL).label('pupil');
const pupilCapR = pupilBallRn.intersect(pupilClipR).label('pupil');

// ============================================================
// EYELIDS (figure-API recipe — frames eyes, kills protrusion)
// Lower UPPER_FRAC so the lid doesn't shadow the iris too much.
// ============================================================
const LID_SCALE    = 1.05;
const LID_TILT_DEG = 14;
const UPPER_FRAC   = 0.20;  // gentle upper-lid → soft, not startled
const LOWER_FRAC   = 0.10;
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
// NOSE — rounded dog nose at the snout tip (dark in palette)
// ============================================================
const nY = fc.noseY + faceDY;
const nZ = fc.noseZ + faceDZ;
const noseMain   = sdf.ellipsoid(1.5, 1.0, 1.2).translate(0, nY, nZ);
const noseNostrL = sdf.sphere(0.5).translate(-0.7, nY - 0.2, nZ - 0.5);
const noseNostrR = sdf.sphere(0.5).translate( 0.7, nY - 0.2, nZ - 0.5);
const noseFull   = noseMain.smoothUnion(noseNostrL, 0.4).smoothUnion(noseNostrR, 0.4).label('nose');

// ============================================================
// MOUTH — gentle smile below the nose
// ============================================================
const mY  = nY - 0.10;
const mZ0 = nZ - 1.3;
const philtrum = sdf.capsule([0, mY, nZ - 0.6], [0, mY, mZ0], 0.18);
const arcL = sdf.capsule([0, mY, mZ0], [-1.3, mY + 0.1, mZ0 - 0.5], 0.18);
const arcR = sdf.capsule([0, mY, mZ0], [ 1.3, mY + 0.1, mZ0 - 0.5], 0.18);
const mouth = philtrum.smoothUnion(arcL, 0.15).smoothUnion(arcR, 0.15).label('mouth');

// ============================================================
// PATTERN MARKINGS (proud labeled blobs — muzzle recipe, clean flush color)
// solid → none (baseline-safe). tuxedo → white bib/socks. tan-points → tan
// brows, muzzle, chest, socks (Beagle/Doberman feel).
// ============================================================
function markAnchorsFor() {
  if (p.pose === 'sitting') {
    return {
      pawPts: [[3.4, -4.6, 1.8], [-3.4, -4.6, 1.8]],
      chest: [0, -4.8, 10.5], chestR: [3.4, 4.4, 4.8],
      browPts: [[eyeAnchorLx, eyeY + 0.4, eyeZ + 2.2], [eyeAnchorRx, eyeY + 0.4, eyeZ + 2.2]],
    };
  }
  const br = bodyResult;
  return {
    pawPts: [
      [br.frontLegX, br.frontLegY, br.legBottom], [-br.frontLegX, br.frontLegY, br.legBottom],
      [br.backLegX, br.backLegY, br.legBottom], [-br.backLegX, br.backLegY, br.legBottom],
    ],
    chest: [0, br.frontLegY - 1.2, br.legBottom + 3.5], chestR: [3.2, 3.0, 4.0],
    browPts: [[eyeAnchorLx, eyeY + 0.4, eyeZ + 2.2], [eyeAnchorRx, eyeY + 0.4, eyeZ + 2.2]],
  };
}
function buildMarkings() {
  if (p.pattern === 'solid') return [];
  const a = markAnchorsFor();
  const out = [];
  if (p.pattern === 'tuxedo') {
    out.push(sdf.ellipsoid(a.chestR[0], a.chestR[1], a.chestR[2])
      .translate(a.chest[0], a.chest[1], a.chest[2]).label('bib'));
    for (const [x, y, z] of a.pawPts) out.push(sdf.ellipsoid(2.6, 2.3, 2.4).translate(x, y, z).label('socks'));
  } else if (p.pattern === 'tan-points') {
    for (const [x, y, z] of a.browPts) out.push(sdf.ellipsoid(1.0, 0.8, 0.9).translate(x, y, z).label('tan'));
    out.push(sdf.ellipsoid(a.chestR[0] * 0.8, a.chestR[1], a.chestR[2])
      .translate(a.chest[0], a.chest[1], a.chest[2]).label('tan'));
    for (const [x, y, z] of a.pawPts) out.push(sdf.ellipsoid(2.6, 2.3, 2.4).translate(x, y, z).label('tan'));
  }
  return out;
}
const markings = buildMarkings();

// ============================================================
// DETAIL REGIONS
// ============================================================
const detailRegions = [
  { center: headCenter,                         radius: 15,  edgeLength: 0.20 },
  { center: [0, nY, nZ],                         radius: 5.0, edgeLength: 0.07 },
  { center: [eyeAnchorLx, eyeY, eyeZ],           radius: 5.0, edgeLength: 0.05 },
  { center: [eyeAnchorRx, eyeY, eyeZ],           radius: 5.0, edgeLength: 0.05 },
  { center: [ielx, iely, ielz],                  radius: 6.0, edgeLength: 0.14 },
  { center: [ierx, iery, ierz],                  radius: 6.0, edgeLength: 0.14 },
];

// ============================================================
// ASSEMBLE & LIFT TO z≥0
// ============================================================
const dog = sdf.union(
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

const liftZ = p.pose === 'sitting' ? 0.9 : 0.25;

return dog.translate(0, 0, liftZ).build({
  edgeLength: 0.45,
  detail: detailRegions,
});
