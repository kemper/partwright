---
session: "01MDx5"
timestamp: "2026-06-20T00:00:00Z"
---

## Human

I recently enabled a fast preview option which is great. Can we approximate
color on the fast preview? It would be great if color, texture, etc showed (as
best an estimate as possible) on that preview. I think for things that are
colored by label it could be done. What do you think?

(Scope decided via a follow-up question: apply `api.label({color})` and
`api.paint.*` in-code colours to the preview — the high-value, low-risk slice.
User brush paint and surface textures are out of scope.)

## Assistant

## Key decisions

**Why the fast preview was colourless, and what's cheap to fix.** The SDF
coarse pass (and SCAD low-`$fn` pass) posts back only the raw mesh on the
`execute_preview` message; the main thread renders it directly, skipping the
colour-resolution the full `execute_result` runs. But model-declared colour is
resolved *geometrically / by name*, not by triangle index, so it transfers
cleanly onto the coarse mesh — only **user brush paint** (keyed by full-mesh
triangle index, the same reason surface-bake is refused during preview) and
**detail-region labels** (eyes etc., whose geometry the coarse pass skips) can't
map across. So I scoped it to `api.label({color})` + `api.paint.*`.

**Three-layer wiring, mirroring the existing full-result path:**
- `engineWorker.ts` — the manifold-js SDF preview branch now serialises
  `labelMap`/`labelColors`/`paintOps` onto the `execute_preview` message (same
  flatten-to-entries the full result already does).
- `engine.ts` — the `execute_preview` handler reconstructs the `Map<string,Set>`
  and hands them to `onPreview` via the existing `MeshResult` shape.
- `main.ts` — generalised the offscreen-thumbnail helper `colorMeshFromLabels`
  → `colorMeshFromModel(result, includePaintOps?)`: always resolves
  `api.label({color})`; with the flag also resolves `api.paint.*` via the **pure
  `resolvePaintOps`** (the same resolver `model:preview` uses — covers
  slab/box/cylinder/byLabel with no adjacency and no global state, resolving
  `byLabel` from the result's own labelMap rather than the live
  `currentLabelMap`). The preview callback bakes those colours onto the coarse
  mesh and `updateMesh`es it.

**Deliberately off-state, not via `setModelColorRegions`.** The preview bakes a
model-only `triColors` and never touches the global region/label state. That
keeps it safe against painted sessions (stale user-paint indices can't
shatter-shard onto the coarse tessellation) at the cost of one transient
edge case: `renderViews()` *during* the ~1s preview window recomposes from the
(empty) global model regions and shows grey — irrelevant to the live viewport,
which gets the baked-colour mesh, and self-corrects when the full render lands.

**Verification.** A throwaway in-page probe confirmed the coarse preview mesh
(119,888 tris vs 745,560 full) came back fully painted — 59,732 red (top half) +
60,156 blue (bottom half), ~50/50, matching the two `api.paint.box` ops. Landed
a permanent golden-path e2e (`tests/fast-preview-color.spec.ts`) that screenshots
the `#viewport` canvas while the "⚡ Fast preview" pill is up and asserts both
red and blue are present via a shading-robust hue test (3× repeat, no flake).
Preflight green; paint-in-code / sdf-end-to-end / render-cancel e2e all pass.

## Follow-up — user reported no colours on real figures

The user tested the deployed preview and saw **no** colour. Root cause: the
v1 change only painted colours declared in the model *code* (`api.label({color})`
/ `api.paint.*`), but real catalog figures (e.g. `archer`) get their colour from
**saved `byLabel` paint regions** — user paint, not in-code colour. Diagnosis via
an in-page probe: at preview time the coarse mesh's labelMap was fully populated
(14 labels: skin, tunic, boots…) but `getRegions()` was **empty** — the catalog's
region descriptors are deserialised only *after* the initial render.

Two fixes:
- **`colorCoarsePreview`** (new) composes the in-code model underlay PLUS the
  user's saved paint regions whose descriptors re-resolve geometrically — byLabel
  and box/slab/cylinder. The existing pure `resolvePaintDescriptor` returns a
  triangle set for exactly those kinds and `null` for the index/seed-dependent
  ones (brush strokes, coplanar, colorFlood, raw triangle ids), so it's a perfect
  filter for "what can map onto the coarse mesh." Refactored the model-layer
  building into a shared `buildModelColorLayer` so the thumbnail bake and the
  preview share it.
- **Stage region descriptors before the run.** `loadVersionIntoEditor`'s
  cache-miss branch now calls `stageUnresolvedColorRegions(version.geometryData)`
  *before* `runCodeSync`, so a painted figure's regions are in the store when the
  preview fires. `rehydrateColorRegions` still owns the final post-run resolution
  (it clears + rebuilds), so this is a strict head-start, not a competing source.

Verified: the `archer` catalog figure's fast preview now renders skin/hair/tunic/
leggings/bow colour while "Rendering… Xs" is still computing (screenshot posted).
Added a permanent e2e for the catalog-figure case; 21 paint/catalog/version-switch
e2e specs pass (no regression from staging-before-run); preflight green.
