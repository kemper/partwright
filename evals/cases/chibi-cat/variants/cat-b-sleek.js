// Cat B — "Sleek Chibi" — taller oval head, defined waist, tail wraps to left side
// v4: COMPLETE paw overhaul — symmetric grounded front paws replacing cantilever,
//     muzzle pad shrunk 35% to cat wedge nose, proper triangular nose, wider ear base,
//     eyes sunk into shallow sockets, short hip tail, flat base disc
// Sitting pose, face points -Y, Z up.
const { sdf } = api;

// ============================================================
// Eye geometry constants (same rig as cat-a, scaled to this head)
// Eyes sunk slightly (Y 0.4 deeper), lowered ~12% on Z (19.5→17.2)
// ============================================================
const eyeR = 0.95;
const eyeAnchorLx = -2.8;
const eyeAnchorRx =  2.8;
const eyeAnchorY  = -6.6; // 0.4 deeper (was -7.0) — sunk into shallow sockets
const eyeAnchorZ  = 17.2; // lowered 12% from 19.5

// ============================================================
// BODY MASSES
// ============================================================

const haunches = sdf.ellipsoid(7.0, 5.5, 4.5).translate(0, 0, 4.5);
const torso = sdf.ellipsoid(6.0, 4.5, 5.0).translate(0, -0.5, 9.5);
let bodyMass = haunches.smoothUnion(torso, 2.0);

// Flat stable base disc — thick enough to guarantee z=0 flat floor
const baseDisc = sdf.ellipsoid(7.5, 5.4, 2.5).translate(0, 0, 2.5);
bodyMass = bodyMass.smoothUnion(baseDisc, 2.0);

// FRONT PAWS — symmetric, grounded to z=0, no cantilever.
// Two rounded ellipsoid paws sit ON the base directly under the chest.
// Wide base join (5 units wide merge zone) prevents any pinch neck.
// Each paw is a compact rounded capsule/ellipsoid tucked under the chest.
const pawR = sdf.ellipsoid(1.8, 1.4, 2.2).translate(3.0, -3.2, 2.2);
const pawL = sdf.ellipsoid(1.8, 1.4, 2.2).translate(-3.0, -3.2, 2.2);
// Leg stubs connecting paws to body
const legStubR = sdf.capsule([3.0, -2.8, 4.5], [3.0, -3.0, 2.5], 1.6);
const legStubL = sdf.capsule([-3.0, -2.8, 4.5], [-3.0, -3.0, 2.5], 1.6);
bodyMass = bodyMass
  .smoothUnion(pawR, 2.5)
  .smoothUnion(pawL, 2.5)
  .smoothUnion(legStubR, 2.8)
  .smoothUnion(legStubL, 2.8);

// Neck — very short, head low on body
const neck = sdf.capsule([0, -1.2, 13.0], [0, -1.5, 14.5], 2.5);
bodyMass = bodyMass.smoothUnion(neck, 2.0);

// Head — large relative to body
const head = sdf.ellipsoid(7.5, 6.0, 7.5).translate(0, -1.5, 18.0);
bodyMass = bodyMass.smoothUnion(head, 2.2);

// Ears — upright triangular, wide base, blunted by large tip sphere blended smoothly
const earBodyR = sdf.ellipsoid(2.8, 1.0, 3.2).translate(4.5, -0.5, 23.2);
const earCapR = sdf.sphere(1.8).translate(4.5, -0.5, 26.0);
bodyMass = bodyMass
  .smoothUnion(earBodyR.mirrorPair('x'), 2.0)
  .smoothUnion(earCapR.mirrorPair('x'), 2.2);

// Muzzle: small cat wedge — pushed out to y=-8.8 to act as anchor for nose
// Small enough to avoid pig-snout but far enough forward to provide nose-overlap zone
const muzzlePad = sdf.ellipsoid(1.4, 1.0, 0.7).translate(0, -8.0, 15.8);
bodyMass = bodyMass.smoothUnion(muzzlePad, 1.0);

