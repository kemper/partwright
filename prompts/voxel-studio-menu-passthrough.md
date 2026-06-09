---
date: 2026-06-09
branch: claude/voxel-studio-menu-paint-bug-ogaliz
files_changed:
  - src/color/voxelPaint.ts
  - tests/voxel-studio-menu-passthrough.spec.ts
---

## Human

In Voxel Studio on mobile, interacting with the menu (with the paint tool
selected) turns finger presses into paint splotches on the model behind the
menu. Presses on the menu shouldn't pass through and edit the model. Please fix.

## Assistant

Root cause: `voxelPaint.ts`'s `onPointerDown`/`onPointerMove` are registered on
the viewport *container* in the CAPTURE phase (so they beat OrbitControls'
suppressor). That means they also fire for presses on the floating Voxel Studio
panel, which is an overlay sibling of the canvas inside the same container.
`onPointerDown` went straight to `pickFace(event)`, which raycasts purely from
`clientX/clientY` against the canvas rect — ignoring which DOM element was
actually pressed — so a tap on a menu button raycast onto the model behind it
and painted. `setPointerCapture` then bound the pointer to the canvas, so a drag
across menu buttons kept stamping.

`paintMode.ts` already had the correct guard for the identical overlay problem
(`if (event.target !== getRenderer().domElement) return;`). The fix mirrors it:
bail out of the voxel `onPointerDown` when the press didn't land on the canvas.
`onPointerMove` needs no separate guard — it only edits while `strokeActive`,
which is only set by a stroke that started on the canvas, so a press that bailed
early can never begin one.

Verified with a Playwright spec that dispatches a `pointerdown` whose target is
a panel button but whose coordinates are over the model: the live grid size is
unchanged after the menu tap, and a positive control (same gesture targeting the
canvas) still adds a voxel. Confirmed the spec fails (9261 → 9262) when the guard
is removed, so it's a real regression guard. All 19 existing voxel specs pass.
