---
session: "89rxW"
timestamp: "2026-06-07T17:10:00Z"
model: claude-opus-4-8
tools: [playwright]
sequence: 2
---

## Human

Make the viewport tool menus behave and look consistent. Specifically:
1. List the Tools submenu buttons horizontally, and have each tool's panel pop
   up just beneath and to the right.
2. Palette opens centered with an overlay and isn't draggable — make it like the
   paint menu (docked right, draggable).
3. Quality opens on top of other panels instead of closing them — all tool
   panels should close the others when opened.
4. Image Paint doesn't close on Escape.
5. Resize/Surface don't have the same grey look as the others.
6. Find and fix any other inconsistencies; make them all consistent.

Confirmed by Q&A: horizontal row with panels docked beneath, right-aligned; and
unify the active toggle accent to blue.

## Assistant

## Key decisions

**One shared standard (`src/ui/toolPanel.ts`).** An audit found every tool hand-
rolled its own shell: backgrounds (zinc-800/95 vs zinc-900), borders, z-indices
(z-20 vs z-[60]), header markup, close glyphs (× vs ✕), hit areas (w-7 vs w-6 vs
none), title sizes, and active accents (blue/pink/emerald). New module is the
single source of truth: `TOOL_PANEL_CLASS`, `TOOL_PANEL_HEADER/TITLE/CLOSE`,
`TOOL_TOGGLE_IDLE/ACTIVE`, `createToolPanelHeader()`, and `createToolPanelShell()`
(the docked-panel equivalent of `createModalShell`, with `{ body, footer, close }`).
Every tool (Paint, Image, Voxel, Annotate, Quality, Surface, Resize, Palette)
was pointed at it.

**Unified mutual exclusion through the existing single-open registry.** Root
cause of "Quality opens on top" and the general inconsistency: Image Paint used
*neither* exclusion registry, and tools only half-closed each other. Fix: route
every panel through `viewportPanelRegistry.openViewportPanel` on open /
`closeViewportPanel` on close. Image Paint now registers; opening any tool closes
whatever else is open. Image Paint also gained an Escape handler.

**Palette: modal → docked panel.** Swapped `createModalShell` for
`createToolPanelShell`; all the palette content code is untouched (same body/
footer/close interface). It's now draggable, right-docked, grey, and part of the
single-open set. Kept it a non-modal `role="dialog"` (aria-modal=false) so the
existing tests stay valid; its Escape defers to any layered modal (the photo
picker). The photo-import flow closes the panel while the picker is up and the
picker's onClose reopens it (mirrors the old single-shell behaviour).

**Horizontal menu + docking beneath it.** `popoverMenu` rows now use
`flex-row flex-wrap w-max` (an abspos flex-wrap box otherwise collapses to its
widest child and stacks). `setInitialPanelPosition` now drops a panel below the
*open Tools menu* (its bottom edge), right-aligned — replacing the earlier
"shift left beside the list" logic from the previous PR, which no longer applies
to a horizontal row.

**Other inconsistencies fixed:** active accent unified to blue (Annotate pink →
blue, Voxel emerald → blue, Quality blue-500/20 → /30); slider/tab accents
sky/emerald/pink → blue; close glyph ✕ → × everywhere; close hit-area unified to
28px; Surface/Resize dropped from z-[60] to z-20 and from `<h2>` titles to the
standard title style.

**Behaviour change flagged to the user:** opening Palette now closes the Paint
panel (per "all tool panels close the others"). Two palette tests were updated
to reopen Paint / drop a now-redundant close. Surfaced for confirmation in case
Palette should instead be exempt (it's Paint's companion editor).

**Tests:** new `tool-panel-consistency.spec.ts` (mutual exclusion, docked
non-modal palette, Escape); updated `paint-palette.spec.ts` for the docked
palette + exclusion. Verified the full paint/voxel/annotate/simplify/surface/
resize/image/relief/command-palette e2e set (180+ specs) green.
