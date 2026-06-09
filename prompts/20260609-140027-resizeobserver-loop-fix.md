---
date: 2026-06-09
prefix: fix
---

## Human

"I sometimes see an error: 'ResizeObserver loop completed with undelivered
notifications.' can you investigate and fix?"

## Assistant

Investigated the two app-level `ResizeObserver` instances. The viewport
observer (`src/renderer/viewport.ts`) only resizes the WebGL drawing buffer
via `renderer.setSize(w, h, false)` (`updateStyle=false`), so it never changes
the observed element's box and can't loop. The culprit is the hints ticker
(`src/ui/hints/hintsTicker.ts`): its observer callback synchronously mutates
layout — toggling `display`, reparenting/restyling between single- and two-row
arrangements, and reading `offsetWidth` in `measureSingleNeeded()`. When that
work doesn't settle in one frame the browser raises the "undelivered
notifications" notice. That intermittency matches the "sometimes" in the report.

Two changes:

1. **Source fix** — the ticker's `ResizeObserver` now coalesces to one
   `requestAnimationFrame`-deferred `relayout()` per frame instead of mutating
   layout inside the observer's delivery tick. Running the mutation outside the
   tick is the standard way to break the loop. The rAF handle is cancelled in
   `teardownStrip()` so a torn-down strip can't relayout.

2. **Defense-in-depth** — this notice is a benign, unpreventable browser
   message that can also originate from observers we don't own (CodeMirror,
   Three.js helpers) and carries no stack. Filtered it out of the global
   `window 'error'` handler in `src/diagnostics/errorLog.ts` so it stops
   polluting the Diagnostic Log and raising the unseen-error badge over real
   failures.

Verified with `npm run build`, `npm run test:unit` (856 pass), and a scratch
Playwright spec that thrashes the editor viewport width across seven sizes
while listening for the message — zero occurrences.
