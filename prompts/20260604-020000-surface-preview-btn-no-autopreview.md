---
date: 2026-06-04
branch: claude/vigilant-einstein-Iifva
pr: 364
touches:
  - src/ui/surfaceModal.ts
  - src/surface/modifiers.ts
---

## Human

Three more issues with region-selection surface modifiers:

1. Selecting one face freezes the UI and won't let me select another face — because the
   texture preview fires after each flood-fill click. Now that the patch path pre-subdivides
   the full mesh (prior commit), each auto-preview is expensive.

2. Splotchy view during selection — the texture preview is visible at the same time as
   the amber selection overlay, making it hard to see what's selected.

3. Fuzzy skin with region select on a cube only "slightly waves" — less detail than the
   whole-model path. Expectation: same fuzz density as Apply on the whole model.

Requested: add a separate Preview button next to Apply.

## Assistant

### Fix 1 & 2 — Preview button; remove auto-preview on selection clicks

`runFloodFill()` was calling `schedulePreview()` on every flood-fill click. Since `schedulePreview`
now triggers `runOnPatch` → `subdivideWithMask` → full mesh subdivision, it was O(quality^4) work
per click. Removed the `schedulePreview()` call from `runFloodFill` entirely.

Also removed `schedulePreview()` from the "Stop picking" click handler — the user can now
see the clean amber overlay without a preview overlaid on top.

Added an explicit **Preview** button between Cancel and Apply in the footer. It is disabled
(same condition as Apply) when no region is selected. Clicking it calls `runPreview()`
immediately, bypassing the debounce.

`clearRegion()` now calls `clearPreviewIfDirty()` directly instead of `schedulePreview()` — the
scheduled version would immediately re-clear since region is blocked, so this is a no-op
simplification that avoids the setTimeout round-trip.

`setRegionMode(mode)` only calls `schedulePreview()` when switching TO whole model (makes sense
to preview immediately); switching to region mode just clears any stale preview.

Slider auto-preview (`schedulePreview` on each slider's `onChange`) still fires as before —
adjusting amplitude/scale while a region is selected still updates the preview. The freeze was
specific to each flood-fill click, not slider drags.

### Fix 3 — maxRounds: 4 in patchSubdivTarget

`patchSubdivTarget` was returning `maxRounds: q` (quality setting, default 3). But the
whole-model path in `fuzzySkin` hardcodes `maxRounds: 4` regardless of quality. This meant
the patch pre-subdivision stopped 1 round earlier, leaving the cube at 768 tris vs 3072 tris
for the whole-model path. Changed to `maxRounds: 4` to match.
