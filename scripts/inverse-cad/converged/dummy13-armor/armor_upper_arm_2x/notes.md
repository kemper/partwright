# armor_upper_arm_2x — session notes (2026-07-03)

## Verdict: CONVERGED

Best = attempt 1: **score 0.0257**, 6/6 MUST + 2/2 SHOULD, chamfer 0.000mm,
hausdorff max 0.000mm, P99 0.000mm, IoU 0.9949 (voxel-resolution floor),
volume ratio 1.0000 (175.1 vs 175.1mm³), genus 1/1, components 1/1, zero
findings. ONE authored attempt (budget 15). No optimizer pass needed — every
constant is an exact facet-plane / vertex readout, zero numeric headroom.

## What the part actually is (armor-shell class, first of its kind here)

A thin curved plate that clips over the frame upper arm: two side plates
(inner walls x=±2.5, outer walls tilted/tapered out to |x|=4) joined by a
short floor+ceiling bridge at y∈[-3.5,-1.85] — that closed ring band IS the
genus-1 handle. Wall thickness ~1.0–1.5mm (varies with the outer taper).

Exact CSG (all numbers read from facet census, none fitted):

- **OUTER solid is CONVEX** — every one of the 109 distinct facet planes with
  outward normal is a supporting half-space. Built as `Manifold.hull` of the
  26 exact outer vertices per side (|x|≥2.9 filter on the welded vertex dump).
  Notable outer features: y-tilted side walls (0.9965x−0.0830y=3.9447,
  y∈[-5,0.5]), flat |x|=4 walls (y>0.5), z-taper planes x=3.5+0.2z /
  x=4.9−0.2z, steep chamfers to (±3, z0/z7), 45° −y end bevels z=y+10 and
  z=−y−3, tip plan chamfer 0.6771x−0.7359y=6.0787, plus 8 small corner-
  chamfer planes — the hull reproduces ALL of them from vertices alone.
- **Cavity = union of 5 convex prisms** (each a hull of exact corner points):
  - C1: chamfered slab through ALL y: |x|≤2.5, z 0.85..6.15, 0.5 corner
    chamfers (planes x∓z=∓1.15 bottom, x±z=8.15-family top).
  - B: bottom opening, sharp |x|≤2.5, 45° ramp end plane y+z=−1
    (open for y>−1 at z=0; bridge end bevel).
  - T: top opening, mirror ramp z=y+8.
  - C3: front-end opening y≤−3.5 (flat bridge end face), profile KEEPS the
    45° wall-corner chamfer planes (chamfer facet spans y −4.35..−1.85, i.e.
    past the bridge end — a sharp box cut here would clip it).
  - BORE: cylinder r=3.100, **144 segments**, axis = y through (x,z)=(0,3.5),
    y 0.3..5.5 (annular end face at y=0.3), vertex phase 1.25°+k·2.5°.
    Matches the frame fork's r3.1 cavity radius — clearance seat.

## Method (why 1 turn): facet-census decode, not slice tracing

520-triangle faceted STL → grouped every triangle by (normal, plane offset)
and printed per-plane area + bbox, then dumped the welded vertex list sorted
by region (|x|≥2.9 outer / 2.4–2.9 walls+bore / <2.4 bridge). That one-page
census gave: convexity of the outer solid, every cavity plane equation
exactly (45° planes show as ±0.7071 normals with d·√2 = clean constants),
the bore radius/segment count/phase from the tangent-plane fan (all
apothems 3.0993 → 144-gon r=3.100), and the bridge/ramp/chamfer topology
from facet bboxes alone. Zero probe fits, zero tracing, zero tuning.

## Not done / next if reopened

- Nothing structural. IoU 0.9949 is the voxel grid floor (distances are 0).
- Code is hull-of-exact-vertices for the outer solid — CAD-pure enough, but
  if someone wants named parameters, the half-space plane list in this file
  is the spec.
- Candidate = best/candidate.js (also attempts/001).

## strategiesTried

- facet-census-decode + convex-hull-outer − 5-convex-cavity-hulls: CONVERGED.
