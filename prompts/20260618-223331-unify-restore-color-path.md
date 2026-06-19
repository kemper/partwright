---
session: "beautiful-pascal-z0esff"
timestamp: "2026-06-18T22:33:31Z"
model: claude-opus-4-8
---

## Human

[After a work-reviewer pass flagged that the cache-hit model-color stamp could
render a one-frame mis-colored flash for a model-colored part that also carries
a smooth/subdividing paint stroke] "Let's unify the code path so that we
prevent future cases of similar errors."

## Assistant

## Key decisions

**Why unify:** the previous fix stamped model colors directly in
`loadVersionIntoEditor`'s cache-hit branch — a hand-rolled re-implementation of
the render path. That branch already manually restores mesh/labels/model
regions/params, and any colour state it forgets is a latent bug (this very
class shipped twice). The reviewer also found the stamp could mis-colour for
one frame when the cached coarse `paintBaseMesh` is paired with model-region
indices resolved against the *refined* mesh (a smooth stroke subdivided it).

**The unification:** made `rehydrateColorRegions` the single authority that
finalizes a restored part's colours (model underlay + user paint) for EVERY
load path (cache hit, cache miss, loadVersion, navigateVersion):
- Its no-user-paint early return now renders the model-declared underlay via a
  new `renderModelColorUnderlay()` helper instead of returning without drawing.
- Its main re-render guard widened from `hasColorRegions()` to
  `hasColorRegions() || hasModelColorRegions()`.
- Removed the bespoke model-colour stamp from the cache-hit branch — it now
  just shows the geometry; `rehydrateColorRegions` (already called right after,
  for both branches) applies all colours.

This eliminates the mis-colour flash for free: a model-only part never
subdivides (coarse base aligns with its model indices), and a model+smooth-paint
part goes through rehydrate's full refine/re-resolve path, which renders the
correctly-refined mesh — the premature coarse-base stamp is gone. The
model-only cache-hit case has no `await` before the underlay render, so the
base→coloured updates coalesce in one macrotask (no visible flash).

**Verification:** added a second regression test for the hardest case (in-code
model colour + a subdividing `maxEdge` user stroke through a cache-hit part
round-trip — asserts BOTH layers render). Full colour/paint/parts suite (35
specs incl. parts, model-declared-color, fork-color-carry, surface-paint,
save-all-parts, render-color-readability) green; unit tier 1482 passed;
typecheck clean.
