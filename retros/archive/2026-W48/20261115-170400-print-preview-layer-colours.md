---
date: "2026-11-15T17:04:00Z"
task: "feat: print preview with colours by layer height"
pr: 1252
areas: [print, viewport, import-export, ai-tools]
cost: high
---

## Liked / Worked
- Measuring the slicer first (`slicer-cli check` on hand-made variants) settled
  four design questions before any app code: where a switch lands, that paint
  and layer switches don't combine, what a manual swap counts as, and that
  custom layer heights are honoured. The export matched the real slicer on the
  first end-to-end run.
- Making the preview an ordinary coloured `MeshData` meant the viewport,
  `renderView` and unit tests all drew the same thing with no renderer work.
- The `work-reviewer` pass found a real data bug (below) that every test
  missed, and reproduced the cut-on-a-step hole with numbers.

## Lacked
- No list of "state a run produces" to check against the mesh cache. Anything
  set only in `runCodeSync` is stale after a cache-hit object switch unless it
  is also added to `PartMeshCacheEntry` and restored. I missed it for layer
  colours; the viewport material from `api.material` looks to have the same gap.
- No single "draw the current model" function. A dozen call sites call
  `updateMesh(applyTriColorsIfVisible(...))` directly, so a display override
  (print preview, relief preview) has to be threaded through each by hand.

## Learned
- A cut plane placed exactly on a layer top meets faces and edges lying in it
  on almost every CAD model (steps, shelves, boss feet). Cutting slightly below
  and drawing at the layer top removes every on-plane case at once.
- A display mode that re-tessellates the model must be exclusive with anything
  that picks triangles. Tying the mode to a registered tool panel gets that
  exclusivity from the registry for free; a bare API flag does not.
- An API flag with no visible UI state is a trap: the user can't see why the
  model looks different or turn it off.

## Longed for
- A test helper that runs "object A → object B → back to A" and diffs
  everything `getGeometryData` / exports report, to catch cache-restore gaps.
- `showModel()`-style chokepoint adopted repo-wide, with an ast-grep rule that
  flags new direct `updateMesh(applyTriColorsIfVisible(` calls.
