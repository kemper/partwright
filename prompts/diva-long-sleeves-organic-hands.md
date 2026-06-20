---
date: 2026-06-20
branch: claude/hands-opt3-twopass
files_changed:
  - src/geometry/sdfFigure.ts
  - examples/figure_diva.js
  - public/catalog/diva.partwright.json
---

## Human

(Testing PR #780 on the live preview.) "Still seeing a sleeve issue with the
opera diva" — screenshot shows the raised arm's sleeve stopping at the elbow
with a long bare forearm, while the extended arm's sleeve reaches the wrist.
Also: "the hands still look kind of low-poly on some models … I like the
generally smooth organic look of SDF models" — screenshot of a reaching hand
with a hard rectangular palm slab and stepped/stub fingers.

## Assistant

Two defects, both root-caused empirically (headless `model:preview` renders +
zoomed crops), not guessed.

**Diva sleeve.** The gown was `sleeve: 'short'` (ends at the elbow). On the
nearly-straight extended arm the fat sleeve cap bulges down the forearm so it
*looks* long; on the bent + twisted raised arm it stops at the elbow → bare
forearm. The earlier "quick fix" only touched the `'long'` sleeve code path,
which the diva never used — so the user still saw the bug. Real fix: make the
gown actually `sleeve: 'long'` (an opera gown has full sleeves anyway). The
`'long'` path follows the arm chain to ~0.97 of the wrist on BOTH arms, so the
raised forearm is covered. Verified: front + ¾ renders show both sleeves
reaching the wrist, manifold, 1 component.

Key discovery (via an explore-agent trace of the catalog load path): opening a
catalog entry **re-executes the version's `code`** through the engine —
`geometryData` is never the mesh source (only paint/printability metadata). So
changing the `code` string in `diva.partwright.json` is enough for the editor
to render the fix; the engine `sdfFigure.ts` changes likewise reach every figure
on open with no re-bake. The only stale surface is the static `/catalog` grid
thumbnail (baked from `thumbnail`), and the headed-WebGL bake won't init in this
container ("API never appeared"), so the grid thumbnail stays short-sleeved
until re-baked in a working environment — noted for follow-up.

**Organic hands.** The blocky look was the hand *shape*, not just tessellation:
a hard `roundedBox` palm slab plain-unioned to the heel, plus fingers made of
three plain-unioned capsule segments (faceted steps at each joint). Fixes, both
budget-neutral and topology-safe:
- `slab.smoothUnion(heel, rh*0.28)` — rounds the wrist→palm into one organic
  mass. Both are centred palm volumes, so the smin can't reach the fingers.
- Build each finger as its OWN mass, `smoothUnion`-ing consecutive segments so
  the knuckles round into a continuous digit, THEN plain-union the finished
  finger onto the hand. The smin is local to one finger's collinear axis, so it
  can't web adjacent fingers — inter-finger gaps stay clean unions.

Rejected a `fineEdge` 0.04→0.025 bump: it pushed `waving_kid` to 522k tris (over
the ~500k catalog budget, triggering warnings) for only marginal smoothing. The
shape changes give the organic win at ~+1k tris. Validated manifold + single
component across open/spread/fist/relaxed grips (diva, waving_kid, boxer,
chibi_wizard, cornrows_runner). Typecheck + 1511 unit tests + build green.
