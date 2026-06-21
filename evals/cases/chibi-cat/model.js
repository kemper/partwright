// Cat A — "Round Chibi" — large domed head, round compact body, curled tail to side
// Sitting pose, face points -Y, Z up. Head ~55% of silhouette mass.
// v11: eye center recessed deeper into head (less 3/4 protrusion), orange lid caps
const { sdf } = api;

// ============================================================
// Eye geometry constants — LARGE, dominate the face
// eyeR = sphere radius of the eye dome
// eyeAnchorY = position of eye sphere centre — RECESSED into the head (+Y vs v10)
//   Recessing 1 unit means the visible dome height drops from eyeR to (eyeR - 1)
//   from any angle, reducing 3/4 protrusion without changing the frontal disc size.
// ============================================================
const eyeR      = 2.8;    // sphere radius — keeps eyes large
const eyeAnchorLx = -3.8;
const eyeAnchorRx =  3.8;
const eyeAnchorY  = -6.8; // eye centre: 1 unit DEEPER than v10 (-7.8→-6.8)
const eyeAnchorZ  = 24.5;
// Clip box: keeps only the front dome (y <= eyeAnchorY) as a hemisphere
const halfBoxY   = 50;
const eyeClipBox = sdf.box([eyeR * 2 + 2, halfBoxY * 2, eyeR * 2 + 2]);
// Front of the dome: eyeAnchorY - eyeR (the most-forward point of the hemisphere)
const eyeFrontY  = eyeAnchorY - eyeR;   // = -6.8 - 2.8 = -9.6

// ============================================================
// BODY MASSES
// ============================================================

const haunches = sdf.ellipsoid(7, 5.5, 4.2).translate(0, 0, 4.2);
const torso = sdf.ellipsoid(5.5, 4.5, 4.5).translate(0, -0.5, 8.5);
let bodyMass = haunches.smoothUnion(torso, 2.5);

const baseDisc = sdf.ellipsoid(7.5, 5.2, 2.5).translate(0, 0, 2.5);
bodyMass = bodyMass.smoothUnion(baseDisc, 2.2);

const pawFront = sdf.capsule([2.5, -4.2, 6.5], [2.7, -4.5, 1.0], 2.0).mirrorPair('x');
bodyMass = bodyMass.smoothUnion(pawFront, 1.8);

const neck = sdf.capsule([0, -1, 12.5], [0, -1, 14.5], 2.5);
bodyMass = bodyMass.smoothUnion(neck, 2.5);

const head = sdf.ellipsoid(9.2, 7.5, 8.5).translate(0, -1, 22);
bodyMass = bodyMass.smoothUnion(head, 3.0);

const earShaftL = sdf.ellipsoid(3.2, 0.9, 3.5).rotate(0, -15, 0).translate(-5.5, -1.0, 29.0);
const earShaftR = sdf.ellipsoid(3.2, 0.9, 3.5).rotate(0,  15, 0).translate( 5.5, -1.0, 29.0);
const earTipL = sdf.sphere(1.0).translate(-5.5, -1.0, 32.0);
const earTipR = sdf.sphere(1.0).translate( 5.5, -1.0, 32.0);
bodyMass = bodyMass
  .smoothUnion(earShaftL, 2.8)
  .smoothUnion(earShaftR, 2.8)
  .smoothUnion(earTipL, 1.5)
  .smoothUnion(earTipR, 1.5);

const muzzleBodyBump = sdf.ellipsoid(2.0, 0.32, 1.4).translate(0, -8.25, 20.8);
bodyMass = bodyMass.smoothUnion(muzzleBodyBump, 0.45);

// Eye sockets: REMOVED.
// Instead, the eye is recessed (eyeAnchorY=-6.8), and eyelid caps provide the
// orange framing. Sockets + lid caps would create topological tunnels.

// ============================================================
// TAIL
// ============================================================
const tailRoot = sdf.capsule([5.5, 2.0, 5.0],  [8.5, 1.5, 3.5],  2.2);
const tailMid  = sdf.capsule([8.5, 1.5, 3.5],  [8.0, -2.0, 2.5], 1.9);
const tailBend = sdf.capsule([8.0, -2.0, 2.5], [5.5, -5.5, 2.0], 1.6);
const tailFront= sdf.capsule([5.5, -5.5, 2.0], [3.5, -7.0, 1.5], 1.4);
const tailTip  = sdf.capsule([3.5, -7.0, 1.5], [1.8, -7.8, 1.2], 1.2);
let tail = tailRoot
  .smoothUnion(tailMid,   1.6)
  .smoothUnion(tailBend,  1.4)
  .smoothUnion(tailFront, 1.3)
  .smoothUnion(tailTip,   1.2);
