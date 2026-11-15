---
session: "01QnZG"
timestamp: "2026-11-15T04:05:00Z"
model: claude-sonnet-5-5
---

## Human

main is failing CI please fix

## Assistant

## Key decisions

**Triage**: The red "Gate main → staging" run had exactly one failing e2e test (shard 7, `annotation-views.spec.ts` "Attach to AI" click: "element is outside of the viewport"). The commit that went red only touched a script, settings and a prompt log, so it was an intermittent app/layout problem, not a regression from that commit.

**Root cause**: The annotate panel is `position: fixed` and grows when a saved view adds a History row. `clampIntoView` only ran on drag-end and window resize, so a taller panel could extend past the window bottom and clip its buttons.

**Fix**: Keep the drag handle returned by `attachViewportPanelDrag` and call `clampIntoView()` at the end of `renderHistory()`. Reused the existing helper rather than adding new clamping logic. The spec passes locally; the flake itself could not be reproduced locally, so CI is the confirmation.
