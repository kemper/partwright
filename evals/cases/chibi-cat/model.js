// Cat A — "Round Chibi" — large domed head, round compact body, curled tail to side
// Sitting pose, face points -Y, Z up. Head ~55% of silhouette mass.
// v10: flattened eye ellipsoids (no bulge from side), big nose triangle, cat mouth, tail forward
const { sdf } = api;

// ============================================================
// Eye geometry constants — LARGE, dominate the face
// Front-facing ellipsoid: large in x/z plane, shallow in y (forward) axis
// eyeR = nominal frontal radius; eyeDepth = forward half-extent (shallower = less bulge)
// ============================================================
const eyeR      = 2.8;   // sphere radius for the eye dome
const eyeAnchorLx = -3.8;
const eyeAnchorRx =  3.8;
const eyeAnchorY  = -7.8;  // eye center — sphere clipped to front hemisphere only
const eyeAnchorZ  = 24.5;
// The eyeball is a HEMISPHERE (front half of sphere only).
// Achieved via sphere.intersect(halfBox) where halfBox clips at y = eyeAnchorY.
// This means the eye has NO side or back surfaces — only the curved dome facing -Y.
// From the side, you see zero protrusion because the hemisphere edge sits flush.
const halfBoxY = 50;  // large clip box half-extent
const eyeClipBox = sdf.box([eyeR * 2 + 2, halfBoxY * 2, eyeR * 2 + 2]);
// Position clip box so its +Y face is at eyeAnchorY (center at eyeAnchorY - halfBoxY):
// sphere clipped to y <= eyeAnchorY → the front dome (-Y direction)
const eyeFrontY = eyeAnchorY - eyeR;   // foremost point of the dome

// ============================================================
// BODY MASSES
// ============================================================

const haunches = sdf.ellipsoid(7, 5.5, 4.2).translate(0, 0, 4.2);
const torso = sdf.ellipsoid(5.5, 4.5, 4.5).translate(0, -0.5, 8.5);
let bodyMass = haunches.smoothUnion(torso, 2.5);

// Flat stable base disc
const baseDisc = sdf.ellipsoid(7.5, 5.2, 2.5).translate(0, 0, 2.5);
bodyMass = bodyMass.smoothUnion(baseDisc, 2.2);

// Front paws — prominent, visible from front and underside
const pawFront = sdf.capsule([2.5, -4.2, 6.5], [2.7, -4.5, 1.0], 2.0).mirrorPair('x');
bodyMass = bodyMass.smoothUnion(pawFront, 1.8);

const neck = sdf.capsule([0, -1, 12.5], [0, -1, 14.5], 2.5);
bodyMass = bodyMass.smoothUnion(neck, 2.5);

// Head — large, round chibi
const head = sdf.ellipsoid(9.2, 7.5, 8.5).translate(0, -1, 22);
bodyMass = bodyMass.smoothUnion(head, 3.0);

// Cat ears: WIDE triangular, not rabbit-tall.
const earShaftL = sdf.ellipsoid(3.2, 0.9, 3.5).rotate(0, -15, 0).translate(-5.5, -1.0, 29.0);
const earShaftR = sdf.ellipsoid(3.2, 0.9, 3.5).rotate(0,  15, 0).translate( 5.5, -1.0, 29.0);
const earTipL = sdf.sphere(1.0).translate(-5.5, -1.0, 32.0);
const earTipR = sdf.sphere(1.0).translate( 5.5, -1.0, 32.0);
bodyMass = bodyMass
  .smoothUnion(earShaftL, 2.8)
  .smoothUnion(earShaftR, 2.8)
  .smoothUnion(earTipL, 1.5)
  .smoothUnion(earTipR, 1.5);

// Muzzle — subtle body bump so the labeled cream pad sits flush (not sunken).
const muzzleBodyBump = sdf.ellipsoid(2.0, 0.32, 1.4).translate(0, -8.25, 20.8);
bodyMass = bodyMass.smoothUnion(muzzleBodyBump, 0.45);

// Eye sockets: small indentation to give the eye dome a nice recess.
// Since the hemisphere has NO sides/back, the socket only needs to expose the rim.
// A shallow socket makes the eye look set into the face rather than floating on it.
const eyeSocketL = sdf.ellipsoid(3.1, 0.6, 3.1).translate(eyeAnchorLx, eyeAnchorY - 0.2, eyeAnchorZ);
const eyeSocketR = sdf.ellipsoid(3.1, 0.6, 3.1).translate(eyeAnchorRx, eyeAnchorY - 0.2, eyeAnchorZ);
bodyMass = bodyMass.smoothSubtract(eyeSocketL, 0.5).smoothSubtract(eyeSocketR, 0.5);

// ============================================================
// TAIL — curled forward so tip is visible from front 3/4
// Path: root on right side → sweeps behind → curls around to front-right
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
// MUZZLE PAD — separate labeled shape (cream), like eyes.
// Wider and taller than v9 to better support nose + mouth geometry.
// ============================================================
const muzzlePad = sdf.ellipsoid(2.3, 0.50, 1.55)
  .translate(0, -8.55, 20.8)
  .label('muzzle');

// ============================================================
// INNER-EAR PADS
// ============================================================
const innerEarL = sdf.ellipsoid(2.0, 0.65, 2.9)
  .rotate(0, -15, 0)
  .translate(-5.5, -1.6, 29.0)
  .label('innerEar');

const innerEarR = sdf.ellipsoid(2.0, 0.65, 2.9)
  .rotate(0,  15, 0)
  .translate( 5.5, -1.6, 29.0)
  .label('innerEar');

