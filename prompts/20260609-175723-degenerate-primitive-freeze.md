---
date: 2026-06-09
title: Stop the editor freezing on degenerate primitives (e.g. Manifold.sphere())
files_changed:
  - src/geometry/engines/manifoldJs.ts
  - src/renderer/viewport.ts
  - src/content/data/help.ts
  - tests/degenerate-geometry-guard.spec.ts
---

## Human

While typing code into the editor, `return Manifold.sphere()` froze the UI
before the radius was typed — "I think it doesn't know an argument is
required." Asked to research the cause first, then (after discussing whether to
wrap/rename the whole Manifold API) ship two fixes in one PR: guard the footgun
primitives *and* harden the renderer.

## Assistant

**Root cause (two layers).** The editor live-auto-runs the buffer ~300 ms after
a keystroke pause (`codeEditor.ts`), with no validity gate — so a half-typed
`Manifold.sphere()` executes immediately. `manifold-3d`'s `sphere(radius)` has
no default, so `undefined` coerces to NaN in the WASM binding and builds a
*degenerate* zero-size sphere (all 258 verts at the origin) that the kernel
reports as a **successful, non-empty** result — the engine's "did you forget to
return?" check passes. That mesh then reaches `frameModel()`, whose
`Box3.isEmpty()` bail-out is false for a zero-*size* (non-empty) box, so it
places the camera exactly on the orbit target. `OrbitControls` derives a NaN
spherical angle whose damping never converges, firing `change` every frame and
pinning the render loop at full rate forever — the observable "freeze."

**Why not wrap/rename the whole Manifold API.** `const { Manifold } = api`
appears 288×/146 files (every catalog session-JSON, examples, tests, persisted
IndexedDB sessions). Renaming breaks back-compat for unmigratable saved
sessions; a full bespoke wrapper is a permanent maintenance tax and abandons the
native-familiarity priors models have. Decisive point: argument-guarding does
*not* fix the freeze class (scale(0), empty booleans, degenerate imports all
reach it too) — so the real fix belongs at the render boundary, independent of
the API surface.

**Fix 1 (renderer, the actual freeze fix).** `frameModel()` now bails when
`maxDim <= 0` or any of `maxDim`/center are non-finite, before touching the
camera. Catches the whole degenerate-geometry class, not just sphere.

**Fix 2 (sandbox, actionable error at the source).** `installPrimitiveGuards`
validates the required dimensions of `sphere`/`cylinder`/`circle` (and the
optional size of `cube`/`square` when provided) via the existing
`assertNumber`/`assertNumberTuple` helpers, installed at the existing
`wrapMethodsForTracking` seam (before tracking, restored after — reverse order
so the two wrappers compose). A missing radius now yields
`Manifold.sphere(radius) is required …` instead of a silent zero-size solid.
`cube()`/`square()` keep their documented unit-shape default.

Also updated the help-page prose to show argument'd primitives
(`sphere(15)` etc.) rather than the now-erroring no-arg forms. Added
`tests/degenerate-geometry-guard.spec.ts` covering both guards + the recovery
path. Verified in-browser: no-arg sphere returns a clean error, a `scale(0)`
mesh keeps the camera finite, and a subsequent valid model re-frames normally.
