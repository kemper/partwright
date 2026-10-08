# armor_shin_2x — session notes (2026-07-03)

## Verdict: CONVERGED

Best = attempt 2: **score 0.0595**, 6/6 MUST + 2/2 SHOULD, chamfer 0.0061mm,
hausdorff max 0.098mm, P99 0.037mm, IoU 0.9930, volume ratio 0.9975,
genus 3/3, components 1/1, zero findings. TWO authored attempts (budget 15).
No optimizer pass — nothing numeric left to tune.

## What the part is

Armor shell that slides over the frame shin. bbox 9 × 26 × 9.37, volume
501.7mm³ (23% of bbox → shell class per §5.22 volume test). Genus 3:
(1) the square ring tube at y −13..−9.5 (through-hole along y — outer box
x±3.5/z 0..7.3 with 0.5×45° chamfered rims on both end faces, hole x±2.6 /
z 0.8..6.2 with 45° corner chamfers), (2) the side-window frame in the stem
region y −9.5..~0.5 (floor rail z 0..0.8 + top rail z 6.5..7.3 enclosing an
x-through window), (3) closed ring around the covered channel / fork-slot
region toward +y (deck z 6.2..7.3 over the channel, slot |x|<1.6 opening
y −2.2..9.6, curved knee hump rising to z 9.37 with big flat 45°-family
facets, tapered flare walls to x=±4.5 at y −1.75..10.83).

Facet census (census.mjs in scratchpad): 2608 tris, 1415 planes, 95.2% of
the 1019mm² surface in just 74 planes ≥0.5mm². Curved leftovers: hump-crown
blends (~11mm²/side), flare-rise blends, a rounded slot-floor fan at
y≈7.2–7.8, and two ~270-facet detent bumps on the inner walls at
(x≈±2.3..2.6, y≈10.3..11.7, z≈3.0..4.2) — snap-fit nubs. None of these
needed explicit modeling; the levelSet sections carry them.

## Route taken: §5.25 levelSet-of-measured-sections (2 turns)

Routed by the volume test (23% ≪ 50%) despite the feasible facet census —
genus 3 + many chamfer runouts made an exact-CSG decode risky for turn
budget, while the §5.25 recipe is mechanical:

1. Ledge scan (Σ|signedArea| slice areas at 0.01 pitch): true ledges at
   z = 0.8, 6.2, 6.5, 7.3 (single giant ΔA). The z 0..0.5 and 6.9..7.3
   runs of small consistent ΔA are 45°/tilted ramps — NOT snapped (§5.13a).
2. genshin.mjs (copy of outer_chest's genchest.mjs): 95 sections, pitch 0.1
   + straddle pairs at ledge±0.005, DP 0.02, minEdge 0.05, levelSet res 0.1.
   → attempt 1: 5/6 MUST, chamfer 0.0076. One finding: 5.1mm³ thin-skin
   missing at z≈7.27 across the whole tube+stem deck top.
3. Diagnosis (candidate ray-probe, §5.19c): candidate deck top sat
   0.02–0.05 BELOW z=7.3 — marching-cubes z-lerp bias at a flat interior
   ledge: grid samples sit outside the 0.01 straddle blend zone, so the
   crossing interpolates asymmetric SDF magnitudes (+deep-inside vs
   −shallow-outside) and lands off the plane.
4. Fix: clamp the returned SDF to ±0.05 (half the grid step) so both sides
   of any flat ledge saturate symmetrically and the crossing lands midway
   on the plane. → attempt 2: 6/6+2/2, chamfer 0.0061, done.

## Not done / next if reopened

- Nothing required. If someone wants CAD-readable parametric code, the
  facet census output (74 planes) + the structure description above is the
  spec — but the levelSet candidate passes everything.
- Candidate = best/candidate.js (= attempts/002).

## strategiesTried

- levelset-z-sections (95 sections, ledges 0.8/6.2/6.5/7.3, ±0.05 SDF
  clamp): CONVERGED.
