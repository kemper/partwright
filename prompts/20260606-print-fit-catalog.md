---
date: 2026-06-06
branch: claude/inspiring-brown-MHzmu
pr: 403
tags: [catalog, print-fit, joinery]
---

## Human

Merge latest main, then add a new catalog category with models/parts that demo the print-fit capabilities.

## Assistant

### Merge resolution

Three-way merge: `tools.ts` and `ai.md` conflicted because both my branch (print-fit) and origin/main (mechanisms, textures) added to the same readDoc enum and verb table. Resolved by keeping all additions: `print-fit`, `textures`, `mechanisms` all present.

Also added `mechanisms` to `systemPrompt.ts` (present in tools.ts from main but missing from the system prompt) so the AI knows to suggest the subdoc for print-in-place joints.

### Font loading fix

`clearanceCoupon` engraves text labels via `deps.text`, but the font-loading heuristic only fires when the user's code literally contains `api.text(`. Fixed `engineWorker.ts` to also pre-load fonts when the code contains `api.printFit` or a destructured `{ ..., printFit, ... }` import — both patterns guarantee the namespace is in use.

Note: the CLI `run` command (phase-1 SSR via `previewModel.ts`) can't load fonts via relative URL fetch in Node.js context, so `clearanceCoupon` only works in-browser. The catalog doesn't include it — it's surfaced as a starter idea and via the `print-fit` subdoc.

### Catalog group and models

Added `'print-fit'` curated group to `catalogCategories.ts`, placed just after `fidget-toys` in the section order. Four demo models:

1. **Print-Fit Enclosure** — base with M3 insert bosses + alignment pin, lid with counterbored M3 screw holes + socket. Two components (base, lid) laid flat for printing.

2. **T-Slot Mounting Bracket** — L-bracket with M4 counterbored holes on the horizontal leg and captive M4 nut pockets on the vertical leg (for 2020 extrusion). Single-component, practical jig part.

3. **Sliding Dovetail Joint** — tail beam and socket beam with `fit: 'normal'` clearance. Two components laid side by side.

4. **Hardware-Ready Mounting Plate** — single plate demonstrating four builders: M3 screw holes (corners), M4 nut pockets (midline), alignment pin (+X edge), alignment socket (-X edge).

All four models were verified via `npm run cli -- run` to be `isManifold: true` before embedding geometry data.
