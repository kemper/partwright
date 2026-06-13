---
date: 2026-06-13
author: kriskemper@gmail.com
title: Stop the Customizer (and surface modifiers) from resetting the camera angle
---

## Human

Using the Customize menu resets the angle/perspective on the interactive
viewport. I previously added camera persistence for other situations (orbiting
then switching versions back and forth no longer resets), but the Customize menu
still does it. Fix that, and investigate whether other places in the app reset
the view in surprising/annoying ways — fix those too and tell me about it.

## Assistant

Root cause: camera persistence was already wired through `runCodeSync`
(`opts.preserveCamera` → `captureCameraToPreserve()` → `setCameraPose()`), and
the Customizer panel's `onChange` does call `runCode()`, which defaults
`preserveCamera: true`. So manifold-js customizing already worked. The break was
**SCAD-specific**: SCAD renders progressively, and its `onScadPreview` callback
calls `updateMesh()` (auto-framing) *mid-run*, while the preserve-snapshot was
taken *after* `executeCodeAsync` returned. By then the preview had already
reframed the camera to the default 3/4 view, so the snapshot captured (and
"restored") the reset pose. The Customizer is most commonly used on parametric
SCAD models, which is why it surfaced there. The existing camera-persistence
e2e test only exercises manifold-js, so SCAD was never covered.

Fix:
- Capture `preservedCameraPose` at the **top** of `runCodeSync` (before the
  engine runs), and make `onScadPreview` skip auto-framing while a pose is being
  preserved. Robust for every engine; identical behavior for manifold-js (no
  mid-run camera move to poison the pose).

Other reset points found and addressed (the "investigate" half):
- **`setParams` console/AI-tool path** re-rendered via `runCodeSync` with no
  `preserveCamera`, so tweaking a parameter from the console or the AI customizer
  tool always reframed — inconsistent with the panel. Now passes
  `preserveCamera: true`.
- **Surface modifiers** (`commitSurfaceModifier`, both the manifold-js and voxel
  result branches) reframed on apply. A texture/voxelize decorates the model in
  place (same bounds), so they now preserve the camera.

Deliberately left reframing: **transforms** (scale / rotate / translate /
lay-flat in `commitTransform`) genuinely move or resize the model, where an
auto-fit is the helpful behavior. Flagged this choice to the user to veto.

Verified: reproduced the bug (test fails on unfixed code, passes with the fix),
added a permanent SCAD-customizer regression test to
`viewport-camera-persistence.spec.ts`, and captured before/after screenshots
showing the SCAD cube growing 20→55 while the orbited angle holds.
