---
session: "export-color-and-unsaved-warn"
timestamp: "2026-06-19T14:33:54Z"
model: claude-opus-4-8
---

## Human

Sometimes when I export several parts together some are missing their color.
Let's create a new PR for the export fix. I'm also wondering if we should warn
people when they try to export without saving — we should be able to export
unsaved models anyway, but people should be alerted and given the option to
click a save button which opens the (multi-part) save modal. [Scope chosen:
one combined PR; warning covers all exports.]

## Assistant

## Key decisions

**Investigated the "missing color on multi-part export" first — and could NOT
reproduce a bake bug on current main.** A repro that exported a session with a
model-colored part (api.label), a flat-painted part, and a smooth/subdividing-
painted part showed ALL colors present in both generic (m:colorgroup) and Bambu
(per-triangle paint_color) 3MF output, and again after a full reload (cold parts
re-baked from saved versions). The recent multi-part 3MF work (#681) composes
each part's model + manual color layers in `bakeColoredMeshForPart`, so the bake
path is sound.

**The real cause is unsaved work.** `bakeColoredMeshForPart` bakes each
NON-current part from its **last saved version** (the current part uses its live
mesh). So a part painted but not saved exports in its older/uncolored saved
state — exactly "some parts missing their color". The fix the user proposed (warn
before exporting unsaved) IS the fix for the symptom.

**Implemented the unsaved-export warning:**
- `exportConfirmModal.ts`: added `unsavedParts?: {count, names}` to
  `ExportWarningInfo`; `hasExportWarning` includes it; the modal renders an
  amber "N parts have unsaved changes" block and a **Save…** button. Return type
  widened from `Promise<boolean>` to `Promise<'export'|'cancel'|'save'>`.
- `confirmExportOrProceed` (main.ts): flags unsaved **non-current** parts
  (`gatherUnsavedParts().filter(status==='unsaved' && !isCurrent)`) — the current
  part exports live, so warning about it would false-alarm on every
  run-but-unsaved single-part export (and would break export-safety.spec). On
  `'save'`, it calls `saveSelectedParts(flaggedIds)` to commit exactly the parts
  the export would otherwise bake stale, then aborts the export (user
  re-triggers). Covers ALL export formats via the shared confirm chokepoint.

**Did NOT change the bake path** (no reproducible bug there). Filed earlier:
#758 (merge/`bakePartComponents` drops color) is a separate, real, distinct path.

**Verification:** new `tests/export-unsaved-warning.spec.ts` (warning shows +
names the part + Save… commits a version for the unsaved part; Export anyway
proceeds). export-safety, save-all-parts, parts suites green; unit 1482;
typecheck + lint:deps clean. Screenshot of the modal shared with the user.
