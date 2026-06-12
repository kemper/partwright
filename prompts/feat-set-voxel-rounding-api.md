---
date: 2026-06-12
branch: claude/elegant-turing-sjwiei
files_changed:
  - src/main.ts
  - public/ai/voxel.md
  - tests/voxel-studio.spec.ts
---

## Human

Follow-up to the pre-release review: close the `setVoxelRounding` UI↔JS-API
parity gap (the Voxel Studio Rounding panel had no `window.partwright` twin).

## Assistant

The Rounding panel (`voxelPaintUI.ts` → `voxelPaint.setRounding`) was only
reachable by clicking — a parity gap of exactly the kind the mid-2026 audit
flagged. Added the console/MCP twin so an agent can drive what the panel does.

- **`setVoxelRounding(opts | null)`** on `partwrightAPI`, mirroring the sibling
  `setVoxelBrush`/`setVoxelLevelAxis` pattern: active-guard first, then inline
  per-field validation returning `{ error }` (never throwing, per the
  value-returning-method rule), then `voxelPaint.setRounding` +
  `syncVoxelPaintUI()` so the panel reflects the change, returning the resolved
  `{ surfacing }`. `null` → hard blocks.
- **Validation mirrors the engine's real bounds** so nothing reaches
  `VoxelGrid.smooth()` that it would *throw* on: `algorithm` ∈
  {taubin,surfaceNets}, `strength` 0..1, `iterations` 1..8, `flatBottom` bool,
  `baseLayers` int 0..1024. `baseLayers: 0` is treated as "no flat base" and
  stripped (the engine's `smooth` requires `baseLayers ≥ 1`, so passing 0 would
  throw — the UI does the same `>0 ? n : undefined` dance).
- **`getVoxelRounding()`** for read-back parity.
- Registered both in the `help()` table (the discoverability surface) and
  documented them in `public/ai/voxel.md` (code block + bullet).

Verified in a real browser: error paths return `{error}`, surfaceNets/taubin
apply and read back, `null` reverts to blocky, and the panel's Rounding controls
reflect the programmatic state (screenshot posted). Added two permanent
golden-path e2e tests in `voxel-studio.spec.ts` (happy path + read-back, and the
studio-inactive error path). Did NOT add an `src/ai/tools.ts` chat tool — the
Voxel Studio is interactive direct-manipulation, and the chat AI's documented
path for rounding is writing `.smooth({...})` in code; the console API is the
right level here.