// ============================================================
// EYES — flattened ellipsoid eyeball (large frontal area, shallower depth)
// The eye is an ellipsoid: xR=eyeR, yR=eyeDepth, zR=eyeR
// Iris and pupil caps are placed at the front face of this ellipsoid.
// eyeFrontY = eyeAnchorY - eyeDepth  (front of the flattened eye)
// ============================================================

// Hemisphere dome eyes: sphere clipped to front half only.
// The clip box keeps y <= eyeAnchorY (the -Y / front half of each sphere).
// Because the back hemisphere is removed, from the side/rear you see ZERO eye protrusion.
const eyeSphereL = sdf.sphere(eyeR).translate(eyeAnchorLx, eyeAnchorY, eyeAnchorZ);
const eyeSphereR = sdf.sphere(eyeR).translate(eyeAnchorRx, eyeAnchorY, eyeAnchorZ);
const eyeClipL = eyeClipBox.translate(eyeAnchorLx, eyeAnchorY - halfBoxY, eyeAnchorZ);
const eyeClipR = eyeClipBox.translate(eyeAnchorRx, eyeAnchorY - halfBoxY, eyeAnchorZ);
const eyeballL = eyeSphereL.intersect(eyeClipL).label('eye');
const eyeballR = eyeSphereR.intersect(eyeClipR).label('eye');

// Iris: disc cap protruding from the dome front.
// eyeFrontY = eyeAnchorY - eyeR (the very tip of the dome).
// The iris cap lives at the front of the dome, same as before.
const irisDiscR    = eyeR * 0.55;
const irisProtrude = eyeR * 0.12;  // protrude from dome surface
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

// Pupil cap — enlarged: disc radius 0.33*eyeR, protrudes beyond iris
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
// NOSE — clear inverted-triangle cat nose on muzzle pad.
// Build as a rounded downward-pointing triangle using an SDF shape:
// Wide ellipsoid at top, tapered toward bottom, protruding clearly.
// We approximate the triangle with a capsule (wide top ball + narrow bottom point)
// smoothly blended, then label it.
// Position: center of muzzle pad, slightly above middle, proud of cream surface.
// ============================================================

// Triangle nose: inverted-triangle cat nose — wide top bar tapering to a rounded point.
// muzzle front face is at y ≈ -9.05; nose sits ~0.2 proud of that at y = -9.25.
const noseY = -9.28;   // clearly proud of muzzle front face (-9.05)
const noseZ = 21.80;   // slightly above muzzle pad center (21.65 was a bit low)

// Top bar of the triangle (horizontal, wide) — wider and taller than before
const noseTopBar = sdf.capsule([-0.90, noseY, noseZ + 0.30], [0.90, noseY, noseZ + 0.30], 0.46);
// Left and right side of triangle converging downward
const noseSideL = sdf.capsule([-0.90, noseY, noseZ + 0.30], [0, noseY - 0.05, noseZ - 0.55], 0.24);
const noseSideR = sdf.capsule([ 0.90, noseY, noseZ + 0.30], [0, noseY - 0.05, noseZ - 0.55], 0.24);
// Bottom point sphere
const nosePoint  = sdf.sphere(0.26).translate(0, noseY - 0.05, noseZ - 0.55);
// Blend tight for clear triangular read
const noseFull = noseTopBar
  .smoothUnion(noseSideL, 0.22)
  .smoothUnion(noseSideR, 0.22)
  .smoothUnion(nosePoint, 0.20)
  .label('nose');

// ============================================================
// MOUTH — classic cat "ω" / "3" shape below nose.
// Philtrum: short vertical line from nose down.
// Then two arcs sweeping outward and down.
// Built as proud relief capsules labeled 'mouth' (dark color).
// ============================================================
const mouthY  = noseY - 0.06;   // slightly more proud than nose
const mouthZ0 = noseZ - 0.55;   // bottom of nose point (updated to match new nose)
const mouthZ1 = mouthZ0 - 0.42; // bottom of philtrum
const mouthZ2 = mouthZ0 - 0.95; // bottom of arcs

// Philtrum — short vertical capsule center line
const philtrum = sdf.capsule([0, mouthY, mouthZ0], [0, mouthY, mouthZ1], 0.16);
// Left arc — sweeps out and down from philtrum base
const arcL = sdf.capsule([0,    mouthY, mouthZ1], [-0.90, mouthY - 0.05, mouthZ2], 0.16);
// Right arc — mirror
const arcR = sdf.capsule([0,    mouthY, mouthZ1], [ 0.90, mouthY - 0.05, mouthZ2], 0.16);
// Small upward curl at each arc end for the cat smile
const curlL = sdf.capsule([-0.90, mouthY - 0.05, mouthZ2], [-1.10, mouthY - 0.04, mouthZ2 + 0.22], 0.15);
const curlR = sdf.capsule([ 0.90, mouthY - 0.05, mouthZ2], [ 1.10, mouthY - 0.04, mouthZ2 + 0.22], 0.15);

const mouth = philtrum
  .smoothUnion(arcL, 0.14)
  .smoothUnion(arcR, 0.14)
  .smoothUnion(curlL, 0.12)
  .smoothUnion(curlR, 0.12)
  .label('mouth');

// ============================================================
// ASSEMBLE
// ============================================================
const cat = sdf.union(
  bodyLabeled,
  muzzlePad,
  eyeballL, eyeballR,
  irisCapL, irisCapR,
  pupilCapL, pupilCapR,
  noseFull,
  mouth,
  innerEarL, innerEarR
);

// Lift 0.9 to guarantee z≥0 base
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
