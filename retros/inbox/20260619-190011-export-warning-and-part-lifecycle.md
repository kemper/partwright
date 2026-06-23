# Retro — export-unsaved warning, drafts-carry-paint, and the #764 scope saga

**Context:** A long chat session off the part-color work: shipped the
unsaved-export warning (#760) and the drafts-carry-paint part-unload fix (#778),
and discovered the part-preservation logic is hand-wired per UI handler.

## Liked
- "Reproduce before coding" kept paying off: the multi-part 3MF export *bake*
  path turned out NOT to be broken (it composes colour fine) — the real cause of
  "parts lost colour on export" was unsaved work. The fix became a warning, not a
  bake change. Verifying the claim first saved a phantom fix.
- Delegating the drafts-carry-paint multi-file change to an `implementer` in a
  worktree kept the heavy edits out of an already-huge context, and it caught a
  real spec gap (the `onCreatePart` `isStarterCode` guard needed `|| hasColorRegions()`).

## Lacked
- A single "unload current part" lifecycle. Preservation is re-implemented in
  each transition handler (`selectPart` saves a version incl. paint; `onCreatePart`
  stashed code-only) — the exact inconsistency the user predicted, and the source
  of the ➕-loses-paint bug. Drafts now carry paint, but the handlers still each
  call preserve/stash by hand; a real `unloadCurrentPart()` chokepoint is still owed.
- Cheap dirty-state instrumentation. `currentPartIsDirty`/`versionMatchesCurrent`
  compare raw code, so `runAndSave` saving the unformatted arg made just-saved
  parts read "unsaved" (#764) — invisible until the new warning surfaced it.

## Learned
- A "correct" fix can have a wide blast radius through bug-dependent code. The
  #764 fix (save the formatted buffer) was right, but two separate features
  (multi-part 3MF picker test, AND the thumbnail-camera pin→resave→new-thumbnail
  path) silently *relied* on the raw-vs-formatted mismatch. Re-asking the user
  with the new finding (instead of pushing through) avoided shipping a regression.
- Cloudflare Pages 0-second "build failed" ≠ a code break: build-unit ran the
  identical `npm run build` green. It was a deploy-config issue fixed on main
  (versioned-deploy base-mount), not the account-quota I first guessed — I should
  weight "what changed on main" higher before diagnosing infra.

## Longed for
- `unloadCurrentPart()` / `loadCurrentPart()` symmetry so per-version state
  (code, paint, annotations, params, thumbnail-camera) can't drift between the
  ~6 transition handlers.
- A dirty-check that's format-insensitive (normalize before comparing) so save
  state doesn't hinge on auto-format — would dissolve #764 and the thumbnail
  dedup gap together.
