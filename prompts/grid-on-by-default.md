---
date: 2026-06-28
branch: claude/nifty-cray-33fbbz
files_changed:
  - src/renderer/viewport.ts
  - src/ui/layout.ts
---

## Human

let's have grid mode on by default

## Assistant

The grid plane is a `THREE.GridHelper` built in `viewport.ts:makeGrid` and
toggled by the `#grid-toggle` viewport pill. Two coupled places were forcing
"off":

1. `makeGrid` set `g.visible = false` so every fresh build (initial scene + every
   theme rebuild path) hid the grid.
2. The pill in `layout.ts` was constructed with the neutral inactive styling
   and a "Show grid plane" tooltip, so even if step 1 were changed alone the
   button would have lied about state on first paint.

Both flipped. `makeGrid` now leaves `visible` at the `GridHelper` default
(true), and the pill is built with the same active blue styling + "Hide grid
plane" tooltip that the already-on-by-default `dimensions-toggle` uses one line
below — keeping the visual convention consistent. `initGridToggle`'s click
handler in `main.ts` already drives the active/inactive swap on click, so no
change there.

Comment "hidden by default" updated to "visible by default" to match. No
existing test pinned the off-by-default state (`paint-controls-extended.spec.ts`
and `viewport-toolbar-groups.spec.ts` both just check the button is present,
not its title or initial visibility).
