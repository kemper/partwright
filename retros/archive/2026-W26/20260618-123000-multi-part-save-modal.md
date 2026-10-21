# Retro — multi-part save modal + part-list scroll fix (PR #734)

## Liked
- The detection refactor stayed clean: extracting `saveVersion`'s dedup into
  `versionMatchesCurrent` let `currentPartIsDirty` reuse the exact same
  five-axis comparison instead of drifting a second copy.
- Reusing the rail-switch flow (`selectPart`) for "Save all" meant each
  non-current part is saved through the *real* load+run path, so saved versions
  carry correct geometry/thumbnails — no special-case save plumbing.

## Lacked
- A way to construct "multiple unsaved parts" in a test without fighting the
  autosave machinery. Two traps cost real cycles:
  1. **Rail-switching auto-saves the outgoing part** (`preserveCurrentEditsIfNeeded`),
     so editing-then-switching never leaves a part dirty. My first repro showed
     0 dirty parts and looked like a feature bug.
  2. **Programmatic `setCode`/`setValue` CANCELS the pending autosave** (by
     design — see codeEditor.setValue), so it never writes a draft. Tests that
     set code via the API silently produce no draft → no dirty non-current part.
     Real typing + blur (or the visibilitychange hook) is required.

## Learned
- The genuine source of "multiple unsaved parts" is the **"+" (Add part) button**:
  unlike the rail click, `onCreatePart` does NOT auto-save (or even stash) the
  outgoing part. That asymmetry — rail-switch saves, "+" doesn't — is the whole
  reason the user accumulated unsaved parts. The user knew their workflow; I had
  to reconcile it against the code before the feature made sense.
- "Unsaved part" detection must handle **never-saved** parts (no version to diff
  against), not just parts that diverge from a committed version — a part built
  via "+" and not yet saved has no version at all.

## Longed for
- A single helper to set up "a session with N parts in known dirty/clean states"
  for tests — every multi-part test re-derives the type-real-code + blur +
  API-changePart dance. A `tests/helpers/parts.ts` fixture would remove ~40
  lines of fragile setup per spec.
- Documented somewhere discoverable (CLAUDE.md?) that **rail-switch auto-saves
  but "+" does not**, and that **setCode cancels autosave** — both are
  non-obvious and each has cost multiple sessions a debugging detour.
