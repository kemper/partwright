---
date: 2026-06-15
branch: claude/quirky-cerf-jik841
files_changed:
  - src/main.ts
  - public/ai/file-io.md
---

## Human

There's a JavaScript API to create exports and pull the contents yourself without
the browser file API (the `*Data()` methods). You should be able to create 3
parts, export them together, and read the 3mf back. If we're missing that API for
the multi-part export, build it.

## Assistant

Added `partwright.export3MFPartsData(partIds?, filename?, { bambu? })` — the
bytes-returning twin of `export3MFParts`. It returns `{ filename, mimeType,
base64, sizeBytes, parts }` (or `{ error }`) instead of triggering a browser
download, so an agent/test can read the exported 3MF back (unzip the base64)
without the download path. This fills the `*Data()` parity gap I'd flagged for the
multi-part export.

Refactored the shared core into `build3MFPartsExport(partIds, filename, opts)`
(validate ids → bake each part's coloured mesh off-editor → `build3MFProject`,
returns the `BuiltExport`); `export3MFPartsApi` (download) and
`export3MFPartsDataApi` (base64) are thin wrappers over it. help() table + the
`/ai/file-io.md` multi-part section updated.

Motivation: it gives a headless self-verification loop for the multi-part 3MF
work — create 3 real coloured parts, export, and inspect the exact bytes — which
I used to confirm the real pipeline emits the intended structure (3 objects, 3
`<plate>` blocks mapping object→plate, build items tiled by the bed-size stride).
That isolated the remaining Bambu multi-plate bug to one question (what makes
Bambu instantiate the plate list), now under investigation against the
bambulab/BambuStudio importer source. Typecheck clean.
