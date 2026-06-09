---
date: 2026-06-09
author: claude (opus-4-8)
area: surface modifiers / wireframe edge cage
---

## Human

User applied the new Wireframe modifier to the catalog **lighthouse** and got
"garbage" on Apply — asked me to reproduce and fix.

## Assistant

Reproduced with a scratch Playwright spec that loads the lighthouse session and
applies the modifier. The lighthouse body is a **smooth tapered cone** (the
red/white stripes are *paint*, not modeled steps), so its only sharp geometric
edges are horizontal rings: the base, the gallery platform, the lamp room, the
dome base, and the finial — and those rings are **disconnected** from each other
(the smooth cone between them carries no feature edges).

Root cause: `applyWireframe` defaulted `watertight: true`, which runs
`largestMeshComponent` and **keeps only the single biggest loop**. So the
42-tall lighthouse collapsed to just its base ring (output bbox Z 2.9–11.7) — the
"garbage." With `watertight:false` the full cage appeared (Z −1.1→43.2, 9
components: every ring).

Fix: a cage's feature edges commonly form several disconnected loops, so keeping
only the largest is almost never right here (it *is* right for the Voronoi lamp,
whose struts are one connected web — that's where the default was copied from).

- `defaultWireframeOptions.watertight` → **false**; `wireframeMesh` now applies
  `largestMeshComponent` only when `watertight === true` (was `!== false`).
- Surface panel: the checkbox defaults **unchecked** and is reworded to "Keep
  only the largest piece (drops separate edge loops)", with a hint that
  round-bodied models cage as stacked rings.
- `tools.ts` schema/description + `public/ai/textures.md` updated: default false,
  and an explicit note that a round/smooth body has no vertical edges so its cage
  is a set of rings, not a full outline (expected, not a failure).
- New e2e assertion (`tests/surface-wireframe.spec.ts`): a cylinder's two rim
  rings are kept as ≥2 components by default and collapse to 1 with
  `watertight:true` — locks the regression.

Verified: default lighthouse cage now spans the full height with all rings; cube
golden path and unit tests unchanged (a cube cage is one connected piece either
way).
