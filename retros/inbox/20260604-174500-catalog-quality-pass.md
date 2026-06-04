---
date: "2026-06-04T17:45:00Z"
task: "feat: catalog quality pass — redesign 8 weak entries, colorize 6 gray ones, add 5 voxel creatures"
areas: [catalog, tooling, docs, renderer, agents]
cost: high
---

Consolidated from 10 modeling sub-agents driven in parallel to upgrade catalog
entries (each baked + screenshot-iterated its own models). Frequency = number of
*independent* agents who hit the item, so the facilitator can weight it.

## Liked / Worked
- **The bake → `Read` PNG → iterate loop is the MVP** (≈all 10 agents). Judging
  each render like a real catalog tile caught defects stats never would: eyes
  floating above sockets, a gold rim hidden in the vase bore, an invader that
  was illegible, a slime face that read as "creepy carved." A tight
  screenshot-driven loop is the right primitive for art-directing models.
- **`label(part,'name')` + a separate `paintByLabels` pass is excellent for
  manifold-js/SCAD** (≈6 agents). Coordinate-free, survives booleans, and the
  `byLabel` descriptor keeps saved files tiny. `colors.md`'s "labelled
  construction" recipe worked first-try repeatedly.
- `v.mirror('x')` (build half, mirror) for symmetric voxel characters, plus a
  3-tone height-based shade palette, gives blocky models real depth cheaply.

## Lacked
- **The catalog thumbnail camera orientation is undocumented AND the obvious
  guess is wrong** (≈6 agents — the single biggest time sink). The fixed 3/4
  tile camera looks toward **+X/+Y**, so the camera-facing surfaces are the
  **−Y and +X faces, meeting at the (+X,−Y) corner**. Characters must put their
  face there. Multiple agents authored faces on +Y, baked, saw the back of the
  head, and had to flip the whole model (a replicad agent rotated geometry
  180°; voxel agents rebuilt). Cost ~1–2 wasted bakes *each*. Nothing in
  `voxel.md`/`colors.md`/the bake tooling says which way the tile faces.
- **`paintInBox`/`paintNear`/coordinate paint bake huge per-triangle ID lists
  into the saved file** (≈3 agents). One SDF vase came out **17 MB** (vs ~250 KB
  norm) purely from `triangles` descriptors; switching to `byLabel` dropped it
  to 185 KB (~92×). The replicad robot couldn't use labels at all (see below)
  and even compacted lands at 446 KB — the largest catalog file. There is no
  documented catalog file-size budget, and `/catalog` eagerly fetches *every*
  entry file on page load, so a fat entry taxes the whole page.
- **Very light / desaturated colors wash out to gray under the flat catalog
  thumbnail lighting** (≈3 agents). A cream dial, a cream turbine tower, and an
  amber-vs-brass lantern all read as "still gray / muddy" until pushed
  noticeably warmer/more-saturated. One agent burned a magenta test-paint just
  to prove the label owned the visible face.
- **`replicad` labels are unusable after `fuseAll`** (1 agent, but it dominated
  that task). `replicad.md` warns labels scramble, but not the downstream
  consequences: every feature must be hand-targeted by *world coordinates*
  (which also means the 180° thumbnail flip forces flipping every coordinate's
  sign), and coordinate paint produces the large `triangles`-descriptor files
  above. `coverageMode:'fully_inside'` also has a small-feature cliff — if no
  single triangle fits entirely inside the radius it paints **zero** and errors,
  so tiny features (robot ears) need a different selector.

## Learned
- **SDF label propagation, reconfirmed across models:** `smoothUnion` does NOT
  propagate inner labels (outer label wins), so you cannot get a multi-band
  vertical gradient on one smooth body — build accents (e.g. a vase's gold rim)
  as their own labelled solid and **hard-union** them on. Labelled subtrees mesh
  separately, so labelling a piece *before* `shell()` can split the shell into
  disconnected walls (componentCount jumps). Pulling a shallow surface feature
  inward under a shell can also silently detach it (1→2 components).
- **`.bend(rate, axis)` can't curl a vertical strand forward** — its rotation
  plane must contain the driving axis, so a Z-length tentacle won't curl in the
  vertical plane. Chaining overlapping `capsule()` segments along a parametric
  polyline is the reliable way to author flowing/curved limbs (and they weld
  watertight).
- **`.smooth({detail:2})` makes *small* voxel features worse**, not better —
  more stair-stepping/bumps on a face, opposite of what the API hint implies.
  For clean voxel faces, use plain `iterations` and chunky *connected* feature
  blocks (a dense sub-voxel arc fill) so neighbours stay joined through smoothing.
- `label()` on a degenerate/empty manifold (e.g. an inverted-bounds box with
  min>max) fails late with a cryptic `asOriginal() did not produce a valid
  originalID` that names neither the box nor the real cause.

## Longed for
- **One sentence on tile orientation** in `voxel.md` and the bake tooling:
  "the catalog 3/4 thumbnail looks toward +X/+Y — put the character's front on
  the −Y/+X corner." This alone would have saved the most expensive, most
  *repeated* class of wasted bake this whole pass. Even better: a `--thumb-azimuth`
  / `--thumb-elevation` flag on the bake/export so the tile camera can be aimed
  without baking orientation into the geometry, plus a one-call **orientation
  probe** (a per-face-colored cube) shipped as a fixture.
- **A persistent warm engine page for batched bakes.** Every bake cold-launches
  Chromium and re-warms WASM (~10–15 s; ~90 s for replicad/OCCT), which is the
  dominant cost when art-directing a single model across many re-bakes. A warm,
  reused session that just swaps code + re-screenshots would roughly halve
  wall-clock.
- **A documented catalog file-size budget + a `byLabel`-only lint**, and a note
  in `colors.md` that `paintInBox`/coordinate paint bloats saved files with
  triangle-ID lists (use `paintByLabels` for anything destined for the catalog
  or a shared session). A way to keep model-declared colors through a BREP
  `fuseAll` would let replicad entries be tiny like `royal-crown`'s
  `label(...,{color})` manifold-js underlay.
- **`colors.md` note on thumbnail lighting:** near-white/desaturated regions
  collapse to gray under the flat tile shading — pick warmer/more-saturated
  values than you would on a white-background swatch, and sanity-check a
  near-white region with a vivid test color first. A `paintExplain`-style
  per-label highlight in the bake output would replace the manual test-paint.
- **Richer `BAKE_RESULT` stats:** per-region descriptor kind + resolved triangle
  count (to confirm `byLabel` and catch a label consumed to zero triangles by a
  later boolean), plus `voxelCount` for voxel models. Several agents wrote their
  own inspection scripts to recover these.
