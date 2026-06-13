---
session: "01XER6"
timestamp: "2026-06-13T13:50:00Z"
---

## Human

When exporting a model, there's a modal window that pops up and says "Warning,
no unit set yet." That modal would make a lot more sense if it gave the user
the ability to set the units in the modal (or leave them unset), in addition to
the warning message, so the user can actually do something right away that might
be more correct. Implement and create a PR.

## Assistant

## Key decisions

**Put an actionable units selector inside the unitless warning block, not a
separate section.** The pre-export confirm modal's "No units set" warning
(`src/ui/exportConfirmModal.ts`) now carries an inline `<select>` (Leave
unitless / mm / cm / in) right under the copy. The select reuses the same
options and persisting `setUnits` call the toolbar Export-menu selector uses, so
a choice made here sticks for the tab exactly like the menu — fixing the
warning where the user hit it instead of forcing a cancel → open Export menu →
re-export round-trip.

**Picking a unit clears the warning live rather than just dismissing it.** A
`syncUnitsBlock()` closure re-renders the block on each change: choosing a
concrete unit flips it from amber warning to an emerald confirmation ("Units set
to mm…") and re-formats the bounding-box dims through `formatDimension`, which
now reflects the just-set unit (e.g. `10.00 mm × 10.00 mm × 10.00 mm`).
"Leave unitless" restores the original warning, so the deliberate-unitless path
is still one click.

**Relax the primary button from "Export anyway" to "Export" once nothing is
wrong.** `updateExportLabel()` reads a precomputed `otherWarning` (manifold /
component / colour / surface-stale) plus the live `unitsResolved` flag, so the
button only says "Export anyway" while a real warning remains. If the unitless
warning was the only issue and the user sets a unit, the button honestly reads
"Export".

**Tests + docs.** Added an e2e case to `tests/export-safety.spec.ts` that drives
the inline selector, asserts the warning→confirmation flip, the mm-formatted
dims, the button label change, and that the choice persists to the toolbar
`#export-units-select`. Updated the modal's header comment. No schema or API
change — this is a pure UI affordance over the existing `setUnits`.