bodyMass = bodyMass.smoothUnion(tail, 1.8);

const bodyLabeled = bodyMass.label('body');

// ============================================================
// MUZZLE PAD
// ============================================================
const muzzlePad = sdf.ellipsoid(2.3, 0.50, 1.55)
  .translate(0, -8.55, 20.8)
  .label('muzzle');

// ============================================================
// INNER-EAR PADS
// ============================================================
const innerEarL = sdf.ellipsoid(2.0, 0.65, 2.9)
  .rotate(0, -15, 0).translate(-5.5, -1.6, 29.0).label('innerEar');
const innerEarR = sdf.ellipsoid(2.0, 0.65, 2.9)
  .rotate(0,  15, 0).translate( 5.5, -1.6, 29.0).label('innerEar');

// ============================================================
// EYES — hemisphere dome eyes (sphere clipped to front half)
// Eye sphere centred at eyeAnchorY=-6.8 (recessed 1 unit vs v10).
// The visible dome height = eyeR = 2.8 but the clip plane is at -6.8 (closer
// to the face surface), so the dome protrudes ≈ eyeR units from the clip plane.
// But since the eye is deeper in the head, the face geometry wraps more around
// the eye, making it look more set-in from 3/4 angles.
// ============================================================
const eyeSphereL = sdf.sphere(eyeR).translate(eyeAnchorLx, eyeAnchorY, eyeAnchorZ);
const eyeSphereR = sdf.sphere(eyeR).translate(eyeAnchorRx, eyeAnchorY, eyeAnchorZ);
const eyeClipL = eyeClipBox.translate(eyeAnchorLx, eyeAnchorY - halfBoxY, eyeAnchorZ);
const eyeClipR = eyeClipBox.translate(eyeAnchorRx, eyeAnchorY - halfBoxY, eyeAnchorZ);
const eyeballL = eyeSphereL.intersect(eyeClipL).label('eye');
const eyeballR = eyeSphereR.intersect(eyeClipR).label('eye');

// Iris: disc cap protruding from the dome front
const irisDiscR    = eyeR * 0.55;
const irisProtrude = eyeR * 0.12;
const irisBallRadius = (irisDiscR * irisDiscR + irisProtrude * irisProtrude) / (2 * irisProtrude);
const irisBallCY   = eyeFrontY + irisBallRadius - irisProtrude;

const irisBallL = sdf.sphere(irisBallRadius).translate(eyeAnchorLx, irisBallCY, eyeAnchorZ);
const irisBallR = sdf.sphere(irisBallRadius).translate(eyeAnchorRx, irisBallCY, eyeAnchorZ);
const irisClipL = sdf.cylinder(irisDiscR, irisBallRadius * 3.0)
  .rotate(90, 0, 0).translate(eyeAnchorLx, irisBallCY, eyeAnchorZ);
const irisClipR = sdf.cylinder(irisDiscR, irisBallRadius * 3.0)
  .rotate(90, 0, 0).translate(eyeAnchorRx, irisBallCY, eyeAnchorZ);
const irisCapL = irisBallL.intersect(irisClipL).label('iris');
const irisCapR = irisBallR.intersect(irisClipR).label('iris');

// Pupil cap
const irisCapFrontY      = eyeFrontY - irisProtrude;
const pupilDiscR         = eyeR * 0.33;
const pupilExtraProtrude = eyeR * 0.18;
const pupilBallRadius    = (pupilDiscR * pupilDiscR + pupilExtraProtrude * pupilExtraProtrude) / (2 * pupilExtraProtrude);
const pupilBallCY        = irisCapFrontY + pupilBallRadius - pupilExtraProtrude;

const pupilBallL  = sdf.sphere(pupilBallRadius).translate(eyeAnchorLx, pupilBallCY, eyeAnchorZ);
const pupilBallRn = sdf.sphere(pupilBallRadius).translate(eyeAnchorRx, pupilBallCY, eyeAnchorZ);
const pupilClipL  = sdf.cylinder(pupilDiscR, pupilBallRadius * 3.0)
  .rotate(90, 0, 0).translate(eyeAnchorLx, pupilBallCY, eyeAnchorZ);
const pupilClipR  = sdf.cylinder(pupilDiscR, pupilBallRadius * 3.0)
  .rotate(90, 0, 0).translate(eyeAnchorRx, pupilBallCY, eyeAnchorZ);
const pupilCapL = pupilBallL.intersect(pupilClipL).label('pupil');
const pupilCapR = pupilBallRn.intersect(pupilClipR).label('pupil');

