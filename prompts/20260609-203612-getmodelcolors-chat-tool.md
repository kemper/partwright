---
date: 2026-06-09
prefix: fix
---

## Human

In a test on a PR branch the in-app AI tried a tool that failed with
"Unknown tool: getModelColors".

## Assistant

`getModelColors` existed on `window.partwright` (src/main.ts) and was
documented across `public/ai.md`, `public/ai/colors.md`, and
`public/ai/replicad.md` as the way to read the model-declared color
underlay — but it was never registered as an in-app chat tool. The chat
agent, following those docs, called it; dispatch hit the default branch
and returned "Unknown tool: getModelColors". Same parity gap class as the
previously-fixed `listRegions` / `runAndExplain` / `saveVersion` tools.

Decisions:

- Registered `getModelColors` in `src/ai/tools.ts` as a parameterless tool
  next to its siblings `listLabels` (uncolored label features) and
  `listRegions` (manual paint regions).
- Put it in `ALWAYS_AVAILABLE` (it's a pure read of declared colors, not a
  paint mutation, so it stays listed even when `paintFaces` scope is off,
  mirroring `listLabels`) and in `RETRY_SAFE_TOOLS`.
- Added the dispatch case delegating to the existing `api.getModelColors()`.
  No new console API or validation needed — the method already exists and
  `PartwrightAPI` is the untyped record dispatch already uses.
- Added `tests/ai-getmodelcolors-tool.spec.ts`, mirroring the
  `ai-listregions-tool.spec.ts` regression guard: asserts the tool is
  listed (with and without paint scope) and dispatches end-to-end against a
  model that declares a color via `api.label(shape, name, {color})`.
