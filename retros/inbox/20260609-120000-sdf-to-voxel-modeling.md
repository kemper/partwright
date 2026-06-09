---
date: "2026-06-09T12:00:00Z"
task: "feat: v.sdf — rasterize api.sdf expressions into the voxel grid; 5 SDF-voxel catalog entries driven by model-sculpt sub-agents"
areas: [voxel, geometry-api, sdf, catalog, tooling, docs]
cost: high
---

Consolidated from **6 `model-sculpt` sub-agents** (5 new catalog models — gyroid
vase, TPMS lattice cube, porous coral, smooth-blend blob mascot, twisted lattice
pen-tower — plus one iteration pass) that drove the new `v.sdf(node, opts)`
voxel API through the headless `model:preview --lang voxel` render→`Read`-PNG→
adjust loop against explicit printability gates. Frequency = number of
*independent* agents who hit an item. Several asks were **fixed inside this same
PR** and are tagged `[DONE]`.

## Liked / Worked
- **`v.sdf` + chainable `api.sdf.*` is the right abstraction** (6/6). Whole
  models are one readable expression tree — `smoothUnion(...).intersect(diamond())`
  (coral), `gyroid ∩ tube` (vase), `roundedBox.subtract(windows)` (cube). Authors
  reused the SDF vocabulary they already know, just targeting voxels.
- **`smoothUnion(k)` keeps organics one component** (blob, coral) — chaining
  blended lobes never split into boolean-seam islands; `componentCount` stayed 1.
- **`colors` + `.label()` "deepest region wins" two-toning just works for SHARP
  ops** (vase, cube, coral) — frame-vs-lattice / body-vs-base colored in one call,
  no paint step.
- **The 4-view PNG + JSON (`componentCount`, `genus`, per-component bbox) is the
  right instrument set** (6/6). `genus` confirmed real porosity (coral 119); the
  per-component bbox list pinpointed 8 stray corner blobs at their coordinates
  (cube). ~2 s iterations.
- **`roundedBox` as a CLIP region** elegantly prevents corner-fragment
  connectivity (cube) — declarative, no imperative cleanup.
- **Half-space flatten** (`body.intersect(box with bottom at z=0)`) is a reliable
  one-liner for a printable flat base (blob).

## Lacked
- **No built-in connectivity weld — 3/6 agents hand-rolled the same flood-fill**
  (twist, coral, cube) to drop stray specks. The single most-repeated friction.
  **[DONE]** Added `v.keepLargest(count=1)` (face-connected component filter);
  the coral & cube catalog entries now use it instead of ~18 lines of hand-rolled
  BFS each.
- **`--png` is silently ignored when `--json` is also passed** (cube + others
  burned probe runs getting no image). **[DONE]** `model:preview` now writes the
  PNG whenever `--png` is explicit, even with `--json`.
- **`colors`/`.label()` silently yields ZERO voxels through `smoothUnion`** (blob)
  — a blended sub-body is never the deepest region at the surface, so the label
  never colors anything, with no warning. Central to a "multi-color organic"
  showcase and it doesn't work; the blob agent abandoned labels and hand-painted.
  **[DONE: documented]** in `ai/voxel.md` + `ai/sdf.md` (label the outer
  expression, or recolor detail after `v.sdf`). The *engine* fix (color by which
  primitive contributed the pre-blend min) is deferred — see Longed for.
- **No `componentCount` breakdown distinguishing diagonal-contact (mesh-split)
  from truly-disconnected** (cube, coral). Agents inferred "these are diagonal
  contacts" from negative/odd genus + bboxes. A `nonManifoldEdges` count or a
  "diagonal-contact" warning would save 2–3 passes.
- **No res→world-size echo in stats.** The JSON bbox is in voxel units; "is this
  really a 40 mm cube?" needs a mental ×`res`. A `worldBBox` (voxel·res) field is
  the ask (cube, blob, twist).
- **No "thinnest solid-voxel run" / min-wall metric** to judge knife-edge risk
  objectively (vase, cube) — strut thickness was eyeballed in the PNG.

## Learned
- **TPMS `thickness` is in FIELD units (~±1.5), and behaves nonlinearly near the
  percolation threshold.** ≥~1.5 fills nearly solid; an open lattice wants
  ~0.4–0.8. Coral: thickness 0.95 → 5 components, 0.75 → **1** (larger cell +
  lower thickness gave fewer, thicker, *more connected* walls). **[DONE:
  documented]** the field-units gotcha in `ai/voxel.md`.
- **Thin TPMS struts at `res: 1` are a non-manifold trap** — one-voxel struts
  touch diagonally (edge contact), not face-to-face. The fix is **resolution, not
  thickness**: finer `res` thickens the same world strut to ≥2 voxels (cube).
  **[DONE: documented]**, with the note that `keepLargest` can't repair it
  (diagonal contact is a bad join within one component, not a separate island).
- **`v.sdf` centers an origin-centered SDF at the voxel origin → it spans negative
  Z.** `const b=v.bounds(); v.translate([0,0,-b.min[2]])` is the robust
  flat-on-plate move (more reliable than hardcoding height once `res ≠ 1`).
- **`.twist` preserves Z**, so two nodes twisted independently at the same rate
  land aligned at each height — that's what lets a separately-colored rim weld
  cleanly onto a twisted perforated wall (twist tower).
- **The Read tool caches a PNG by path** → editing the model and re-rendering to
  the *same* `<file>.preview.png` served a stale image; the blob agent nearly
  concluded its edits did nothing. Rendering each pass to a unique `--png checkN.png`
  was the reliable workaround.
- **`componentCount` is trustworthy when small** (single digits tracked real
  changes) even though it over-reports at large values (coral noted 227 = noise,
  5→1 = signal).

## Longed for
- **A diagonal-contact weld — `v.solidifyDiagonals()` / `v.weld()`** on the grid.
  This is the #1 *voxel-print* hazard the docs already warn about, and
  `v.keepLargest()` (now added) deliberately doesn't cure it. The cube agent
  hand-rolled a 6-pass bridge; that pattern should be a one-call grid method.
  (Highest-value remaining ask.)
- **`worldBBox` (res-aware) in `model:preview` stats** so size is answerable
  without multiplying by `res`.
- **Per-label voxel-count report from `v.sdf`** (e.g. `{ foot: 0, eye: 142 }`) so
  a zero-match label (the smoothUnion trap above) is immediately visible instead
  of silent.
- **Declarative color for blended organics** — a `colorByNearestPrimitive` mode
  or a pre-blend `.paint(color)` tag, so smooth-blended characters can be
  multi-colored without hand-painting after `v.sdf`.
- **A `clip` shorthand on `v.sdf`** (`v.sdf(gyroid, { clip: roundedBox(...) })`)
  so an infinite TPMS doesn't need both an explicit `.intersect(region)` and a
  matching `bounds`.
- **A min-wall / thinnest-strut printability metric** in the preview warnings,
  and **TPMS phase alignment** for cylindrical lattices (the vase's holes land
  asymmetrically because a Cartesian gyroid isn't phased to the tube axis).
- **A worked "lattice vessel / lattice cube" doc example** — the TPMS∩annulus +
  solid-caps and the frame+window+lattice patterns are canonical and the
  thickness/wall interaction is non-obvious. (Partly done: `ai/voxel.md` now has
  a two-tone shell+core example and an open-gyroid-in-rounded-box example.)
