---
date: 2026-06-17
title: Raise the advisory triangle budget to 500k
---

## Human

User asked to understand the "triangle gate/limit" on catalog entries — worried it
was downgrading figure quality — and, after the investigation, to bump it to 500k.
Separately asked whether older catalog entries still embed per-triangle paint data
in their JSON now that slab/paint ops can be declared in code, and whether they
should be rebaked.

## Assistant

Investigation findings (reported in chat, no code needed for the answer):

- The "triangle limit" is **advisory only** — a single `triCountWarnBudget`
  constant that drives a non-blocking `warnings[]` string in
  `geometryHeuristics.ts`, `previewModel.ts`, and the model-sculpt agent's
  self-imposed gate. Nothing rejects a denser model; the catalog bake
  (`build-catalog-entry.cjs`) gates on genus/labels, not triangles.
- The only hard catalog **gate** is `lint:catalog`, which is **file-size** based
  (1500 KB hard), driven by base64 thumbnails + per-triangle paint id lists —
  *not* triangle count.
- Figure catalog entries store re-runnable manifold-js **code** (~3 KB), not a
  baked mesh, so a high triangle count costs per-open render + slice time, not
  catalog file size. That makes 500k low-risk.

Change made:

- Bumped `triCountWarnBudget` default 200k → 500k in `appConfig.ts` and expanded
  the doc comment with the rationale.
- Wired `previewModel.ts`'s headless warning to read
  `APP_CONFIG_DEFAULTS.geometry.triCountWarnBudget` instead of a hardcoded
  `200000`, so the in-app and headless signals can't drift again.
- Updated the ~200k references in live guidance (`CLAUDE.md`, `public/ai.md`,
  `model-sculpt.md`) and the stale comment in `sdf.ts` (the 400k REFINE cap is a
  separate safety guard, value unchanged). Left historical `prompts/`/`retros/`
  logs untouched.

The Advanced Settings field already reads the default, so the user-facing knob
updates automatically. The geometryHeuristics unit test passes its own threshold
fixture, so it's independent of the default — no test change needed.

The paint-blob rebake question (6 older entries carry ~677 KB of brush-painted
per-triangle id lists) was reported separately as a follow-up — it's a per-entry
re-authoring job (add `api.label` + `paintByLabels`), not part of this change.
