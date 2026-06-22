// Cat A — "Round Chibi" — large domed head, round compact body, curled tail to side
// Sitting pose, face points -Y, Z up. Head ~55% of silhouette mass.
// v8: HUGE eyes (eyeR=2.8), wide triangular cat ears, innerEar as proud pad,
//     prominent curled tail, front paws visible, all hard gates pass.
const { sdf } = api;

// ============================================================
// Eye geometry constants — LARGE, dominate the face
// ============================================================
const eyeR = 2.8;
const eyeAnchorLx = -3.8;
const eyeAnchorRx =  3.8;
const eyeAnchorY  = -7.8;
const eyeAnchorZ  = 24.5;

// ============================================================
// BODY MASSES
// ============================================================

const haunches = sdf.ellipsoid(7, 5.5, 4.2).translate(0, 0, 4.2);
const torso = sdf.ellipsoid(5.5, 4.5, 4.5).translate(0, -0.5, 8.5);
let bodyMass = haunches.smoothUnion(torso, 1.8);

// Flat stable base disc
const baseDisc = sdf.ellipsoid(7.5, 5.2, 2.5).translate(0, 0, 2.5);
bodyMass = bodyMass.smoothUnion(baseDisc, 2.0);

// Front paws — prominent, visible from front and underside
const pawFront = sdf.capsule([2.5, -4.2, 6.5], [2.7, -4.5, 1.0], 2.0).mirrorPair('x');
bodyMass = bodyMass.smoothUnion(pawFront, 1.8);

const neck = sdf.capsule([0, -1, 12.5], [0, -1, 14.5], 2.5);
bodyMass = bodyMass.smoothUnion(neck, 1.5);

// Head — large, round chibi
const head = sdf.ellipsoid(9.2, 7.5, 8.5).translate(0, -1, 22);
bodyMass = bodyMass.smoothUnion(head, 2.2);

// Cat ears: WIDE triangular, not rabbit-tall.
// xR=3.2 (wide base), yR=0.9 (thin depth), zR=3.5 (height)
// Angled 15° outward. Center at x=±5.5, z=29 (midway between head top and tip)
const earShaftL = sdf.ellipsoid(3.2, 0.9, 3.5).rotate(0, -15, 0).translate(-5.5, -1.0, 29.0);
const earShaftR = sdf.ellipsoid(3.2, 0.9, 3.5).rotate(0,  15, 0).translate( 5.5, -1.0, 29.0);
// Blunt tip
const earTipL = sdf.sphere(1.0).translate(-5.5, -1.0, 32.0);
const earTipR = sdf.sphere(1.0).translate( 5.5, -1.0, 32.0);
bodyMass = bodyMass
  .smoothUnion(earShaftL, 2.0)
  .smoothUnion(earShaftR, 2.0)
  .smoothUnion(earTipL, 1.5)
  .smoothUnion(earTipR, 1.5);

// Muzzle — small flat oval pad, barely protrudes
const muzzle = sdf.ellipsoid(1.4, 0.7, 1.0).translate(0, -8.2, 20.8);
bodyMass = bodyMass.smoothUnion(muzzle, 0.7);

// Tail: large S-curl to the right — tip curls away from body (NOT back to body)
// to avoid creating a topological loop (genus > 0).
// Tip ends at y=-8.0 (further out, not close enough to body to bridge).
const tailRoot = sdf.capsule([5.5, 2.0, 5.0], [9.5, 0.5, 3.0], 1.8);
const tailMid  = sdf.capsule([9.5, 0.5, 3.0], [9.0, -5.5, 2.5], 1.5);
const tailTip  = sdf.capsule([9.0, -5.5, 2.5], [7.0, -8.0, 3.5], 1.2);
let tail = tailRoot.smoothUnion(tailMid, 1.4).smoothUnion(tailTip, 1.2);
bodyMass = bodyMass.smoothUnion(tail, 1.8);

const bodyLabeled = bodyMass.label('body');

