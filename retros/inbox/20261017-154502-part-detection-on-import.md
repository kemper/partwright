---
date: "2026-10-17T15:45:02Z"
task: "feat: detect parts on STL import, plus Paint-panel entry"
pr: 1032
areas: [import-export, ui, agents, testing]
cost: low
---

## Liked / Worked
- The foundation's registry made "which detectors run on import" a one-field
  opt-in (`autoPropose`) instead of import-flow logic — the future seedless
  detector plugs in with no import change.
- A hand-built binary STL helper in the spec (boxes → 50-byte records) gave
  multi-body and single-solid fixtures through the real file input in a few
  lines; no committed fixture files.
- The work-reviewer caught real async/state bugs (blocking import on a silent
  Worker pass, a no-result cleanup that could wipe a newer draft, a stale-draft
  null access) that every test had passed.

## Lacked
- Two viewport panels can't be open at once (viewportPanelRegistry), which
  isn't stated where post-import asks are wired; I first designed a second
  prompt before discovering it. (cost: ~2 turns)

## Learned
- Fire-and-forget the post-import pass: awaiting it inside placeImportedMesh
  also delays handleImportFile's Recent Imports snapshot.
- Session saves can replace `getActiveImports()` element identities, so
  "did the user move on" checks must compare `importMeshKey`, not objects.

## Longed for
- A tiny "post-import next step" registry (convert, detect parts, future
  reliefs) so each feature contributes an offer and one chooser decides,
  instead of each feature editing `placeImportedMesh`.
