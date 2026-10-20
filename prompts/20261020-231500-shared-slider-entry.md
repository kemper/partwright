---
date: 2026-10-20
branch: claude/optimistic-gauss-ofleuq
files_changed:
  - src/ui/sliderEntry.ts (new)
  - src/ui/surfaceModal.ts, characterCreatorPanel.ts, paramsPanel.ts, resizeModal.ts, simplifyUI.ts, reliefImportModal.ts, partDetectionPanel.ts, imageVoxelImportModal.tsx, layout.ts
  - src/color/voxelPaintUI.ts, imagePaintUI.ts
  - src/main.ts (clip-Z wiring)
  - .ast-grep/rules/prefer-slider-entry.yml
  - .claude/agents/work-reviewer.md
  - tests/unit/sliderEntry.test.ts, tests/slider-typed-entry.spec.ts
---

## Human

Implement issue #1044 (consolidate the slider + number-entry helpers into one
shared UI component; also give the clip-Z slider a typed entry). Then: create
a PR.

## Assistant

- **Wire, don't lay out.** Every caller had a different layout (label rows,
  units, readouts, ids the e2e suite targets), so the shared piece is
  `bindSliderEntry(range, input, opts)` — pure behaviour on an existing pair —
  plus a thin `createSliderEntry` that makes the two inputs with default
  classes. Callers keep their DOM; the drift was in the behaviour (bounds,
  rounding, commit timing, NaN handling), and that now lives once.
- **Options mirror the real differences found, nothing speculative:**
  `hardMin`/`hardMax` (±Infinity = open), `integer`, `format`,
  `overflow: 'pin' | 'grow'` (paramsPanel/Resize grow, others pin),
  `dragCommit: 'change'` for heavy rebuilds (Character Creator, params),
  `liveTyping` where something reads the value mid-typing (Surface preview,
  Simplify's Apply), and `set`/`setBounds` for state-driven or model-derived
  ranges (Voxel Studio, Simplify, clip Z).
- The `change` handler re-reads the slider rather than trusting the last
  `input` event — the customizer e2e fires a bare `change`, and a real
  keyboard/AT interaction can too.
- A committed typed value is displayed precision-safe, never truncated to the
  display format; slider-driven values use the caller's format.
- Pure helpers (`clampEntry`, `stepDecimals`, `formatEntry`, `entryTitle`)
  are shared with the Preact slider (can't use the DOM binder) and unit-tested.
- Resize no longer re-renders all controls on every uniform-mode drag tick
  (it only re-renders when a typed value grows the range).
- `clipZEntry` is module-level in main.ts: as a function-scoped `let` declared
  ~10k lines below `initClipControls`' call site it would sit in the TDZ.
- Left `paintUI.ts` as is: several of its pairs map the slider through a
  different unit (tenths, 0–100 → 0–180°), which needs a slider↔value
  transform in the helper — filed as a follow-up rather than widening this.
- Added an advisory ast-grep hint (`prefer-slider-entry`) and a work-reviewer
  bullet so new hand-built sliders get flagged.