// ============================================================
// INNER-EAR PADS — proud oval pads on the FRONT (-Y) face of each ear.
// Strategy: position a small shallow ellipsoid PROUD of the ear surface
// (more negative Y than the ear front face) so it wins the label race.
// The ear front surface (facing viewer at az=270) is at roughly y≈-1.9 at ear center.
// We place a thin ellipsoid at y=-2.0, slightly more proud (more -Y).
// No box intersection — just a flat ellipsoid slightly in front of the ear.
// xR=1.5, yR=0.4, zR=2.5 → a tall oval pad.
// ============================================================
// Inner-ear pad: a rounded oval pad (thick yR to avoid coin-bridge topology that creates genus>0)
// Positioned so front protrudes ~0.35 units proud of ear front face (→ visible surface label)
// and back is ~0.5 inside the ear solid (→ no bridging gap → genus stays 0).
// Ear center at (-5.5, -1.0, 29.0), ear yR≈0.9 → ear front at y≈-1.9.
// Pad center at y=-1.6, yR=0.65 → front at y=-2.25 (proud), back at y=-0.95 (inside ear).
const innerEarL = sdf.ellipsoid(1.3, 0.65, 2.4)
  .rotate(0, -15, 0)
  .translate(-5.5, -1.6, 29.0)
  .label('innerEar');

const innerEarR = sdf.ellipsoid(1.3, 0.65, 2.4)
  .rotate(0,  15, 0)
  .translate( 5.5, -1.6, 29.0)
  .label('innerEar');

// ============================================================
// EYES — ball-in-ball construction (eyeR = 2.8, HUGE proud domes)
// ============================================================

const eyeballL = sdf.sphere(eyeR).translate(eyeAnchorLx, eyeAnchorY, eyeAnchorZ).label('eye');
const eyeballR = sdf.sphere(eyeR).translate(eyeAnchorRx, eyeAnchorY, eyeAnchorZ).label('eye');

// Iris: disc radius 0.55*eyeR, protrudes 0.12*eyeR from eyeball front
const irisDiscR    = eyeR * 0.55;
const irisProtrude = eyeR * 0.12;
const irisBallRadius = (irisDiscR * irisDiscR + irisProtrude * irisProtrude) / (2 * irisProtrude);
const eyeFrontY    = eyeAnchorY - eyeR;
const irisBallCY   = eyeFrontY + irisBallRadius - irisProtrude;

const irisBallL = sdf.sphere(irisBallRadius).translate(eyeAnchorLx, irisBallCY, eyeAnchorZ);
const irisBallR = sdf.sphere(irisBallRadius).translate(eyeAnchorRx, irisBallCY, eyeAnchorZ);
const irisClipL = sdf.cylinder(irisDiscR, irisBallRadius * 3.0)
  .rotate(90, 0, 0).translate(eyeAnchorLx, irisBallCY, eyeAnchorZ);
const irisClipR = sdf.cylinder(irisDiscR, irisBallRadius * 3.0)
  .rotate(90, 0, 0).translate(eyeAnchorRx, irisBallCY, eyeAnchorZ);
const irisCapL = irisBallL.intersect(irisClipL).label('iris');
const irisCapR = irisBallR.intersect(irisClipR).label('iris');

// Pupil cap on top of iris
const irisCapFrontY      = eyeFrontY - irisProtrude;
const pupilDiscR         = eyeR * 0.27;
const pupilExtraProtrude = eyeR * 0.14;
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

// Nose — tiny sphere at center-top of muzzle
const nose = sdf.sphere(0.48).translate(0, -8.75, 21.4).label('nose');

// ============================================================
// ASSEMBLE — innerEar as proud standalone labeled ellipsoids
// ============================================================
const cat = sdf.union(
  bodyLabeled,
  eyeballL, eyeballR,
  irisCapL, irisCapR,
  pupilCapL, pupilCapR,
  nose,
  innerEarL, innerEarR
);

// Lift 0.9 to guarantee z≥0 base
return cat.translate(0, 0, 0.9).build({
  edgeLength: 0.45,
  detail: [
    { center: [0, -1, 22],              radius: 15,  edgeLength: 0.20  },
    { center: [0, -8.2, 21.0],          radius: 4.0, edgeLength: 0.09  },
    { center: [eyeAnchorLx, eyeAnchorY, eyeAnchorZ], radius: 5.0, edgeLength: 0.05 },
    { center: [eyeAnchorRx, eyeAnchorY, eyeAnchorZ], radius: 5.0, edgeLength: 0.05 },
    { center: [-5.5, -2.0, 29.0],       radius: 5.0, edgeLength: 0.12  },
    { center: [ 5.5, -2.0, 29.0],       radius: 5.0, edgeLength: 0.12  },
  ]
});
