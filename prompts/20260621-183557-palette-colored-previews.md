---
session: "busycray"
timestamp: "2026-06-21T18:35:57Z"
model: claude-opus-4-8
sequence: 7
---

## Human

Previews should render colors by default when colors are used (add whatever
flags make sense), and the eval system needs to be color-aware too.

## Assistant

## Key decisions

Figures looked grey in model:preview because their source declares UNCOLORED
labels (`.label('skin')`) and the real colors live in bake-time palette JSONs.
Made the fast preview palette-aware so it colors by default, threaded through the
shared engine so eval gets it for free:

- `src/tools/previewModel.ts`: new `palette` option (label→"#rrggbb"). When
  coloring label regions, in-code `labelColors` win; the palette fills labels
  with no in-code color. Added `hexToRgb01`. Broadened the label-color branch to
  fire when a palette is supplied (not only when in-code colors exist).
- `scripts/cli/preview.mjs`: `runPreview(..., { palette })` passthrough — one
  change serves both model:preview AND eval (both go through previewModel).
- `scripts/model-preview.mjs`: `--palette-file <json>` + `--no-palette`, and
  **color-by-default** auto-resolution: explicit → sibling `<base>.palette.json`
  → `public/catalog/palettes/<base-without-figure_>.json`.
- `scripts/eval-models.mjs`: per-case `palette` (inline object, a path, or
  sibling `palette.json`) so contact sheets — and thus the vision judge — see
  figures in color.
- Docs: evals/README (case layout) + CLAUDE.md (corrected the now-false "does
  NOT show palette colors" note).

Verified: `model:preview examples/figure_chibi_wizard.js` now renders in full
palette color with NO flag (auto-resolved); witch via explicit --palette-file.
In-code-colored models (gears/knob) unaffected. typecheck clean, 1586 unit tests
pass, shoulders eval unchanged (no palette → grey, as before).
