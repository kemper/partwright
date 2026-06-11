---
date: 2026-06-11
branch: claude/3d-modeling-performance-gap-57lm3d
files_changed:
  - src/config/appConfig.ts
  - src/ai/historyElision.ts
  - src/ai/chatLoop.ts
  - src/geometry/geometryHeuristics.ts
  - src/geometry/statsComputation.ts
  - src/main.ts
  - src/ui/advancedSettingsModal.tsx
  - public/ai.md
  - tests/unit/historyElision.test.ts
  - tests/unit/geometryHeuristics.test.ts
---

## Human

Asked why AI models produce wondrous 3D *games* instinctively but need heavy
micromanagement to produce correct 3D *models* in this app — and whether the app
can be changed so future AI sessions benefit. After two rounds of grounding the
answer in the codebase (the user pushed back: "this is meant to be an app driven
by AI agents," which correctly killed my first naive prescription of forced
auto-render + hard validity gates — those fight the app's deliberate
vision-rationing cost model). Then: "implement your full set of recommendations
as one PR but also test/validate each."

## Assistant

The framing that survived research: a 3D game keeps the *discriminator* in the
human's free, continuous eyeballs; this app tries to relocate it into the agent,
under a vision budget the game never pays (renderView is the most expensive tool,
and images compound in context — the reason the CLI uses the model-sculpt
subagent). So the right levers REDUCE the need to look or borrow the human's free
glance, rather than forcing more (expensive) vision.

Four changes, each aligned with the cost model rather than fighting it:

1. **(Dropped after review.)** Originally an annotation-push signal (per-turn
   suffix + getSessionContext enrichment). The user pointed out that few people
   use the Annotate tool, so the channel is low-traffic — and the high-traffic
   version of the same "borrow the human's free judgment" insight already exists
   (the user typing "the arm's too thin" into chat already reaches the agent).
   Reverted the code; kept the docs honest. The two changes below help EVERY
   session regardless of feature usage and are the real wins.

2. **Numeric "free-vision" warnings** (`geometryHeuristics.ts` new leaf,
   `statsComputation.ts`, `main.ts`). The headless model:preview already emitted
   sub-extrusion edge length, triangle budget, aspect ratio, and interpenetration
   warnings; the in-app agent was blind to all of them. Extracted the math into a
   pure, dependency-free leaf (delegating overlap to the existing `bboxOverlap.ts`)
   so both audiences share it. `computeGeometryStats` now emits `minEdgeLength`,
   `meanEdgeLength`, `aspectRatio`, and `componentsInterpenetrate` (reusing the
   decompose() already paid for), and `geometryWarnings()` appends the heuristic
   strings. These are cheap signals that substitute for a render.

3. **Stale render-image elision** (`historyElision.ts` new, `chatLoop.ts`). Render
   snapshots were re-sent to the provider every turn, compounding image tokens.
   `elideStaleToolImages` keeps the most-recent N (config `keepRecentToolImages`,
   default 3) and drops the rest from the *request only* — persisted/displayed
   history is untouched, and dropping the optional `image` field never breaks API
   turn structure, so it's provider-agnostic at the single streamTurn chokepoint.

4. **Docs over redundant examples.** The original idea (golden few-shots) turned
   out largely redundant — `figure.md`/`mechanisms.md` already ship complete
   runnable examples. So instead I documented the *new* agent-facing behavior
   (required by the UI↔API parity rule anyway): the new stat fields + warnings in
   `ai.md`, and the annotation-push in `annotations.md`.

All new tuning constants live in `appConfig` (`ai.keepRecentToolImages`, new
`geometry` section) and are exposed in the advanced settings modal.

Validation: three new unit suites (elision idempotency/no-mutation/keep-N,
heuristic thresholds + stride-aware edgeStats, annotation formatter) — full unit
tier 1071 pass; typecheck + production build clean; madge acyclic (new leaf edges
introduce no cycle); dead-code gate clean. Browser-verified with throwaway specs:
a 1×1×40 sliver surfaces `aspectRatio: 40` + the aspect-ratio warning in both
`getGeometryData().warnings` and `getSessionContext().geometryWarnings`, a pushed
text annotation appears in `getSessionContext().annotations`, and the new
"Geometry warnings" settings section renders.
