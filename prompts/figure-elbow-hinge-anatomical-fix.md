---
date: 2026-06-11
branch: claude/hopeful-franklin-6ucma0
files_changed:
  - src/geometry/sdfFigure.ts
  - tests/unit/sdfFigure.test.ts
  - public/ai/figure.md
  - examples/figure_ballerina.js
  - examples/figure_chibi_wizard.js
---

## Human

Continue the figure-quality work from the previous session. Investigate and
take on the next task — chosen scope: fix the deferred elbow hinge direction,
add sculpted hands and hair variants, re-bake the five catalog figures, and
create five new high-quality catalog entries using the combined capabilities.

## Assistant

This commit is the elbow fix — the prior session's "biggest deliberate
deferral." Verified the bug in the math before changing anything: for a
hanging arm `hinge = dir × fwd = [−1,0,0]`, and `rotAxis(dir, hinge, −elbow)`
yields `[0, sin e, −cos e]` — a +Y (BACKWARD) curl, while the comment (and
`public/ai/figure.md`) claimed forward. Same hinge-sign family as the knee
bug fixed in round 5.

Decisions:
- Flip the elbow rotation to the positive angle (anatomical forward curl)
  AND flip the twist roll sign (`−twist · side`) so `twist: 90` still lifts
  a side-raised fist UP. This preserves the documented double-biceps /
  ballet-fifth recipes exactly; only the twist-0 curl direction changes.
  The existing twist unit test passes unmodified.
- Also fixed the degenerate-hinge fallback in BOTH chains: `[side,0,0]`
  doesn't match the continuous limit of `dir × fwd` as flex → 90 (which is
  `[−1,0,0]` for both sides), so the documented sitting recipe
  (`legs flex 90, knee 90`) bent the LEFT knee the wrong way. New
  regression tests cover the forward elbow curl (both sides) and the
  symmetric sitting pose.
- Re-posed examples judged by rendering, not memory: kid reads better
  as-is (relaxed arm now bends naturally forward); warrior + strongman
  are unaffected (elbows 0 / manual capsule arms). Ballerina needed
  `twist: 90` to arc the forearms inward overhead (the doc's own
  ballet-fifth recipe) — genus 0 → 1 because the arm "O" is now a real
  closed loop over the head, an expected handle within the ≤ 2 budget.
- The wizard exposed a latent construction bug: its staff was only
  connected to the figure because the rod incidentally pierced the hat
  brim — the "hand bridge" sphere never reached the rod ~1.2 head-radii
  away. The pose shift broke the accident (componentCount 2). Replaced
  the bridge sphere with a hand→rod capsule grip so the connection is
  structural in any pose.
