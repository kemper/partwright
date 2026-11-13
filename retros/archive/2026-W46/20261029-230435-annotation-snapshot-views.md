---
date: "2026-10-29T23:04:35Z"
task: "feat: snapshot annotation views with camera, history and attach-to-AI"
pr: 1210
areas: [annotations, storage, ai-tools, testing]
cost: medium
---
## Liked / Worked
- The existing session plane already gave camera-flat drawing, so "Snapshot"
  could reuse pen/text/select and just add a draft layer + capture.
- work-reviewer caught a real cross-session leak (drafts surviving
  loadAnnotations([]) at every session/object boundary) and a redo wipe from
  the transient "no mode active" gap during sub-mode switches.

## Lacked
- No e2e had ever drawn on the viewport with the mouse; the first attempt
  failed because the Annotate panel stretched to ~720px over the canvas
  center (a pre-existing layout bug nobody had noticed).

## Learned
- The renderer canvas IS #viewport (`canvas#viewport`), not a child of it.
- Annotate sub-mode activation deactivates the old mode before the new one
  sets active, so "panel closed" observers fire mid-switch. Defer any
  close-side effect to a microtask and re-check.
- ai.md sits ~at its 168k-char ceiling; even a one-line console-API addition
  can trip aiContextBudget. Put new API detail in the subdoc from the start.

## Longed for
- A `tests/helpers/viewport.ts` with `drawOnViewport(page, points)` and
  `waitForEngine(page)` — every spec re-implements waitForEngine.
