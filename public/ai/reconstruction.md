# Mesh → code reconstruction

Turning an imported mesh (STL) into faithful, editable, import-free code.
Two tools do the heavy lifting; your job is judgment and targeted refinement.
These tactics are distilled from the headless inverse-CAD loop that converged
37 articulated-figure parts and the 3DBenchy to sub-0.1 chamfer.

## The tools

- **`convertToCode({quality?, step?, edge?})`** — deterministic baseline.
  Slices the current model into measured Z-sections and rebuilds it as a
  smooth `Manifold.levelSet` interpolation of their 2D signed-distance
  fields (multi-blob slice runs fall back to flat per-slice extrusions).
  Splits multi-part meshes into components, drops export debris, runs the
  generated code, saves a version, and returns `{ stats, metrics }`.
  `quality: 'draft' | 'standard' | 'fine'` trades speed for smoothness
  (≈ ×4 build time per level); explicit `step` (section pitch) and `edge`
  (levelSet resolution) override it.
- **`evalAgainstImport({index?, samples?})`** — the verifier. Chamfer
  (mean surface deviation) + hausdorff (worst point) between the current
  model and the imported original. **Never claim fidelity from memory —
  re-measure after every edit.**

## Reading the numbers

- **`sampleSpacing` is the noise floor.** Both metrics come from matched
  point-cloud samples; distances below `sampleSpacing` are sampling noise,
  not real error. A chamfer within ~2× the floor is an excellent remake.
  Raise `samples` for a tighter floor when you need to resolve fine error.
- **Chamfer high everywhere** → resolution problem. Re-convert with
  `quality: 'fine'` or a smaller `edge` — don't post-process.
- **Hausdorff spike with a good chamfer** → a localized missed feature
  (a thin fin lost between sections, a hole that vanished, an overhang the
  Z-sectioning stepped). Find it by comparing `renderViews` of the remake
  against the import (re-run the import wrapper in `runIsolated` if you
  need a reference render), then fix it locally.
- **Components matter.** `stats.components` should match what the source
  visibly is. Fused-together parts mean the source components touch or the
  debris filter merged them; missing parts mean they were debris-dropped
  (check `stats.warnings`).

## Tactics and traps (measured, not folklore)

- **Never smooth or refine the meshed result.** `smoothOut`/`refine` on
  levelSet output degrades it badly (verified twice: hausdorff 0.16 → 4.3
  on the Benchy hull). Smoothness is set by `edge` at build time.
- **Semantic replacement beats resolution.** If a region is an obvious
  primitive (a cylindrical boss, a rectangular pocket), model it with
  primitives/booleans and union/subtract it against the section-stack body
  — cleaner, lighter, and it gives the user a real parameter. Verify with
  `evalAgainstImport` that the swap didn't move the surface.
- **Banded segments are correct, not a bug.** Where a slice has several
  separated blobs (spread fingers, side-by-side pillars), SDF blending
  would fabricate spurious handles, so those runs are flat extrusion
  stacks on purpose. If banding looks too steppy, a smaller `step` refines
  it; converting the whole model at a finer step is usually cheap compared
  to the levelSet cost.
- **The generated code is self-contained** — no `api.imports` references.
  Keep it that way when editing, so the model re-renders in a session that
  no longer carries the import bytes.
- **Iterate through versions.** `convertToCode` and your edits each save a
  version; if an edit makes the metrics worse, `loadVersion` back rather
  than stacking corrections. Log baseline and final metrics with
  `addSessionNote('[MEASUREMENT] …')`.

## Workflow

1. `convertToCode()` → note baseline `metrics` and `stats`.
2. Judge: numbers near the noise floor AND renders that match the import's
   silhouette/holes/proportions → you may already be done.
3. Refine only what the evidence justifies (resolution vs missed feature vs
   semantic replacement, per the table above).
4. `evalAgainstImport()` after every change; revert regressions.
5. Report the final chamfer/hausdorff to the user in plain language
   ("mean deviation X, worst point Y, sampling floor Z").
