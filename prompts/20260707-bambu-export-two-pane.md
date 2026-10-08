---
session: "export-dialog-cancel"
timestamp: "2026-07-07T14:30:00Z"
model: claude-opus-4-8
sequence: 2
---

## Human

For the Bambu export, make the export options an always-visible right-hand pane,
with the left-hand pane being the current part-list selector (instead of the
options being stacked below the list where you have to scroll to reach them).

## Assistant

## Key decisions

**Two-pane layout is Bambu-only; other formats stay single-column.** The generic
OBJ/STL/GLB/3MF pickers have no options block, so a side-by-side split would just
add empty space. Gated the whole thing on `opts.bambu`: when present, the modal
widens (`widthClass: 'max-w-lg sm:max-w-3xl'`) and the body splits into a
`flex-col sm:flex-row` panes container — part list left, options right; stacked on
mobile, side-by-side on desktop. When absent, `listParent`/`optionsParent` both
fall back to `shell.body` and nothing changes.

**Redirected appends via two parent handles rather than restructuring the
builders.** Introduced `listParent` (header + part rows) and `optionsParent`
(printer/nozzle/filament selects + plate-layout radios) so the existing row/
select/radio construction code is untouched — only where each block *lands*
changed. The left column scrolls internally (`sm:overflow-y-auto sm:min-h-0`) so
a long part list never pushes the options out of view — that's what "always
visible" requires.

**Restyled the selects for a vertical pane.** They were `justify-between` rows
with a `max-w-[60%]` select sized for a wide single column; in a ~256px pane
that's cramped, so they became stacked `flex-col` label-over-full-width-select.
Section headings ("Bambu Studio settings", "Plate layout") became uppercase
pane headers; the old top-border divider on the settings block is now the pane's
own left border, so it was dropped (kept only between settings and plate-layout).

**Test.** Extended the existing Bambu picker e2e with a positional assertion —
the "Bambu Studio settings" heading's left edge is past the part-list header's
right edge — verifying side-by-side layout without coupling to exact Tailwind
classes. Also verified the generic OBJ picker is visually unchanged.

This shipped alongside the export-cancel work already on the branch (same
session); the merge with origin/main resolved a bake-loop conflict (kept
between-parts cancellation + main's per-part group propagation).
