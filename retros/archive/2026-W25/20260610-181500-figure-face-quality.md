---
date: "2026-06-10T18:15:00Z"
task: "feat: SDF detail regions + figure mouth styles + paintable eyes; catalog regen"
pr: 575
areas: [geometry-api, sdf, figure, catalog, tooling]
cost: medium
---

## Liked / Worked
- **`model:preview` paint-op resolution (merged hours earlier) was the MVP of
  this session.** `api.paint.label(...)` probes gave per-label triangle counts
  headlessly — that's how I verified the eyes/mustache/orb labels actually had
  paintable surface before re-baking, in seconds per iteration instead of a
  browser round-trip each.
- `bin/partwright.mjs compare` settled the central design question (1 vs 2
  refinement rounds, old vs new mouth) with one contact-sheet render each.
- Parallel `model-sculpt` agents upgraded 4 catalog examples concurrently
  against the just-updated `figure.md` — the docs-first ordering meant their
  output matched the new pattern with zero rework.

## Lacked
- **`scripts/build-catalog-entry.cjs` launches a headed browser** and dies in
  this container without X (`headless: false` hardcoded). `xvfb-run -a`
  rescued it, but that cost a failed run + a detour reading the script.
  `catalog-regen.cjs` already uses `headless: true` — the single-entry script
  should match (or document the xvfb requirement).
- SDF `.label()` regions still don't surface in `model:preview` stats for
  manifold-js (the W24 retro backlog item) — I worked around it with paint-op
  probes, which is fine but non-obvious.

## Learned
- **A "paintable" SDF label can silently resolve to 0 triangles** when the
  labelled geometry is fully enclosed by another region after the hard union
  (eyes swallowed by cheek welds; the wizard's old duplicate-sphere orb
  label). The bake palette just skips it and nothing fails loudly — two
  catalog entries shipped with dead labels for a week. The paintByLabel error
  now distinguishes this case, and the headless paint probe detects it, but
  the lesson generalizes: enclosure, not registration, is what makes a label
  paintable.
- `Manifold.levelSet` vertices sit ON the iso-surface; the visible faceting is
  pure chord sag between them — which is exactly why midpoint subdivision +
  re-projection works as a detail pass without re-marching.

## Longed for
- **A label-coverage assertion in the bake script**: `build-catalog-entry`
  should fail (or at least exit non-zero) when a `--palette` label resolves to
  0 triangles, instead of printing PAINT FAILED and writing the entry anyway —
  that's how the dead orb/mustache labels shipped originally.
- `partwright preview --paint-probe label1,label2` — synthesize the
  `api.paint.label` probes automatically instead of sed-ing them into a
  scratch copy of the model file.
