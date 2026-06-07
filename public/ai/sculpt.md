# Mesh Sculpt — interactive clay-style mesh editing

Push, pull, and smooth the **actual triangle surface** of a manifold-js model
like clay. This is distinct from the other free-form tools:

- **Surface textures** (`applyFuzzySkin`, `applyKnitTexture`, … — see `textures`)
  add *procedural* detail across the whole surface in one shot.
- **Voxel Studio** (`activateVoxelPaint`, … — see `voxel`) edits a *blocky*
  voxel grid.
- **Mesh Sculpt** (this doc) is hands-on, local deformation of a *smooth* mesh —
  bulge a cheek, dent a seat, round a corner, relax a bump.

Only works on **manifold-js** models. The session edits a live in-memory mesh
and locks the editor; committing bakes the result into a new version exactly
like a surface modifier (`return Manifold.ofMesh(api.imports[0])`), so
code-as-source-of-truth is preserved.

## Workflow

1. **`activateMeshSculpt()`** — starts a session on the current model. A coarse
   mesh (e.g. a 12-triangle cube) is auto-densified so the brush has vertices to
   move. Returns `{ ok, triangles }`. (Run/open a model first.)
2. **`subdivideSculptMesh()`** *(optional)* — split every triangle into 4 for
   finer detail. Repeatable. Clears the sculpt undo history. Returns
   `{ ok, triangles }`.
3. **`setSculptTool('push' | 'pull' | 'smooth')`** and
   **`setSculptBrush({ radius, strength })`** — `radius` is in world units;
   `strength` is `0..1`.
4. **Get a surface point + normal.** Render a view, then use
   `probePixel({ imageUrl, pixel: [x, y] })` → `{ point, normal, … }`. That
   point/normal is exactly what `sculptAt` wants.
5. **`sculptAt({ point, normal, tool?, radius?, strength? })`** — apply one brush
   dab. Call repeatedly (walking points across the surface) to build a form.
   Per-call `tool`/`radius`/`strength` override the session defaults for that dab.
   Returns `{ ok, moved, triangles }`.
6. **Verify** with `renderViews`.
7. **`commitMeshSculpt({ preserveColor? })`** — bake to a new version (default
   `preserveColor: true` re-resolves paint onto the result). Returns the standard
   modifier result `{ ok, label, geometry, colorsCarried, warnings? }`. Or
   **`cancelMeshSculpt()`** to discard.

`meshSculptUndo()` / `meshSculptRedo()` step through strokes while the session is
live (in-memory; cleared when the session ends or the page reloads).

## Brush semantics

- **push** — moves in-range vertices *outward* along the supplied surface normal,
  with a smoothstep falloff (full effect at the center, zero at `radius`).
- **pull** — same kernel, inward (negative).
- **smooth** — moves in-range vertices toward their 1-ring average (Laplacian
  relax); `strength` is the blend weight.
- Displacement per push/pull dab is roughly `strength × radius × 0.6`, so a
  bigger brush makes a bigger bump. Several dabs accumulate.

## Tips & gotchas

- **Connectivity never changes mid-session** (only vertex positions move), so the
  mesh stays manifold and per-triangle paint survives. The one exception is
  `subdivideSculptMesh`, which changes the vertex count and therefore resets undo.
- **Keep displacements modest** relative to the model — very large pushes on a
  coarse region can self-intersect. Densify first (`subdivideSculptMesh`) for
  crisp local detail, then sculpt with a smaller radius.
- **It's additive, not parametric.** The baked version is a frozen mesh wrapped
  in `Manifold.ofMesh`; you can still boolean/paint/heal it, but the original
  parametric code is replaced by the wrapper. Fork first if you want to keep the
  code editable.
- Switching the engine away from manifold-js, navigating versions, or loading a
  different model cancels an active session.
