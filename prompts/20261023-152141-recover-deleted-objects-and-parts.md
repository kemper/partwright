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
