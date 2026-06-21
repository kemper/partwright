---
session: "hopeful-faraday"
timestamp: "2026-06-20T16:38:31Z"
model: claude-opus-4-8
---

## Human

If I've opened a tool menu and switched parts, my tool menu closes. Possibly
because the parts has a "customize" menu but once someone has a menu they've
opened I don't want to close it and want to remember that as the current menu
as they switch parts.

(Clarified scope: ANY viewport tool panel the user has open — not just the
Customize panel — should stay open across a part switch.)

## Assistant

## Key decisions

**Root**: a part switch reloads the part (`loadVersionIntoEditor`) and re-runs
`syncParamsPanel`. The part-load path itself does NOT close the floating tool
panels (it only cancels voxel paint), so the *only* vector that closed an open
menu was the Customize/params panel **auto-revealing** on a schema change:
`paramsPanel.update()` reset `userClosed = false` whenever the schema changed,
and the resulting `openViewportPanel(...)` — through the single-panel
`viewportPanelRegistry` — closed whatever menu the user already had open.

**Fix** (deferral, not a hard suppress):
- Added `getActiveViewportPanel()` to `viewportPanelRegistry.ts` exposing the
  current `active` panel ("the current menu").
- In `paramsPanel.update()`, on a schema change Customize now auto-opens **only
  when no other panel is active** (or Customize itself is the active one). If a
  *different* menu is open, it sets `userClosed = true` and stays closed, so the
  user's current menu survives the part switch. The part's knobs remain
  reachable from the Customize pill (the count still updates).

This preserves the original "first opening a parameterizable model auto-reveals
its knobs" behavior (no panel active on initial load), while honoring an
already-open menu during part switches.

**Verification**: new e2e `tests/menu-persist-part-switch.spec.ts` (open Paint
on a plain part → switch to a parametric part → Paint stays open, `#params-panel`
stays hidden). Manually confirmed in-browser via a throwaway spec + screenshot.
Existing `customizer.spec.ts` (12 tests, incl. auto-reveal) still green; added a
`getActiveViewportPanel` case to the registry unit test. Full unit tier + madge
cycle gate green.
