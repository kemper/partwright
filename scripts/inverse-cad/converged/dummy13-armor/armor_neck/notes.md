# armor_neck — session notes

## Verdict: CONVERGED (attempt 1, ONE authored turn)

score 0.0391 | 6/6 MUST, 2/2 SHOULD | chamfer 0.0027 | hausdorff P99 0.0292 /
max 0.0488 | IoU 0.9956 | volume ratio 0.9991 | genus 0/0, components 1/1.
Optimizer never needed. 2 attempts total (bootstrap + 1 authored).

## What the part is

A small curved neck-armor shell, 7×7×5.14mm, volume 119.7mm³, genus 0,
1 component. Freeform curvature on all axes (the bootstrap Z band-stack
scored 5.31, second-worst in the corpus). Exactly one true horizontal ledge
at **z=4.4025** (slice-area scan at 0.05mm pitch shows a single giant step
ΔA = 24.40 → 10.57 between z=4.400 and 4.405; every other ΔA is a run of
consistent small steps = dome curvature, not snapped per §5.13a). The
z<0.5 area growth and z>4.4 shrink are smooth chamfer/dome slopes.

## Converged structure

`best/candidate.js` = **levelSet SDF interpolation of 55 measured
z-sections** (PLAYBOOK §5.25/§5.25a, the armor_waist recipe transferred
verbatim — only the ledge list changed):
- sections at uniform **0.1mm** pitch + a straddle pair at 4.4025±0.005;
- each section DP-simplified at tol 0.02 / minEdge 0.05 (1324 points);
- sdf2d with per-polygon bbox early-reject + per-(section,x,y) memo;
- z-interp = linear blend of bracketing section SDFs capped by flat end
  planes at z=0 / z=5.141;
- `Manifold.levelSet` at **res 0.08** (part is small, so finer than the
  waist's 0.15 was affordable and paid off: chamfer 0.0027);
- post-pass: decompose() + drop sub-1mm³ shells (kept exactly 1).

Generator: scratchpad `genneck.mjs` — genwaist.mjs with
`LEDGES=[4.4025]`, defaults pitch 0.1 / res 0.08. Invocation:
`node genneck.mjs target.stl neck-ls.js 0.1 0.08`.

## Strategies tried

1. deterministic bootstrap Z band-stack (attempt 0): 1/6 MUST, chamfer
   0.517, hausdorff 4.62 — abandoned without polishing.
2. levelSet z-section interpolation (attempt 1): converged.

## What next

Nothing — done. If ever re-opened for scaffold erosion (§5.6): the shell is
probably a swept/offset saddle surface; the section stack is the faithful
digitized form and passes every gate, so erosion is cosmetic only.
