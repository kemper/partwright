# Reliefs, colour tiles, and SVG imports (Relief Studio)

The relief importer has three output kinds for raster images, plus a dedicated
SVG path. All produce a Part you can paint on (AMS-friendly), and for the
heightmap-based variants you also get an advisory single-nozzle swap guide.

| Output | What it is | Best for |
|---|---|---|
| **Luminance relief** | Smooth tonal heightmap (brightness→height) | Portraits, photos, lithophanes |
| **Quantized → flat tile** (default for colour) | Flat colour-painted tile (keychain-style) | Logos, characters, badges |
| **Quantized → silhouette tile** | Flat tile cut to the image's subject outline | Stickers, character keychains |
| **Quantized → stepped relief** | Each cluster gets its own Z height | Posters where colour layering matters |
| **SVG import** | Per-`<path fill>` regions on a flat tile | Vector logos and icons (crispest result) |

## Make a Part from a raster image

```js
// src is a data: or http(s) image URL (e.g. an attached reference image's src).
await partwright.importImageAsRelief({
  src: 'data:image/png;base64,...',
  mode: 'quantized',
  options: { widthMm: 100, layerHeight: 0.08, baseThickness: 0.6, maxHeight: 3, resolution: 200 },
  quantized: {
    clusters: 5,
    output: 'flat',              // 'flat' (default) | 'silhouette' | 'relief'
    shape: 'rounded',            // 'rect' | 'rounded' | 'circle' (flat only)
    cornerRadiusMm: 4,
    chamferMm: 0.4,              // top-edge bevel; 0 = sharp corner
    holes: [                     // any number of circular cut-outs (mm)
      { cxMm: 0, cyMm: 44, diameterMm: 5 },
    ],
    // 'relief' only: 'single-nozzle' (default) groups triangles by Z-band
    // (slicer-faithful); 'multi-color' groups by cluster (AMS-friendly).
    paintingMode: 'single-nozzle',
  },
})
// -> { sessionId } (a new session whose geometry is the tile/relief), or { error }
```

- `mode: 'luminance'` — smooth brightness-driven heightmap relief; ignores
  `quantized.*` (no clusters).
- `mode: 'quantized'` — clusters the image colours into K regions (k-means with
  k-means++ seeding; Lab space by default). The colour regions are pre-painted
  on the resulting Part.
- The `quantized.output` switch decides the geometry kind. Default `'flat'` is
  the keychain-style flat tile + colour decals. `'silhouette'` cuts the tile
  to the image's subject (background removed via edge-colour detection).
  `'relief'` is a stepped-height heightmap where each cluster gets its own Z
  layer — useful for layered prints but rarely what you want for
  character/illustration art.
- For `'relief'` only, `quantized.paintingMode` selects how the mesh gets
  painted: `'single-nozzle'` (default) puts every triangle in a Z-band so any
  printed layer is one colour (matches a real filament-swap print, no
  XY-stripe artefacts on side walls); `'multi-color'` puts each cluster in
  its own region so an AMS can swap mid-XY.
