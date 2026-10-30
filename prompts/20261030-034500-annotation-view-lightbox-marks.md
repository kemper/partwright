---
session: "01qnzgnp"
timestamp: "2026-10-30T03:45:00Z"
sequence: 4
---

## Human

Clicking a saved annotation snapshot's image doesn't show a large version.
The View button jumps back to where the annotation was taken but doesn't
redraw the annotation — redrawing it would be cool.

## Assistant

## Key decisions

**One shared lightbox.** The gallery and the Images tab each had their own
copy (the Images-tab one leaked its Escape listener when closed by click).
Extracted `src/ui/lightbox.ts` and used it for the history thumbnails too.
Escape is caught in the capture phase and stopped, so it closes only the
lightbox, not the Annotate panel underneath (whose own Esc steps modes back).

**View redraws the view's stored marks as a separate overlay group**, not as
annotations in the store: nothing should select, edit or save them, and they
must not collide with drafts or floating marks. The group is named so a new
Save view's frame grab hides it. It clears on Hide marks, another View,
Annotate closing (behind the same transient-close microtask guard as the draft
scope), or when the shown view is deleted / its session closes.

**Parity:** `restoreAnnotationView(id, {marks})` redraws by default and
reports `marksShown`; new `hideAnnotationViewMarks()` mirrors the row's
"Hide marks".
