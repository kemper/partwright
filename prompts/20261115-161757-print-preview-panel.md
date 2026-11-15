---
session: "5ecjfq"
timestamp: "2026-11-15T16:17:57Z"
sequence: 9
---

## Human

Proceed with the layer-colour print preview using best judgement; the owner
will test what gets built.

## Assistant

## Key decisions

**A docked Inspect tool, not a modal.** The preview is something you look at
while orbiting the model, so it uses the shared tool-panel shell (draggable,
Escape closes, one panel open at a time) and sits in the Inspect menu next to
Print and Cross-section. It is registered with the tool registry and the
command palette, so `partwright.openTool('tool-print-preview')` and the
palette open the same panel.

**Edits preview from a draft and reach the code only on Apply.** Writing every
tweak to the code would re-run the model and save a version per slider nudge.
The panel keeps a draft, the app previews the draft instead of the code's own
colours, and Apply makes one code edit, one run and one saved version. Revert
and closing the panel discard the draft.

**The slider is in layers, like a slicer's.** It shows "45 of 120, 9 mm" and
maps to the same `setPrintPreview({ layer })` call agents use. Rebuilds are
throttled to one per animation frame so a heavy model can't be re-cut per
pixel of drag.

**The panel calls the public API, nothing private.** Its handlers are thin
wrappers over `setPrintPreview`, `setLayerColors` and `clearLayerColors`,
which keeps the UI and the agent surface in step by construction.

**Non-JavaScript sessions can look but not edit.** The colours live in
manifold-js code, so for other languages the list is disabled with a line
saying why, rather than hiding the tool.

**What I left.** The Inspect popover stays open behind the panel, and the
toolbar's triangle counter shows the preview mesh's count while the preview is
on. Both are cosmetic.
