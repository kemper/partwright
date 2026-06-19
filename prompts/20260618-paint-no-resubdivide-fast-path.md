---
date: 2026-06-18
branch: claude/busy-clarke-cd0e1w
files_changed:
  - src/main.ts
  - tests/paint-cancel.spec.ts
---

## Human

After shipping the "Stop & turn off smoothing" button on the paint refine modal,
the user reported it didn't actually fix the slowness: "I don't think the cancel
really cancels the mesh subdivision. My first test had slow painting with a modal
popup even after using the new cancel button, but if I did undo and kept the smooth
button off I was able to paint instantly with no popup." Asked to investigate and
fix. When offered the choice, the user picked "Do both" — the core reconcile fix
AND making the button discard the slow stroke.

## Assistant

Root cause (not the button): a smooth brush stroke is stored as a `brushStroke`
descriptor, and `descriptorRefines()` returns true for it unconditionally. So once
ONE smooth stroke exists, every subsequent paint action fell into the heavy worker
rebuild (`rebuildPaintedGeometryAsync` → "Rebuilding refined mesh…"), because the
reconcile only treated a brand-new brushStroke as a cheap append and everything else
as a full rebuild. Turning the global smoothing toggle off only affected FUTURE
strokes; the already-committed smooth stroke kept forcing re-subdivision. The user's
undo worked because it REMOVED the stroke (no refine descriptors left → instant).

Fixes:
1. Reconcile fast path (the real fix). Track the refine-driving descriptor set the
   working mesh was built against (`meshRefineList`) plus the exact mesh object
   (`meshRefineForMesh`, a guard against external mesh swaps). When a change leaves
   that set unchanged — a non-smooth stroke, colour edit, non-refine removal — the
   topology is already correct, so `reresolveRegionsAgainstCurrentMesh()` resolves
   any unresolved regions against the current mesh and recolours instead of
   re-subdividing in the worker. No modal, instant. Mirrored into both the async tick
   and the sync (agent) reconcile. `markMeshRefineState()` is called wherever the
   working mesh is (re)built or reverted.
2. UI-stroke discard (the "do both" half). `pendingStrokeRegionId` was only set on
   the agent paint path, so a cancelled UI stroke left a dead, empty `brushStroke`
   region that still forced re-subdivision. Set it in the async append branch so the
   modal's Cancel / "turn off smoothing" action drops exactly that orphan.

Verification: typecheck + build green; added a deterministic e2e (smooth stroke then
a non-smooth stroke — a MutationObserver proves the progress modal shows exactly once
and the triangle count doesn't change on the second stroke); extended the button test
to assert smoothing turns off + clean region state. Full paint regression sweep: 39
specs + 6 paint-cancel + 36 smooth-brush all green (the live-vs-reload determinism
specs are the key guard that the fast path matches a full rebuild).
