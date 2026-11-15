---
session: "01QnZGNLbg"
timestamp: "2026-11-15T17:38:25Z"
tools: [playwright, cdp-cpu-profile]
---

## Human

I'm ok if complex models with multiple colours render with no colour first and
then have a render pass where the colour shows up (with the user knowing what
phase of rendering they are waiting for). How close are we to that now? Is it
no longer needed?

(After the answer — the phases exist but the colour pass still freezes the
page behind a modal, tracked as #1260:) yes, start on it as a follow-up PR.

## Assistant

## Key decisions

**Measured first.** On a 1.79M-triangle two-colour import the Worker match
took ~1 s; the 7.3 s freeze after it was: the coloured geometry built three
times (each `addRegion` repaints, plus an explicit `updateMesh`), its upload
and first draw, and the thumbnail. Step timers showed 4.2 s in the first
coloured frame alone, most of it drawing in the container's software WebGL.

**Inline status instead of the modal.** The match now runs with the page live
behind "Matching colours… Xs" and the shared inline Cancel (the pattern
`api.surface.*` textures use, same timer). The modal had been added in #1257
to stop the model being switched mid-match; that protection moves to the save
step (below) so the uncoloured model stays orbitable.

**Name each blocking step before it blocks.** `importPhase(label)` sets the
status line and waits for a paint (`afterNextPaint`, a new leaf) before the
work: "Loading model…" (fast-preview upload), "Applying colours…", "Saving…"
(thumbnail + version). Only at or above `renderer.lazyManifoldMinTriangles`,
so small imports get no extra frames. A hidden tab doesn't wait for a frame.

**One coloured build, not three.** The seeds are added inside
`withSyncReconcile`, which repaints once for the batch. That is the existing
helper the paint APIs use, so relief seeds keep their preview-mode handling.

**Don't save an import the editor has left.** With the page live during the
match, the user can switch object or edit code before the version is saved.
`importStillOpen(partId, shownCode)` checks the object and the editor text
(as the editor showed it: `setValue` can auto-format) before thumbnail + save
in all three placement paths, and says so in a toast instead of writing the
import into whatever is open.

**Result** (same file, same container): colour-pass freeze 7.3 s → 2.8 s,
whole import 38 s → 29 s, every stall labelled, Cancel works during matching.

**Not done:** the 2.8 s that remains is the coloured mesh's build, upload and
first draw. Moving the buffer build off-thread would take ~0.4 s off it here;
the rest is GPU work I can't measure meaningfully without a real GPU, so #1260
stays open for that.
