// Dog A — "Floppy Ears Chibi" — cocker spaniel feel: long drooping ears, snout, gentle look
// Sitting pose, face points -Y, Z up.
// v4: ear Y-radius 0.8→1.5 (printable), eyeR 1.05→1.35 + spacing ±2.9, nose Y −12.5→−11.5,
//     tail X 2.0→3.5 (visible 3/4), neck radius 2.8→3.1, flat base disc (print-safe)
const { sdf } = api;

// ============================================================
// Eye geometry constants
// eyeR enlarged for soulful-puppy look
// ============================================================
const eyeR = 1.35;
const eyeAnchorLx = -2.9;
const eyeAnchorRx =  2.9;
const eyeAnchorY  = -9.0; // pushed back into head for overlap
const eyeAnchorZ  = 25.5;

// ============================================================
// BODY MASSES
// ============================================================

const haunches = sdf.ellipsoid(8.5, 6.0, 4.5).translate(0, 0, 4.5);
const torso = sdf.ellipsoid(7.0, 5.5, 5.5).translate(0, -0.5, 10.0);
let bodyMass = haunches.smoothUnion(torso, 2.2);

// Flat stable base disc — thick enough to guarantee z=0 flat floor
const baseDisc = sdf.ellipsoid(8.5, 5.8, 2.5).translate(0, 0, 2.5);
bodyMass = bodyMass.smoothUnion(baseDisc, 2.0);

// Front legs — forward-placed sitting pose
const pawFront = sdf.capsule([4.0, -3.0, 8.5], [4.0, -3.5, 1.5], 2.0).mirrorPair('x');
bodyMass = bodyMass.smoothUnion(pawFront, 2.2);

// Neck — softened cinch (radius 2.8→3.1)
const neck = sdf.capsule([0, -1, 14.5], [0, -1.5, 16.5], 3.1);
bodyMass = bodyMass.smoothUnion(neck, 2.0);

// Head — big round chibi head
const head = sdf.ellipsoid(8.0, 7.0, 7.5).translate(0, -1.5, 23.0);
bodyMass = bodyMass.smoothUnion(head, 2.2);

// Floppy ears: Y-radius 0.8→1.5 for printable thickness
const flopEarR = sdf.ellipsoid(2.0, 1.5, 6.5).translate(8.5, -0.5, 21.0);
const flopEarL = sdf.ellipsoid(2.0, 1.5, 6.5).translate(-8.5, -0.5, 21.0);
bodyMass = bodyMass.smoothUnion(flopEarR, 1.8).smoothUnion(flopEarL, 1.8);

// Spaniel snout
const muzzlePad = sdf.ellipsoid(2.5, 1.4, 1.2).translate(0, -10.0, 21.5);
bodyMass = bodyMass.smoothUnion(muzzlePad, 1.8);

const snout = sdf.ellipsoid(4.5, 2.8, 3.2).translate(0, -10.0, 22.0);
bodyMass = bodyMass.smoothUnion(snout, 2.2);

// Stubby happy tail: X shifted 2.0→3.5 so it peeks into 3/4 view
const tailBase = sdf.capsule([0, 5.5, 11.0], [3.5, 7.0, 15.5], 1.8);
const tailTip  = sdf.capsule([3.5, 7.0, 15.5], [3.0, 7.5, 16.8], 2.0);
let tail = tailBase.smoothUnion(tailTip, 1.5);
bodyMass = bodyMass.smoothUnion(tail, 2.0);

const bodyLabeled = bodyMass.label('body');

// ============================================================
// EYES — ball-in-ball (eyeR = 1.35)
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

// Pupil cap — protrudes past iris
const irisCapFrontY  = eyeFrontY - irisProtrude;
const pupilDiscR     = eyeR * 0.27;
const pupilExtraProtrude = eyeR * 0.10;
const pupilBallRadius = (pupilDiscR * pupilDiscR + pupilExtraProtrude * pupilExtraProtrude) / (2 * pupilExtraProtrude);
const pupilBallCY    = irisCapFrontY + pupilBallRadius - pupilExtraProtrude;

const pupilBallL  = sdf.sphere(pupilBallRadius).translate(eyeAnchorLx, pupilBallCY, eyeAnchorZ);
const pupilBallRn = sdf.sphere(pupilBallRadius).translate(eyeAnchorRx, pupilBallCY, eyeAnchorZ);
const pupilClipL  = sdf.cylinder(pupilDiscR, pupilBallRadius * 3.0)
  .rotate(90, 0, 0).translate(eyeAnchorLx, pupilBallCY, eyeAnchorZ);
const pupilClipR  = sdf.cylinder(pupilDiscR, pupilBallRadius * 3.0)
  .rotate(90, 0, 0).translate(eyeAnchorRx, pupilBallCY, eyeAnchorZ);
const pupilCapL = pupilBallL.intersect(pupilClipL).label('pupil');
const pupilCapR = pupilBallRn.intersect(pupilClipR).label('pupil');

// Nose — protrudes 0.7 units PAST snout tip so the label surface is exposed
// Snout tip at ~y=-12.8. Nose center at -12.1 (Y-radius 1.0 → nose tip at -13.1, overlap at -12.8)
// Nose must be smoothUnioned into body FIRST so it's part of bodyMass, THEN labeled in final union
const nose = sdf.ellipsoid(1.5, 1.0, 1.1).translate(0, -12.1, 21.8).label('nose');

// ============================================================
// ASSEMBLE
// ============================================================
const dog = sdf.union(
  bodyLabeled,
  eyeballL, eyeballR,
  irisCapL, irisCapR,
  pupilCapL, pupilCapR,
  nose
);

// Lift 0.75 to guarantee z≥0 base (smoothUnion blend dips ~0.7 below the disc)
return dog.translate(0, 0, 0.75).build({
  edgeLength: 0.45,
  detail: [
    { center: [0, -1.5, 23.0],        radius: 13,  edgeLength: 0.20  },
    { center: [0, -10.0, 22.0],       radius: 5.0, edgeLength: 0.09  },
    { center: [eyeAnchorLx, eyeAnchorY, eyeAnchorZ], radius: 2.5, edgeLength: 0.055 },
    { center: [eyeAnchorRx, eyeAnchorY, eyeAnchorZ], radius: 2.5, edgeLength: 0.055 },
  ]
});
