---
date: 2026-06-18
component: figure footwear (buildFootwear) — derive shoe from foot
---

## Human

ok, do what you recommend. [Implement #747 — derive figure shoes from the bare
foot via an SDF outward offset instead of a from-scratch "last".] Then rebake the
catalog entries as part of 739 to prove it works, be sure to update to the latest
main before starting.

## Assistant

Implements the #747 redesign. Root problem: `buildFootwear` re-built foot geometry
from scratch (ellipsoid "last" + heel cylinder + a third "coverage underlayer"),
which kept drifting from the real foot — heel-jut (#737), club toe, bubble (#745),
chunky uppers.

Restructure:
- Factored the bare-foot shape out of `buildFeet` into `footMassLocal` (the foot
  masses in the local sole frame) + `footPlacement` (the pitched-or-flat world
  placement). `buildFeet` now calls them; standing feet are byte-identical.
- `buildFootwear` is now: `shoe = footMassLocal(...).round(t)` — the SDF parallel
  offset (the primitive behind `surfaceMarking`). The shoe IS the foot grown
  outward by the wall thickness, so it hugs the foot, inherits plantarflexion via
  the shared placement, and is a superset of the foot (the coverage underlayer is
  gone — skin can't poke through by construction). Sole = the lowest `soleThick`
  band of the shoe's own footprint; collar/boot-shaft stay world-anchored.
- "Foot physics" fix the user invited: the plantarflexed foot now flat-clips its
  sole IN THE LOCAL frame before pivoting (in BOTH `buildFeet` and the shoe), so a
  lifted foot has a real flat sole that tilts with it — not a rounded nub. This
  also lets the shoe clip uniformly at −0.14·r.foot (grounded → world ground;
  lifted → tilted), killing the bubble.

Verified: 1483 unit tests green (preflight). Three footwear tests were calibrated
to the OLD wider/longer/taller shoe and to loose `bounds()` (offset+smoothUnion
SDFs report conservative bounds — e.g. a sole actually at z≈groundZ reads as
−2.90); updated them to the new foot-hugging geometry / actual-sampled extents,
preserving intent (welt>flush, toe-tracks-heading, base-contains-sole). Added a
redesign guard: a lifted shoe sits a sole's-thickness under the foot (<0.55·r.foot),
not a ~1·r.foot bubble. Rendered grounded + lifted shoes and rock-climber /
sprinter / soccer / ballerina full figures — clean flat-soled shoes in every pose;
the bare ballerina arabesque foot improved too.

Supersedes the interim #737 (resize) and #745 (flat-sole patch). Catalog re-bake
rides on #739.
