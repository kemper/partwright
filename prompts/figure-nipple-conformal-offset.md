---
date: 2026-06-18
branch: claude/kind-cerf-dikkfm
files_changed:
  - src/geometry/sdfFigure.ts
  - public/ai/figure.md
  - public/catalog/*.partwright.json (9 figures re-baked)
---

## Human

(Continuing the areola fix on PR #713, with screenshots of danseur / swimmer /
tai chi / sprinter.) The areolae still aren't landing: some paint a disc with no
nipple, some are faded, and even when both show the disc has rough triangled
edges. Let's discuss what's possible first. → [chose: shallow raised disc] →
Look from multiple angles; a past attempt had the disc jutting instead of
near-flush — make sure the algorithm reliably finds the torso skin so the disc
is very subtle / near-flush. → Why a fixed fraction of chest? Can't it be like
clothing — ultra-thin, starts at a predictable point, perfectly follows the
torso? → [chose: thinner if possible] → Can you refine the mesh just at the
nipple, not the whole chest?

## Assistant

Diagnosed the real failure from the screenshots: the hatched/faded areola was a
**paint-assignment** artifact, not geometry density. The areola was a separate
`'areola'`-labelled shape sitting *coincident* with the skin; the bake assigns
each triangle to the nearest SOURCE shape (`src/color/subdivide.ts`), so a
coincident disc is a per-triangle coin-flip between `areola` and `skin` → the
dither. "Totally flush" is therefore the *hardest* case to paint, not the
easiest.

Reworked `F.nipples(rig, { on })` to the user's clothing model: the areola is now
a **conformal offset** of the torso — `body.round(t)` (SDF `f − t`, which pushes
the surface outward by `t` along the TRUE normal everywhere) clipped to the
nipple region by a forward column, plus a small central nipple from a slightly
larger offset. This follows whatever chest is actually there (bare/pec/mound/
belly) perfectly — no analytic curvature guess (the old coin's guess was what
jutted on one figure and sank on another), no flat disc face. The offset can't
be zero (coincident = dither again), so `t` is a thin fixed fraction — the
THICKNESS knob; the SHAPE is fully conformal. Verified the protrusion is a
uniform ~constant fraction of torso depth on every figure (probe over
`buildRig`), so no misprediction is possible.

Then made it thinner per request by refining the **nipple-local** detail mesh:
`faceDetail`'s `chest` regions are already two small spheres at the nipple
anchors (not a whole-chest remesh — confirmed: refining them cost only ~+1%
triangles), so halving `chestEdgeLength` (chestX·0.03 → 0.018) let `t` drop
(chestX·0.05 → 0.03, ≈2.5% of torso depth) while the raised front still clears
one detail triangle → still paints clean. Verified front (clean solid round
areolae, no dither) + profile (a gentle near-flush swell, no jut) on swimmer,
boxer, sumo. Re-baked all 9 catalog entries; all comp=1, manifold, `areola`
resolves > 0 triangles.
