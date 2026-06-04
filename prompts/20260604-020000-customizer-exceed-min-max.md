---
date: 2026-06-04
branch: claude/dreamy-euler-HvCh2
files_changed:
  - src/geometry/params.ts
  - src/ui/paramsPanel.ts
  - tests/customizer.spec.ts
  - tests/unit/params.test.ts
  - tests/unit/scadParams.test.ts
---

## Human

In the customize menu, I'd like to be able to exceed the min or max value by
typing in a custom value into the text input part of each parameter.

## Assistant

The Customizer's number field already forwarded the raw typed value, but the
authoritative clamp in `coerceParamValue` (params.ts) snapped any override back
inside `spec.min`/`spec.max`, and `setValue` then reconciled the UI to the
clamped result — so typing past a bound was silently undone. That clamp is the
single chokepoint every engine shares (manifold-js/voxel via `createParamCapture`,
and SCAD via `scadParams.ts`'s `buildScadDefines`), so relaxing it there fixes
all paths at once.

Decisions:

- **Stop clamping numeric *overrides*** in `coerceParamValue` — honor any finite
  value (still reject non-finite, still round ints). The min/max bounds remain
  meaningful as the *slider's* convenient range; the number field is the escape
  hatch. Default normalization in `normalizeParamSchema` still clamps the
  author-declared `default` so a sloppy default stays coherent.
- **Dropped the `min`/`max` HTML attributes on the number `<input>`** so the
  field (and its spinner arrows) isn't capped or marked `:invalid` when the user
  exceeds a bound.
- **Grow the slider's range to contain an out-of-range value** (new `reflect()`
  helper used by commit, slider-change, and the post-run `setValue`). Without
  this the thumb would pin misleadingly at an edge while the field showed e.g.
  250; now the thumb tracks the true value, and dragging back into the declared
  range restores the original scale.

Updated the two unit tests that asserted override-clamping (params + scadParams)
to assert the value is now honored, added a `resolveParamValues` test for values
beyond both min and max, and added a customizer e2e test that types 250 into a
max:100 field and asserts the model re-runs to 250 with a grown slider. Verified
in-browser with a throwaway spec: a cube re-rendered at 250 from a max:100 Width.
