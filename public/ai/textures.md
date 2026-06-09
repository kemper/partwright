# Surface Texture & Mesh Operations

Post-hoc operations that add surface detail to a finished model by displacing
vertices along their normals. Seven textures are available:

| Texture | Look | Best for |
|---------|------|----------|
| `applyFuzzySkin` | Fine irregular roughness (3D-printing "fuzzy skin") | Technical prints, organic objects, rough stone/bark |
| `applyKnitTexture` | Interlocking V-pattern (stockinette knit stitch) | Clothing, plushies, cozy objects, fabric items |
| `applyCableKnit` | Rope-like cable columns with crossing ply ridges | Sweaters, hats, Aran knitwear, rope textures |
| `applyWaffleStitch` | Recessed grid cells with raised borders | Waffle-knit, waffle irons, honeycomb patterns |
| `applyFurVelvet` | Directional anisotropic pile (velvet, fur, chenille) | Animal fur, velvet fabric, soft plush surfaces |
| `applyWovenFabric` | Plain-weave over/under interlacing | Baskets, woven cloth, twill, burlap |
| `applyVoronoiShell` | Organic cell-wall ridge network (Voronoi cells) | Lampshades, planters, vases, cracked-mud / dragonfly-wing shells |

Two further mesh operations live in the same panel and share the same
apply→save→verify workflow:

