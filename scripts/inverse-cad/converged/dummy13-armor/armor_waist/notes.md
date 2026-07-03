# armor_waist — session notes

## Verdict: CONVERGED (attempt 1, ONE authored turn)

score 0.0705 | 6/6 MUST, 2/2 SHOULD | chamfer 0.005 | hausdorff P99 0.0621 /
max 0.1315 | IoU 0.9953 | volume ratio 0.998 | genus 2/2, components 1/1.
Optimizer never needed.

## What the part is

A wrap-around curved waist-armor shell, ~1.5–2mm wall, bbox 20×16×15.2,
genus 2. NOT prismatic on any axis (bands = freeform on x, y, AND z — the
bootstrap's Z band-stack mangled it, score 9.73). Structure in words:
- bottom apron plate z∈[0,2] with a front tab (x∈[-2.5,2.5] to y=-7) and a
  rounded-rect through-hole x∈[-1.5,1.5], y∈[0.5,3.7] (handle #1);
- two side shells rising and flaring back (outer wall a plan-prism-like
  diagonal (10,3.5)→(8.2,7.54)→(7.5,8) at mid z);
- front window between columns at x≈±(2.55..3.17) enclosed by the top band →
  handle #2; back window between the side walls is open at the top (no genus);
- top band z∈[12.2,15.2], y∈[-0.5,4], x∈[-4,4];
- the inner J-profile (y=2.0 wall + big fillet to z=1.5 floor, ending at
  y=-3.51) is IDENTICAL at x=4.5/6/9 — an X-prism inner surface — but the
  outer surface tapers, so no simple shell decomposition was attempted.

## Converged structure

`best/candidate.js` = **levelSet SDF interpolation of 115 measured
z-sections** (the grip-levelset prototype productionized for this part):
- sections at uniform 0.15mm pitch PLUS straddle pairs at ±0.005 around each
  measured horizontal ledge (z = 1.5, 2.0, 3.0, 4.0, 12.0, 12.2 — found by a
  0.05mm slice-area scan; the z<0.25 ramp is bottom-chamfer slope, not a
  ledge, per §5.13a);
- each section DP-simplified at 0.02 / minEdge 0.05 (2954 points total);
- sdf2d with per-polygon bbox early-reject + per-(section,x,y) memo cache
  (levelSet re-queries the same xy column every layer) — full build ~7s at
  res 0.15;
- z-interp = linear blend of bracketing section SDFs, capped by flat end
  planes at z=0 / z=15.2;
- post-pass: decompose() and drop sub-1mm³ shells (marching-cubes junk
  guard; ended up keeping exactly 1 component, genus 2 came out exact).

Generator: scratchpad `genwaist.mjs` (session-local; parameterized
target/pitch/res — trivially re-creatable from this description + the
grip-levelset.js prototype).

## Strategies tried

1. deterministic bootstrap Z band-stack (attempt 0): 0/6 MUST, chamfer 0.64,
   hausdorff 7.9 — freeform everywhere, abandoned without polishing.
2. levelSet z-section interpolation (attempt 1): converged.

## Residual (cosmetic, passing)

F1: 0.5mm³ missing thin-skin sliver at [0, 3.7, 13.8] (6.4×0.6×0.6) — the
top band's back shoulder between sections; well under every gate. If ever
re-opened: add straddle pairs at z=12.5/13.5 (the y=4 face's chamfer ends)
or halve pitch over z∈[12,15.2].

## What I'd try next

Nothing — done. Erosion to readable CAD (§5.6) was deliberately NOT done:
gates pass, and the part is genuinely freeform-composited; a primitive
rebuild would be a multi-session project for zero gate delta.
