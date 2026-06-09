---
session: "dzwl3a"
timestamp: "2026-06-08T16:44:00Z"
model: claude-opus-4-8
tools: [explore, playwright]
---

## Human

When painting or using a tool in the interactive view, clicking outside the
model to move/rotate it hides the horizontal tool menu but leaves the
individual tool panel open. Clicking away outside the model shouldn't close
either — you might want to rotate the model while using tools on it. Make
that update and open a PR.

## Assistant

## Key decisions

**Root cause**: `createPopoverGroup` in `src/ui/popoverMenu.ts` registered a
`document` `click` listener that called `close()` whenever the click target
wasn't inside the popover `wrapper`. The 3D viewport `<canvas>` is not a DOM
child of that wrapper, so an off-model click in the viewport (an orbit/rotate
gesture, which OrbitControls handles on `pointerdown`) still produced a
bubbling `click` that the listener treated as "click outside" — collapsing
the Tools launcher row. The active tool's docked panel (e.g.
`#paint-picker-panel`) is controlled separately and stays open, leaving the
inconsistent state the user described.

**Fix**: Guard the click-outside handler so clicks landing on the 3D viewport
canvas (`.viewport-canvas`) are not treated as a dismiss. A viewport click is
a camera/orbit/paint interaction, not a "close the menu" intent, so the menu
(and the tool panel that docks beneath it) stays open. Genuine off-viewport
UI clicks still dismiss the popover, and opening a sibling popover or Escape
still closes it. Scoped the guard to the canvas element specifically (not the
whole viewport container) so clicking other overlay buttons still dismisses,
preserving single-popover-at-a-time behavior.

**Verification**: Added a regression test to
`tests/viewport-toolbar-groups.spec.ts` — opens Tools → Paint, clicks empty
viewport-canvas space with a real mouse, and asserts both the Tools row and
the paint panel remain visible. Used a real `page.mouse.click` (the tour is
pre-dismissed) rather than `dispatchEvent('click')`, since the synthetic
coordinate-less event isn't representative of an orbit click.
