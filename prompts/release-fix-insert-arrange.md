---
date: 2026-06-12
branch: claude/elegant-turing-sjwiei-insert-arrange
files_changed:
  - src/renderer/meshGeometry.ts
  - src/renderer/phantomGeometry.ts
  - src/ui/insertPalette.ts
---

## Human

Pre-production-release review of `main`. Fix correctness defects from the recent
merge window (the insert/arrange palette is the newest, roughest area).

## Assistant

Three correctness fixes in the insert/arrange palette:

1. **`apiResizeSelection` returned `{ ok: true }` on rejected input.** Its
   internal `applyResize()` toasts and silently no-ops on a non-positive scale
   factor, so a scripted/AI caller branching on the result saw a false success
   (violating the "return `{error}` on bad input" API rule). Validate
   positivity in the wrapper and return `{ ok: false, reason }`. (The UI dialog
   already clamps, so users were unaffected.)

2. **`meshDataToGeometry` was duplicated and had diverged** between
   `renderer/phantomGeometry.ts` (computed vertex normals) and
   `ui/insertPalette.ts` (did not). Harmless today — the palette's copy only
   feeds raycaster pick meshes — but a drift trap. Extracted a single
   `renderer/meshGeometry.ts` leaf (with normals) and pointed both at it.

3. **The Undo/Redo panel buttons duplicated `apiUndo`/`apiRedo`'s toast logic**
   instead of calling them, so the keyboard / console path and the buttons
   could drift. Routed the buttons through `apiUndo()` / `apiRedo()`.

Skipped a flagged "divide-by-zero" in `syncBoxToEntry` — the divisor is always
≥0.001 or undefined (→NaN→`|| 1`), so it can't actually occur; adding a guard
would be noise.

Verified: typecheck, no new circular deps, 1264 unit tests, and the full
insert-palette + insert-codegen e2e suites (205 tests) all pass — including the
undo/redo button and round-trip cases.
