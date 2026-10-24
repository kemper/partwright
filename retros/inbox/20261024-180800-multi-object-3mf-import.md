---
date: "2026-10-24T18:20:00Z"
task: "feat: import multi-object 3MF files as separate objects, by object or plate"
pr: 1103
areas: [import, 3mf, ui]
cost: medium
---

## Liked
- Reusing the existing Bambu export (`build3MFProject`) as the round-trip fixture in a unit test checked plate binding against a writer we already trust.
- The `work-reviewer` caught a real mismatch: the part detector and `computeMeshPieces` can disagree on piece counts, so the Split button promised N objects and made fewer.

## Lacked
- A real-world Bambu 3MF fixture in the repo. Every test builds a minimal hand-written one, so plate metadata that only real Bambu Studio writes goes untested.

## Learned
- After building several objects in a loop and switching back to the first, the camera stays framed on the last object. Call `resetView()` explicitly, or a small last object leaves the camera inside a big first one (the viewport shows solid grey).
- Two "pieces" definitions exist: the segmentation `pieces` detector (edge-connectivity, area order) and `computeMeshPieces` (position weld, triangle-count order). Count with the one the action will actually use.

## Longed for
- A shared "build N objects with progress + cancel" helper for multi-object flows (merge, import split, extract pieces). Each one reimplements the loop.
