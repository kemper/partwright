---
session: "export-color-and-unsaved-warn"
timestamp: "2026-06-19T16:08:43Z"
model: claude-opus-4-8
---

## Human

(Continuing #760.) A merge from main landed multi-part export for STL/OBJ/GLB
(`src/export/multiPart.ts`), so a multi-part STL export now opens the part
picker instead of downloading directly.

## Assistant

## Key decisions

My "Export anyway proceeds" test asserted a direct "Exported" toast after
dismissing the unsaved warning — valid when STL was single-shot, but the merge
made STL/OBJ/GLB multi-part-aware, so a ≥2-part STL export now opens the
"Export parts to STL" picker. Updated the assertion to expect that picker
(its appearance proves the export proceeded past the warning). No source change.
Verified export-unsaved-warning + multipart-export specs green.
