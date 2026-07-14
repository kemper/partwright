---
date: 2026-07-06
branch: claude/serene-ritchie-jfdhv6
files_changed:
  - src/reconstruct/slice2d.ts
  - src/reconstruct/profileMesh.ts
  - src/reconstruct/voxelDiff.ts
  - src/reconstruct/inscribed.ts
  - src/reconstruct/reconstructWorker.ts
  - src/reconstruct/reconstructClient.ts
  - src/main.ts
  - src/ai/tools.ts
  - src/ai/reconstructPrompt.ts
  - public/ai/reconstruction.md
  - public/ai.md
  - tests/unit/reconstruct-semantic.test.ts
  - tests/reconstruct.spec.ts
  - CLAUDE.md
---

## Human

Tested the AI-driven /reconstruct on a Benchy: it did no better than the
deterministic baseline. Diagnosis requested + fix: the prompt doesn't push
the AI, and it likely lacks tools to "experiment with fitting shapes inside
an STL" (e.g. an inscribed box filling 80% of the volume, remainder via the
heuristic). Key question: how would an AI know where a cylinder fits, other
than looking at screenshots? "Implement what you've described and create a
new PR."

## Assistant

**Root cause, two halves.** (1) The AI optimizes what we measure — global
chamfer/hausdorff — and the deterministic baseline already sits below that
metric's noise floor, so "refine only what evidence justifies" rationally
halts. (2) The headless loop's measurement tools (contour primitive fits,
localized voxel-diff findings) were deliberately left out of the v1 port,
leaving the AI with only pixels for feature discovery — the exact
measure-don't-guess trap the PLAYBOOK forbids.

**The answer to "how would it know": geometry queries, not vision.**
`profileModel` sweeps sections along all axes, fits circle/rounded-rect to
each (Kåsa fit + PCA rect, ported from slice.mjs), and merges steady fits
into runs — a run of circular sections at constant radius IS a measured
cylinder. Trap fixed en route: any 4 points fit a circle exactly, so a
DP-simplified square (4 corners) classified as a circle of r=half-diagonal;
circle verdicts now also require ≥8 contour points.

`compareToImport` ports voxelDiff (ray-parity shared-grid, signed/located/
classified findings) so a regression reads "missing compact feature at
[12,0,-5]" instead of a scalar. `fitInscribed` implements the user's
80%-box idea: largest inscribed box (3D DP cube seed + greedy verified
extension) and z-cylinder (AND-map over candidate z-ranges + exact
Felzenszwalb EDT — chessboard DT under-reports a disc radius ~30%, measured
before fixing; plus greedy z-extension past the coarse cuts).

**Objective reframed.** Prompt + subdoc now define success as semantic
structure at matched fidelity — profile first, primitives at measured
dimensions, sections only for organic runs — with the explicit honesty
clause that a fully-organic profile (figurine, sculpt) means the baseline
already IS the answer, so the Benchy-class case gets called out instead of
thrashed. All three tools are retry-safe (idempotent measurements), not
save-gated.
