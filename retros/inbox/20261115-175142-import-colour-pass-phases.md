---
date: "2026-11-15T17:51:42Z"
task: "feat: show a big import's colours as a named pass instead of a blocking modal"
pr: 1264
areas: [import-export, ui, testing]
cost: medium
---

## Liked / Worked
- Recording status-line text with a MutationObserver that stamps each change on the next `requestAnimationFrame`, next to a 25 ms heartbeat, showed exactly which label was on screen when each stall began. Polling from Playwright can't: it is blocked by the same stall.
- `withSyncReconcile` already existed for "mutate several regions, repaint once"; using it removed two redundant coloured-mesh builds with no new machinery.
- The `work-reviewer` pass caught what removing a modal really means: the modal had been the only thing keeping the editor still during an awaited phase.

## Lacked
- `setValue(code)` can auto-format, so `getValue() !== code` right after it. My first "has the editor moved on" check compared against the unformatted text and failed every add-to-object import. (cost: one failed e2e round)
- The inline status line has several writers (run timer, surface timer, now import phases) and no owner. Each writer has to know about `_running` and the others' timers by hand.
- Software WebGL in the container makes "how long does the coloured mesh take to draw" unanswerable; about 4 s of a 7 s stall was draw time that a real GPU may not have.

## Learned
- Each `addRegion` notifies the reconcile listener, whose first tick runs synchronously up to `paintedColorRefresh`. Seeding N regions then calling `updateMesh` yourself builds the coloured geometry N+1 times or more. Wrap batches in `withSyncReconcile`.
- A status label set right before blocking work never paints. It needs a frame first (`afterNextPaint` in `src/ui/afterPaint.ts`), and that wait needs a timeout because frames can stop without `document.hidden`.
- Adding a field to `AppConfig` needs four places: the type, the defaults, `appConfigBounds.ts`, and the Advanced Settings `<Field>`. `tests/unit/appConfigApi.test.ts` fails if the bounds table and the modal drift. CLAUDE.md lists only three.

## Longed for
- A single owner for the viewport status line: `statusLine.claim(owner, label, { cancel })` returning a release function, with a fixed precedence (run > texture > import phase), so new phases can't overwrite a run's status or hide its Cancel.
- A `busy` guard for the editor and object list that leaves the viewport orbitable, for awaited phases that must not be interleaved with edits. Today the choice is a full modal or nothing.
