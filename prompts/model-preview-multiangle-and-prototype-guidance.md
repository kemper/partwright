---
date: "2026-06-13"
task: "feat: model:preview multi-angle --view + prototype-when-subjective agent guidance"
pr: draft
areas: [tooling, docs, process]
---

## Human

Update the agent instructions to prototype when things are subjective. Also update model:preview to do multiple angles in one call by passing information as argument(s).

## Assistant

Two changes, both from the footwear retro:

1. **`model:preview --view` now takes multiple `;`-separated `az,el` pairs** (`--view "130,35;0,-72;90,7"`), tiled in one call — so an agent can capture iso + underside + side in a single render instead of one bake per angle. Implemented in `resolveViews` (scripts/cli/views.mjs); `composePng`/`tileGrid` already grid an arbitrary view array, so no renderer change. Back-compatible (single pair still works; trailing ';' tolerated). Unit tests added; CLI usage + CLAUDE.md docs updated.

2. **CLAUDE.md guidance: prototype subjective/aesthetic work before implementing.** When the deliverable is *how something looks* (shoe/face/silhouette/colour), build 2–3 throwaway variations, render them from ≥4 angles incl. the underside in colour, show the user a side-by-side, and let them pick — instead of implementing one interpretation and iterating it through full bake→review cycles. Added as a callout in the model:preview verification block (the footwear sole shipped "fixed" several times before a demo-and-pick converged it).
