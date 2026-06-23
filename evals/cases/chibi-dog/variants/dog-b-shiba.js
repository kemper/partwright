// Dog B — "Shiba/Corgi Perky Ears" — alert triangular ears, wide chubby face, upright tail
// Sitting pose, face points -Y, Z up. Very round and chunky — corgi/shiba feel.
// v4: ear tip capped (blunted, ~15% shorter), curled shiba tail added, eyes 1.2×+raised,
//     Z squashed ~10%, flat base disc, nose pulled in from −12.5 to −11.5
const { sdf } = api;

// ============================================================
// Z-squash factor: compress body Z 10% for roly-poly silhouette
// Applied by scaling Z coords × 0.90 on all body masses
// ============================================================
const ZS = 0.90; // squash factor

// ============================================================
// Eye geometry constants
// eyeR scaled up 20% (1.15→1.38), raised 0.5 unit (×ZS applied to Z pos)
// ============================================================
const eyeR = 1.38;
const eyeAnchorLx = -3.4;
const eyeAnchorRx =  3.4;
const eyeAnchorY  = -9.8;
const eyeAnchorZ  = 25.0 * ZS; // raised slightly after squash

// ============================================================
// BODY MASSES — keep the round barrel body (its strength)
// Z coords multiplied by ZS for the squash
// ============================================================

const haunches = sdf.ellipsoid(9.5, 6.5, 5.5 * ZS).translate(0, 0, 5.5 * ZS);
const torso    = sdf.ellipsoid(9.5, 6.5, 6.5 * ZS).translate(0, -0.5, 11.5 * ZS);
let bodyMass = haunches.smoothUnion(torso, 5.5);

// Flat stable base disc — thick enough to guarantee z=0 flat floor
const baseDisc = sdf.ellipsoid(9.5, 6.2, 2.5).translate(0, 0, 2.5);
bodyMass = bodyMass.smoothUnion(baseDisc, 2.0);

// Front legs/paws — very stubby
const pawFront = sdf.capsule([4.5, -3.0, 8.5 * ZS], [4.5, -3.0, 1.5], 2.0).mirrorPair('x');
bodyMass = bodyMass.smoothUnion(pawFront, 2.5);

// Wide pad from torso to head
const barrelTop = sdf.ellipsoid(8.0, 5.5, 3.5 * ZS).translate(0, -1.5, 16.0 * ZS);
bodyMass = bodyMass.smoothUnion(barrelTop, 5.0);

// Head — VERY wide and round, set LOW (squashed Z)
const head = sdf.ellipsoid(10.0, 8.0, 8.5 * ZS).translate(0, -2.0, 22.0 * ZS);
bodyMass = bodyMass.smoothUnion(head, 4.0);

// Shiba snout
const snout = sdf.ellipsoid(4.5, 2.2, 3.2 * ZS).translate(0, -10.5, 21.0 * ZS);
bodyMass = bodyMass.smoothUnion(snout, 2.5);

// Chubby cheeks
const cheekR = sdf.sphere(4.0).translate(7.0, -6.5, 21.0 * ZS);
bodyMass = bodyMass.smoothUnion(cheekR.mirrorPair('x'), 2.8);

// Ears: triangular, Z-radius 4.0 (shorter), X=2.5, moderate cap sphere (r=1.6, k=2.8)
// keeps triangular silhouette but blunts the needle tip to printable thickness
const earBodyR = sdf.ellipsoid(2.5, 1.1, 4.0).translate(7.0, -1.5, 29.5 * ZS);
const earCapR = sdf.sphere(1.6).translate(7.0, -1.5, 33.0 * ZS);
bodyMass = bodyMass
  .smoothUnion(earBodyR.mirrorPair('x'), 2.0)
  .smoothUnion(earCapR.mirrorPair('x'), 2.8);

// Shiba curled tail — must protrude OUTSIDE the body to be visible
// Body rear surface is at Y≈+7.0 at Z≈11 (ZS-scaled). Tail starts well behind body.
// Uses a tight curl that loops up over the rump and lands back (classic shiba)
// ZS applied only to Z start since tail arcs above body Z range
const tailBase = sdf.capsule([1.0, 8.5, 10.0], [3.0, 9.0, 14.0], 2.3);
const tailMid  = sdf.capsule([3.0, 9.0, 14.0], [2.0, 7.5, 18.5], 2.1);
const tailTip  = sdf.capsule([2.0, 7.5, 18.5], [0.5, 6.5, 17.0], 2.0);
let tail = tailBase.smoothUnion(tailMid, 1.8).smoothUnion(tailTip, 1.6);
bodyMass = bodyMass.smoothUnion(tail, 2.5);

const bodyLabeled = bodyMass.label('body');

// ============================================================
// EYES — ball-in-ball rig (eyeR = 1.38, raised out of face 0.5 unit)
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

// Wide dog nose — centered at snout tip with 1.5-unit embed overlap
// Snout tip at ~y=-12.7; nose center at -12.0 so sphere extends -13.1 to -10.9 straddling snout surface
const nose = sdf.ellipsoid(1.8, 1.1, 1.3).translate(0, -12.0, 21.0 * ZS).label('nose');

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

// Lift 0.9 to guarantee z≥0 base (smoothUnion blend dips ~0.84 below the disc)
return dog.translate(0, 0, 0.9).build({
  edgeLength: 0.45,
  detail: [
    { center: [0, -2.0, 22.0 * ZS],   radius: 14,  edgeLength: 0.20  },
    { center: [0, -10.5, 21.0 * ZS],  radius: 5.5, edgeLength: 0.09  },
    { center: [eyeAnchorLx, eyeAnchorY, eyeAnchorZ], radius: 2.8, edgeLength: 0.055 },
    { center: [eyeAnchorRx, eyeAnchorY, eyeAnchorZ], radius: 2.8, edgeLength: 0.055 },
  ]
});
