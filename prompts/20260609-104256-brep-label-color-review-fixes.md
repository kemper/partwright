---
session: "5c6115"
timestamp: "2026-06-09T10:42:56Z"
model: claude-opus-4-8
tools: [work-reviewer]
sequence: 2
---

## Human

(Automated PR review pass via the work-reviewer subagent over the BREP
label color diff, plus the standing instruction to address actionable CI /
review findings on PR #523.)

## Assistant

## Key decisions

The `work-reviewer` found no blocking issues and confirmed color
propagation, the boolean merge direction, shared-Map safety, and
back-compat were all clean. Acted on its one should-fix and two nits:

**Should-fix — Phase C side-channel could leak across runs on the error
path.** `consumeBrepToManifoldLabelColors()` (and the pre-existing
`consumeBrepToManifoldLabels()`) were drained only on the manifold-js
*success* path. A run that called `BREP.toManifold(...)` — queueing
labels/colors — then threw on a later line left them queued, bleeding into
the next run's labelMap/labelColors (generic names like `"body"` collide
across unrelated models). Fixed by draining *both* channels
unconditionally in the `finally` block; on the success path they're
already empty, so it's idempotent. This also closes the pre-existing
`pendingToManifoldLabels` leak with the same one-line change.

**Nit — error-message parity.** Dropped the trailing period from BREP's
`options must be an object...` message so it's character-identical to the
manifold-js `api.label` original.

**Nit — test coverage for the two silent-regression-prone behaviors.**
Added two e2e tests: (1) left/accumulator input wins on a label-name color
collision through `fuseAll`, and (2) a color queued by a throwing run does
not bleed into the next run's `getModelColors()` — which directly exercises
the finally-drain fix.

Verified: `npm run build` ✅, the 6 BREP.label tests green including both
new regressions.
