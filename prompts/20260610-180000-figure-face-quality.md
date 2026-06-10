---
date: "2026-06-10T18:00:00Z"
task: "feat: SDF detail regions + figure mouth styles + paintable eyes"
areas: [geometry-api, sdf, figure, examples, docs]
---

## Human

After merging the `api.sdf.figure` builder, faces came out poorly: the AI
struggles to make mouths and to paint faces, and face features look like
angled flat surfaces rather than smooth SDF work ("I assume it's using
non-SDF for the faces"). Asked for an investigation, then approved a plan:
land high-quality faces (the top priority), better mouths, and paintable
face features, then upgrade the catalog figures to use them.

## Assistant

Diagnosis: the faces ARE SDF — they're under-sampled. `build()` meshes every
region on one uniform levelSet grid, and at the documented figure default
(`edgeLength 0.4–0.6` for a 60-unit figure) a mouth ridge is ~1 grid cell
across. Going globally fine is unaffordable (the grid is O((H/e)³) JS evals),
so the fix had to be local.

Key decisions:

- **Refine-and-project over per-region edgeLength.** Two designs considered
  for localized detail: (a) mesh the head as its own levelSet region at a
  finer grid — simpler, but converts the head↔neck smooth weld into a hard
  seam, visible on exactly the shirtless figures the user wants; (b) a
  post-march pass that selectively subdivides triangles inside caller-given
  spheres and Newton-projects new vertices onto the SDF iso-surface. Chose
  (b) (`src/geometry/sdfRefine.ts`, `build({ detail: [...] })`): no seams,
  labels and welds unaffected, cost proportional to the sphere's surface
  area. Conformity is by construction (a global marked-edge set means both
  triangles sharing a split edge agree — 1/2/3-marked-edge patterns, no
  T-junctions). A micro-tolerance `simplify()` after `ofMesh` collapses the
  near-degenerate slivers projection can create.
- **`F.faceDetail(rig)`** packages the face sphere (centered on the head,
  edge target scaled to `r.head`) so figure authors pass one expression. The
  default lands in the one-subdivision-round bucket (~34k tris for a
  60-unit-figure head) after comparing one vs two rounds visually — two
  rounds tripled the cost for a barely visible gain; the override is
  documented for final passes.
- **Mouth: carved styles, additive kept.** The old mouth was only a
  protruding ridge, and its documented `open` option was parsed but never
  read (silent no-op — the likely cause of the AI "struggling with mouths").
  New `style: 'smile' | 'open' | 'lips'` where smile (carved arc groove,
  the cartoon default) and open (carved cavity, `open` 0..1 gape) are
  subtracted by `assemble`, lips remains the old additive ridge. Default
  changed to 'smile' deliberately — catalog entries are being regenerated in
  the same change.
- **Paintable eyes via pattern, not partitioner surgery.** Considered letting
  nested labels split out of an outer-labelled region, but a label nested
  under a smoothUnion can't be split without changing geometry, and eyes sit
  under the body weld. The structural fix is already expressible: assemble
  with `eyes: false` and hard-union `F.face.eyes(rig).label('eyes')` at the
  top level. Made that the canonical documented pattern (figure.md "one
  pattern" + all examples) instead of the old "duplicate the eyes over the
  welded ones" workaround.
