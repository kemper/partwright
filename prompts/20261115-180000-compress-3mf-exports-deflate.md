---
session: "3mfdeflate"
timestamp: "2026-11-15T18:00:00Z"
model: claude-opus-5-5
tools: [subagent]
---

## Human

3MF exports are written as an uncompressed (STORE) ZIP, so a 150 mm layered
print is about 21 MB. Add DEFLATE without breaking the synchronous
`build3MFProject` callers (a `CompressionStream('deflate-raw')` path with a
STORE fallback, or a vetted library), use it for the layered-print download,
the general 3MF exports and the CLI, and prove correctness with a unit test
that reads the deflated ZIP back with an independent reader and checks bytes
and CRCs. Also research (no code unless conclusive) whether one layer-swap
3MF can serve both AMS and non-AMS Bambu printers.

## Assistant

## Key decisions

**Native `CompressionStream`, no new dependency.** The app already uses
`DecompressionStream('deflate-raw')` in the ZIP reader and
`CompressionStream('gzip')` for share links, so the browser path and Node 18+
(CLI, vitest) both have it. `fflate` would have meant a new `package.json`
entry for no capability gain. Fallbacks: a runtime without `'deflate-raw'`
gets `'deflate'` (zlib) with its 2-byte header and Adler-32 trailer stripped;
one with no `CompressionStream` at all stores everything.

**Sync builders kept, async twins added.** `buildZip`, `build3MF` and
`build3MFProject` stay synchronous (STORE) so unit tests and any sync caller
keep working. They and the new `buildZipAsync` / `build3MFAsync` /
`build3MFProjectAsync` / `buildPlan3MFAsync` share one entry-list builder,
so the two paths can't drift. Every download, publish and `*Data()` path
now awaits the deflated variant.

**Per-entry choice.** Entries under 64 bytes, directory entries, and
anything deflate doesn't shrink are stored, so the archive is never bigger
than before. CRC-32 is now table-driven, since the old bit loop was the slow
part on a 25 MB model.

**`exportLayeredPrint3MF` and `export3MF` became async.** Callers that
awaited them (AI tools, `page.evaluate`) are unaffected. The command palette
and the layered-print dialog now await the call, and the dialog shows a
failed export in its status line. The docs and `help()` signature say
`await`.

**Tests decode instead of regexing raw bytes.** Several e2e specs read the
exported 3MF as latin1 text. They now inflate it Node-side through a small
`tests/helpers/zipText.ts` that uses the app's own reader. The new unit test
checks every entry with `node:zlib.inflateRawSync` (independent of the
app's `DecompressionStream`) and a bit-at-a-time reference CRC, and
cross-checks local headers against the central directory.

**Research is reported, not coded.** BambuStudio's source shows that
ToolChange items become real filament changes (an AMS
`M620`/`T`/`M621` sequence, with no pause) whenever the project has more
than one filament. Driving that with a non-AMS printer depends on the
"Multi-color with external" option in the send dialog and on the printer's
firmware. That is not conclusive enough to merge the two files, so the
findings go in the PR body.
