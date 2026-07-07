---
session: "export-dialog-cancel"
timestamp: "2026-07-07T13:30:00Z"
model: claude-opus-4-8
sequence: 1
---

## Human

When exporting a Bambu 3MF (and maybe other 3MFs / other formats) a dialog pops
up for processing all the files and preparing the export, but there's no way to
cancel it. For any long-running export, the user should be able to cancel —
either by pressing Escape or clicking a Cancel button.

## Assistant

## Key decisions

**The progress modal already supported a Cancel button — the export flows just
weren't passing an `onCancel`.** `progressModal.tsx` renders a Cancel button
whenever the job carries `onCancel` (paint refine already used it). The two
multi-part export flows in `main.ts` (`export3MFMultiPartFlow`, which also backs
the Bambu path via its `bambu` arg, and `exportMultiPartFlow` for OBJ/STL/GLB)
started their "Preparing …" job with no `onCancel`, so the modal was a dead end.
Fix was to wire a `cancelled` flag through each.

**Cancellation granularity is between parts, not mid-bake.** Each part's
`bakeColoredMeshForPart` is a single atomic async call with no abort signal, so
the loop checks the `cancelled` flag at the top of each iteration and again
right after the await, then bails with a neutral "… export cancelled." toast
before writing/downloading. This matches the user's scenario (a multi-file
export grinding through many parts) — the natural stop point is the next part
boundary. Documented that in a comment so nobody expects a hard mid-part abort.

**Escape-to-cancel went into the modal itself, not each call site — so it
covers every cancellable progress job at once.** Added one capture-phase
`keydown` listener in `progressModal.tsx`'s singleton `ensureMount` (never torn
down, so no removeEventListener needed, per the resource-lifecycle rule). It
only acts when the modal is visible AND the current job has an `onCancel`,
calling the same handler the button does; otherwise it passes the key through.
Capture phase so this top-most modal wins Escape over anything beneath it. This
also gives the paint refine job Escape-to-cancel for free.

**Tests.** New `tests/export-cancel.spec.ts`: a module-level test that Escape
fires a cancellable job's `onCancel` + is inert for a non-cancellable one, and
an integration test that a multi-part STL export's progress modal actually
renders the Cancel button (MutationObserver catches the transient frame between
per-part bakes). Used plain saved cubes so no export-confirm modal precedes the
part picker.
