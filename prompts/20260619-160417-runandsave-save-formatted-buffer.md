---
session: "export-color-and-unsaved-warn"
timestamp: "2026-06-19T16:04:17Z"
model: claude-opus-4-8
---

## Human

[CI on #760 failed: threemf-multipart's part-picker test never saw the picker
because the new unsaved-parts warning intercepted it — the parts, saved via
runAndSave, read as "unsaved" due to #764.] Fold the #764 fix into this PR.

## Assistant

## Key decisions

Root cause (#764): `runAndSave(code)` does `setValue(code)` (which auto-format
normalizes) then `runCodeSync(code)`, but saved the **raw `code` arg** as the
version. With auto-format on, the editor buffer (`getValue()`) no longer equals
the saved `version.code`, so `versionMatchesCurrent` → `currentPartIsDirty`
reports a just-saved part as unsaved. That false positive tripped the new
export warning and blocked the multi-part 3MF picker test.

Fix: save `getValue()` (the normalized editor buffer) instead of the raw `code`
arg in `runAndSave`. Geometry is unaffected (it ran from `code`; auto-format is
whitespace-only), and `version.code === getValue()` so the part reads clean.
Swept tests — none assert runAndSave persisted the exact unformatted arg (they
read `getCode()` or check counts/labels), so no test churn beyond the win.

Verified: the previously-failing `threemf-multipart` part-picker test passes,
plus export-unsaved-warning, export-safety, parts, save-all-parts (27 specs).
Closes #764.
