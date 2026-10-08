# Retro — conformal surfaceMarking/surfaceRecess helpers (PR #741)

4-Ls from generalizing the areola fix into reusable engine helpers + migrating nipples/navel/brows.

## Liked
- **The design discussion before coding paid off twice.** Articulating *why* one helper can't cleanly do both proud and recessed (a carved void can't carry a paint label — colour rides positive unioned nodes) surfaced the real boundary, and the user landed on two-helpers from that. Verifying the "void can't be labeled" claim in the code (the teeth-through-cavity pattern) before asserting it kept me honest.
- **work-reviewer caught a regression I'd have shipped.** I migrated brows and tested *one* figure (expectant_mother, painted top-level brows) — but `assembleFace` passing `on: result` also flipped ~50 *in-assemble* brows to a proud strip. Those flatten to skin and are meant to be flush, so it'd have added an unwanted ridge everywhere. The review's blast-radius check turned a 1-figure experiment into a safe opt-in.

## Lacked
- **A habit of checking every call site of a shared path before changing its default.** I reasoned about the feature I was demoing, not the 50 other callers of `assembleFace`. The general rule: when you thread a new param into a shared builder and default it on, enumerate who already calls that builder and whether the new behavior is wanted there — *before* the reviewer does.
- A fast way to tell "does this change alter the baked output of figure X?" without a full bake. The nipple/navel migrations were provably identical (pure refactor), but proving the brow blast radius meant reasoning about the label-weld flow by hand. A stat-diff harness (ties to #732) would make "did this geometry change?" a command, not an argument.

## Learned
- `.round(r)` (SDF `f − r`) is the engine's conformal-offset primitive and it's the right tool for any "thin layer hugging the real surface" feature — markings via `round(+) ∩ region`, and it's distinct from recess (`subtract`), which is a different mechanism, not a sign flip, because of labeling.
- "Proud vs flush" for a marking isn't cosmetic — it's coupled to *whether it gets painted*. A painted marking must stand proud (own its triangles); an unpainted/flattened one should stay flush. The same helper serves both, but the call site has to choose relief by that criterion. That's exactly why blanket-applying the proud path to skin-flattened brows was wrong.

## Longed for
- The #732 catalog-freshness / stat-diff gate, again — it would have answered the blast-radius question mechanically.
- A lightweight "call-site census" affordance (even just `npm run ag` patterns I keep handy) for "who calls this builder and with what" when changing a shared figure function's defaults.
