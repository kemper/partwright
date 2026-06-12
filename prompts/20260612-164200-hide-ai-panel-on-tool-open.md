---
session: "elegant-clarke-25f7wu"
timestamp: "2026-06-12T16:42:00Z"
model: claude-opus-4-8
tools: [explore-subagent, playwright]
---

## Human

When opening a customizable model the customization panel pops up over the AI
pane, where it's easy to miss. Hide the AI pane whenever we auto-open the
customization pane — and more generally, hide the AI pane any time the user
opens one of the interactive viewport tools, since once they're using the tools
they're working by hand, not with the AI.

## Assistant

## Key decisions

**Single chokepoint, not per-button wiring.** Every viewport tool panel (Paint,
Voxel/Image paint, Annotate, Surface, Insert, Customize/params, Simplify,
Resize, Place/Orient, Relief, Print Tools, generic ToolPanel) becomes visible
through `openViewportPanel()` in `src/ui/viewportPanelRegistry.ts`. Hooking
there covers the whole family in one place, including the params panel's
auto-reveal for customizable models (`applyVisibility()` → `openViewportPanel`
in `paramsPanel.ts`), which is the user's primary case.

**Keep the registry a dependency-free leaf — wire in main.ts.** The registry is
imported by ~13 panel modules and currently imports nothing. Importing the AI
panel into it would pull a large module in and risk a cycle (the `lint:deps`
gate is strict). Instead I added a tiny `onViewportPanelOpen(fn)` subscriber
list to the registry and registered the subscriber in `src/main.ts` (which
already imports both the registry and the AI panel), matching the repo's
leaf-callback layering pattern. `npm run lint:deps` confirms no new cycle.

**Close-only AI helper.** Added `closeAiPanel()` to `aiPanel.ts` (no-op when
already closed) rather than reusing `toggleAiPanel()`, whose `state` isn't
exported and which would re-open a closed panel.

**Don't stomp on re-asserts.** `openViewportPanel` notifies subscribers only on
a genuine open (`active !== panel`), so a panel re-registering while already
active won't keep closing an AI panel the user may have just reopened.

**Verified** in-browser with a Playwright spec (before/after screenshots) and
landed it as a permanent regression test
(`tests/ai-panel-hides-on-tool.spec.ts`): open AI panel → run a customizable
model → Customize panel visible, AI panel hidden.
