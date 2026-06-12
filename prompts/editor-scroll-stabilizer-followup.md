---
session: "01AhYR"
timestamp: "2026-06-09T21:50:00Z"
---

## Human

(Follow-up to the merged #542 editor bottom-scroll stabilizer.) After merging,
the user asked whether any cleanup was needed; a post-merge `work-reviewer` pass
flagged two should-fix items. The user chose: open a small follow-up PR fixing
both — the latent listener leak and the programmatic-scroll revert edge — with a
test for the interaction.

## Assistant

## Key decisions

**Gave the stabilizer a disposer so a re-init can't stack listeners.**
`installBottomScrollStabilizer` adds three `document`-level pointer listeners
(plus scroller wheel/scroll and an editor-root keydown). `initEditor` runs once
today, but `editorView` is reassignable, so a future remount/HMR/reset path
would orphan the old scroller's handlers and double-register the document ones —
against the repo's listener-lifecycle rule. The function now stores a
module-level `disposeScrollStabilizer` and calls any prior disposer at the top of
a fresh install, removing every listener with matching capture flags.

**Stopped the stabilizer from reverting a deliberate programmatic scroll.**
`revealFirstDiagnostic` (jump-to-error on Run) and find-next dispatch a
`scrollIntoView` with no preceding wheel/key/pointer, so `userActive()` was
false; a diagnostic on one of the last lines while parked at the bottom produced
a small (`<= 3 line`) near-bottom scroll that the stabilizer would revert,
silently failing the reveal. Two-part fix:

1. **`markEditorScrollIntent()`** — a module-private timestamp setter; `userActive()`
   now also honors a scroll within the grace window of the last deliberate
   navigation. `revealFirstDiagnostic` calls it right before its dispatch.
2. **Keydown listener moved from `.cm-scroller` to `view.dom` (`.cm-editor`)** so
   keystrokes in the search panel — which lives *outside* the scroller — count
   as intent, covering the find-next-scrolls-to-match path without special-casing.

Kept `markEditorScrollIntent` un-exported (only caller is in-file) to avoid a
dead export.

**Tests.** Added a sixth e2e case (`tests/editor-blur-scroll.spec.ts`): a
keydown on the editor root followed by a small near-bottom scroll is honored, not
reverted — proving the find-panel/intent path. All six pass; build + the unit
tier green.
