---
session: "trusting-dirac"
timestamp: "2026-06-05T18:40:00Z"
---

## Human

Create a new PR for the doc changes.

## Assistant

## Key decisions

**Separate PR, separate branch.** The in-app print-in-place mechanism guidance had
been held out of the catalog/tooling PR (#447). On request, I moved the three
files — `public/ai/mechanisms.md` (new subdoc), plus its wiring in `public/ai.md`
(topic index + verb-tree rows) and `src/ai/tools.ts` (`SUBDOC_NAMES` +
`readDoc` description) — onto a fresh branch cut from `origin/main` (via stash →
checkout → pop, after confirming the files matched `main` so nothing from #447
leaked in). This keeps the docs PR an independent, clean diff and unblocks #447.

**Audience-correct content.** This subdoc targets the *in-app / chrome-extension*
AI, so it speaks only the in-browser vocabulary — `renderViews()`, sandbox
`decompose()`, `runAndSave(..., {maxComponents})`, `componentCount` from
`geometry-data` — and deliberately contains **no** `model:preview`/CLI references
(those live in `CLAUDE.md` for repo agents). Same technique, different tool surface.

**Corrected before shipping.** The subdoc leads with the verified recipe — split a
solid with a clearance-thick cutter (e.g. a full-diameter helical slab), then
`decompose()` and color each component — replacing an earlier *false* claim
(that a helical cut can't split a solid of revolution) that I'd caught and proven
wrong with the engine. Doc claims about geometry are stated only after testing.

**Also fixed a pre-existing drift:** `textures` was missing from the `readDoc`
name list though the subdoc + `SUBDOC_NAMES` already had it — added it alongside
`mechanisms`.
