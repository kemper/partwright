---
date: "2026-06-05T01:30:00Z"
task: "feat: add 8 reference-image catalog entries (2 per engine: manifold-js, scad, replicad/BREP, voxel)"
areas: [catalog, tooling, docs, agents, geometry-api]
cost: high
---

Consolidated from **8 modeling sub-agents** driven in two waves of four (one per
engine per wave) to add ambitious, reference-image-driven catalog entries on the
"Country Manor Estate" bar. Each agent picked a real reference image, authored
its model, and **baked → `Read` the PNG → iterated** on visual quality via a
shared single-entry build helper (`scripts/build-catalog-entry.cjs`).
Frequency = number of *independent* agents who hit the item, so the facilitator
can weight it. This pass strongly **corroborates** the 2026-06-04 catalog retros
(camera orientation, slow cold-bake loop, fuseAll label scramble, desaturated
colors) — those are now multi-pass, multi-agent patterns, not one-offs.

## Liked / Worked
- **The bake → `Read` PNG → iterate loop is again the MVP** (8/8 agents). Judging
  each render as a real catalog tile caught what stats can't: a gondola hidden
  under an airship envelope, a faucet handle painted onto the wrong arch, a
  pagoda roof stair-stepping before the hull-sweep rework. Screenshot-driven
  art direction is the right primitive.
- **`api.label(part,'name',{color})` (manifold-js) bakes color for free** — the
  pagoda, airship, and the self-coloring `labeledUnion` pattern produced vibrant
  tiles with zero paint step. This is the headline color path and it just works.
- **Mid-task tooling fixes paid off immediately.** After Wave 1, two helper gaps
  the agents surfaced were fixed before Wave 2: (a) the voxel warmup probe used a
  non-existent `v.toManifold()`; (b) label-based models (scad/replicad) baked
  gray because the helper snapshotted before painting. Adding a `--palette
  '{"label":"#hex"}'` flag (paint labels → `commitWithColors` → re-snapshot)
  let the Wave-2 scad watch paint 15 regions first try. Closing the loop between
  waves is a real win of the wave structure.
- **`runAndExplain` / component-floater naming (replicad)** — the faucet agent
  converged on `componentCount:1` fast because the explain output named the
  floating body with volume/centroid and "sits on max-Y face, translate to
  overlap." More of this everywhere, please.

## Lacked
- **`componentCount` is a bare number with no "which piece floated?"** (≈4 agents:
  pagoda, pirate-ship, locomotive, watch). When you're chasing a watertight bake,
  the only signal is the count; you reverse-engineer *which* island broke off by
  hand. The pagoda agent burned 3 rebuilds guessing roof-vs-wall-vs-bracket. The
  voxel agents reimplemented flood-fill in Node just to find the stray island.
- **The `--palette` happy path SILENTLY mispaints on replicad `fuseAll` solids**
  (faucet agent). `listLabels` reported `count:2`, `PAINT FAILED` was empty, yet
  the handle blue landed on the spout — only the thumbnail caught it. The
  documented BREP coloring path has no mismatch detection; the agent had to
  hand-roll a 60-line coordinate-paint wrapper (re-implementing the helper's
  warmup/export boilerplate).
