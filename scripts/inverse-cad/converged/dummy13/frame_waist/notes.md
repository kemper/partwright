# frame_waist — session notes

## Verdict: CONVERGED (attempt 1, one authored turn)

score 0.0116 | 6/6 MUST, 2/2 SHOULD | chamfer 0.0009 | hausdorff max 0.0893 |
IoU 0.9991 | volume ratio 0.9992. Optimizer never needed — every number came
from probes and landed exact.

## Converged structure (all probed)

- **Body**: disc r=4.500 about the socket center (origin) + shoulder block
  |x|<=2.5 up to y=7.0 with 0.5 plan corner chamfers to (+-2, 7). The arc/wall
  junction at (+-2.5, 3.7417) is just circle-meets-halfplane, not a feature.
- **Uniform 0.5 x 45deg chamfer, top AND bottom faces, on the ENTIRE plan
  outline** (arc -> 4.05, walls -> 2.05, top face -> 6.55 at z=+-2.45; wedge
  walls offset ~0.45+). Built as cylinder+frustums for the arc, hull-of-pinned-
  slabs for the shoulder block, and offset(+0.5,'Round')-dilated hulled flares
  for the cuts.
- **Mouth wedge**: {y <= -0.66818|x|} — both walls pass exactly through the
  socket center at all z (par. 5.12, slope identical at z=-1.875/-1.0/+1.125;
  0.66818 = tan 33.75deg). NO flat front face: between each wedge wall and the
  arc sits a corner-chamfer line y = +-0.228x - 2.9806 through (+-3.3259,
  -2.2223) (= bbox ymin corner).
- **Socket**: hourglass (par. 5.19d) — sphere r=2.852 @ (0,0,0) + lead-in
  cones on BOTH z faces, r(z) = 1.4888 + 0.3515|z| (19.4deg), sphere/cone
  transition at |z|=1.873, face opening r=2.3675. NOTE: this socket sphere is
  r=2.852, NOT the kit-usual 2.90 (ray-verified axisymmetric at 4 azimuths;
  r^2 = x^2+z^2 constant to 4 decimals over |z|<=1.8).
- **Side tabs** (the mid-height bumps at x=+-3.65, y<=3.40): Y-prisms,
  profile in (x,z) = circle r=0.5986 @ (+-3.0529, 0) plus its 45deg tangent
  lines x+|z| = 3.899 running inboard; flat end face y=3.40; buried in the
  disc below y~2.6. Invisible at |z|>=0.8 which is why band traces missed them.
- **Neck**: D-cylinder r=1.5 along Y at z=0, chordal flat at z=-1.30 (bottom),
  y=7 into the ball. Same -1.3 flat as the hips strut spec.
- **Ball**: r=3.000 @ (0,11,0) (kit-exact), clipped print-flat at z=-2.5.

## Strategies tried

1. deterministic bootstrap slice-stack (attempt 0): 1/6 MUST — staircased
   bands, cavity carried as prism (par. 5.4 signature).
2. full primitive rebuild from probes (attempt 1): converged.

## What I'd try next

Nothing — done. If ever re-opened: params are already declared
(socketR/coneR0/coneSlope/tabA/tabR/ballR/neckFlat) for optimize.mjs.

## Tactics/traps discovered (appended candidates for PLAYBOOK)

- Mid-height side bosses hide from band traces AND near-face sections: scan
  x(z) by rays at a suspect y; a profile that is exactly "circle then 45deg
  line" is a tangent-blended ridge — model as circle+tangent-quad Y-prism.
- The apparent flat "front face" at bbox ymin was really just the corner
  vertex of two cut lines; ray-scan the face before authoring a halfplane.
