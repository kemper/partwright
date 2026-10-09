---
date: "2026-10-09T02:22:00Z"
task: "fix: catalog defects found by the reviewer eval (19 entries, Sonnet fixers + reviewer loop)"
pr: 994
areas: [agents, tooling, catalog, ci]
cost: high
---

## Liked / Worked
- **Fix → independent review → fix loop converged on every entry.** A shared
  BRIEF.md for all fixers (no git, no manifest edits, prove each defect with
  measurements, read the real app PNG) plus a separate Sonnet reviewer on the
  exact in-app review input (`scripts/catalog-review.mjs prepare`) found a lot
  of real follow-up defects. Examples: a d20 whose numerals were 0.2 mm proud,
  pupils that diverged after an eye rotation, gate slits on the voxel castle,
  and a lips ridge welding a genus handle into the surfer's face.
- **Committing each entry by explicit path** kept half-written files from
  parallel fixers out of every commit.

## Lacked
- **The shared dev server reloads on any `public/` write.** Parallel bakes and
  `prepare` runs kept failing with "Execution context was destroyed" whenever
  another fixer wrote a catalog file. One fixer worked around it with a private
  Vite on another port that ignores `public/`. (cost: many retries across 4 agents)
- **The bake started persisting `Version.surfaceTexture`**, multiple MB, which
  pushed two `api.surface` entries past the 1500 KB `lint:catalog` gate. Only
  CI caught it. The bake now drops it, but `build-catalog-entry.cjs` didn't
  run `lint:catalog` on its own output. (cost: 2 CI rounds)
- **The reviewer keeps finding new pre-existing nits** on large hand-written
  voxel or SCAD models (the castle took 5 reviews). What finally converged it
  was a scripted sweep (hidden voxels, see-through gaps), not more spot fixes.
- **The reviewer can't see paint stored outside code** (`colorRegions`) or
  multi-part sessions (#984), so it produced false findings: the "white paint
  missing" claim on the mug, and "only one part" on the dummy13 kit.
  The coordinator has to triage these.

## Learned
- Scoped `api.surface` ops pick triangles near the label's *base-mesh*
  centroids. Huge flat triangles or slivers make the scope patchy and bleed
  label colours. Uniformly refining the base mesh (`.refine(n)`,
  `extrude(h, nDivisions)`) fixes it.
- Viewport ACES tone mapping caps painted white at about RGB 160 (#1000).
- Multi-label `BREP.label` sets scramble in replicad sessions (#997). Use
  coordinate paint there.
- SDF figure genus surprises can come from tiny additive features (lips ridge).
  Bisect by rebuilding subsets of the parts and re-measuring genus.

## Longed for
- **`build-catalog-entry.cjs --check`**: run `lint:catalog`'s size gate plus a
  z-min==0 / componentCount / label-tri sanity on the freshly written entry, so
  oversized or floating bakes fail at bake time.
- **A dev-server mode for bakes that doesn't watch `public/`**, e.g.
  `npm run dev:bake`, which has `server.watch.ignored` for `public/**`. Parallel
  catalog work stops racing.
- **A voxel "hidden detail" lint** (`model:preview --lang voxel --hidden-voxels`)
  that lists placed voxels whose colour never shows, and 1-voxel see-through
  slits. It would have saved the voxel castle three review rounds.
- **The reviewer input should include `colorRegions` and the session `parts`
  list** (#984), so paint stored in data and multi-part kits aren't misjudged.
