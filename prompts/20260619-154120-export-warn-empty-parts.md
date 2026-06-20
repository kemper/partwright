---
session: "export-color-and-unsaved-warn"
timestamp: "2026-06-19T15:41:20Z"
model: claude-opus-4-8
---

## Human

I want "untouched starter parts" to be considered as unsaved parts for the sake
of the [export] warning.

## Assistant

## Key decisions

Brand-new "+" parts that were never saved have status `'empty'` in
`gatherUnsavedParts` (no version, buffer still starter code). A multi-part
export SKIPS them entirely (`bakeColoredMeshForPart` → `getLatestVersion` →
null), so the user gets a file silently missing those parts — worth warning
about.

Broadened the export warning filter from `status === 'unsaved'` to
`status === 'unsaved' || status === 'empty'` (only fully-`'clean'` parts are
omitted). Updated the modal copy: "N parts aren't saved … parts that were never
saved are skipped entirely." The Save… action already commits all flagged parts
via `saveSelectedParts` (an empty part's starter geometry is saved as its v1).

Note this means a brand-new single-part session now warns on first export (the
default starter part is `'empty'`) — that's the explicitly requested behavior.
Only `export-safety.spec` drives UI exports and it saves a version first, so it
stays green.

Added a regression test (`export warns about untouched, never-saved parts`) and
updated the two assertions that matched the old "unsaved changes" copy to the
stable "last saved version" substring.