- **No sweep / pipe / loft primitive** (≈2 agents: pagoda's upturned-eave roof,
  faucet's gooseneck). Both got there with discovered hacks — hull three rings;
  full torus → rotate → intersect a half-space. Curved roofs, vaults, tubes, and
  goosenecks are common catalog shapes and currently require non-obvious tricks
  that aren't in the helper list.
- **scad: a `for`-loop wrapping `label()` silently drops ALL labels** (orrery
  agent burned a full build; watch agent dodged it only because the brief warned
  after the fact). The fallback auto-names every object and nukes labels with
  only an `INFO` line the helper swallows. `ai.md` warns about labels inside
  booleans, not the far more natural loop case.
- **The verify loop is cold every time** (≈5 agents: pagoda, airship, pirate,
  watch, locomotive). ~30–60 s manifold/voxel, ~90 s replicad/OCCT per bake,
  dominated by Chromium boot + WASM warmup. Most iterations were color/proportion
  tweaks that don't need a GL snapshot.
- **The catalog tile camera is undocumented and the obvious guess is wrong**
  (≈2 agents: locomotive inferred it from another entry's comments; airship
  nearly shipped an occluded gondola). Reconfirms the 2026-06-04 finding — still
  unfixed.

## Learned
- **Many catalog subjects legitimately are NOT one component**, and the tooling/
  brief over-index on `componentCount:1` (≈4 agents: orrery 26, watch 28, airship
  23, pagoda 15). A skeleton watch, an orrery, a multi-part assembly *should* be
  many watertight bodies; fusing them would misrepresent the mechanism. Agents
  wasted cycles second-guessing a perfectly correct count. `isManifold:true` is
  the real gate; the component count needs an "expected N" escape hatch.
- **replicad has no code-side self-color.** `api.label(shape,name,{color})` works
  in manifold-js (engine emits `labelColors`) but the replicad engine only emits
  a `labelMap` — `BREP.label` takes no color arg. So a pure `return BrepShape`
  always renders gray; the brief's "self-color via api.label" is currently
  impossible for BREP (doc-vs-reality gap in `replicad.md`/`colors.md`).
- **`paintInCylinder` is hard-locked to the Z axis** (turbofan agent) — composing
  an engine along Y forced either a 180° geometry flip or negating every paint
  z-range. `paintSlab` already takes a `normal`; the cylinder painter doesn't.
- **manifold-js gotchas that cost an iteration each** (airship agent): `hull()`
  on two shapes is `a.add(b).hull()` (not `Manifold.hull(a,b)` — cryptic
  "called with 1 arguments, expected 0"); and `cs.extrude(h,nDiv?,twist?,...)` as
  an *instance* method shifts the positional args vs the static signature in docs.
- **voxel connectivity is the #1 voxel trap** (pirate-ship agent): `v.line` lays
  an 8-connected (diagonal) Bresenham path, which is NOT face-connected, so
  rigging/sails spawn dozens of manifold-breaking islands. Required a hand-rolled
  flood-fill + nearest-cell bridge pass.
- **A `fillet(r)` that works on one rim fails "radius too large for at least one
  edge" on an ordinary cylinder rim elsewhere** (faucet agent) — a hard failure
  with no preflight; the feature had to be deleted rather than clamped.

## Longed for
- **Per-component introspection** — a `partwright.componentStats()` (and a helper
  `--explain-components` flag) returning per-island bbox / volume / voxel-count,
  plus an `--expect-components N` so legitimately-multi-part models don't read as
  defective. This is the single highest-frequency ask of the pass (≈4 agents) and
  would erase the "which piece floated?" guessing loop. (Echoes 2026-06-04's
  "richer BAKE_RESULT stats.")
- **A first-class sweep/loft/pipe primitive** — `api.loft([profiles])` /
  `BREP.pipe(path, r)` / `BREP.sweepArc({...})`. Generalizes across roofs, hulls,
  vaults, goosenecks, ducts — the shapes agents most often had to fake.
- **A warm, reused engine page for batched bakes** (≈5 agents) and/or a
  `--no-thumbnail` stats-only fast mode on the build helper. Cold Chromium+WASM
  per iteration is the dominant wall-clock + token cost when art-directing one
  model. (Reconfirms 2026-06-04.)
- **Label-paint that actually works through `fuseAll`** (or `--palette` detecting
  a label-bbox vs feature mismatch and warning), plus **code-side BREP color**
  (`BREP.label(shape,name,{color})` → `labelColors`) so replicad entries can be
  one-line-colored and tiny like a manifold underlay.
- **A documented/loud scad label rule**: "unroll every loop — a `for` wrapping
  `label()` loses ALL labels," and a `warning`-level diagnostic (not swallowed
  INFO) naming dropped labels when the object count mismatches.
- **Tile-camera control + an orientation probe** — one sentence ("the catalog 3/4
  thumbnail looks toward +X/+Y; put the hero face on the −Y/+X corner") in
  `voxel.md` and the bake tooling, a `--views box` 4-up composite flag to catch
  occlusion in one bake, and/or `--thumb-azimuth/--thumb-elevation` so
  composition isn't baked into geometry. (Reconfirms 2026-06-04 — still the most
  repeated avoidable cost.)
- **Voxel ergonomics**: `v.disc(center, r, axis, color)` (1-thick filled circle —
  wheels/portholes/gears), a `v.bridgeComponents()` / 6-connected `v.line`, a
  `v.shade({top,side})` normal-based recolor pass, and a `voxels.toHex(c)`
  companion to `voxels.color(c)` (round-tripping packed→hex for bridges is manual).
- **`paintInCylinder({axis})`** to match `paintSlab`'s `normal`, decoupling
  composition orientation from colorability.
