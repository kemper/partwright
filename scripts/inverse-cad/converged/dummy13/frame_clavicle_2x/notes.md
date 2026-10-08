# frame_clavicle_2x — session notes

## Verdict: CONVERGED (attempt 1, phase done)

6/6 MUST + 2/2 SHOULD. score 0.0080 | chamfer 0.0009 | hausdorff max 0.048
(P99 0.0047) | IoU 0.9990 | volume ratio 0.9993 | area ratio 0.9995.
2 attempts total (bootstrap + ONE authored turn). Best: `best/candidate.js`
(from `work.js`).

## What the part is (all numbers probed, none guessed)

A ball-to-socket bridge: socket end at the origin, ball end at (0,7,0),
joined by a short neck. The socket grammar is §5.19i verbatim, but the
socket BODY here is a SPHERE, not a prism block — which turns the kit's
straight corner-chamfer line into a conoid (see below).

- **Outer socket body**: sphere r=4.500 about the origin (ray r=4.4998),
  clipped to z∈[-2.5, 2.5]. Band areas shrinking toward the faces
  (52.7→28.3 mm²) are the sphere, not chamfers — no face chamfers anywhere
  on the outer sphere rim (bbox at z=2.45 matches √(20.25−z²) to 0.001).
- **Ball**: r=3.000 EXACT @ (0,7,0) (fit rms 0, inliers 1.0), plate-clipped
  at z=-2.5 (cap pokes above the body to z=3.0 — the z 2.5..3.0 circle bands).
- **Neck strut**: cylinder r=1.500 along Y at (x=0,z=0). No chordal flat
  (top ray z=1.5000 = side ray x=1.5000 at y=4.4). The visible cylinder is
  tiny (y≈4.24..4.40 between the two spheres); modeled y∈[0,7], buried ends.
- **Cavity**: sphere r=2.900 @ origin (fit rms 0, inliers 1.0) + kit lead-in
  cones on BOTH faces: r(z) = 2.4689 − 0.3678·(2.5−|z|) (ray-cast r(z) at
  0.1 steps; slope 0.3678 measured on both faces; crossover with the sphere
  at |z|≈1.855). Per-part socket radius confirmed again (2.900 here).
- **Mouth wedge**: vertical planes y = ±0.6682·x passing exactly through the
  socket center (§5.12; same 0.6682 as hip_shoulder/waist/abdomen/head).
- **Mouth face chamfers**: 45°, leg 0.5, top AND bottom, ONLY on the mouth
  planes (perp distance (y−0.6682x)/1.2028 == |z|−2.0, verified at z=2.4).
  Not on the sphere rim, not on the cavity rims.
- **Corner cut (the one novel feature)**: the kit corner-chamfer line
  y=±(0.217x−2.935) exists at z=0, but on this spherical body it is
  modulated in z: cut region y < CC − s(z)·(CA − CB·|x|) with
  s=sqrt(1−(z/CZ)²), CC=−0.3215 CA=2.6138 CB=0.2168 CZ=3.3882.
  554-point ray-sample fit: rms 0.0042, max 0.014. It is a RULED surface
  with horizontal straight rulings whose slope varies with z — provably NOT
  a cone/cylinder about any horizontal axis (basin-corrected cone fit rms
  0.14) and not a surface of revolution (straight z-sections). Built as
  20×2 hulled z-band slabs (0.25mm pitch; linear-interp sagitta ~0.004mm).

## Construction (best/candidate.js)

[sphere4.5 ∩ cube z±2.5] ∪ ball3@(0,7,0) ∪ strutY r1.5 → plate clip →
− mouth wedge prism − 4 chamfer wedge prisms (§5.11 (s,z) recipe)
− conoid band hulls − [cavity sphere ∪ 2 cone frustums (overshoot faces)].

## Traps hit / lessons

- **Hull convexifies**: the conoid cut region is a V-tent (two rulings
  meeting at x=0); hulling whole-width band slabs would fill the V. Split
  per side (each half is a convex quad) — 2 hulls per band.
- **Grid-search primitive fits need the hand-derived basin inside the
  ranges**: two cone fits landed rms 0.15–0.29 in wrong basins because r0's
  range excluded the true value (1.3). Always sanity-evaluate hand-derived
  params through the same residual function before trusting a search.
- Mouth face-chamfer points contaminate the corner-strip sample — filter
  |z|>2.0 hits against the offset plane y=0.6682x+(|z|−2)·1.2028 first.

## strategiesTried

- deterministic slice-stack bootstrap (superseded; silhouette-limited)
- probe-driven primitive composition per Dummy 13 socket grammar + empirical
  conoid corner cut → CONVERGED in one edit

## If reopened

Nothing structural left. The conoid params are empirical (design intent
unknown — possibly a swept clearance); optimizer never needed since all
gates pass with wide margin. The only approximation: 0.25mm band pitch on
the corner cut (error ~0.004mm, far below facet noise).
