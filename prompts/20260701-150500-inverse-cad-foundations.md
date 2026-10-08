---
session: "inverse-cad"
timestamp: "2026-07-01T15:05:00Z"
model: claude-opus-4-7
sequence: 1
---

## Human

Two rounds of Dummy 13 parametric guessing produced a "complete disaster." I
proposed inverse-CAD instead: hand the AI an STL, iterate parametric code
until mesh delta is small, days-long runs OK, generalize to arbitrary STLs.
User said yes: headless task, not a Partwright feature; create a tracking
issue and get started; note that multi-part STLs may need chopping.

## Assistant

## Key decisions

**Not in `src/`.** Everything sits under `scripts/inverse-cad/` (`.mjs`) so
zero bundle impact and no dependency the app can accidentally pick up.
Parallel to `scripts/model-preview.mjs`, which is the existing precedent
for "headless tooling that consumes the engine layer." When the loop needs
to render a candidate, it'll use vite-node the same way `model-preview`
does — no new runtime.

**Tracking issue #878** with the full scope manifest and non-goals up front:
not a UI feature, not a general organic-shape solver, not `src/eval/`.

**First cut is the deterministic foundation, not the loop.** Six pieces that
stand alone and are unit-testable without the engine — STL I/O, mesh
weld, connected-component split, area-weighted surface sampling, k-d tree,
Chamfer/Hausdorff. The loop itself needs the engine round-trip, so it's
next but separate.

**Multi-part STL splitter first.** User flagged it, and it's the right
"prove the plumbing" surface: the same weld+DSU that powers the splitter is
what the invariants extractor will use to peel a target into sub-features.
Confirmed on real Dummy 13 STLs — all 21 are single-component (soozafone
ships one file per part), and confirmed on a synthesized 2-STL merge that
the splitter separates them. So the splitter earns its keep the moment
someone hands us a Thingiverse file with multiple loose pieces per STL.

**Vertex-DSU, not triangle-adjacency-DSU.** Simpler and equally correct as
long as the weld tolerance is set right: two solids that don't share a
vertex end up in different components. Two solids that touch at a single
point post-weld fuse, which is what you want for an STL that split a
single object into halves.

**Reproducible sampling.** Mulberry32 seeded RNG so distance metrics are
deterministic between runs — the AI needs to see a strict improvement, and
sample noise flipping the sign would poison the loop.

**Static k-d tree, not brute force.** Chamfer at 5k×5k points would be 25M
distance evaluations per iteration — the loop will run for hours to days,
so O(log n) queries pay off immediately.

**No fitting in the distance layer.** `meshDistance` assumes the meshes are
already at the same scale + translation. Rigid alignment (bbox/PCA
principal axes) belongs in the separate invariants extractor coming next,
so distance stays a pure metric that can also be used to validate the
alignment itself.

## What's deferred

- Invariants extractor (bbox/PCA/symmetry/RANSAC primitives)
- Candidate evaluator (vite-node bridge + side-by-side render)
- Iteration harness (the actual AI loop)
- Primitive grammar doc (what subset of Manifold + `api.joints` + `api.sdf`
  the AI composes from)
- First spike against `frame_hips.stl`

All tracked in #878; will land in subsequent PRs so review stays scoped.