- For watertight/manifold guarantees: luminance reliefs come in as a real
  Manifold (booleans/slice work). Tile + quantized-relief Parts come in as
  render-only meshes (the colour-region triangle ids would scramble through
  `Manifold.ofMesh`'s internal reorder) — paint/export still work.

## Paint it

Use the regular paint tools. Two strategies:

- **AMS (free paint):** paint features however you like — `paintInBox`,
  `paintConnected`, `paintByLabel`, etc. Each region is one filament color.
- **Single-nozzle friendly:** keep color a function of height — paint with
  `paintSlab({ axis: 'z', offset, thickness, color })` in horizontal bands so a
  single nozzle can reproduce it with filament swaps.

## See it like a print

```js
partwright.setReliefPreviewMode('single-nozzle') // 'flat' | 'ams' | 'single-nozzle'
```

`single-nozzle` simulates light through the translucent layer stack (filament
transmission distance), so it differs from flat paint. The preview is baked into
the per-triangle colors, so `renderView` / `renderViews` show it — set it before
rendering to self-check a stepped-relief print against the reference image.

## Read the swap guide

```js
partwright.getReliefSwapGuide()
// -> { layerHeight, totalLayers, totalHeight,
//      swaps: [{ atLayer, atZ, color:[r,g,b], filamentName? }, ...],
//      bands: [...], printability: 0..1, warnings: [...] }
```

`printability` near 1 means a single nozzle reproduces the painting well. A
`warnings` entry means a layer mixes colors at the same height — only an AMS can
reproduce that; constrain the paint there to Z-slabs if single-nozzle output
matters.

## Make a Part from an SVG

Vector input — each `<path fill>` becomes one seed region with crisp boundaries
(no clustering, exact colours, no anti-alias edge noise). Default `output` is
`'silhouette'` so the tile takes the SVG's overall outline.

```js
await partwright.importSvgAsRelief({
  svgText: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">...</svg>',
  options: { widthMm: 60, layerHeight: 0.2, baseThickness: 1, maxHeight: 0.8, resolution: 200 },
  quantized: { output: 'silhouette', holes: [{ cxMm: 0, cyMm: 27, diameterMm: 5 }] },
})
```

Strokes, gradients (treated as their representative colour), masks, and
clip-paths are ignored. Resolution caps at 256 columns.

## Imported stepped-relief STLs

Import the `.stl` normally, then in the Relief Studio panel use **Detect levels**
to seed a color region per existing Z plateau (or, programmatically, paint Z
slabs). Then preview + read the swap guide as above.

## Layered photo prints

A HueForge-style print (filament layering) is a heightmap printed in thin
layers, with the filament swapped at chosen layers. Thin plastic is
translucent, so the colour at each point depends on how much of each filament
lies under the surface there: a handful of filaments gives many shades.

`createLayeredPrint` solves the whole thing from a photo:

1. picks the filaments (from the built-in list, or the user's own spools), their
   order bottom→top, and the layer each one starts at;
2. gives every pixel the height whose stacked colour best matches the photo,
   smoothing the surface without blurring real edges;
3. opens the result as a new session, painted with the **predicted** look, so
   `renderView` / `renderViews` show what the print should look like.

```js
await partwright.createLayeredPrint({
  src: 'data:image/jpeg;base64,...',   // or an http(s) URL; AI tool: imageRef
  colors: 8,          // MAXIMUM filaments; swaps that barely help are dropped
  widthMm: 120,       // depth follows the photo
  maxHeightMm: 2.4,   // taller = more shades per filament (3.2 for colourful photos)
  // baseHeightMm: 0.48, layerHeight: 0.08, firstLayerHeight: 0.16, pixelSizeMm: 0.3,
  // filaments: [{ name: 'Black', hex: '#161616', td: 0.6 }, ...],  // the user's spools
  // baseFilament: 'Black',   // force the bottom filament
  // chromaWeight: 0,         // lightness only: classic monochrome HueForge
})
// -> { sessionId, blocks: [{name, hex, td, startLayer}], swaps: [{layer, z, name, hex, td}],
//      totalLayers, totalHeightMm, widthMm, depthMm, meanDeltaE }

partwright.getLayeredPrintPlan()        // same plan + `instructions` text for the user
partwright.listLayeredPrintFilaments()  // the built-in candidate list

partwright.exportLayeredPrint3MF({ swapMode: 'ams', printer: 'p1s' })
// Bambu Studio / Orca 3MF: one object, layer height + first layer + 100% infill
// set to match, and a filament change at each swap layer.
//   'ams'   — automatic filament changes (one AMS slot per filament)
//   'pause' — one filament; the printer pauses at each swap for a manual change
```

- **TD (transmission distance)** follows the HueForge convention: the
  thickness (mm) at which a filament stops letting the colour below show
  through. A layer of thickness `t` covers what's beneath with opacity
  `min(1, t / TD)`. The built-in TDs are typical values for common PLA colours;
  if the user knows their spools' TDs, pass them as `filaments`.
- **Judging the result:** `meanDeltaE` under ~10 is a good match; above ~15
  means the photo needs more colours, more height, or filaments closer to its
  palette. Render the session and compare it with the photo.
- **Colourful photos** are the hard case: every pixel shares one stack of
  filaments, so two saturated hues that each need to sit directly on a light
  base compete. More `maxHeightMm` and 8–10 `colors` help most.
- **The plan lives in this browser** (localStorage, keyed by session), not in the
  session file: a session exported/imported or opened from a share link has
  the painted mesh but no plan, so `exportLayeredPrint3MF` asks you to
  re-create it. The export also refuses if the open model no longer matches
  the plan's size (edited, scaled, or another object open).
- Size guards (App Config → Import): at most `layeredPrintMaxCells` heightmap
  cells and `layeredPrintMaxLayers` layers; past them `createLayeredPrint`
  returns `{error}` — raise `pixelSizeMm` or lower `maxHeightMm`.
- Headless (CLI agents in the repo): `npm run layered-print -- photo.jpg --colors 8
  --swap both` writes the 3MF(s), a photo-vs-prediction PNG, and the swap list.
