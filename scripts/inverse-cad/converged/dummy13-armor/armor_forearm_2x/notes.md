# armor_forearm_2x — session notes (2026-07-03)

## Verdict: CONVERGED

Best = attempt 4: **score 0.0056**, 6/6 MUST + 2/2 SHOULD, chamfer 0.000mm,
hausdorff max 0.0029mm (detent-sphere tessellation floor), P99 0.000, IoU
0.9989 (voxel floor), volume ratio 1.0000 (319.1 vs 319.1mm³), area ratio
1.0000, genus 4/4, components 1/1, zero findings. 4 scored attempts (of 15):
1 = stock levelSet safety best (0.156, 6/6 MUST — coordinator recipe), 2-4 =
exact facet-census CSG decode (§5.26). No optimizer pass — every constant is
an exact facet-plane / welded-vertex readout.

## What the part actually is (armor clip-shell, sibling of armor_upper_arm)

A Z-flat armor tube clipping over the frame forearm, bbox 8 × 21 × 9.
Genus 4 = tube ring (1) + the two side walls pierced by the transverse
window (2) + the roofed ridge channel over the open-bottom body (1).

- **Outer tube**: XZ octagon hw 3.5, z 0..7, 0.5 corner chamfers, y −10..8.5.
  −y end: inset rect face (±3, z 0.5..6.5) at y=−10.5, hull-of-pinned-slabs
  to the octagon at y=−10 (corner miters come free). +y end: bottom slant
  y−z=5.5 (z 0..3) + end face y=8.5 with plan chamfers x+y=12 below z=5 /
  x+y=11.5 at z 5..7 (the z=5 step facet emerges from the two KEEP prisms).
- **Side rib bulges** (|x| 3.5→4, y −2..8.5, z 0..5): CONVEX — hull of 17
  exact welded verts. **ASYMMETRIC**: +x front is a 45° plan chamfer x−y=5
  reaching (3,−2,0); −x front is a flat y=−1.5 face + chamfer only from
  (−3.5,−1.5) — vert (−3,−1.5,0), facet (0,−1,0) d=1.5. The slant-corner
  chamfer plane 0.7071x+0.5(y−z)=5.2249 passes exactly through the main
  slant edge at x=3.5, so only the bulge needs it (free via hull verts).
  Hull needed an extra footprint vertex (3, 6.20711, 0) that the mesh
  doesn't weld (interior to the shared z=0 face).
- **Cavity prism** (through both ends): floor z=0.7 (|x|≤2.2, 0.5 chamfers
  to walls x=±2.7), walls to z=5.5, 45° wings x+z=8.2 to ceiling z=6.1.
- **Top ridge** (y 0.5..10.5) = (YZ profile prisms: front slope z=y+6.5,
  plateau 8.5 y 2..5.5, roof-front slope z=y+3, top z=9 y 6..10, rear
  chamfer y+z=19, tip face y=10.5 z 8.1..8.5, rear underside slant
  z=y−2.4) ∩ (XZ rail prism ±2.5 with x+z=10.5 chamfers to ±1.5 @ z=9).
  Front-slope/rail corner chamfers (plane 0.7071x−0.5y+0.5z=4.6642, 0.5
  leg) subtracted as wedges clipped to z≥7.
- **Channel + slot cuts**: top opening y≥−3 (45° overhang ramp z=y+9.8 for
  y −3.7..−3) full height |x|≤1.5 (+wings from ±2.1@6.1) to y=5.5; covered
  channel y>5.5: walls to z=7.8, 0.5 ceiling chamfers to flat 8.3 (|x|≤1);
  slot-end wedge ramp y+z=13.7. Rear slant y−z=2.4 extends BELOW z=6.1
  bounded by |x|≤2.7 (end face y=8.5 only survives at 2.7<|x|).
- **Floor cuts**: channel |x|≤1.6 from undercut ramp y+z=−3.1; floor end:
  45° ramp y=z for z 0..0.5 then vertical y=0.5 (z to 1.2) — two prisms,
  cut region is a UNION {y≥z}∪{y≥0.5}, not one polygon.
- **Window** (y −7.5..−5): cuts everything except |x|≤1.5 bottom strip
  (z≤0.7) and top strip (z≥6.4), strip edges chamfered x−z=1 / x+z=8, strip
  ceiling trim to z=6.4. The rim carries a 0.5 45° chamfer on EVERY outer
  face it crosses (plan chamfers on walls, y-z wedges at z=0/z=7 — max
  semantics via union of 4 wedge prisms) AND **8 three-plane corner miters**
  (0.577-normal facets): sx·x+sy·y+sz·z = 7.5 / 14.5 / −5 / 2.
- **Snap detents**: sphere r=1.000 exact at (±3.3, 0.5, 3.5) — center 0.6
  OUTSIDE the inner wall x=2.7, protrudes 0.4 into the cavity (ρ=0.8 ring
  at the wall). Clipped `.intersect(MAIN∪BULGE)`, added LAST after all cuts.

## Method

§5.26 facet-census decode (custom scratch script: group tris by
(normal, plane offset) → per-plane area+bbox, plus welded-vert dumps) on the
1784-tri STL: 896 planes but everything is planar + 2 sphere fans. Sphere
solved closed-form from ring radii (r=1.0000 to 4 decimals, 3 rings).
Cross-checked with probe sections at 10 stations, exact-area identities
(cavity 28.55, end annulus 7.45, strip 1.85/1.55 all matched analytically).
sliceOverlay against my own candidate STL (§5.19c) localized both bug
rounds; a BVH argmax scan (closestPointOnMesh, note signature
`(bvh, x, y, z)` not `(bvh, [x,y,z])`) decoded the last 0.24mm of excess.

## Bugs worth remembering (PLAYBOOK candidates)

1. **`Manifold.hull(points)` silently convexifies a CONCAVE profile** — my
   wings+walls channel profile lost its concave vertex (1.5,6.7) and the
   hull edge overcut 12mm³. Shoelace-convexity-check every profile before
   using hull-of-points; split concave profiles into convex sub-prisms.
2. **Mirror asymmetry**: "2x" parts can be non-mirror-symmetric in small
   features (the −x bulge front). Compare the ± facet AREAS in the census —
   1.341 vs 1.164 on nominally mirrored planes was the tell.
3. Hull-of-exact-verts needs verts that the mesh never welds (corners
   interior to a shared planar face) — check the hull's footprint against
   the target's face bboxes.

## strategiesTried

- stock-levelSet (§5.25, coordinator recipe): 6/6 MUST at 0.156 — banked
  as safety best, superseded.
- facet-census-decode + convex-piece CSG (§5.26/§5.28): CONVERGED at 0.0056.

## Not done / next if reopened

- Nothing structural. Residual 0.0029mm hausdorff = 64-gon sphere vs the
  target's own sphere tessellation; not worth a turn.
- Candidate = best/candidate.js (also attempts/004).