| Operation | What it does | Notes |
|-----------|--------------|-------|
| `smoothModel({ iterations, subdivide, preserveColor })` | Taubin λ/μ smoothing — rounds sharp edges/facets without the shrinkage of a naive Laplacian | Mesh smoothing, not a true fillet; for exact fillets use the replicad (BREP) engine. Returns `{ ok, label, geometry, warnings? }`. |
| `voxelizeModel({ resolution, smooth, preserveColor })` | Converts the model into the `voxel` engine (colored cubes) and switches the session language to `voxel` | `resolution` = voxels along the longest axis (~32 default). Replaces the code with a `voxels.decode(...)` program — see the `voxel` subdoc. |
| `applyVoronoiLamp({ cellSize, wallThickness, strutWidth, resolution, jitter, grainAngleDeg, seed, output, smooth })` | Cuts the model into a **true perforated Voronoi shell** (a "Voronoi lamp") — hollow wall with the cell interiors cut through, leaving a see-through strut network. `output:'mesh'` (default) stays manifold-js; `output:'voxel'` switches to the voxel engine. | The cutaway counterpart to the `applyVoronoiShell` relief. See [`applyVoronoiLamp`](#applyvoronoilamp) below. |
| `applyWireframe({ strutRadius, angleThresholdDeg, resolution, watertight, preserveColor })` | Keeps **only the model's sharp feature edges**, rebuilt as smooth round struts — a see-through **wireframe / edge cage**. Bakes a manifold-js mesh. | Best on boxy / low-poly shapes; a fully smooth surface has no sharp edges and returns an error. See [`applyWireframe`](#applywireframe) below. |

> **Cross-engine note:** every operation here bakes to a mesh. On a SCAD or
> BREP/replicad model this discards the parametric source (and, for BREP, STEP
> export) — the returned `warnings` array says so. Prefer editing the source for
> parametric models when the change can be expressed there.

---

## Textures as code — `api.surface.*` (non-baking, in a manifold-js session)

The tool calls above (`applyFuzzySkin`, …) **bake** the textured mesh into
`api.imports[0]` and replace the editor code. As an alternative, in a
**manifold-js** session you can declare the same textures **in the model code**
so they stay parametric — edit a number, re-render, no lost source:

```js
const { Manifold } = api;
const body = Manifold.sphere(10, 64);
api.surface.knit({ stitchWidth: 1.2, amplitude: 0.6 });  // texture the returned mesh
return body;
```

- Available ops: `api.surface.fuzzy`, `.knit`, `.cable`, `.waffle`, `.fur`,
  `.woven`, `.voronoi`, `.smooth`. Each takes the **same options** as its
  `apply*` tool (size-relative defaults fill in anything you omit). There's also
  a generic `api.surface.apply('knit', { … })` form.
- Calls are recorded, not applied during evaluation — they texture the **final
  returned mesh** in the order called (a terminal skin; you can chain several).
- Surface textures are **expensive**, so they're **memoized**: a render reuses
  the cached textured result when the code, params and ops are unchanged.
- **Explicit runs compute the texture automatically.** A `runCode` / `runAndSave`
  / `run` call (and the editor's Run button + version loads) force the
  (memoized) compute and return the **textured** mesh — so an AI/console caller
  sees the real result with no extra step. The first compute shows a progress
  modal; repeats are instant (cache hit).
- **Only live-typing is gated.** While a human edits in the editor, keystroke
  auto-runs show the **base (untextured) mesh** plus a **"⟳ Textures stale —
  Re-apply"** pill (top-left) instead of recomputing on every keystroke. Press
  the pill (or just hit Run) to apply. This keeps typing snappy; it does **not**
  affect `run`/`runAndSave`, which always apply.
- This is the in-code counterpart of the bake tools, mirroring `api.paint.*`
  (see [colors](/ai/colors.md)). Use it when you want the texture to live with
  the code; use the `apply*` tools when you want a one-shot baked result.

---

## When to apply textures

Apply after the geometry is finalised and before the final paint pass (or after
paint — existing regions carry through). The texture densifies the mesh and
bakes it onto `api.imports[0]`, so it **replaces** the editor code with a plain
`Manifold.ofMesh(api.imports[0])` wrapper. Retune by loading the version before
the texture (`loadVersion`) and re-applying.

**Ordering with paint:**
- **Texture then paint** — cleanest workflow. Apply texture on the bare mesh,
  then paint the densified result. Labels survive because the retessellated
  surface is treated like any STL import.
- **Paint then texture** — paint is carried by nearest-triangle transfer
  (`preserveColor: true`, default). `colorsCarried` in the return tells you how
  many triangles got color. If coverage is low (< 70%), the return includes a
  `warnings` entry — re-apply paint to the gaps or call `copyColorsFromVersion`
  from the pre-texture version.
- **Raw triangle-id regions** (face-pick, paintFaces) survive as nearest-triangle
  transfers. Coplanar/label/slab descriptors re-resolve against the new mesh.

---

## applyFuzzySkin

```
applyFuzzySkin({ amplitude?, scale?, octaves?, seed?, quality?, preserveColor? })
```

Applies multi-octave value-noise (FBM) displacement along per-vertex normals.

| Parameter | Default | Notes |
|-----------|---------|-------|
| `amplitude` | ~1% of diagonal | Peak outward displacement (world units). Keep ≤ 5% to avoid manifold artifacts. |
| `scale` | ~4% of diagonal | Characteristic feature size. Smaller = finer fuzz. |
| `octaves` | 2 | Fractal layers 1–5. More = busier surface. |
| `seed` | 1 | Different seeds → different patterns with identical params. |
| `quality` | 3 | Mesh detail 1 (draft, ~4× fewer triangles) to 5 (ultra, ~4× more). Higher = smoother displacement, slower. |
| `preserveColor` | true | Carry paint through subdivision. |

**Size guidance (model diagonal `d`):**
- Subtle: `amplitude=d*0.008`, `scale=d*0.03`
- Medium: `amplitude=d*0.015`, `scale=d*0.05`
- Heavy: `amplitude=d*0.03`, `scale=d*0.08`

---

## applyKnitTexture

```
applyKnitTexture({ amplitude?, stitchWidth?, stitchHeight?, rowOffset?,
                   roundness?, grainAngleDeg?, variation?, seed?, quality?, preserveColor? })
```

Applies a brick-offset grid of smooth cosine bumps shaped by the V-profile of
stockinette stitch loops.

| Parameter | Default | Notes |
|-----------|---------|-------|
| `amplitude` | ~3% of diagonal | Peak bump height. Keep ≤ 5% of diagonal. |
| `stitchWidth` | ~5% of diagonal | Horizontal repeat (world units). Larger = chunkier knit. |
| `stitchHeight` | `stitchWidth × 1.4` | Vertical repeat. Real knit stitches are ~40% taller than wide. |
| `rowOffset` | 0.5 | Brick offset fraction. 0.5 = classic half-stitch (default). |
| `roundness` | 0.5 | 0 = sharp column ridges, 1 = soft round bumps. |
| `grainAngleDeg` | 0 | Rotate grain in XY plane. 0 = stitches run up Z. 90 = horizontal. |
| `variation` | 0.1 | Per-stitch amplitude jitter (0 = machine-uniform, 0.1 = handmade feel). |
| `seed` | 1 | Deterministic seed for per-stitch variation. |
| `quality` | 3 | Mesh detail 1 (draft, ~4× fewer triangles) to 5 (ultra, ~4× more). Higher = smoother displacement, slower. |
| `preserveColor` | true | Carry paint through subdivision. |

**Look guidance by `roundness`:**
- `roundness=0`: strong vertical ridges (ribs / rib-stitch look)
- `roundness=0.5`: classic stockinette V pattern
- `roundness=1`: soft bubble/seed-stitch look

---

## applyCableKnit

```
applyCableKnit({ amplitude?, cableWidth?, cablePitch?, plyWidth?,
                 grainAngleDeg?, variation?, seed?, quality?, preserveColor? })
```

Two Gaussian ply ridges cross sinusoidally within each cable column, creating
rope-like Aran/cable-knit relief.

| Parameter | Default | Notes |
|-----------|---------|-------|
| `amplitude` | ~3% of diagonal | Peak ply-ridge height. |
| `cableWidth` | ~8% of diagonal | Width of one cable column. Larger = bolder Aran cables. |
| `cablePitch` | `cableWidth × 2.5` | Length of one twist repeat. Shorter = tighter twist. |
| `plyWidth` | `cableWidth × 0.3` | Width of each individual ply ridge. |
| `grainAngleDeg` | 0 | Rotate cable columns in the XY plane. 0 = cables run up Z. |
| `variation` | 0.08 | Per-cable amplitude jitter. |
| `seed` | 1 | Deterministic seed. |
| `quality` | 3 | Mesh detail 1 (draft, ~4× fewer triangles) to 5 (ultra, ~4× more). Higher = smoother displacement, slower. |
| `preserveColor` | true | Carry paint through subdivision. |

**Size guidance:**
- Fine twisted cord: `cableWidth=d*0.04`
- Classic cable: `cableWidth=d*0.08`, `cablePitch=d*0.2`
- Bold Aran: `cableWidth=d*0.15`, `cablePitch=d*0.35`

---

## applyWaffleStitch

```
applyWaffleStitch({ amplitude?, cellWidth?, cellHeight?, sharpness?,
                    rowOffset?, grainAngleDeg?, seed?, quality?, preserveColor? })
```

Regular grid of recessed cells with raised border ridges. `rowOffset=0.5`
produces a honeycomb/brick variant.

| Parameter | Default | Notes |
|-----------|---------|-------|
| `amplitude` | ~2.5% of diagonal | Border height. |
| `cellWidth` | ~6% of diagonal | Width of one cell. |
| `cellHeight` | `cellWidth` | Height of one cell (square by default). |
| `sharpness` | 3 | 1 = soft rounded, 3 = crisp waffle, 8+ = very thin border. |
| `rowOffset` | 0 | 0 = straight grid; 0.5 = honeycomb offset; any value [0,1]. |
| `grainAngleDeg` | 0 | Rotate the cell grid in the XY plane. |
| `quality` | 3 | Mesh detail 1 (draft, ~4× fewer triangles) to 5 (ultra, ~4× more). Higher = smoother displacement, slower. |
| `preserveColor` | true | Carry paint through subdivision. |

**Look guidance:**
- Waffle blanket: `cellWidth=d*0.1`, `sharpness=3`
- Honeycomb: `cellWidth=d*0.06`, `rowOffset=0.5`, `sharpness=4`
- Fine grid: `cellWidth=d*0.04`, `sharpness=6`

---

## applyFurVelvet

```
applyFurVelvet({ amplitude?, fiberSpacing?, fiberLength?, octaves?,
                 grainAngleDeg?, seed?, quality?, preserveColor? })
```

Anisotropic FBM noise: fine sampling cross-grain (individual fiber width),
coarse along-grain (smooth fiber length). Creates directional pile like velvet
or short fur.

| Parameter | Default | Notes |
|-----------|---------|-------|
| `amplitude` | ~2.5% of diagonal | Pile height. |
| `fiberSpacing` | ~2% of diagonal | Cross-grain fiber spacing. Smaller = finer velvet; larger = shaggy fur. |
| `fiberLength` | `fiberSpacing × 6` | Along-grain scale (fibers are 6× longer than wide by default). |
| `octaves` | 2 | Fractal detail 1–4. More = finer sub-fiber variation. |
| `grainAngleDeg` | 0 | Rotate grain direction in XY plane. 0 = fibers run up Z. |
| `seed` | 1 | Deterministic noise seed. |
| `quality` | 3 | Mesh detail 1 (draft, ~4× fewer triangles) to 5 (ultra, ~4× more). Higher = smoother displacement, slower. |
| `preserveColor` | true | Carry paint through subdivision. |

**Look guidance:**
- Fine velvet: `fiberSpacing=d*0.01`, `fiberLength=d*0.07`
- Short animal fur: `fiberSpacing=d*0.025`, `fiberLength=d*0.12`
- Shaggy carpet: `fiberSpacing=d*0.04`, `fiberLength=d*0.3`, `octaves=3`

---

## applyWovenFabric

```
applyWovenFabric({ amplitude?, threadSpacing?, threadWidth?, underDepth?,
                   grainAngleDeg?, seed?, quality?, preserveColor? })
```

Plain-weave interlacing: alternating warp and weft thread ridges cross at each
grid point, with each crossing's "over" thread elevated and "under" thread
slightly depressed.

| Parameter | Default | Notes |
|-----------|---------|-------|
| `amplitude` | ~2% of diagonal | Peak thread height. |
| `threadSpacing` | ~4% of diagonal | Thread center-line spacing (weave cell size). |
| `threadWidth` | 0.4 | Thread bump width as fraction of spacing [0.1–0.9]. 0.4 = open weave; 0.7 = tight weave. |
| `underDepth` | 0.3 | Under-thread depression depth [0–1]. 0 = flat valleys; 1 = deep recess. |
| `grainAngleDeg` | 0 | Rotate the weave in the XY plane. 0 = warp runs up Z. |
| `seed` | 1 | Deterministic seed. |
| `quality` | 3 | Mesh detail 1 (draft, ~4× fewer triangles) to 5 (ultra, ~4× more). Higher = smoother displacement, slower. |
| `preserveColor` | true | Carry paint through subdivision. |

**Look guidance:**
- Open weave / burlap: `threadWidth=0.35`, `threadSpacing=d*0.05`, `underDepth=0.5`
- Tight fabric: `threadWidth=0.65`, `threadSpacing=d*0.03`, `underDepth=0.2`
- Basket weave: `threadWidth=0.55`, `threadSpacing=d*0.06`, `underDepth=0.4`

---

## applyVoronoiShell

```
applyVoronoiShell({ amplitude?, cellSize?, wallWidth?, raised?, jitter?,
                    grainAngleDeg?, seed?, quality?, preserveColor? })
```

Organic cell-wall relief: a network of raised ridges tracing the boundaries
between Voronoi cells, with flat cell interiors (cracked-mud / dragonfly-wing /
decorative-lampshade look). Computed as a cellular (Worley F2−F1) distance field
over jittered grid seeds, so it follows the surface like the other textures.

> **This is a relief, not a cutaway.** It raises or engraves cell walls along the
> surface; it does **not** cut through-holes to leave an open strut lattice. For
> an actually-perforated, see-through Voronoi shell (a "Voronoi lamp"), use
> [`applyVoronoiLamp`](#applyvoronoilamp) instead.

| Parameter | Default | Notes |
|-----------|---------|-------|
| `amplitude` | ~3% of diagonal | Wall height. |
| `cellSize` | ~12% of diagonal | Approx spacing between cells (~8 cells across). |
| `wallWidth` | 0.25 | Raised-wall band width as a fraction of cellSize [0.05–0.6]. Smaller = thinner struts. |
| `raised` | true | true = raised wall network; false = engrave the network as recessed channels. |
| `jitter` | 1 | Cell irregularity [0–1]. 1 = full irregular Voronoi; 0 = a regular square grid. |
| `grainAngleDeg` | 0 | Rotate the cell pattern in the XY plane. |
| `seed` | 1 | Deterministic seed — change it to reshuffle the cell layout. |
| `quality` | 3 | Mesh detail 1 (draft, ~4× fewer triangles) to 5 (ultra, ~4× more). Higher = crisper walls, slower. |
| `preserveColor` | true | Carry paint through subdivision. |

**Look guidance:**
- Lampshade shell: `cellSize=d*0.15`, `wallWidth=0.15`, `amplitude=d*0.04`
- Cracked mud / dry earth: `cellSize=d*0.1`, `wallWidth=0.2`, `raised=false`
- Regular grid (waffle-like): `jitter=0`, `cellSize=d*0.08`

> Want **actual holes** (a see-through Voronoi lamp), not a raised pattern? Use
> [`applyVoronoiLamp`](#applyvoronoilamp).

---

## applyVoronoiLamp

```
applyVoronoiLamp({ cellSize?, wallThickness?, strutWidth?, resolution?,
                   jitter?, grainAngleDeg?, seed?, output?, smooth? })
```

The **cutaway** counterpart to `applyVoronoiShell`: turns a solid model into a
true perforated Voronoi shell — a thin hollow wall with the cell interiors cut
clean through, leaving a see-through strut network (the classic 3D-printed
Voronoi lamp / planter).

`output` chooses the form:
- **`'mesh'` (default)** — bakes a smooth manifold-js mesh by meshing a
  **continuous signed-distance field** (the principle behind `Manifold.levelSet`),
  so the curved walls follow the true surface with **no voxel stair-stepping**,
  and **no engine change**. Best for most lamps. It's a heavier operation than the
  other textures (allow a few seconds); a thin web can fuse into a few connected
  islands, so it stays manifold but may report `componentCount > 1`.
- **`'voxel'`** — switches the session to the `voxel` language (paintable,
  `.vox`-exportable, re-blockable), at the cost of a blockier look.

Start from a **closed solid** (vase, sphere, vessel). It hollows + perforates in
one step.

| Parameter | Default | Notes |
|-----------|---------|-------|
| `cellSize` | ~10% of diagonal | Approx spacing between cells (world units). |
| `wallThickness` | ~4% of diagonal | Shell thickness — how thick the struts are through the wall. |
| `strutWidth` | 0.32 | Kept edge-network width as a fraction of cellSize [0.05–0.6]. Smaller = thinner struts, bigger windows. |
| `resolution` | 110 | Field/voxel resolution along the longest axis [16–256]. **Auto-raised** so struts resolve to ≥6 cells — you rarely set it. Higher sharpens the struts (the walls are already smooth from the continuous field). |
| `jitter` | 1 | Cell irregularity [0–1]. 1 = irregular Voronoi; 0 = a regular grid of windows. |
| `grainAngleDeg` | 0 | Rotate the cell pattern in the XY plane. |
| `seed` | 1 | Deterministic seed — change to reshuffle the cell layout. |
| `watertight` | true | Keep only the largest connected web → one watertight, manifold, printable piece (drops loose fragments). Leave on for printing. |
| `output` | `'mesh'` | `'mesh'` = smooth manifold-js mesh (no engine change); `'voxel'` = voxel engine (paintable / .vox). |
| `smooth` | true | Voxel output only: round the struts with a smoothing pass. |

**Look guidance** (defaults already look good on a typical solid — mostly tune cellSize + strutWidth):
- Voronoi lamp: `cellSize=d*0.1`, `wallThickness=d*0.04`, `strutWidth=0.3`
- Chunky planter: `cellSize=d*0.16`, `wallThickness=d*0.06`, `strutWidth=0.4`
- Fine lattice: `cellSize=d*0.07`, `strutWidth=0.22`

**Tips:** with `watertight` on (default) the result is manifold/printable. If
windows don't open, lower `strutWidth` or raise `cellSize`. Resolution
auto-raises for thin struts, so you rarely touch it. Verify with `renderViews`.

---

## applyWireframe

```
applyWireframe({ strutRadius?, angleThresholdDeg?, resolution?, watertight?,
                 preserveColor? })
```

Turns a solid into a see-through **wireframe / edge cage**: it keeps only the
model's **sharp feature edges** and rebuilds each as a smooth round strut, so the
result is the model's visible "just the edges" skeleton. A cube becomes its
12-strut frame; a chamfered or low-poly shape becomes its hard edges.

Unlike the relief textures, this isn't surface displacement — it meshes a
**continuous distance field to the model's edges** (iso-0 of
`distanceToNearestEdge − strutRadius`), which gives cylindrical struts with
rounded joins at the corners, then keeps the largest connected web and relaxes
it. No engine change (bakes a manifold-js mesh).

**An edge is "kept" when** it is a boundary / non-manifold edge, **or** its two
adjacent faces bend by more than `angleThresholdDeg`. So a **fully smooth
surface** (sphere, organic blob) has no sharp edges and returns an **error** —
use it on **boxy / faceted / low-poly** models.

| Parameter | Default | Notes |
|-----------|---------|-------|
| `strutRadius` | ~2% of diagonal | Radius of each round strut (world units); the strut diameter is twice this. |
| `angleThresholdDeg` | 25 | Keep an interior edge when its faces bend more than this [5–80]. Lower → more edges kept (denser cage); higher → only the sharpest. |
| `resolution` | 96 | Field resolution along the longest axis [16–256]. **Auto-raised** so thin struts stay rounded — you rarely set it. |
| `watertight` | true | Keep only the largest connected strut web → one watertight, manifold, printable piece. For a single connected solid the whole cage is already one piece. |
| `preserveColor` | true | Sample model paint onto the struts. |

**Look guidance:**
- Clean box frame: defaults on a cube / cuboid.
- Denser cage on a chamfered or low-poly model: lower `angleThresholdDeg` (~12–18).
- Chunky vs delicate: raise / lower `strutRadius`.

**Tips:** if the cage is too sparse, lower `angleThresholdDeg`; too busy, raise
it. It's a heavier op (continuous field meshing) — allow a few seconds. Verify
with `renderViews` (an `edges:'none'` render reads cleanest). Returns
`{ ok, label, geometry, warnings? }` or `{ error }` when no edges qualify.

---

## Warnings

All texture tools return `{ ok, label, geometry, colorsCarried, warnings? }`.
`warnings` is an array of strings. Always log / report them.

| Warning | Cause | Fix |
|---------|-------|-----|
| amplitude exceeds 15% of diagonal | Displacement too large | Lower amplitude |
| Spacing/width/cell parameter too large | Too few visible features | Smaller value |
| Spacing/width/cell parameter very small | Features invisible | Larger value |
| Color transfer covered N% of triangles | Paint didn't fully transfer | Repaint gaps or `copyColorsFromVersion` |

---

## Typical workflows

### Bare geometry → knit texture → paint

```
1. runAndSave(code, "base shape")
2. applyKnitTexture({ stitchWidth: d*0.05, amplitude: d*0.03 })
3. renderViews()   // verify texture
4. paintByLabel / paintInBox / paintConnected as usual
5. saveVersion("knit + painted")
```

### Pre-painted geometry → texture (carry paint)

```
1. // model is already painted (version N)
2. applyWovenFabric({ threadSpacing: d*0.04, preserveColor: true })
3. // check result.colorsCarried and result.warnings
4. renderViews()   // verify paint survived
5. // if coverage < 70%: repaint problem areas or copyColorsFromVersion({index: N})
```

### Retune after applying

```
1. listVersions()         // find the pre-texture version index
2. loadVersion({index: N})
3. applyCableKnit({ ...newParams })
```

### Layering textures — not directly possible

Each texture bakes to a flat mesh. To combine (e.g. cable channels on a
waffle-background), apply the textures in sequence (each saves a new version)
— the second texture displaces the already-textured mesh. For very fine
secondary textures on coarse primary ones, apply the coarser texture first.
