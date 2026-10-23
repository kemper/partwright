---
session: "013sNYzhSzvu3h7P3s75MXRM"
timestamp: "2026-10-23T15:21:41Z"
tools: [playwright, vitest]
---

## Human

I want to be able to undelete objects — investigate and report back options.
Then: also add undelete for parts (part deletion shipped recently). Then: people
should be able to get back to an undelete after the toast has faded — maybe a
"Recover deleted" button/link opening a modal that recovers both deleted objects
and parts; ideate pros/cons. Decisions: the piece-name comment sounds good;
drop single-delete confirms; always show the link; current session only.

## Assistant

## Key decisions

**Objects go to a bin store, not a `deletedAt` flag.** A new IndexedDB store
(`deletedObjects`, DB v9, indexed by sessionId) holds each deleted object's part
row + versions + drafts verbatim. Deleting moves records out of the live stores,
so no reader of parts/versions (listParts, session version counts, export,
share, listObjects) had to learn to skip deleted rows — the flag approach would
have needed every one of them. The bin never leaves the browser (not exported),
so the session export schema is unchanged. Move/restore run in one transaction
with requests chained from callbacks (no awaits mid-transaction), per the
IndexedDB rule in CLAUDE.md. Retention is `ui.deletedObjectRetentionDays`
(default 30), purged lazily on read; the hard-delete helpers became dead code
and were removed.

**Parts need no storage.** A part/piece delete is already a code line
(`api.removePart` / `api.removePiece`), so restore = remove the line, re-run,
save a `restore …` version. `findRemovalLines` / `removeRemovalLine` match by
the canonical call so hand-written single-quoted calls work too. Piece removals
now carry `// piece 3 ("wheel")` so the modal can name them. If nothing comes
back (label deleted, geometry moved) the line was already a no-op, so it is
dropped anyway and the result carries a `note` rather than leaving an
unrestorable entry stuck in the list.

**One modal, three ways in.** Undo button on the delete toast (new `action`
option on `showToast`, longer `ui.undoToastDurationMs`), an always-visible
"↺ Recover deleted (N)" link, and a palette command. The link ends the
scrolling Objects list instead of being a pinned footer: on a 720px-tall window
the rail is stacked under the sidebar nav and a footer shrank the list to ~24px
(caught by the existing drag-reorder e2e).

**Blank placeholder.** Deleting the last object leaves an untouched "Object 1";
restoring the object whose deletion created it (created within a minute of the
delete, still never-saved starter) drops the placeholder. Restricting it to that
case avoids discarding a user's fresh untouched object on an unrelated restore.

**Parity.** `listDeleted`, `restoreObject`, `restoreObjectPart`,
`purgeDeletedObjects`, `showRecoverDeleted` on window.partwright + help() +
ai.md; chat tools `listDeleted`/`restoreObject` (always available) and
`restoreObjectPart` (SAVE_GATED like deleteObjectPart). Purge is console-only —
too destructive for an unscoped chat tool.

**Side fix.** playwright.config.ts now also finds the sandbox Chromium under
`chrome-linux64/` (the image changed layout; the e2e suite couldn't launch).

## Assistant

**CodeQL follow-up.** CodeQL flagged `parseQuoted` (js/incomplete-sanitization):
it converted a single-quoted literal to JSON by swapping quotes without
handling backslashes, so a name like `'a\"b'` mis-parsed (returned null). Not
exploitable — it only reads removal lines from the user's own code — but a real
parse bug, so it now decodes JS escapes directly instead of round-tripping
through JSON.parse; a unit test covers both quote styles.

## Assistant

**Merged main (#1060: part deletes on OpenSCAD, BREP, imports, voxel).** Main
now writes OpenSCAD `remove_part("x");` / `remove_piece([…]);` lines and allows
deletes beyond manifold-js. Restore follows: `findRemovalLines` parses both
syntaxes (each entry carries `syntax`, canonical `call` in that syntax),
restore no longer requires manifold-js, and the piece-name comment is written
for both (`//` works in OpenSCAD too). Kept main's disabled-✕-with-reason
behaviour and dropped only its confirm dialog. ai.md keeps main's per-engine
table and points the Recover deleted section at it. New e2e restores an
OpenSCAD part + piece.

## Assistant

**Review follow-ups (work-reviewer pass, nothing blocking).** The rail count
now uses a `[sessionId, deletedAt]` index count instead of loading every bin
entry's versions on each state/mesh event (v9 is unreleased, so the index joins
the same upgrade block). Moving to the bin can hit the quota (two copies
briefly), so a quota error falls back to a permanent delete and the toast /
API result says so (`permanent: true`) instead of failing silently. A restore
that finds nothing (another tab or a racing Undo got there first) now changes
nothing — it used to drop the blank placeholder anyway. Purge refuses an
ambiguous name like restore does; the modal's purge/empty and the expiry purge
are skipped in read-only tabs. Undo reopens the object that was open, and a new
e2e covers unsaved edits surviving delete → Undo. Small-danger button constant
(44px on touch, hover only where hover exists), toast action 44px on coarse
pointers, a superseded restore puts the old code back, named constants for the
placeholder window and refresh debounce, and the modal shows the restore note
instead of a stacked success toast.
