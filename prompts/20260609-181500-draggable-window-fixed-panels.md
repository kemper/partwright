---
session: "ibcg08"
timestamp: "2026-06-09T18:15:00Z"
model: claude-opus-4-8
tools: [subagent, playwright]
sequence: 1
---

## Human

When dragging a tool modal, wanted to be able to move it anywhere within the
window, and for it NOT to move around when panes are closed/resized. Same for
the other modals like Customize. Also: put Customize in the Tools dropdown, and
when a parameterizable model is opened for the first time, auto-open the
Customize panel together with the Tools dropdown (the tool list that sits just
above it by default).

## Assistant

## Key decisions

**Window-anchored, not pane-anchored.** The viewport overlay panels (Customize
+ every `createToolPanelShell` tool: Surface, Resize, Place, Quality, …) were
`position: absolute` inside the viewport pane and the drag math clamped them to
the *parent pane*. Switched `viewportPanelDrag.ts` to `position: fixed`
(window-relative): the drag now uses raw `clientX/clientY` and `clampIntoView`
clamps to `window.innerWidth/innerHeight`. This delivers both asks at once —
the panel can be dragged anywhere in the window, and a pane open/close/resize
no longer shifts it (those reflow the pane but fire no `window resize`, so a
window-anchored box stays put). The resize listener is kept only to pull a
panel back on-screen when the *window itself* shrinks. `setInitialPanelPosition`
now docks via window coords (right edge aligned to the toolbar's right edge so
it still tucks under correctly when a side panel insets the toolbar). I set
`style.position = 'fixed'` inline in the drag module so every caller inherits it
without touching their Tailwind classes.

**Customize moved into the Tools dropdown.** It was a standalone top-level pill;
now it's appended into `#viewport-tools-menu` via `viewportToolsMount`, restyled
with the shared `TOOL_TOGGLE_IDLE/ACTIVE` so it reads as one of the editing
tools. The command-palette action and `getParams/setParams` API are unchanged
(no API-parity surface changed — this is pure UI placement + drag behavior).

**Auto-open both on first open of a param model.** `paramsPanel.update()`
already re-opened the panel on a schema change; added an `onAutoReveal` callback
fired in that same branch (and only then — not on manual reopen), wired in
`main.ts` to `openPopoverGroupById('viewport-tools')` (new helper in
`popoverMenu.ts` that calls a live group's `open()`). Ordered it *before*
`applyVisibility()` so the panel docks beneath the now-open menu rather than the
bare toolbar.

**Consistency consequence, accepted:** because the Customize panel lives outside
the Tools popover wrapper, interacting with it (or closing it) lands a
click-outside that collapses the dropdown — identical to every other docked tool
panel. The "way back in" after closing is reopen-dropdown → Customize (plus the
command palette). Updated `customizer.spec.ts` to assert this model, added a
test that a dragged panel is `position: fixed` and stays put across an editor-
pane collapse, and verified both behaviors with screenshots.
