---
date: 2026-11-01
branch: claude/bold-wright-8qf51c
files_changed:
  - src/import/jsonBytes.ts
  - src/main.ts
  - src/ui/sessionList.ts
  - tests/unit/jsonBytes.test.ts
---

## Human

After the large-export fix merged: go ahead and fix the import side too
(issue #1218 — .partwright.json files over ~512 MB fail to import).

## Assistant

Every session-import path did `JSON.parse(await blob.text())`; `text()` throws
"Invalid string length" once the file is past V8's ~512M-char cap. Added
`parseJsonBytes`, a small recursive-descent parser over the UTF-8 bytes that
decodes each string value separately, so no string ever holds the whole file.
Escape-free strings (the huge base64 mesh buffers) take a fast path: native
indexOf for the closing quote and one TextDecoder call on the subarray; the
backslash search is bounded to that span to avoid a quadratic rescan. Escaped
strings fall back to JSON.parse on just that literal. `__proto__` keys become
own properties, as with JSON.parse (no prototype pollution from a crafted file).
`parseJsonBlob` keeps native JSON.parse for files under 256 MB (half the cap,
so the string certainly fits; RangeError still falls back) and uses the byte
parser above it. Wired into the file import, Recent Imports re-import,
importFromUrl, and the session list's Import button. Checked a 671 MB export:
blob.text() throws, parseJsonBlob parses it in ~4 s in Node. Kept it on the
main thread: a Worker would have to structured-clone the same huge object back.
