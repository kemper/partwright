# armor_abdomen — session notes (2026-07-03)

## Verdict: CONVERGED

Best = attempt 1: **score 0.0269**, 6/6 MUST + 2/2 SHOULD, chamfer 0.0025mm,
hausdorff max 0.0915mm (P99 0.0276), IoU 0.9979, volume ratio 1.0001
(972.2 vs 972.1mm³), genus 1/1, components 1/1, zero findings. ONE authored
attempt (budget 12). Best candidate: `best/candidate.js`
(= stock genLevelSet output, `--step 0.1 --dp 0.02 --edge 0.1`).

## Method

§5.26 facet census first: 3290 tris → 2232 distinct planes (~tris/2) with
several curved-fan families (y-invariant side profiles at n=(0,±~1,nz)
morphing continuously, ±(0.217,0,0.976) roof planes, 45° x±z corner bevels).
§5.22 volume test: 972mm³ / 2813mm³ bbox = 34.6% ≪ 50%. Both discriminators
(§5.26a) route to §5.25 levelSet — stock `genLevelSet.mjs`, zero hand edits,
one turn. The genus-1 through-tunnel interpolated exactly for free.

## Structure map (from census, if anyone wants exact CSG)

Mirror-symmetric in x, 16 × 11.34 × 15.5, Z-flat. Key exact planes:
- Front/back main faces y=±... : y=4.1724 plate (x±6, z 0.5..11.5) and
  y=−3.8276 twin; inner cavity walls y=−2.7724 (z 0..10.2), y=−2.3276
  (z 0..5.4), y=−2.4276 slot (|x|≤1.865, z 0..10.2).
- Upper spine block |x|≤3: front face y=5.6724 (z 5.5..15), side walls
  x=±3.5 (z 2..12), sloped roofs n=±(0.217,0,0.976) d=12.4735, flat top
  z=12 cap (|x|≤3.5), 45° plan corner chamfers (±0.707,±0.707,0) pairs.
- Big 45° shoulder bevels n=(±0.707,0,−0.707) d=0.0071 (x 4..8, z 4..8),
  outer faces x=±6 (z 0.5..6) and x=±8 (z 8..10.5).
- Curved fan on the lower front/back: tangent-plane family
  n=(0,−0.97..−1.0, nz) — an x-invariant cylinder-ish blend z 2..12.
- Floor z=0 with 0.5mm 45° edge chamfers n=(0,±0.707,−0.707).

## Strategies tried

1. Deterministic bootstrap (silhouette) → 2/6 MUST, score 3.38.
2. Facet census (discriminator only, no decode attempted).
3. genLevelSet z-blend @ step 0.1 / dp 0.02 / edge 0.1 → 6/6+2/2, score
   0.0269, ONE turn. No straddle-pair ledge sections needed.

## What I'd try next (if reopened)

Nothing required. For CAD-pure code, the census output above names every
flat wall; only the front/back curved blends need a fan fit.
