---
date: "2026-06-12"
task: "feat: separate paintable sole + F.ground (plant/IK-drop) so feet stand level on a surface"
pr: 634
areas: [figure, sdf, docs, catalog, tests]
---

## Human

The soles are extruded blocks, not a real sole object (should be a bit larger, look like a sole, often a different/darker color — sometimes same as the shoe). The feet/shoes are also at different heights — when standing on a surface both soles should be on the same level. We're missing a connection API: "the bottom of shoe X and Y connect to the top of surface Z." Do it all in this PR; sole on by default, different (darker) color, identical-to-shoe in some cases. I trust your judgement.

## Assistant

Two-part change.

**Separate sole (default on).** Confirmed in sdf.ts that the OUTERMOST `.label()` wins and nested labels are ignored — so a sub-region sole can't survive a caller's outer `.label()`. So footwear now OWNS its paint regions (like `F.face.eyes`): the upper carries `label` (default 'boots'/'shoes') and the sole is its own region (default label 'sole'), wider than the upper (overhang lip), flat-bottomed, clipped to sit on the ground plane while the upper is clipped to sit above it (they overlap to weld). `sole: false` folds it in; `sole: { label, thickness, overhang }` tunes it (label:'boots' = same colour). Callers must NOT add `.label()` now — documented. Superhero palette gets a dark `sole` colour.

**`F.ground(rig, { mode, surface?|z?, tolerance? })` — the connection API.** Rig-level (returns a new rig) so feet/footwear/base all derive from the shared plane and can't drift. `'plant'` levels near-plane feet onto the plane (sole thickens to reach) and leaves far feet lifted; `'drop'` re-poses each leg with **2-bone IK** (hips fixed, bone lengths preserved) so every foot lands on the plane. Superhero uses `'drop'` so the popped-knee foot comes down and both soles are coplanar on the base.

**Base fix for visibility:** reduced the base weld lip to 0.32·foot (below the sole's 0.5·foot height) so the coloured sole shows above the disc rim instead of being swallowed.

Verified in color from front, low-front (sole visible) and underside (clean, no skin): both feet level, distinct dark sole, one component, isManifold. 1297 unit tests pass (added sole-region + ground plant/drop/IK-bone-length tests). Rebaked superhero (13 labels incl. 'sole'). Docs in figure.md.
