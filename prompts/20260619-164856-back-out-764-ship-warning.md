---
session: "export-color-and-unsaved-warn"
timestamp: "2026-06-19T16:48:56Z"
model: claude-opus-4-8
---

## Human

[The #764 fix exposed that thumbnail-camera.spec relied on the same bug.]
Back #764 out; ship the warning only.

## Assistant

## Key decisions

Reverted the runAndSave change (back to saving the raw `code` arg) so #764 stays
its own issue, to be fixed in a dedicated PR where the thumbnail-camera dedup
gap it exposes can be handled properly. The thumbnail-camera test passes again
(its pin→resave→new-thumbnail path depends on the raw-vs-formatted diff, which
is restored).

To keep CI green with #764 unfixed, the UI-export tests whose multi-part parts
are created via `runAndSave` need their parts to read "clean" — otherwise the
new unsaved-parts export warning intercepts. Disabled auto-format
(`editor-auto-format=false`) in `threemf-multipart.spec`, `multipart-export.spec`,
and `export-unsaved-warning.spec` (matching `export-safety`) so `runAndSave`'s
saved arg matches the editor buffer. #764 stays open (spurious unsaved warnings
for AI/console sessions with auto-format on) for a focused follow-up.
