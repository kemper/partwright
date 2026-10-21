---
date: "2026-06-12T01:30:00Z"
task: "feat: five surface-UX follow-ups — scoped previews, engrave worker, knurl pyramid, parametric scale, brush-stroke survival (PR #606)"
pr: 606
areas: [surface, ui, geometry-api, workers, git-workflow]
cost: large
---

## Liked / Worked
- **One explore-agent pipeline map carried all five items.** Up front I had the
  `explore` agent trace the four unknown paths (preview-vs-apply scope
  resolution, the engrave main-thread SDF path, `scaleModel` vs `commitTransform`,
  and brush-stroke descriptor re-resolution) in its own context and return
  file:line conclusions. Every item then became a wiring change against known
  primitives instead of a fresh investigation — the single delegation paid for
  itself across the whole PR.
- **Every "feature" reused an existing primitive instead of new machinery.**
  Scoped preview reused `selectedTriangles` + `resolveSurfaceScopes` +
  `selectTrianglesNearSeeds` (no new compute mode — just resolve the scope to a
  selection and feed the patch path). Parametric scale reused the
  `TransformStep`/`commitTransform` chain — adding a `scale` step gave `mode`
  for free, identical to place/rotate. The engrave Worker reused the surface
  Worker's terminate-on-cancel idiom. Looking for the seam in what already
  exists beat building parallel paths every time.
- **Splitting `applyEngrave` → `engraveMesh` + `buildEngraveResult` made the
  Worker move surgical.** The heavy half goes to the Worker; the cheap assembly
  (paint transfer + version code) stays main-side; `applyEngrave` itself stays
  intact for the headless/test callers. No caller had to change shape.
- **`import type` keeps a heavy module out of a Worker bundle.** `engraveWorker.ts`
  imports only the pure `engraveSdf` kernel + a `type` from `modifiers.ts`, so
  the worker chunk stayed tiny and `lint:deps` stayed acyclic. The reusable
  recipe for "move compute to a worker": worker imports the pure kernel + types
  only; assembly and worker-construction live in separate main-side modules.

## Lacked
- **Preview fidelity isn't automatable.** `previewSurfaceModifier` is
  viewport-only — it returns `{ok}`/`{error}`, not the result mesh — so I could
  only assert the *wiring* (scoped preview returns ok, malformed region errors)
  in e2e and fall back to a manual screenshot for the actual "only the labeled
  shape got textured" claim. The most user-visible item had the weakest
  automated proof.
- **One of the five was a no-op verification.** Item #4 (brush strokes through
  textures) already worked by design — descriptor-based regions re-resolve onto
  whatever mesh is current. The explore map surfaced that early so the cost was
  just one regression spec, but "verify nothing's broken" is inherently
  lower-yield than the other four; worth front-loading the "is this already
  handled?" question before scoping an item as work.

## Learned
- **A new `TransformStep` kind touches five coordinated spots**: the union type,
  `applySteps`, the `WRAPPER_RE` **and** `CALL_RE` regex pair, the `parseChain`
  cast, and `normalizeChain` (merge + identity-drop). The two regexes are the
  easy ones to miss — a parametric chain that emits fine but won't *re-parse*
  silently nests IIFEs on the next transform.
- **A guard that lives only in the leaf op can be bypassed by a new path.**
  `applyScale` validated factors `> 0`, but routing scale through
  `commitTransform`/`applySteps` skips `applyScale` entirely — the guard had to
  move up to `scaleModel` so both the bake and the new parametric path are
  covered. When you add a second path to an operation, re-check where its
  invariants are enforced.

## Longed for
- **`previewSurfaceModifier` returning result stats (triangleCount).** A single
  optional stat in the return would make scoped-vs-whole previews assertable in
  the unit/e2e tier instead of screenshot-only — closing the test gap on the
  most visible feature in this PR.
- **The cross-branch collision check, again.** `main` advanced 7 commits
  mid-task and I re-synced clean this time, but the same drift that caused the
  dual-knurl conflict in #590 keeps recurring — a daily/gate job diffing open PR
  branches' new exported symbols would still earn its keep.
