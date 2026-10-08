# armor_foot_2x — session notes

## Verdict: CONVERGED (attempt 1, ONE authored turn)

score 0.0233 | 6/6 MUST, 2/2 SHOULD | chamfer 0.0019 | hausdorff P99 0.0246 /
max 0.0602 | IoU 0.9982 | volume ratio 1.0001 | area ratio 1.0001 |
genus 1/1, components 1/1. Optimizer never needed. 2 attempts total
(bootstrap + 1 authored).

## What the part is

A curved foot-armor shell, 8×16.19×8mm, volume 419.1mm³ = 40% of bbox
(≪50% → NOT prism-minus-cavity), genus 1 (one vertical through-tunnel,
present as a slice hole from z=0 up to ~z=2.75), 1 component, 5704 tris
(too many for §5.26 facet census). Band census: freeform on z
(prismaticScore 0.16) and y (0.39) → routed to §5.25 levelSet section
interpolation, exactly per §5.22's volume test.

Ledge scan (Σ|signedArea| per contour, outers minus holes, 0.05mm pitch,
refined at 0.005mm):
- **z=3.0025**: the ONE giant step, A 79.92 → 60.09 (ΔA −19.8) in a single
  0.005 step. True horizontal ledge.
- **z=6.4025**: contour count 2→3 with a small sharp ΔA 0.30 — a new
  feature is born on a flat plane (not an area ledge but still snapped
  with a straddle pair so the blend zone is 0.01mm).
- z<0.5 area growth (~+2/0.05 steps, consistent run) = smooth chamfer
  slope, NOT snapped (§5.13a rule).

## Converged structure

`best/candidate.js` = levelSet SDF interpolation of **86 measured
z-sections** (PLAYBOOK §5.25/§5.25a/§5.25b, armor_neck recipe verbatim —
only the ledge list changed, as §5.25b predicts):
- uniform 0.1mm pitch + straddle pairs at 3.0025±0.005 and 6.4025±0.005
  (uniform sections within 0.9·eps of a ledge dropped);
- DP tol 0.02 / minEdge 0.05 (2993 points total);
- sdf2d with per-polygon bbox early-reject + per-(section,x,y) memo;
- z-interp = linear blend of bracketing section SDFs capped by flat end
  planes at z=0 / z=8;
- `Manifold.levelSet` at res 0.08;
- post-pass: decompose() + drop sub-1mm³ shells.

Generator: scratchpad `genfoot.mjs` (= genneck.mjs with
`LEDGES=[3.0025, 6.4025]`). Invocation:
`node genfoot.mjs target.stl foot-ls.js 0.1 0.08`.
Ledge scan: scratchpad `foot-ledges.mjs` / `foot-ledges2.mjs`.

## Strategies tried

1. deterministic bootstrap Z band-stack (attempt 0): 1/6 MUST, chamfer
   0.158, hausdorff 1.04 — abandoned without polishing.
2. levelSet z-section interpolation (attempt 1): converged.

## What next

Nothing — done. Genus-1 tunnel came through the section holes for free.
If ever re-opened for scaffold erosion (§5.6): the section stack is the
faithful digitized form and passes every gate; erosion is cosmetic only.
The frame_ankle mating joint (socket r=2.9046 @ z=2.5 on the frame part)
was never needed here — the armor shell carries no socket.
