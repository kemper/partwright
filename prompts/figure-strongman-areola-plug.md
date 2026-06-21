---
date: 2026-06-17
branch: claude/kind-cerf-dikkfm
files_changed:
  - examples/figure_strongman.js
  - public/catalog/flexing_strongman.partwright.json (re-baked)
---

## Human

I recently merged a bunch of figure fixes but a bunch still have issues.

[After a triage of all 43 figure examples and a de-noised review, the user scoped
the combined PR to one verified, certain item — the strongman areola plug — and
chose to track the catalog-wide triangle-budget overflow separately rather than
fix it here.]

## Assistant

A broad triage (six parallel render passes over every `examples/figure_*.js`, plus
my own ground-truth renders of the highest-signal cases) showed that most of the
merged engine fixes (#701/#702/#703/#706/#707/#691) had in fact landed: the muscled
back reads as normal anatomy on bodybuilder/sprinter, boxer's areolae are flush
front discs with a clean back, and several "pose is wrong" reports were by-design
grounding for printability. The agents over-reported normal anatomy and props as
defects, so I verified with my own eyes before touching anything.

The one **certain, code-confirmed** remaining defect was figure-local, not engine:
`figure_strongman.js` hand-rolls its own areola coins (it has to — `F.nipples`
rides `rig.torso`, which lands on the un-puffed base chest *behind* this figure's
custom pec puff). That inline coin still used the **old pre-#706 plug idiom**: a
clip cylinder of length `(surfR + eps) * 2.2` centred on the anchor, which runs
~1.1·surfR *back* into the body. On strongman's deep pec puff the plug stayed
buried, so it wasn't visible today — but it's the same latent rod that #706 fixed
in the engine, and it would punch out the back on any shallower chest.

Fix: mirror the engine's #706 approach in the figure's own code — bound the clip
to a short slab seated at the surface. The coin pokes `eps` proud and sinks only
`discDepth = min(areolaR·0.6, surfR·0.35, chestY·0.5)` in (enough to weld under the
hard union), with the cylinder re-centred at `anchor + (discDepth − eps)/2` so its
back face can never exit the torso. `.intersect` and the `eps`-proud flush face are
unchanged, so the areola still reads as the same subtle coin + tiny nipple nub.

Verified by rendering strongman front/side/back at 1100–1200 px before and after
(no rod out the back either way; the front coins read identically) and re-baking
`flexing_strongman.partwright.json` via `build-catalog-entry.cjs`
(`--palette-from-existing`): `isManifold: true`, `componentCount: 1`, all 11 paint
labels including `areola` resolved, `genus: 1` (pre-existing for strongman per #684;
a shorter solid plug cannot add a handle). `lint:catalog` and `typecheck` green.

Confirmed the plug idiom was strongman-only: every other bare-chest figure
(boxer, danseur, lotus_yogi, sprinter_start, sumo, surfer, swimmer, tai_chi_master)
goes through the already-fixed `F.nipples`.

Out of scope by the user's choice, captured as follow-ups rather than fixed here:
the catalog-wide ~200k triangle-budget overflow (every figure is over, chef 430k),
the coily/afro hair texture rendering as a coarse golf-ball relief, and the
raised-bent-knee feet ending in rounded stubs.