// ============================================================
// NOSE
// ============================================================
const noseY = -9.28;
const noseZ = 21.80;
const noseTopBar = sdf.capsule([-0.90, noseY, noseZ + 0.30], [0.90, noseY, noseZ + 0.30], 0.46);
const noseSideL = sdf.capsule([-0.90, noseY, noseZ + 0.30], [0, noseY - 0.05, noseZ - 0.55], 0.24);
const noseSideR = sdf.capsule([ 0.90, noseY, noseZ + 0.30], [0, noseY - 0.05, noseZ - 0.55], 0.24);
const nosePoint  = sdf.sphere(0.26).translate(0, noseY - 0.05, noseZ - 0.55);
const noseFull = noseTopBar
  .smoothUnion(noseSideL, 0.22).smoothUnion(noseSideR, 0.22)
  .smoothUnion(nosePoint, 0.20).label('nose');

// ============================================================
// MOUTH
// ============================================================
const mouthY  = noseY - 0.06;
const mouthZ0 = noseZ - 0.55;
const mouthZ1 = mouthZ0 - 0.42;
const mouthZ2 = mouthZ0 - 0.95;
const philtrum = sdf.capsule([0, mouthY, mouthZ0], [0, mouthY, mouthZ1], 0.16);
const arcL = sdf.capsule([0, mouthY, mouthZ1], [-0.90, mouthY - 0.05, mouthZ2], 0.16);
const arcR = sdf.capsule([0, mouthY, mouthZ1], [ 0.90, mouthY - 0.05, mouthZ2], 0.16);
const curlL = sdf.capsule([-0.90, mouthY - 0.05, mouthZ2], [-1.10, mouthY - 0.04, mouthZ2 + 0.22], 0.15);
const curlR = sdf.capsule([ 0.90, mouthY - 0.05, mouthZ2], [ 1.10, mouthY - 0.04, mouthZ2 + 0.22], 0.15);
const mouth = philtrum
  .smoothUnion(arcL, 0.14).smoothUnion(arcR, 0.14)
  .smoothUnion(curlL, 0.12).smoothUnion(curlR, 0.12).label('mouth');

// ============================================================
// EYELIDS — fur-coloured sphere caps wrapping each eye dome.
//
// The eye sphere centre is now at eyeAnchorY=-6.8 (RECESSED into the head).
// At this deeper position, the head body at (±3.8, -6.8, 24.5±mzUpper) is
// INSIDE the head, so the lid cap's flat rim face merges cleanly with the body
// → genus stays at 1 (verified: no floating geometry at the lid margin).
//
// Lid sphere radius: 1.06 × eyeR = 2.968 (6% larger than eyeball).
// Upper cap: covers from z=mzUpper upward (UPPER_FRAC=0.30 of eye height).
// Lower cap: covers from z=mzLower downward (LOWER_FRAC=0.12 of eye height).
// Together they frame the eye opening (orange lids visible top and bottom).
// ============================================================
const LID_SCALE    = 1.06;
const LID_TILT_DEG = 18;
const UPPER_FRAC   = 0.30;
const LOWER_FRAC   = 0.12;

const lidR = eyeR * LID_SCALE;   // 2.968
const big  = lidR * 4;

function makeLidCap(dir, frac) {
  const mz = dir * (1 - 2 * frac) * eyeR;
  const halfSpace = sdf.box([big, big, big])
    .translate([0, 0, dir * big / 2])
    .rotate([dir * LID_TILT_DEG, 0, 0])
    .translate([0, 0, mz]);
  return sdf.sphere(lidR).intersect(halfSpace);
}

const lidsAtOrigin = sdf.union(
  makeLidCap( 1, UPPER_FRAC),
  makeLidCap(-1, LOWER_FRAC)
);

const lidsL = lidsAtOrigin.translate(eyeAnchorLx, eyeAnchorY, eyeAnchorZ).label('lids');
const lidsR = lidsAtOrigin.translate(eyeAnchorRx, eyeAnchorY, eyeAnchorZ).label('lids');

// ============================================================
// ASSEMBLE
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

// Lift 0.9 to guarantee z>=0 base
return cat.translate(0, 0, 0.9).build({
  edgeLength: 0.45,
  detail: [
    { center: [0, -1, 22],              radius: 15,  edgeLength: 0.20  },
    { center: [0, -8.7, 21.0],          radius: 5.0, edgeLength: 0.07  },
    { center: [eyeAnchorLx, eyeAnchorY, eyeAnchorZ], radius: 5.0, edgeLength: 0.05 },
    { center: [eyeAnchorRx, eyeAnchorY, eyeAnchorZ], radius: 5.0, edgeLength: 0.05 },
    { center: [-5.5, -2.0, 29.0],       radius: 5.0, edgeLength: 0.12  },
    { center: [ 5.5, -2.0, 29.0],       radius: 5.0, edgeLength: 0.12  },
  ]
});
