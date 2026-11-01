---
date: 2026-11-01
branch: claude/bold-wright-8qf51c
files_changed:
  - src/export/jsonBlob.ts
  - src/export/session.ts
  - src/ui/sessionList.ts
  - tests/unit/jsonBlob.test.ts
---

## Human

Exporting a large project fails with "RangeError: Invalid string length at
JSON.stringify" from onExportSessionJSON. How to fix?

## Assistant

Root cause: buildSessionJSON did a single `JSON.stringify(data, null, 2)`; V8
caps one string at ~512M chars, which big sessions (base64 import meshes,
embedded meshes, long histories) exceed. Fix: a small recursive serializer
(`jsonToBlob`) that emits the identical text in pieces and flushes them into
Blob parts every ~8M chars, so no single string holds the document. Kept the
2-space indent so files are byte-identical to before (unit test compares with
JSON.stringify across edge cases: undefined/function members, NaN, toJSON,
boxed primitives, circular refs). Verified a ~640M-char document throws with
JSON.stringify and exports with jsonToBlob. Also switched the session-list
Export button, which had the same pattern. The share link exports one version,
so it was left alone. Import still reads the file as one string
(`file.text()` + JSON.parse), so a >512MB file can't be re-imported yet —
flagged as a follow-up rather than widening this fix.
