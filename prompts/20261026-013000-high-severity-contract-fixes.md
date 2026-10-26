---
session: "vibrant-heisenberg-56kfpk"
timestamp: "2026-10-26T01:30:00Z"
sequence: 2
tools: [playwright]
---

## Human

After a bug sweep (three audit agents; findings filed as #1134): "yes, fix the
high-severity ones in one PR" — "but also fix the other in a follow up PR".

## Assistant

## Key decisions

**Paint `scope` → `withinPart`, not a second scope param.** The AI tool layer
still injected `scope: {label}` into 12 paint tools, but its main.ts wrapper
was removed when paint moved to `withinPart`, so the value was dropped and the
paint ran unscoped. 11 of the 12 tools already expose `withinPart` and the
part-selection prefix already tells the model to use it, so the injection is
removed rather than revived. A replayed legacy `scope` from an older chat is
mapped onto `withinPart` in `executeTool` (and a clash with an explicit
`withinPart` errors). `paintComponent`, the one tool without `withinPart`,
gains it on both the schema and the console API.

**One camera default, budget-sized probes.** renderView's tool label claimed
azimuth 0 while the camera defaults to 315, and probePixel/probePixels assumed
500 px while renders default to the spending-mode budget. Kept the rendering
defaults (changing them would move every existing view) and fixed the
reporters: shared `DEFAULT_VIEW_AZIMUTH/ELEVATION` constants from
`multiview.ts`, and the probes now default to `getRenderBudget().defaultPx`, so
"omit size on both" probes the image that was rendered.

**Session open goes through the full version loader.** `partwright.openSession`
and the session-list modal (row click and Import) did `setValue + runCode`,
leaving the previous session's paint/annotations/params live — verified in a
browser first. Both now call `loadPartIntoEditor(version)`, the same loader the
URL router uses; the session-list callback takes the `Version` instead of its
code. `createSession` keeping the editor's paint was left alone: it keeps the
current code too, so paint following the code is consistent.

**Share link: export only the current object.** Added `onlyCurrentPart` to
`exportSession` (re-tags that object as order 0) instead of post-filtering in
`buildShareLink`, so the version/part bookkeeping stays in one place.

**Proof:** `tests/ai-contract-fixes.spec.ts` — all five tests fail on
`origin/main` and pass on the branch.
