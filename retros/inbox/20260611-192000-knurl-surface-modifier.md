---
date: "2026-06-11T19:20:00Z"
task: "feat: knurl surface modifier — diamond/straight grip texture with panel controls (PR #590)"
areas: [surface, ui, geometry-api, testing]
cost: low
---

## Liked / Worked
- **The fabric-texture family is now a genuine template**: knurl went from
  zero to fully wired (op spec, applyChain case, modifier + patch variant,
  panel tab, console method, AI tool enum, sandbox member, docs, tests) in
  one pass by mirroring waffleStitch.ts shape-for-shape. The "full parity
  wiring checklist" from earlier phases is the reason nothing was missed.
- **The unit-tier invariant table** (deterministic, finite, subdivides,
  zero-amplitude no-op, color carry-through) accepted the new modifier as one
  table row — the cheapest meaningful coverage I've ever added.
- **TypeScript exhaustiveness did its job**: adding 'knurl' to SurfaceOpId
  immediately flagged the `Record<SurfaceOpId,…>` in manifoldJs.ts I'd have
  otherwise forgotten.

## Lacked
- Nothing notable — the established patterns held.

## Learned
- **api.knurl (parametric cylinders) and the surface knurl (displacement
  texture) are deliberately different mechanisms** that share vocabulary
  (pitch/depth/aspect/diamond-vs-straight) so they read as one family. The
  twisted-extrude intersection approach can't skin arbitrary geometry; the
  triplanar displacement can. Worth remembering when someone asks why there
  are "two knurls."

## Longed for
- A **scaffold script for new surface modifiers** (`npm run new:modifier
  <id>`) that stubs the sibling module, op-spec entry, applyChain case,
  defaults factory, panel tab block, and the unit-table row. The checklist is
  reliable but it's ~10 files of mechanical echo per modifier.
