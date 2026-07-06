# armor_outer_chest — session notes

## Verdict: CONVERGED (attempt 1, ONE authored turn)

score 0.0495 | 6/6 MUST, 2/2 SHOULD | chamfer 0.0045 | hausdorff P99 0.0496 /
max 0.1184 | IoU 0.9960 | volume ratio 0.9994 | genus 2/2, components 1/1.
Optimizer never needed. Best candidate: `best/candidate.js`.

## What the part is

The outer chest plate — a wrap-around curved shell, bbox 18 × 15.02 × 20,
volume 1565mm³ = 29% of bbox (fails the §5.22 prism-minus-cavity volume
test), freeform on ALL axes (prismaticScore z 0.44 / x 0.47 / y 0.37, every
band "multi"). Genus 2, 1 component. Structure in words, from the z-scan:

- z 0..2.005: a closed collar ring (outer x±6.5, y −4.7..6.5) around a
  central cavity (hole x±4.6, y −2.6..3.6) — the ring = handle #1;
- z 2.005..16: the ring splits into separate FRONT (y≈3..7.5) and BACK
  (y≈−7..−2) plates that rise and flare outward to x±9;
- inner faces of both plates step at z=10.005 (front inner y 3.0→4.5, back
  inner y −2.0→−3.5);
- front plate window: splits into left/right at z=11.895, rejoins at
  z=15.305 → handle #2 (genus 2 total);
- both plates split into left/right permanently at z=16.005 → 4 contours
  to the top (no genus contribution); top tapers to z=20.

## Converged structure

`best/candidate.js` = **levelSet SDF interpolation of 138 measured
z-sections** (§5.25/5.25a — armor_waist recipe transferred verbatim):

- sections at uniform 0.15mm pitch PLUS straddle pairs at ±0.005 around
  each ledge z ∈ {2.005, 10.005, 11.895, 15.305, 16.005} (found by a
  0.05mm slice-area scan, each localized to 0.01mm; uniform sections
  within half a pitch of a ledge dropped so the straddle pair owns the
  blend zone);
- each section DP 0.02 + cleanShortEdges 0.05 (7254 points total);
- sdf2d per-polygon bbox early-reject + per-(section, x, y) memo cache;
  levelSet res 0.15, bounds bbox+0.5; z-interp linear between bracketing
  sections, flat end caps at z=0/20;
- post-pass decompose() + drop sub-1mm³ shells (kept exactly 1 component,
  genus 2 exact).

Generator: scratchpad `genchest.mjs` (session-local; = armor_waist's
boilerplate emitted from sliceMesh + douglasPeucker + cleanShortEdges,
trivially re-creatable from this description + armor_waist/best/candidate.js).

## Measurement note (ledge-scan hygiene)

sliceMesh contour ORIENTATION is arbitrary near horizontal facets — summing
raw signedArea produced phantom ±100mm² "ledges" (sign flips) at z≈3.0,
11.7, 15.7, 16.5, 19.0. Sum |signedArea| per contour (outer − holes) for
the area signal; only single-step jumps in THAT signal, or contour-count
changes, are real ledges. All 5 real ledges were sharp single-step
transitions; everything else was orientation noise.

## Strategies tried

1. deterministic bootstrap Z band-stack (attempt 0): 0/6 MUST, chamfer
   0.209, hausdorff 3.99, IoU 0.805 — freeform everywhere, not polished.
2. levelSet z-section interpolation (attempt 1): converged.

## What I'd try next

Nothing — all gates pass with margin. Erosion to readable CAD (§5.6)
deliberately not done, same reasoning as armor_waist: genuinely freeform
shell, zero gate delta available.
