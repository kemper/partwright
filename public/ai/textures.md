# Surface Texture Operations

Post-hoc operations that add surface detail to a finished model by displacing
vertices along their normals. Two textures are available:

| Texture | Look | Best for |
|---------|------|----------|
| `applyFuzzySkin` | Fine irregular roughness (3D-printing "fuzzy skin") | Technical prints, organic objects, rough stone/bark |
| `applyKnitTexture` | Interlocking V-pattern (stockinette knit stitch) | Clothing, plushies, cozy objects, fabric items |

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
| `scale` | ~4% of diagonal | Characteristic feature size. Smaller = finer fuzz. Match to visible print layer height (e.g. 0.4 mm for FDM). |
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
| `grainAngleDeg` | 0 | Rotate grain in XY plane. 0 = stitches run up Z (natural for standing models). 90 = horizontal. |
| `variation` | 0.1 | Per-stitch amplitude jitter (0 = machine-uniform, 0.1 = handmade feel). |
| `seed` | 1 | Deterministic seed for per-stitch variation. |
| `preserveColor` | true | Carry paint through subdivision. |

**Look guidance by `roundness`:**
- `roundness=0`: strong vertical ridges (ribs / rib-stitch look)
- `roundness=0.5`: classic stockinette V pattern
- `roundness=1`: soft bubble/seed-stitch look

**Grain direction:**
- `grainAngleDeg=0` — stitches run along Z (up the model). Correct for a
  standing figure wearing a sweater, a mug with a knit cozy, etc.
- `grainAngleDeg=90` — stitches run horizontally (good for flat knit items,
  hats viewed from side, brim of a beanie).

**Stitch size guidance (model diagonal `d`):**
- Fine knit: `stitchWidth=d*0.03`
- Medium knit: `stitchWidth=d*0.05`
- Chunky / cable-knit: `stitchWidth=d*0.12`

---

## Warnings

Both tools return `{ ok, label, geometry, colorsCarried, warnings? }`.
`warnings` is an array of strings. Always log / report them.

| Warning | Cause | Fix |
|---------|-------|-----|
| amplitude exceeds 15% of diagonal | Displacement too large | Lower amplitude |
| stitchWidth/scale too large | Too few visible features | Smaller stitch/scale |
| stitchWidth/scale very small | Features invisible | Larger stitch/scale |
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
2. applyKnitTexture({ stitchWidth: d*0.05, preserveColor: true })
3. // check result.colorsCarried and result.warnings
4. renderViews()   // verify paint survived
5. // if coverage < 70%: repaint problem areas or copyColorsFromVersion({index: N})
```

### Retune after applying

```
1. listVersions()         // find the pre-texture version index
2. loadVersion({index: N})
3. applyKnitTexture({ ...newParams })
```
