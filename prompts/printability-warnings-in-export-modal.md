---
title: Surface printability warnings in the export confirm modal
date: 2026-06-19
---

## Human

When exporting a model with a printability issue, the warning shows up only as a
very brief toast at the bottom. But the export already pops a modal that warns
about (e.g.) units not being set. I expected the printability warnings to live in
that modal too. Please make that change.

## Assistant

The export flow had two disconnected printability surfaces:

- `confirmExportOrProceed` → `showExportConfirm` (the modal), which only knew about
  unitless / non-manifold / multi-component / colour issues.
- `warnIfNotPrintable`, which ran the richer `analyzePrintability` (bed fit,
  overhangs, thin walls, small features, tip-over stability) **after** the modal
  and dumped the result into a single fleeting toast.

Decision: fold the design-for-print analysis into the modal and drop the toast,
so the user reads the findings in a dialog they dismiss deliberately.

- Added `printabilityChecks?: PrintabilityCheck[]` to `ExportWarningInfo`. It
  carries only `fail`/`warn` checks and **excludes** the `manifold` check, which
  the modal's existing isManifold block already covers (avoids a duplicate
  watertight line).
- `hasExportWarning` (modal-open gate) now also fires on these checks, so a model
  whose only problem is e.g. bed fit or overhangs now opens the modal instead of
  silently toasting.
- New modal block renders the checks as a bulleted list: red "Printability
  blockers" styling when any `fail` is present, amber "Printability warnings"
  otherwise, blockers listed first.
- Renamed `warnIfNotPrintable` → `exportPrintabilityReport` (returns the report,
  no side effect) and wired it into `exportWarningInfo`; removed all five
  post-confirm `warnIfNotPrintable(...)` toast calls (GLB/STL/OBJ/3MF×2).

The run-time disconnected-components toast (engine source, fired on run) is a
separate path and was left untouched, so `printability-toast.spec.ts` still
passes. Added an `export-safety.spec.ts` case: a 300mm bar (overruns the 256³
bed) with units set to mm opens the modal solely on the bed-fit blocker.
