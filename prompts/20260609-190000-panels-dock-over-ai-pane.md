---
session: "ibcg08"
timestamp: "2026-06-09T19:00:00Z"
model: claude-opus-4-8
tools: [playwright]
sequence: 3
---

## Human

(Follow-up on PR #540.) When the AI pane is open, have the tool/Customize panel
appear over top of it by default rather than aligning to the right of the
interactive viewport pane — people using tools manually don't need the AI pane
visible.

## Assistant

## Key decisions

**Dock to the window's right edge, not the viewport pane's.** `setInitialPanelPosition`
was aligning the panel's right edge to `#clip-controls`' right edge, which is
inset to the left of the docked AI column when it's open — so panels tucked
*beside* the AI pane. Changed it to dock at `right: PANEL_EDGE_GAP` from the
window edge. When the AI pane is closed this is unchanged (the viewport pane
already reaches the window edge); when it's open, the panel now overlays the AI
column.

**Z-order already works — no layering change needed.** The desktop docked AI
panel (`#ai-panel`) is a normal flex child with `position: relative` and no
`z-index`, so it does *not* establish a stacking context; the `fixed z-10/z-20`
tool panels paint on top of it. (The mobile full-screen AI overlay is
`fixed inset-0 z-40`, but that's a distinct mode where manual tool use over the
drawer isn't the scenario, and the stacked mobile layout docks at the window
edge anyway.) Confirmed visually with a screenshot.

Added an e2e test (`customizer.spec.ts`) that opens the AI panel, runs a param
model, and asserts the Customize panel's right edge hugs the window edge and
extends over the AI column. All 11 customizer specs green.
