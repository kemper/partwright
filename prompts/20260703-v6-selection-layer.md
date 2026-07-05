---
date: 2026-07-03
branch: claude/confident-carson-gpo63q
files_changed:
  - src/color/selections.ts
  - src/color/partition.ts
  - src/color/meshIslands.ts
  - src/color/regions.ts
  - src/main.ts
  - src/ai/tools.ts
  - public/ai/colors.md
  - tests/unit/selections.test.ts
  - tests/unit/partition.test.ts
  - tests/unit/apiParity.test.ts
---

## Human

After reviewing the v5 results the owner identified the residual quality
gaps (striped shoulders, alternating pupil-edge colors) and proposed the
underlying abstraction himself: let the AI capture labeled regions like a
lasso/fill selection, then paint only within them, with subregion
division (wedges per shoulder) on apply. Agreed direction: build the
selection layer API-first; UI counterpart later.

## Assistant

The design insight this round: **bleed is the symptom of a missing noun.**
Paint tools conflated *deciding where* with *committing color*; graphics
editors solved this decades ago with first-class selections. And in this
codebase a selection is almost free — it's a paint region without a color.

**`src/color/selections.ts`** — leaf store. Selections keep their SOURCE
EXPRESSION (base selector + boolean refinements) and re-resolve lazily
per mesh identity, the same descriptor-not-baked-ids philosophy regions
use, so a smoothing paint that re-tessellates doesn't strand them (except
`triangleIds`-sourced ones — documented). Refinements that would empty a
selection are rejected and rolled back rather than applied. Runtime-only
this round: persisting them is pointless while render-only imports
themselves don't reload (#883); tracked on #881.

**`within: {island | selection | region}` on every geometric paint tool**
(paintFaces/InBox/InOrientedBox/Disc/Near/Slab/InCylinder/ByCrease).
Painted set = selector ∩ scope. The scope is baked into the persisted
descriptor as `scopeIds` and re-applied generically in
`resolveDescriptorTriangles`, so re-resolution after refinement stays
bounded too. `paintByCrease` additionally gained the promised flood
tripwire: an unscoped flood covering >60% of its island returns a
`floodWarning` (the browser test showed a 150° flood swallowing 5308
tris with the warning vs 646 clamped by a selection scope).

**`paintPartition({within, by, colors})`** — the striped-shoulder /
pupil-ring primitive, on a pure unit-tested kernel
(`src/color/partition.ts`): `bands` (slices along an axis; default = the
scope's PCA long direction via the new `principalDirectionOfTriangles`
export), `wedges` (angular sectors; default axis = the scope's
area-weighted mean normal — the feature's "facing"), `rings` (concentric
annuli measured as true cylinder-radius about the axis). Cells commit as
independent regions; centroid-bucketed (analytic cell-boundary
subdivision deferred to #881). Browser smoke: 8 alternating wedges on a
ball with its cap subtracted — exactly the radial shoulder-stripe look —
and a 3-ring alternating eye pattern.

**apiParity window bug**: the parity test scanned a fixed 400 KB window
of main.ts and the API tail (help, voxelStudio*) fell off when the object
grew — the same silent-truncation failure its own comment describes for
the earlier 80 KB cap. Now scans the whole object.

AI tool schemas + gating (selections ALWAYS_AVAILABLE, paintPartition
PAINT_GATED), help() entries, and a colors.md workflow rewrite (build
named selections in the IDENTIFY phase; scope every geometric paint) ship
in the same change per the parity rule. UI lasso/selections-panel is
acknowledged deferred debt on #881.
