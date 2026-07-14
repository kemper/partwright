# Mesh → code reconstruction

Turning an imported mesh (STL) into faithful, editable, import-free code.
Two tools do the heavy lifting; your job is judgment and targeted refinement.
These tactics are distilled from the headless inverse-CAD loop that converged
37 articulated-figure parts and the 3DBenchy to sub-0.1 chamfer.

## The tools

- **`profileModel({index?, source?, sectionsPerAxis?, axis?, at?})`** — the
  measurement instrument, and the FIRST call of any reconstruction. Sweeps
  cross-sections along every axis, fits a circle and a rounded-rect to each
  section's outer contour, and merges steady fits into runs: a run of
  circular sections at constant radius IS a measured cylinder ("circle
  r≈2.31 from z=8.1..14.0"); a run of rect sections IS a measured box. Each
  fit carries `rmsRel` (residual / feature size) — near zero means the fit
  is real, not wishful. `axis`+`at` probes ONE section in full detail,
  including circle fits of holes (measure a bore directly). Organic and
  multi-blob regions are reported as such: those are where the
  section-interpolation baseline is the right tool.
- **`fitInscribed({kind?, index?, source?})`** — the largest axis-aligned
  box or Z-axis cylinder that fits entirely INSIDE the mesh, measured from a
  voxel occupancy grid, with the volume fraction it covers. A high fraction
  (>0.6) says the shape is mostly that primitive: model it exactly and wrap
  the remainder. Also a direct reader of inner feature dimensions.
- **`compareToImport(index?, {res?, maxFindings?})`** — voxel symmetric-difference
  with LOCALIZED findings: every disagreement blob signed (`excess` = your
  model has material the target lacks; `missing` = the reverse), sized, and
  positioned (centroid, bbox, `relCentroid` 0..1 within the target, a
  thin-skin vs compact-feature classification; `res` overrides the grid
  resolution, console API only). This turns "hausdorff 1.9"
  into "missing compact feature at [12,0,−5], extent 4×3×2" — fix code
  without a visual roundtrip. Use after evalAgainstImport flags a problem.
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

## The objective — semantic structure, not just fidelity

The deterministic baseline is already near the fidelity metrics' ceiling on
most meshes, so "chamfer is low" is the STARTING line, not the finish. Your
added value is code a person can edit: every recognizable feature modeled as
a primitive at its MEASURED dimensions (named constants or `api.params`),
section-interpolation kept only where the profile says the shape is
genuinely organic. If the whole model profiles organic (a sculpt, a
figurine), say so — the baseline IS the right answer there, and forcing
primitives onto it makes the code worse, not better.

## Workflow

1. **Measure**: `profileModel()` (+ `fitInscribed()` when a primitive core
   seems plausible) → record the discovered skeleton in a session note.
2. **Baseline**: `convertToCode()` → note `metrics`; this is the fidelity
   bar the semantic version must match, and the source of levelSet sections
   you can reuse for organic runs.
3. **Rebuild semantically** where measurements justify it: primitives at
   profiled dimensions, holes from the profile's hole fits, booleans between
   them; keep the section stack for organic runs.
4. **Verify every change**: `evalAgainstImport()` for the scalar;
   `compareToImport()` when a number regresses and you need WHAT/WHERE.
   Revert regressions with `loadVersion` — never stack guesses.
5. Report both dimensions of the result: fidelity ("mean deviation X, floor
   Z") and structure ("hull = sections, chimney = cylinder r 2.3, cabin =
   rounded box 12×8, all dimensioned").
