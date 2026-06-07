---
session: "89rxW"
timestamp: "2026-06-07T15:30:00Z"
model: claude-opus-4-8
tools: [playwright]
sequence: 1
---

## Human

The viewport controls were recently collapsed into pop-open menus (View /
Inspect / Tools). Two changes wanted:

1. Take the buttons that just *change the view* out of the View menu and put
   them back directly on the interactive viewport, the way they used to be.
2. For the menus that stay (Tools, etc.), opening a submenu/tool from the list
   shouldn't close the list — so switching tools doesn't cost an extra click.
   The list should close only by clicking the button that opened it, opening
   another menu, or clicking away. Open to other suggestions.

## Assistant

## Key decisions

**Dissolve the View menu → direct pills.** All four View-menu items
(`wireframe`/`grid`/`dimensions`/`orbit-lock`) are pure view-state toggles, so
they move out of the popover and back onto the bar as one-click pills next to
Reset View. The View popover is removed entirely. Button ids are unchanged, so
the toggle-wiring in `main.ts` (which only ever finds them by id) is untouched.

**Make the surviving popovers sticky.** Dropped `closeOnSelect` from
`popoverMenu.ts` — after the View menu's removal no caller wanted close-on-
select, so the option and its delegated-click branch were dead. Inspect and
Tools now stay open when you click an item; they close on the group button, a
sibling popover (the existing single-open sweep), click-outside, or Escape.

**The wrinkle that needed a design call.** Verified the sticky Tools menu in the
browser and found that floating-panel tools (Paint, Annotate, Image, Voxel,
Quality, Surface, Resize) open in the *same* top-right spot as the Tools
dropdown, so the now-sticky list was visually covered — the stickiness bought
nothing for those tools. Surfaced this with before/after screenshots and asked;
the user chose "shift the panels left so they sit beside the open list."

**Shift docked panels beside the open list.** Added `panelDockRightOffset()` to
the shared `viewportPanelDrag.ts`: panels normally hug the right edge (8px), but
when `#viewport-tools-menu` is open on desktop they shift left by the menu's
width + gap so both stay visible. `setInitialPanelPosition` is the single
chokepoint for 8 of the 9 docked panels, so they all inherit it. Image Paint is
the outlier (it positions via its own Tailwind classes + drag logic), so its
`openPanel`/`closePanel` apply/clear the same offset inline (desktop +
undragged only; mobile stays a bottom sheet, dragged panels keep their spot).
Palette manager is a centered modal, so it's unaffected. Verified with a probe
that measured zero menu/panel overlap and that one click switches tools from the
still-open list.

**Tests.** Rewrote `viewport-toolbar-groups.spec.ts` (display toggles now direct
and visible; no View group; Inspect/Tools assert sticky behavior + single-open
across siblings) and updated `paint-controls-extended.spec.ts` (the edge/grid
toggle test no longer opens a View popover).
