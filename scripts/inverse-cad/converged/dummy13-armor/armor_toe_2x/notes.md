# armor_toe_2x — session notes

## Verdict: CONVERGED (attempt 1, ONE authored turn)

score 0.0278 | 6/6 MUST, 2/2 SHOULD | chamfer 0.0016 | hausdorff P99 0.020 /
max 0.0569 | IoU 0.9968 | volume ratio 0.9992 | area ratio 0.9933 |
genus 0/0, components 1/1. Optimizer never needed. 2 attempts total
(bootstrap + 1 authored).

## What the part is

A curved toe-armor cap, 8×7×3.5mm, volume 118.2mm³ = 60% of bbox, genus 0,
1 component, 6796 tris (too many for §5.26 facet census). Band census:
freeform on z and x, rounded-rect morphing to 2-contour on y — routed to
§5.25/§5.25b levelSet section interpolation (the §5.22 volume test was
ambiguous at 60%, but the all-freeform census decided it).

Ledge scan (Σ|signedArea| + contour count, 0.005mm pitch): NO area ledges —
every ΔA run is consistent small steps (dome curvature, §5.13a — largest
run ~0.13/step around z=2.4-2.6). Exactly ONE contour birth: 1→2 contours
between z=3.005 and 3.010 (ΔA −0.14) → straddle pair at 3.0075±0.005 per
§5.25b. The z≥3.485 shrink is the dome closing at the top (smooth).

## Converged structure

`best/candidate.js` = levelSet SDF interpolation of **39 measured
z-sections** (armor_foot/armor_neck recipe verbatim — only the ledge list
changed, as §5.25b predicts):
- uniform 0.1mm pitch + straddle pair at 3.0075±0.005;
- DP tol 0.02 / minEdge 0.05 (653 points total);
- sdf2d with per-polygon bbox early-reject + per-(section,x,y) memo;
- z-interp = linear blend of bracketing section SDFs, flat end caps at
  z=0 / z=3.49999;
- `Manifold.levelSet` at res 0.08;
- post-pass: decompose() + drop sub-1mm³ shells.

Generator: scratchpad `gentoe.mjs` (= genfoot.mjs with LEDGES=[3.0075]).
Invocation: `node gentoe.mjs target.stl toe-ls.js 0.1 0.08`.
Ledge scan: scratchpad `toe-ledges.mjs`.

## Strategies tried

1. deterministic bootstrap Z band-stack (attempt 0): 1/6 MUST, chamfer
   0.180, hausdorff 1.20 — abandoned without polishing.
2. levelSet z-section interpolation (attempt 1): converged.

## What next

Nothing — done. If ever re-opened for scaffold erosion (§5.6): the section
stack is the faithful digitized form; erosion is cosmetic only.
