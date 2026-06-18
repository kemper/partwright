---
date: 2026-06-18
branch: claude/sweet-pasteur-bz2gl4
files_changed:
  - src/ui/saveAllModal.ts
  - src/ui/partList.ts
  - src/ui/sessionBar.ts
  - src/storage/sessionManager.ts
  - src/main.ts
  - public/ai.md
  - tests/save-all-parts.spec.ts
---

## Human

When I save and I have multiple parts with unsaved changes, I have to click each
part and hit Cmd/Ctrl+S separately. We should: (1) if a save shortcut fires while
multiple parts have unsaved changes, pop a modal listing all the unsaved parts,
pre-checked, in the same order as the left rail, with the current part called out
as "current", and let me save just the current part or all of them; the Save
button should do the same thing. (2) Also: when I scroll down the part list and
hit Cmd+S, the list jumps back to the top — the scroll position should be
preserved.

## Assistant

Two parts, one PR.

**Scroll preservation.** `partList.render()` rebuilt the whole rail via
`railEl.innerHTML = ''`, which destroys the `#parts-list` scroll container and
creates a fresh one at scrollTop 0. Every save calls `saveVersion → notify →
render`, so any save reset the scroll. Fix: capture the existing `#parts-list`
scrollTop before the rebuild and restore it onto the new list after the rows are
appended (the browser clamps it to the new scrollHeight). Mirrors the AI
transcript's existing measure-then-restore pattern.

**Multi-part save modal.** New `saveAllModal.ts` (built on `modalShell`) lists
each unsaved part as a pre-checked checkbox row in rail order, badges the current
part, and offers Cancel / "Save current part only" / "Save all" (the primary
button's label reflects the checked count). Detection:
- Current part — judged from the LIVE editor buffer via a new
  `currentPartIsDirty()` in sessionManager, which reuses saveVersion's dedup
  predicate (extracted as `versionMatchesCurrent`) so it accounts for code,
  annotations, paint, params, and companion files.
- Other parts — judged from their stashed per-part draft via a new
  `partHasUnsavedDraft()` (draft code/companions ≠ that part's latest version).

`saveVersionWithToast` (Cmd/Ctrl+S) and the 💾 button (routed through a new
optional `onSave` callback on the session bar) both go through the modal-aware
path: when ≥2 parts are unsaved it opens the modal; otherwise it's the plain
single-part save with identical toasts. "Save all/selected" visits each
non-current part via the existing rail-switch flow (extracted as `selectPart`,
which restores the part's draft and re-runs its code so the saved version carries
the right geometry + thumbnail), saves it, then returns to the originally-active
part. UI↔API parity: added `window.partwright.saveAllParts()` + a `help()` entry
+ an `ai.md` line.

**Key finding surfaced to the user (not yet acted on):** switching parts via the
rail already auto-saves the outgoing part (`preserveCurrentEditsIfNeeded` commits
a version on switch), so multiple parts only stay unsaved when the active part is
changed *without* that auto-save — e.g. the programmatic `changePart` API that
AI-driven multi-part editing uses. The modal therefore mainly helps AI/
programmatic flows today; whether manual rail-switching should ALSO stop
auto-saving (so manual editing accumulates unsaved parts) is a separate product
decision left for the user.

Verified in-browser with a Playwright spec (modal contents, "Save all" → every
part gains v2, "Save current part only" → only the current part does) and the
scroll fix (scrollTop preserved across a save with a 25-part rail).

**Follow-up after user feedback.** The user clarified their real workflow: they
build parts with the **"+" (Add part) button**, which — unlike the rail-switch
path — does NOT auto-save the outgoing part. So that's the genuine source of
"multiple unsaved parts", reached via normal manual use. Two refinements:
- `onCreatePart` now stashes the current part's buffer as a draft before
  switching (but deliberately does NOT auto-save it as a version — leaving it
  unsaved is what surfaces it in the modal).
- Dirty detection now covers **never-saved** parts: `partHasUnsavedDraft` treats
  a part with no committed version as unsaved when it has a non-starter draft in
  any language; `currentPartIsDirty` treats a never-saved current part as dirty
  when its live buffer is non-starter. Added an e2e test reproducing the exact
  "+ button, no save" flow → all three parts detected and committed by "Save all".

**Second follow-up.** User then created several parts via "+" WITHOUT editing
them and wanted those offered too, with the modal noting which "have no changes
yet". So: any part with NO committed version now counts as unsaved (even an
untouched starter), and the detection returns a 3-way `PartSaveState`
(`clean` / `empty` / `unsaved`) instead of a boolean — `partHasUnsavedDraft`
became `partSaveState`. The modal renders an italic "no changes yet" note on
`empty` rows (never-saved + still the starter) so the user can uncheck them; rows
stay pre-checked by default. Added an e2e test: 5 never-edited parts created via
"+" all show "no changes yet" and "Save all" commits a v1 for each.
