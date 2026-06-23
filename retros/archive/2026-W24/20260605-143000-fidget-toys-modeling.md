---
date: "2026-06-05T14:30:00Z"
task: "feat: add catalog search + language filters + Fidget Toys group, and model 10 fidget toys via subagents"
areas: [catalog, tooling, docs, sdf, agents]
cost: high
---

Consolidated from 10 + 6 modeling sub-agents (10 initial authors, 6 revision
passes) driven to model a "Fidget Toys" catalog group: twisty ball, spiral cone,
star spinner, twisted top, twisty egg, lattice ball, gyroid cube, tri-spinner,
fidget cube, ball-in-cage. Frequency = number of *independent* agents who hit the
item. The orchestrator authored the catalog search/filter UI directly and ran all
browser bakes centrally (sub-agents wrote code only, no Playwright, to avoid
renderer contention).

## Liked / Worked
- **Central bake → `Read` PNG → feedback → re-author loop caught every real
  defect** (orchestrator + all agents). Stats said `isManifold: true,
  componentCount: 1` for BOTH gyroid models — yet they rendered as solid blobs.
  Only the screenshot revealed it. Same for shallow twist grooves (looked like
  scuffs), a star "spinner" that came out a squat drum, and a ball-cage with
  struts so thick the ball was hidden. Eyes-on is non-negotiable for art-directed
  geometry.
- **`api.label(shape,'name',{color})` self-coloring + `api.labeledUnion`** (≈all
  agents) made vibrant, paint-step-free models trivial — colors survive booleans
  and export straight into the thumbnail.
- **`Manifold.extrude(cs, h, nDiv, twistDeg, scaleTop)` is a near-perfect twist
  primitive** (≈5 agents): the whole twist/spiral family (ball, cone, top, egg,
  star) is one call once you have the right cross-section. `Manifold.hull()` of 8
  inset corner spheres is a clean rounded-cube with no SDF needed.

## Lacked
- **A headless single-snippet preview was longed for by EVERY sub-agent (16/16) —
  the single biggest, most unanimous ask.** They wrote geometry blind: the
  contract (correctly) bars them from Playwright to avoid renderer contention, so
  every depth/twist/proportion/color guess costs a full central bake round-trip. A
  tiny CLI — `npm run fidget:preview <file.js>` → `{isManifold, componentCount,
  bbox, volume}` + a 4-iso PNG, run against real manifold-3d WASM in Node without
  a dev server or the e2e harness — would let an author self-correct a failed
  boolean, a degenerate tip, a stray component, or a too-shallow groove in one
  second instead of burning an orchestrator round. This is the highest-leverage
  tooling gap for any catalog-modeling work and recurs across retros.
- **`sdf.md`'s gyroid `thickness` guidance is actively WRONG and cost a full
  revision round on BOTH lattice models** (2 agents independently, + orchestrator
  to root-cause). The prose says `thickness ≈ cellSize/6 to cellSize/3` is the
  "sweet spot." In the code (`tpmsNode`, `sdf.ts:754`) the node is
  `(|F(k·p)| - thickness)/k`, so `thickness` is a FIELD THRESHOLD compared against
  the gyroid field, which only ranges ~[-1.5, 1.5]. So `thickness ≥ 1.1` selects
  `{|F| < 1.1}` ≈ all of space → a SOLID blob, and `≥ 1.5` is fully solid. Both
  agents dutifully followed the doc's ratio (1.9, 2.4, then "thinner" 1.1–1.2) and
  still got solids; the actual open-lattice range is `thickness ≈ 0.4–0.7`
  (matching the working examples `gyroid(5, 0.5)` / `gyroid(5, 0.8)` — which the
  prose contradicts). **Fix the doc:** state that `thickness` is a field threshold
  (~0–1.5), that ~0.4–0.7 gives an open see-through lattice, that the
  `cellSize/6..cellSize/3` figure is unitless-wrong, and that pore size is set by
  `cellSize` while open/closed is set by `thickness`. Add the "renders solid"
  failure mode explicitly.
- **No "fidget/twist cookbook" recipe** (≈4 agents): the depth rule that makes a
  twist read ("crest must exceed / valley must undershoot the clip radius, by
  ≥0.3·R — shallow rim-notches on a near-coincident column only bite at the
  equator and fade at the poles"), and the flat-spiral-bloom aspect ratio (height
  ≈ 0.25–0.35·radius + high twist + `scaleTop>1`), were each re-derived (and first
  shipped wrong) per model. A short `ai/` recipe page for the common fidget forms
  would have produced correct first drafts.
- **No documented catalog tri-count / file-size budget** (orchestrator). The first
  open gyroids meshed at 290k–470k triangles; only by enlarging cells did they
  drop to ~160–200k. `/catalog` re-runs each model on open, so an unbounded
  `edgeLength` on a TPMS is a real perf trap. A stated budget + "tie edgeLength to
  cellSize, not wall thickness" guidance would help.

## Learned
- For gyroid open-ness: `thickness` (field threshold) controls solid-fraction;
  `cellSize` controls pore size; tie `edgeLength` to `cellSize/14..16` (not to the
  wall) so thin walls still resolve without a runaway mesh.
- `componentCount`/`isManifold` are necessary but NOT sufficient quality gates for
  art-directed models — a solid sphere and an open lattice can report identically.

## Longed for (most important)
The headless preview CLI above. If one tooling change is made from this retro,
make it that — it would have removed the majority of the 6 revision rounds, and
it's the same ask the previous catalog retro raised. The contract's
"sub-agents don't run the browser" rule is right for *contention*, but it leaves
authors with zero feedback; a contention-free Node-WASM stat+thumbnail probe
resolves both at once.
