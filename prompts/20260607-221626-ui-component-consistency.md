---
session: "a7f3c2"
timestamp: "2026-06-07T22:16:26Z"
sequence: 9
---

## Human

Pre-production audit follow-up: "fix them and group the prs however you think
is most appropriate." This PR collects the shared-UI-component consistency
findings.

## Assistant

## Key decisions

**Shared modal close button had no accessible name** (`modalShell.ts`): the
close `✕` set neither `aria-label` nor `title`, so a screen reader announced the
bare glyph — and EVERY modalShell-based modal inherited it. The recent
conformance work added descriptive close labels to tool *panels* but never
reached *modals*. One fix on the shared shell (`aria-label`/`title` = "Close
<title>") covers them all.

**`showInlineConfirm` duplicated `confirmDialog`** (`main.ts`): a ~70-line
hand-rolled confirm overlay with a single caller (the render-only import
fallback), reimplementing `confirmDialog` at the wrong z-index with no focus
trap and inlined button classes. Replaced the call with the shared
`confirmDialog` (which has the focus trap, focus restore, Escape/backdrop
handling, multi-line support, and BUTTON_* styling) and deleted the function plus
its local ConfirmOptions interface.

**Button-constant drift** (`uninstallModal.tsx`, `aboutModal.tsx`,
`aiAttachmentModal.tsx`): primary/danger buttons re-inlined the Tailwind string
at the wrong padding/size (`px-3 text-xs` vs the standard `px-4 text-sm`), so
they rendered visibly smaller than every shared-button modal. Swapped to
`BUTTON_PRIMARY`/`BUTTON_DANGER` from styleConstants (preserving uninstall's
extra `disabled:` classes via template string).

Deferred (noted for a follow-up, lower value / larger surface): porting
`progressModal.tsx` off its inline hex styles onto Tailwind tokens, and moving
`stepImportTargetModal`'s hand-rolled Cancel into the shell footer with
BUTTON_CANCEL.
