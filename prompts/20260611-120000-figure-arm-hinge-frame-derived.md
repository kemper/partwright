---
session: "013dvTpargwH8BdswvoY7352"
timestamp: "2026-06-11T12:00:00Z"
model: claude-opus-4-8
---

## Human

Reviewed the state of the figure API and asked what to work on next, then
chose: migrate the elbow hinge to the frame-derived form (the same fix the knee
got), re-tune the affected figures' arms, rebake the catalog, and resolve the
leg-twist no-op — all in one session.

## Assistant

## Key decisions

**Arm hinge — frame-derived, not `cross(dir, fwd)`.** The elbow hinge was still
the cross-product form the knee was migrated away from. Reproduced the
instability directly: as a forward-reaching arm crosses horizontal (`flex → 90`)
with small `abduct`, the cross product's magnitude collapses (to ~0.17, never
tripping the `1e-4` fallback) and its direction swings through the pole — the
hinge X-component flips sign across `flex 85→95`, so a bent forward-punch curled
in a pose-dependent wrong plane. Replaced it with `rotX(rotY([-1,0,0],
-side*abduct), -flex)` — the rest axis carried through the bone's own rotations,
exactly like the knee. Proved algebraically that this axis is ⟂ to the
upper-arm direction for all abduct/flex, and numerically that it equals the old
form wherever `abduct` OR `flex` is ~0 (every neutral / side-raised / hanging /
forward / overhead pose). All 58 pre-existing unit tests — including the
twist/double-biceps recipe — passed unmodified, which was the design goal.

**Leg twist — implemented as hip turnout, not rejected.** `leg*.twist` was
parsed and validated but never read by `legChain` (a silent no-op — the worst
state). Implemented it: it rolls the knee-bend plane about the thigh axis (so a
bent knee turns out — plié) and yaws a new per-foot heading `rig.dir.footL/R`
outward (toe toward +X on the left, −X on the right). `buildFeet` now orients
toe/heel/instep along that heading instead of a hardcoded −Y. `twist: 0` yields
the identical foot geometry as before, so the nine non-ballet figures don't
regress. Chose turnout over rejection because the ballerina/karate poses
genuinely benefit.

**Regression tests added.** One asserts the elbow hinge stays a stable lateral
axis across `flex 85/90/95` (no sign flip, |Δ| < 0.1) and curls a forward arm
UP — the arm-edition of the knee's frog-sit regression. One asserts leg twist
yaws the feet out symmetrically and shifts a bent knee, so it can never silently
revert to a no-op.

**Catalog re-tune + rebake follows on this branch (next phase).** The frame
hinge changes any arm with BOTH large `abduct` and `flex` and an elbow bend —
confirmed on karate, whose chambered "fist at the hip" now folds up toward the
shoulder. The affected figures' arm angles need re-tuning to restore the
documented pose intent, then their catalog entries rebaked (palettes recovered
from each entry's existing `colorRegions`). This commit is the engine + tests +
docs; the example re-tune and catalog bakes land in follow-up commits.
Unaffected (flex≈0 or elbow 0, or manual arms): ballerina, strongman,
warrior_pose.
