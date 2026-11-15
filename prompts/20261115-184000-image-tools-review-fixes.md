---
session: "b01bd443"
timestamp: "2026-11-15T18:40:00Z"
model: claude-opus-5-5
---

## Human

(Continuing "start on 1": finish the image-tools slice, #1256.) A review
pass over the PR found defects; fix them before the PR is marked ready.

## Assistant

## Key decisions

**A new session starts with no attachments.** `createSession` never reset the
in-memory attachment list, so an import into a new session inherited the old
session's attachments — and now that imports attach their image, that stale
list got saved onto the new session. The shared new-session helpers clear it.
Attachments also dedupe by content, not just id, so a reused image never
points a record at an attachment the session doesn't have.

**The record follows the image the user actually picked.** Every tool dialog
lets the user swap the image. The record used to keep naming the one the
panel opened the tool on, so "re-apply" (and a layered print's
`api.image(...)`) used the wrong picture. Now the picked image is attached and
recorded, unless it is still the one the dialog was given.

**A failed run is an error, not a success.** The code-based tools share one
commit helper that throws when the code doesn't run, fills an empty starter
object instead of adding a second object beside it, and removes a freshly
attached photo again if the layered print fails.

**Backing out of "where should it go?" keeps the layered dialog open**, so
the solve isn't lost.

**Attached source images are capped** (new App Config setting, 2048 px by
default). They live in the session row and its exports, and the tools sample
far coarser than that. Relief crop is normalised, so downscaling is safe.

Smaller: one validator for image→voxel options (the voxel tool skipped it),
`applyImageTool` is save-gated and reports the tool actually recorded,
`imageRef` indexes the same list as getReferenceImages, http(s) sources are
stored as pixels, and hover styles are guarded for touch screens. Deferred
(tracked on #1256): warn before "re-apply" replaces hand-edited code.
