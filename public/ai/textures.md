# Surface Texture Operations

Post-hoc operations that add surface detail to a finished model by displacing
vertices along their normals. Six textures are available:

| Texture | Look | Best for |
|---------|------|----------|
| `applyFuzzySkin` | Fine irregular roughness (3D-printing "fuzzy skin") | Technical prints, organic objects, rough stone/bark |
| `applyKnitTexture` | Interlocking V-pattern (stockinette knit stitch) | Clothing, plushies, cozy objects, fabric items |
| `applyCableKnit` | Rope-like cable columns with crossing ply ridges | Sweaters, hats, Aran knitwear, rope textures |
| `applyWaffleStitch` | Recessed grid cells with raised borders | Waffle-knit, waffle irons, honeycomb patterns |
| `applyFurVelvet` | Directional anisotropic pile (velvet, fur, chenille) | Animal fur, velvet fabric, soft plush surfaces |
| `applyWovenFabric` | Plain-weave over/under interlacing | Baskets, woven cloth, twill, burlap |

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
applyFuzzySkin({ amplitude?, scale?, octaves?, seed?, preserveColor? })
```

Applies multi-octave value-noise (FBM) displacement along per-vertex normals.

| Parameter | Default | Notes |
|-----------|---------|-------|
| `amplitude` | ~1% of diagonal | Peak outward displacement (world units). Keep ≤ 5% to avoid manifold artifacts. |
| `scale` | ~4% of diagonal | Characteristic feature size. Smaller = finer fuzz. |
| `octaves` | 2 | Fractal layers 1–5. More = busier surface. |
| `seed` | 1 | Different seeds → different patterns with identical params. |
| `preserveColor` | true | Carry paint through subdivision. |

**Size guidance (model diagonal `d`):**
- Subtle: `amplitude=d*0.008`, `scale=d*0.03`
- Medium: `amplitude=d*0.015`, `scale=d*0.05`
- Heavy: `amplitude=d*0.03`, `scale=d*0.08`

---

## applyKnitTexture

```
applyKnitTexture({ amplitude?, stitchWidth?, stitchHeight?, rowOffset?,
                   roundness?, grainAngleDeg?, variation?, seed?, preserveColor? })
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
| `preserveColor` | true | Carry paint through subdivision. |

**Look guidance by `roundness`:**
- `roundness=0`: strong vertical ridges (ribs / rib-stitch look)
- `roundness=0.5`: classic stockinette V pattern
- `roundness=1`: soft bubble/seed-stitch look

---

## applyCableKnit

```
applyCableKnit({ amplitude?, cableWidth?, cablePitch?, plyWidth?,
                 grainAngleDeg?, variation?, seed?, preserveColor? })
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
| `preserveColor` | true | Carry paint through subdivision. |

**Size guidance:**
- Fine twisted cord: `cableWidth=d*0.04`
- Classic cable: `cableWidth=d*0.08`, `cablePitch=d*0.2`
- Bold Aran: `cableWidth=d*0.15`, `cablePitch=d*0.35`

---

## applyWaffleStitch

```
applyWaffleStitch({ amplitude?, cellWidth?, cellHeight?, sharpness?,
                    rowOffset?, grainAngleDeg?, seed?, preserveColor? })
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
| `preserveColor` | true | Carry paint through subdivision. |

**Look guidance:**
- Waffle blanket: `cellWidth=d*0.1`, `sharpness=3`
- Honeycomb: `cellWidth=d*0.06`, `rowOffset=0.5`, `sharpness=4`
- Fine grid: `cellWidth=d*0.04`, `sharpness=6`

---

## applyFurVelvet

```
applyFurVelvet({ amplitude?, fiberSpacing?, fiberLength?, octaves?,
                 grainAngleDeg?, seed?, preserveColor? })
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
| `preserveColor` | true | Carry paint through subdivision. |

**Look guidance:**
- Fine velvet: `fiberSpacing=d*0.01`, `fiberLength=d*0.07`
- Short animal fur: `fiberSpacing=d*0.025`, `fiberLength=d*0.12`
- Shaggy carpet: `fiberSpacing=d*0.04`, `fiberLength=d*0.3`, `octaves=3`

---

## applyWovenFabric

```
applyWovenFabric({ amplitude?, threadSpacing?, threadWidth?, underDepth?,
                   grainAngleDeg?, seed?, preserveColor? })
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
| `preserveColor` | true | Carry paint through subdivision. |

**Look guidance:**
- Open weave / burlap: `threadWidth=0.35`, `threadSpacing=d*0.05`, `underDepth=0.5`
- Tight fabric: `threadWidth=0.65`, `threadSpacing=d*0.03`, `underDepth=0.2`
- Basket weave: `threadWidth=0.55`, `threadSpacing=d*0.06`, `underDepth=0.4`

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
