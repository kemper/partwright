# hand_grip_right — session notes (2026-07-03)

## Verdict: CONVERGED — 6/6 MUST, 1/2 SHOULD, score 0.339 (attempt 2, 2 turns)

chamfer 0.028 | hausdorff max 0.287 / P99 0.147 | IoU 0.955 | volume ratio 0.998
| genus 0/0 (engine convention) | components 3/3. Only `area ratio` (SHOULD)
fails: 1.157 — same staircase riser area as the left hand; band-count-
independent, would need sloped walls (loft/hull between slice contours) to fix.
Judged not worth it with all MUST gates green.

## What worked: this part is an EXACT mirror of hand_grip_left

Verified before modeling (don't assume — but here it held perfectly):

- bbox mirrors exactly about x=0 (y/z extents identical to 1e-5).
- wrist ball socket: `probe fit --near -1.5,0,0 --r 2` → sphere r=2.900 at
  [0,0,0], rms 0, inliers 1.0 — identical to the left (socket center IS the
  origin for both hands).
- `splitStl.mjs` → same 3 components; debris shells at [2.987,3.477,0.184]
  (0.33×0.53×0.37) and [-0.472,8.280,1.649] (0.11×0.18×0.55) — exact x-negated
  copies of the left's.

Recipe: copy `hand_grip_left/best/candidate.js`, append
`solid = solid.mirror([1,0,0])` as the last op before `return`. Manifold's
`.mirror(normal)` handles triangle winding itself, so no polygon rewinding of
the traced bands is needed; the origin-centered socket sphere maps to itself
and the left-side debris voids land exactly on this target's probed centers
after the flip. That single turn scored 0.339 with 5/6 MUST.

## The one real fix: the genus gate convention changed since the left session

The left session worked around an engine-vs-profile genus convention mismatch
by making the debris voids TOROIDAL (see hand_grip_left/notes.md "Gate quirk").
**That workaround is now obsolete and actively fails**: `gates.mjs` now bridges
conventions (`expectedEngineGenus = 1 - targetComponents + targetGenusPerShell`
= 1 - 3 + 2 = 0 here), so faithful sphere-like internal voids are what passes.
Torus voids read engine genus 2 vs expected 0 → topology FAIL. Switching the
two voids to `Manifold.cube(size, true)` boxes (chi = +2 each) gave genus 0/0
and converged. hand_grip_left/best still uses torus voids — it presumably now
FAILS its topology gate if re-evaluated; siblings should copy THIS candidate's
void style (and re-converging left is a 1-edit fix).

## Transfer notes for the remaining sibling hands

- Expect the same socket (r=2.9 at origin), same ledges, same debris pattern
  (run splitStl first), same recipe. If a sibling is a mirror/pose variant of
  an already-converged hand, try the mirror/copy shortcut FIRST — it cost 2
  turns total here vs 6 for the left from scratch.
- Use BOX debris voids (post-gate-fix convention), not torus.

## strategiesTried

- coarse-z-slice-stack bootstrap: superseded.
- mirror-of-left-converged-candidate + box debris voids: CONVERGED
  (attempt 2, score 0.339).
