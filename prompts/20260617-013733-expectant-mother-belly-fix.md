---
date: 2026-06-17
branch: claude/wonderful-planck-02rnpz
files_changed:
  - examples/figure_expectant_mother.js
  - public/catalog/expectant_mother.partwright.json
---

## Human

Reviewing the figure catalog after the recent figurine fixes, the
`expectant_mother` entry is the worst of the lot — the belly bump reads as a
giant horizontal growth jutting off the chest and the cradling hands float in
front of it. Investigate and fix.

## Assistant

Diagnosed the catalog source (not the engine): this entry was added once in
`1d3e101` and never re-tuned, so the later #701–#707 figure-API fixes never
touched its hand-built belly ellipsoid.

Root cause — the bump and the cradle pose were mutually mistuned:
- bump half-height `chestX*1.45` (≈7.2) centred at Z 34.6 → spanned Z 27→42,
  climbing to the chest joint (Z 40.5), so it read as a chest mass, not a belly.
- depth `chestY*1.95` projected the front face to Y −10.6 — the horizontal-growth
  profile.
- the pose pinned both hands at [±3.1, −12.9, 37.8] — 7 above the navel and
  2.3 *in front of* the bump face, so they floated instead of cradling.

Fix (delegated the render→adjust visual loop to the `model-sculpt` subagent so
the iteration PNGs stayed out of the main context):
- Lowered and shrank the bump to a natural gravid ellipsoid centred just below
  the navel (`bumpW = hipsX*1.02`, `bumpD = chestY*1.72`, `bumpH = chestX*0.95`,
  centre Z = navel−1.5) — spans ≈ Z 24.5–34, well below the chest.
- Re-posed the cradle (`arms: { raiseSide:-10, raiseFwd:-5, bend:90 }`) so the
  forearms come forward over the belly's upper front.
- Dropped `footDetail` (feet are hidden inside the long skirt) and raised
  `edgeLength` 0.58 → 0.72 to bring the tri count from 214k (over the 200k
  advisory budget) down to 199k.
- Rewrote the stale target-math comments left over from iteration to describe
  the values actually shipped.

Re-baked the colored catalog entry with the committed palette
(`public/catalog/palettes/expectant_mother.json`) via
`build-catalog-entry.cjs` under `xvfb-run`. Result: isManifold true,
componentCount 1, 199k tris, no tri-count warning. Verified the colored hero
(3/4 front) and a throwaway colored side view — clean pregnant silhouette,
hands cradling.

Residual trade-off: a ~1–2 unit air gap remains between the hand and the
belly in the strict side view (they read as touching from the hero angle).
Fully closing it would need forearm-rotation the `sdf.figure` pose API doesn't
currently expose — noted, not blocking.
