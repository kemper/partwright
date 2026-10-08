# Retro — Character Creator panel (no-code GUI over the figure system)

**Date:** 2026-06-20
**Task:** Product review → picked the Character Creator direction → built the full MVP (PR #804, tracking #805).

## Liked
- **Verify-the-generator-before-the-UI loop.** Writing `specToCode` first, generating sample specs with `vite-node`, and running them through `model:preview` / `figure:smoke` caught every real bug (invalid enums, wrong joint name `lowerLegL`, the dress hem) BEFORE any UI existed. The panel then "just worked" on first browser run.
- **Reading `sdfFigure.ts` assertEnum lists directly** instead of trusting the exploration summary — the summary was wrong in ~6 places (top has no collar/tight; pants length is full|briefs; gaze is center not forward; head takes faceShape; lids has no "round"). The authoritative source check paid for itself.
- **In-code `api.paint.label` for paint** — declaring paint in the generated code (not a separate paintByLabels pass) made colours persist + round-trip for free.

## Lacked
- **No fast "does this figure run + is it manifold + are ALL labels painted" gate including auto-generated labels.** `figure:smoke` surfaced the `lids`/`sole` labels I'd forgotten to paint — but only after I looked. A `--require-all-labels-painted` mode would have flagged the grey-patch bug immediately.
- **The figure API's option surface isn't enumerated anywhere machine-readable.** I reconstructed every enum by grepping assertEnum calls. A generated `figure-api.json` (namespace → fn → options → enum values) would make both this panel and AI authoring far cheaper. (Echoes the W25 "api.* index" backlog item.)

## Learned
- `createToolPanelShell` + `registerCommands` + the `viewport-tools-menu` mount is a clean ~30-line recipe for a new viewport tool panel.
- The Edit tool corrupts on a literal control-byte regex character class — write control-char ranges as explicit `\uXXXX` from the start (I had to fix one via a Python byte-level pass).
- Playwright `getByRole('button', { name })` is a case-insensitive substring match — CodeMirror's Find/Replace "replace" buttons collided with a confirm dialog's "Replace". Scope dialog clicks to the dialog (`getByRole('dialog').getByRole('button', { exact: true })`).

## Longed for
- **A headless "render this figure in colour from N angles" one-liner for catalog-quality QC** without the xvfb bake. `model:preview` shows `api.paint` colours (enough here), but `api.label` palette colours still need the slow bake.
