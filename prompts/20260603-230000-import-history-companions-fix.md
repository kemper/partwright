---
date: 2026-06-03
branch: claude/funny-galileo-C7Gs1
files_changed:
  - src/import/importInbox.ts
  - src/main.ts
---

## Human

When I import a part that had a companion part from the import history it
fails to load its companions.

## Assistant

`ImportInboxEntry` had no field to persist companion files, so re-importing
from Recent Imports always called `placeImportedCodeFile` with no companion
map — the companions the user uploaded during the original import were silently
discarded.

Fix:

- `ImportInboxEntry` gets an optional `companions?: Record<string, string>`
  field. IndexedDB serializes this automatically alongside the existing entry.
- `registerImport` / `registerImportSnapshot` accept an optional `companions`
  argument and store it on the entry (omitted when empty to keep the stored
  object compact).
- `handleImportFile` passes `scadCompanions` (the map returned by the companion
  modal, if any) to `registerImportSnapshot` so the companion set is captured
  at the time of the original import.
- `handleReimportInboxEntry` passes `entry.companions` to
  `placeImportedCodeFile`, restoring the same companion set on re-import
  without requiring the user to re-upload the files.
