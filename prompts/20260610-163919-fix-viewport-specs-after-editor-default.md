---
date: 2026-06-10
author: kriskemper@gmail.com
title: Fix viewport specs broken by editor-shown-by-default
---

## Human

(Continuation of "AI panel closed by default" — PR #570. CI shard 3 reported two
real e2e failures after the change.)

## Assistant

The AI-panel-closed change flips `editorCollapsed`'s default too (it falls back
to `drawerOpen` via `editorCollapsed ?? drawerOpen`), so a fresh `/editor` now
shows the code pane and the viewport is narrower / shifted right. Two viewport
specs that never open the AI panel relied on the old *AI-open + editor-collapsed*
layout and broke. Both reproduced locally and deterministically; root-caused each
with `elementFromPoint` / visibility probes rather than guessing:

- **`viewport-toolbar-groups.spec.ts`** — "clicking the viewport canvas keeps the
  Tools menu up" clicked `box.x+24, box.y+24` (viewport top-left). With the
  narrower viewport the overlay toolbar's first row reaches down to that point,
  so the probe showed it now lands on `#triangle-count`, not empty canvas — a UI
  click that (correctly) dismisses the Tools menu. Moved the click to the
  bottom-left corner (`box.y + box.height - 24`), confirmed via `elementFromPoint`
  to be `CANVAS#viewport` in both wide and narrow layouts.

- **`viewport-camera-persistence.spec.ts`** — "preserves the camera angle when
  editing code" did `getByText('Show code').first().click()`. The `▶ Show code`
  expander (`#expandEditorBtn`) is *always* in the DOM but `hidden` when the pane
  is shown, so the probe showed `count: 1, visible: false`; clicking a hidden
  element waited out the 30s test budget (surfacing as "Target page has been
  closed"). Guarded the click on `isVisible()`.

These are test-brittleness fixes, not product changes — the underlying behavior
(toolbar click dismisses, empty-canvas click orbits; code pane shown by default)
is correct. Verified all 10 tests in the two specs pass locally.

Also confirmed the earlier shard-3 failure (run 1) was an unrelated transient
`npm ci` ECONNRESET, re-kicked via an empty commit.
