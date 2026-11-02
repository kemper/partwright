---
session: "01qnzgnp"
timestamp: "2026-10-29T23:06:00Z"
sequence: 2
---

## Human

(No new request — follow-up to the review pass on the annotation-views PR.)

## Assistant

## Key decisions

**Drafts drop at every session/object boundary.** loadFromSerialized now clears
drafts unless the caller passes keepDrafts; only version navigation does. The
existing loadAnnotations([]) resets in the session manager therefore cover
create/open/close/object switch/clear-all without new call sites.

**Offscreen renders and thumbnails draw floating marks only**, so they always
match what a version persists.

**Sub-mode switch no longer flips the draft layer**: leaving drafts is deferred
to a microtask and skipped if Annotate is open again — that transient flip was
wiping redo.

**Persist before mutating memory** for add/update/delete views; capture returns
{ error } (quota-aware) instead of throwing.

**Import validation per element** for marks, marks2D and hits, so one bad entry
is dropped rather than breaking the history, AI tools or re-render.

**API marks while drafting are documented, not changed**: reading/writing the
drafts lets an agent add a mark for saveAnnotationView to capture.

Also: shared small button constants (new BUTTON_SMALL_PRIMARY), auto-disarming
delete confirm, av_ ids on import, rename rejects blank titles.