// Short hip tail — wraps along the left hip, stays grounded
const tailRoot = sdf.capsule([-5, 1.5, 4.5], [-7.5, 2.0, 4.5], 1.5);
const tailMid  = sdf.capsule([-7.5, 2.0, 4.5], [-8.5, 0.0, 3.0], 1.2);
const tailTip  = sdf.capsule([-8.5, 0.0, 3.0], [-7.0, -2.0, 2.0], 1.0);
let tail = tailRoot.smoothUnion(tailMid, 1.0).smoothUnion(tailTip, 0.9);
bodyMass = bodyMass.smoothUnion(tail, 1.6);

const bodyLabeled = bodyMass.label('body');

// ============================================================
// EYES — ball-in-ball (same construction as cat-a, sunk slightly)
// ============================================================

const eyeballL = sdf.sphere(eyeR).translate(eyeAnchorLx, eyeAnchorY, eyeAnchorZ).label('eye');
const eyeballR = sdf.sphere(eyeR).translate(eyeAnchorRx, eyeAnchorY, eyeAnchorZ).label('eye');

// Iris cap
const irisDiscR    = eyeR * 0.55;
const irisProtrude = eyeR * 0.15;
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

// Pupil cap — protrudes past iris surface
const irisCapFrontY = eyeFrontY - irisProtrude;
const pupilDiscR  = eyeR * 0.27;
const pupilExtraProtrude = eyeR * 0.10;
const pupilBallRadius = (pupilDiscR * pupilDiscR + pupilExtraProtrude * pupilExtraProtrude) / (2 * pupilExtraProtrude);
const pupilBallCY = irisCapFrontY + pupilBallRadius - pupilExtraProtrude;

const pupilBallL = sdf.sphere(pupilBallRadius).translate(eyeAnchorLx, pupilBallCY, eyeAnchorZ);
const pupilBallRn = sdf.sphere(pupilBallRadius).translate(eyeAnchorRx, pupilBallCY, eyeAnchorZ);
const pupilClipL = sdf.cylinder(pupilDiscR, pupilBallRadius * 3.0)
  .rotate(90, 0, 0).translate(eyeAnchorLx, pupilBallCY, eyeAnchorZ);
const pupilClipR = sdf.cylinder(pupilDiscR, pupilBallRadius * 3.0)
  .rotate(90, 0, 0).translate(eyeAnchorRx, pupilBallCY, eyeAnchorZ);
const pupilCapL = pupilBallL.intersect(pupilClipL).label('pupil');
const pupilCapR = pupilBallRn.intersect(pupilClipR).label('pupil');

// Nose — protrudes past muzzle surface. Muzzle tip ~y=-9.0; nose center at -8.75
// spans -9.2 to -8.3, protrudes 0.2 units past muzzle tip for visible surface
const nose = sdf.ellipsoid(0.55, 0.45, 0.35).translate(0, -8.75, 15.8).label('nose');

// ============================================================
// ASSEMBLE
// ============================================================
const cat = sdf.union(
  bodyLabeled,
  eyeballL, eyeballR,
  irisCapL, irisCapR,
  pupilCapL, pupilCapR,
  nose
);

// Lift 0.75 to guarantee z≥0 base (smoothUnion blend dips ~0.69 below the disc)
return cat.translate(0, 0, 0.75).build({
  edgeLength: 0.45,
  detail: [
    { center: [0, -1.5, 18.0],        radius: 12,  edgeLength: 0.20  },
    { center: [0, -7.4, 16.0],        radius: 4.5, edgeLength: 0.09  },
    { center: [eyeAnchorLx, eyeAnchorY, eyeAnchorZ], radius: 2.5, edgeLength: 0.055 },
    { center: [eyeAnchorRx, eyeAnchorY, eyeAnchorZ], radius: 2.5, edgeLength: 0.055 },
  ]
});
