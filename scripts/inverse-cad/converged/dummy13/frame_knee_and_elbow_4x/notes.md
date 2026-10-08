# frame_knee_and_elbow_4x — session notes

## Verdict: CONVERGED (attempt 4, phase done)

6/6 MUST + 2/2 SHOULD. score 0.0396 | chamfer 0.0034 | hausdorff max 0.046 |
IoU 0.9964 | volume ratio 0.9962 | area ratio 0.9981. 4 attempts total
(bootstrap + 3 turns this session).

## What the part is

A double-C bridge (two socket rings at (0,0) and (6,0), mirror plane x=3)
with a top-center eye lobe (circle r=1.5 @ (3,3.6)) carrying the genus-1
keyhole, a 90° V-notch at bottom center (apex (3,−3)), and per-socket
hourglass cavities. All measured, not guessed:

- Cavity (revolve about Z at each center): counterbore r=2.4 depth 0.4 both
  faces, exact 45° cones (r = 2.8−z and r = z), cylindrical waist r=1.5407
  for z∈[1.259, 1.541]. Ray-cast r(z) from the socket center.
- Mouth wedge: 110° opening whose edge lines pass exactly through the
  socket center (40°→150° socket 1; mirrored 30°→140° socket 2). Corner at
  r=2.4 = counterbore radius. The left channel wall segment ALSO passes
  through the center (137.5° ray, r 2.9→4.0) — tactic 5.12 held three times.
- Outer boundary: r=4.5 arcs about each socket center; ear end-face is a
  nearly-straight tilted line (slope ≈ −0.084) from the 137.5° wall end
  (r=4.0) to the arc at ~144.5°; chord from (2.4@150°) to (2.9@137.5°).
- Edge chamfers: 45°, leg 0.5, top AND bottom faces, ONLY on the outer
  perimeter (r=4.5 arcs, y=−4.5 straights, V-notch lines). NOT chamfered:
  eye lobe, channel walls, ear end-faces, mouth wedges, counterbore rims.
  V-notch corner is a sharp MITER (verified: inset-lines intersection at
  (3,−2.3636) @ z=0.05), so the V cut = convex hull of dilated notch
  triangle @ z=0 and exact notch triangle @ z=0.5 — NOT per-edge wedge
  subtraction (that over-cuts interior material past the apex).

## Construction (best/candidate.js)

traced z=1.4 base outline + exact eye-lobe circle + pac-man fills (disk
r=2.0 minus mouth-wedge sector) extruded 0→2.8, minus per-socket cavity
revolve, minus chamfer cuts (masked cone-rings on the arcs [137°,270°] /
[−90°,43°], straight (y,z) wedge along y=−4.5, hull-miter wedge on the V).

## The trap that cost 2 turns: float32 revolve cap membrane

Attempts 2–3 stalled at hausdorff P99 1.54 / max 1.98 with excess VOLUME
≈ 0 and zero findings. Cause: revolve() output rounds to float32 — the
cavity top landed at z=2.7999999970 vs the extrude's 2.8, leaving a
nanometer-thick cap membrane over each socket (phantom π·r² surface, no
volume: voxel/IoU/volume gates all pass, distance gates explode). Found by
exporting the candidate to STL (runPreview from scripts/cli/preview.mjs)
and probing MY OWN mesh with probe.mjs ray. Fix: overshoot subtracted
profiles ±0.1 past face planes; keep union fills clear of subtracted-surface
radii (pac r=2.0, not 2.4).

## strategiesTried

- deterministic slice-stack bootstrap (superseded — carried socket
  mid-slices through depth, tactic 5.4 signature)
- traced-base + pac-man refill + revolved hourglass cavity + exact 45°
  chamfer wedges/cones/miter-hull → CONVERGED

## If reopened

Nothing structural left. The only sub-tolerance approximations: traced
outline chords (DP tol 0.05), ear end-face modeled via traced points,
waist as cylinder (could be a ball equator; indistinguishable at mesh
resolution). Optimizer never needed — all probed numbers were exact.
