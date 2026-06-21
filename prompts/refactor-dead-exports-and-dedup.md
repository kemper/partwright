---
date: 2026-06-12
branch: claude/elegant-turing-sjwiei
files_changed:
  - src/ai/custom.ts
  - src/geometry/printerSettings.ts
  - src/geometry/voxel/grid.ts
  - src/geometry/voxel/edits.ts
  - src/ui/insertPalette.ts
---

## Human

Follow-up to the pre-release review: dead-export and duplication cleanup.

## Assistant

Each candidate was verified by grepping `src/` AND `tests/` (knip can't see the
e2e suite's dynamic `import('/src/...')`), so nothing live was removed.

**Dead exports removed:**

1. **`resetClient` in `src/ai/custom.ts`** — a no-op (`// Stateless`) with zero
   importers. The anthropic/openai/gemini `resetClient`s are live (settings &
   key modals + provider e2e specs) and were left untouched. Deleted only the
   custom one.
2. **`onPrinterSettingsChange` in `src/geometry/printerSettings.ts`** — a
   pub/sub never subscribed to. Removed the function plus the now-write-never
   `listeners` Set and the `savePrinterSettings` notify loop, and dropped the
   stale "listeners" mention from the file header.

**Kept (knip false-positive triage):**

- **`addTarget` in `voxel/edits.ts`** is NOT dead — `tests/unit/voxelEdits.test.ts`
  imports and exercises it. (It was on my earlier suspect list; grep cleared it.)
- **`SurfaceModifierId`** is an advisory unused *type*, but it's the canonical
  documented enumeration of the modifier set (named in CLAUDE.md and a sibling
  JSDoc). Per the "exports/types need per-symbol triage" rule, kept as living
  documentation rather than deleted for marginal gain.

**Duplication consolidated (only the genuinely-identical cases):**

3. **Voxel 6-face neighbour offsets** were duplicated: an exported
   `FACE_NEIGHBORS` in `edits.ts` and a char-for-char identical local `NEIGHBORS`
   inside `grid.ts`'s `faceComponentCount()`. Promoted the constant to a single
   exported `FACE_NEIGHBORS` in `grid.ts` (the lower module — `edits` already
   imports `grid`, so no new import edge / no cycle) and re-exported it from
   `edits.ts` for back-compat.
4. **The insert-palette click-to-pick raycaster** was wired inline twice
   (operand pick + multi-select), identical but for the per-hit callback.
   Extracted a local `attachPartPicker(canvas, camera, mesh, onPick)` helper that
   also owns the geometry/material disposal, and routed both sessions through it.

**Investigated but deliberately NOT merged** (divergent — merging would be a
bug): the broader Raycaster usages (annotation overlay vs programmatic probe vs
plane-intersect vs interactive-mesh are four distinct patterns), and the two
`NUM` numeric-parse regexes (`controller.ts` accepts `.5`/scientific notation;
`parseStatement.ts` is a strict parser for a controlled emission format).

Verified: typecheck, no circular deps (`lint:deps`), knip clean of the removed
symbols, 1264 unit tests, and the full insert-palette + insert-codegen e2e
suites (205 tests) — which exercise the refactored raycaster pick path.
