---
date: 2026-10-20
branch: claude/optimistic-gauss-ofleuq
files_changed:
  - src/ui/surfaceModal.ts
  - src/surface/smoothSurface.ts
  - src/surface/voxelizeMesh.ts
  - src/ui/characterCreatorPanel.ts
  - src/ui/imageVoxelImportModal.tsx
  - src/import/imageToVoxel.ts
  - src/color/voxelPaintUI.ts
  - src/color/voxelPaint.ts
  - src/color/imagePaintUI.ts
  - src/ui/resizeModal.ts
  - public/ai/textures.md
  - tests/slider-typed-entry.spec.ts
---

## Human

The Surface panel's smoothing slider has no input box, so I can't type an
arbitrary value or go above its limit. Fix that, and look for other places in
the UI like it that we can fix or improve.

## Assistant

- **Root cause for smoothing was two caps, not one.** The "Rounding strength"
  slider stopped at 12 *and* `smoothSurface` silently clamped iterations to 20,
  so a typed box alone wouldn't have helped. Raised the engine ceiling to an
  exported `SMOOTH_MAX_ITERATIONS = 100` (Taubin passes are O(edges), so 100 is
  a typo guard, not a cost cliff) and made the UI box read that same constant.
- **Fixed the whole Surface panel at the helper, not per slider.** Its local
  `slider()` had only a read-only readout; a sibling `sliderWithEntry` existed
  but only 4 controls used it. Folded both into one `slider()` that always
  pairs a number box, with `hardMax`/`hardMin` per control. Default bound =
  slider range (safe for fractions/angles); open-ended quantities (sizes,
  depths, seeds, radius, sharpness) pass `NO_LIMIT`; engine-capped ones pass
  the engine's own exported constant (`MAX_FIELD_RESOLUTION`, voxelize
  `MAX_RESOLUTION`) so the UI can't drift from the real limit. "Mesh detail"
  keeps a read-only readout because its value is a named level.
- **Audit of the rest of the UI** (31 sliders, delegated to an explore
  subagent) found the real gaps: Character Creator (no typed values; Height
  capped at 90 though the rig accepts any value >= 1), image→voxel import
  (resolution/thickness/relief/base capped well under the 256 engine cap; gamma
  has no API max), Voxel Studio brush radius (8 vs 16) and block size (16 vs
  32), image-stamp Size box capped at 200 despite no API max, and the Resize
  modal silently clamping typed values to the slider max. Fixed each with the
  same "slider = common range, box = real limit" rule; Resize grows its slider
  max to fit a larger typed value rather than clamping it.
- Left alone deliberately: bounded fractions/percents/angles and discrete
  counts where the slider already spans the real range (spray density,
  posterize colours, edge smoothness 0–20 cost guard, clip Z).
- Typed boxes commit on Enter/blur where each commit triggers a heavy rebuild
  (Character Creator SDF, image-voxel import) so half-typed values aren't
  clamped mid-keystroke.

## Assistant (review follow-up)

- The review subagent caught that `slider()` decided "round to integer" from
  `Number.isInteger(step)`, but most Surface steps scale with the model
  (`span * 0.005` is exactly 1 at span 200), so typed values were silently
  rounded on some models. Added an explicit `fractional` option, set on every
  span-scaled control, instead of guessing from the step.
- Display precision now covers every digit of the step with a floor of 3
  decimals (the old readout's precision), so the box never shows a coarser
  number than the one Preview/Apply use. The value written back on commit is
  precision-safe (`toPrecision(12)`), so a clamp doesn't print float noise.
- Added a Voxel Studio case to the e2e spec (typed brush radius past the
  slider, clamped to the engine's 16).
