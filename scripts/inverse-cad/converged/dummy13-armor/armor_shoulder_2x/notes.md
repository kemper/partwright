# armor_shoulder_2x — session notes (2026-07-03)

## Verdict: CONVERGED

Best = attempt 1: **score 0.1397**, 6/6 MUST + 2/2 SHOULD, chamfer 0.0037mm,
hausdorff max 0.118mm, P99 0.077mm, IoU 0.9827, volume ratio 0.9953,
genus 0/0, components 1/1. ONE authored attempt (budget 15), no optimizer
pass. This closes the 37-part Dummy 13 corpus — the armor recipe went
16-for-16.

## Route taken (exactly the §5.26a decision)

- Facet census (scratchpad facet-census.mjs): 1944 tris → **1082 distinct
  planes**, above tris/2 (972) — no hard collapse, so NOT a faceted-exact
  CAD export. The census shows curved blend fans (families of single-tri
  planes like n=(0, 0.79→0.51, −0.60→−0.86) marching along a roundover at
  y≈−1..−2, z≈6.8..7.7) alongside the flat kit walls.
- Routed straight to §5.25 stock levelSet:
  `genLevelSet.mjs target.stl --step 0.1 --dp 0.02 --edge 0.1` → converged
  in that single banked "safety best" turn. No ledge straddles, no clamp,
  no voids needed (genus 0, 1 component).

## Census structure map (if anyone ever wants a CSG rebuild)

Dome-hood plate over the shoulder joint: build-plate face z=0, back wall
y=−2 plane (42.9mm² — dominant), plan-chamfered front skirt
(±0.3162,−0.9487,0) walls, flat side walls |x|=4.5 (z 0.5..6), 45° inner
chamfers (±0.7071,0,0.7071) d=−1.2728 spanning z 0.8..2.0, interior ledges
z=0.8 and z=2.0, top cap z=8.5, 45° corner bevels (0.7071,0.7071,0)
families, plus curved roundover fans front-top. Residual F1 (0.53mm³
thin-skin, PASSING) sits on the 45° inner chamfer band at z≈1.5 — the
§5.25d SDF-lerp-at-oblique-ledge signature; a saturating clamp or straddle
pair at z=0.8/2.0 is the polish move if anyone reopens this.

## strategiesTried

- facet-census (5.26a: 1082 planes > tris/2) → stock genLevelSet
  step 0.1 / dp 0.02 / edge 0.1: CONVERGED.

## Not done / next if reopened

- Nothing required. Optional polish: straddle pairs at the z=0.8 / z=2.0
  interior ledges + §5.25d clamp would likely shave the last 0.5mm³
  thin-skin finding and the 0.118 hausdorff tail.
- Candidate = best/candidate.js (also attempts/001).
