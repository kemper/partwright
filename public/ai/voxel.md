# Voxel — blocky colored-cube modeling (`voxel` language)

## When to reach for this

The voxel engine builds models out of **unit cubes on an integer grid**, each
with its own color. It's a different paradigm from the solid/CSG engines — no
booleans, no parametric history, no smooth curves — but it's the right tool
for:

- **Minecraft-style / blocky / pixel-art** models.
- **Per-voxel color** baked straight into the mesh (exports carry vertex
  colors — GLB/3MF/OBJ).
- **Image-derived models** — a logo, sprite, or small photo voxelized into a
  standing billboard (see [Image import](#image-import)).
- Fast, **math-free authoring** — `fillBox`, `sphere`, `line`, `set`. Great
  when the user describes a shape block-by-block.

For precise mechanical parts use **manifold-js** or **BREP/replicad**; for
smooth/organic shapes use **manifold-js** (`Manifold.levelSet`, `Curves`).
Voxel surfaces are stair-stepped by nature.

## Switching to the voxel engine

```js
await partwright.setActiveLanguage('voxel');   // non-destructive; stashes your other-language draft
partwright.getActiveLanguage();                // -> 'voxel'
```

Then author code and commit it exactly like any other language —
`partwright.runAndSave(code, 'label')`. A voxel session persists as **code**
(it re-runs deterministically on load), so there's no special save step and no
new file format.

## The sandbox API

Voxel code receives `api` and must **`return` a grid**. Build one with
`api.voxels()`:

```js
const { voxels } = api;
const v = voxels();                 // a fresh empty grid
v.fillBox([-5, -5, 0], [4, 4, 0], '#6b8cff');   // a 10×10 base slab
v.fillBox([-1, -1, 1], [1, 1, 6], '#ff8c42');   // a tower
v.set(0, 0, 7, '#ff3b30');                       // a single red cap voxel
return v;
```

`api.params({...})` works here too, exactly as in manifold-js — declare tweakable
knobs (grid size, colors, counts) at the top and the live Parameters panel drives
them. See the Customizer section in `/ai.md`. Example:

```js
const { voxels } = api;
const p = api.params({ size: { type: 'int', default: 6, min: 2, max: 20 }, tint: { type: 'color', default: '#6b8cff' } });
const v = voxels();
v.fillBox([0, 0, 0], [p.size - 1, p.size - 1, p.size - 1], p.tint);
return v;
```

### Grid builder methods

All methods mutate the grid in place and return it (so they chain). Coordinates
are **integers** in the range −1024…1023 on each axis. 1 voxel = 1 world unit.

| Method | What it does |
|--------|--------------|
| `v.set(x, y, z, color)` | Occupy one voxel. |
| `v.remove(x, y, z)` | Empty one voxel. |
| `v.has(x, y, z)` → bool | Is the voxel occupied? |
| `v.get(x, y, z)` → `0xRRGGBB \| null` | Color of a voxel, or null if empty. |
| `v.fillBox([x0,y0,z0], [x1,y1,z1], color)` | Fill an inclusive box (corners in any order). |
| `v.sphere([cx,cy,cz], radius, color)` | Fill a solid sphere. |
| `v.cylinder([cx,cy,cz], radius, height, color, axis?)` | Fill a solid cylinder; base centered on the point, extends `height` along `axis` (`'x'`/`'y'`/`'z'`, default `'z'`). |
| `v.line([x0,y0,z0], [x1,y1,z1], color)` | Draw a 1-voxel-thick line (3D Bresenham). |
| `v.translate([dx,dy,dz])` | Shift every voxel by an integer offset. |
| `v.mirror('x' \| 'y' \| 'z')` | Add a mirrored copy across that axis's 0-plane (great for symmetric models; the mirrored copy wins where it overlaps an existing voxel). |
| `v.hollow(thickness?)` | Remove interior voxels, leaving a shell of the given wall thickness (default 1). |
| `v.size` | Number of occupied voxels. |
| `v.bounds()` → `{min,max} \| null` | Inclusive extents, or null when empty. |
| `v.forEach((x,y,z,color) => …)` | Iterate occupied voxels. |
| `voxels.decode(str)` | Rebuild a grid from an image-import string. |
| `voxels.color(c)` → `0xRRGGBB` | Normalize any color form to a number. |

### Colors

A `color` argument accepts any of:

- `[r, g, b]` with components **0–255** — e.g. `[255, 136, 0]`
- a hex string — `'#ff8800'` or short `'#f80'`
- a packed number — `0xff8800`

## Coordinate system

Z-up, right-handed (same as the rest of Partwright). A voxel at `(x, y, z)`
occupies the unit cube spanning `[x, x+1] × [y, y+1] × [z, z+1]`. Models sit on
or near the ground plane (Z=0) by convention.

## Colors are baked into the mesh

Each voxel's color is written onto the triangles of its exposed faces, so the
rendered model is colored with no extra step, and GLB / 3MF / OBJ exports carry
those colors out. (The face-region **paint tools** in the toolbar are
mesh-triangle based and designed around the solid engines; for voxel models use
the **Voxel Studio** overlay below, or set color per voxel in code.)

## Rounded edges (smooth surfacing)

By default a grid meshes as hard cubes. Call `.smooth()` before returning it to
round the edges and corners instead — useful for organic shapes, soft props, or
just softening the blocky look:

```js
const { voxels } = api;
return voxels()
  .sphere([0, 0, 0], 6, '#e7b')
  .smooth();              // rounded edges
```

`.smooth(opts)` accepts an iteration count or `{ iterations, detail }`:

- **`iterations`** (1–8, default 2) — more passes = rounder. It's a Taubin
  λ/μ smoothing of the mesh, so the model rounds without collapsing/shrinking.
- **`detail`** (1–4, default 1) — supersamples the grid ×`detail` before
  smoothing, giving finer, more controlled rounding on coarse/small models (at
  more triangles). The result is scaled back to the original world size.

```js
return voxels().fillBox([-4,-4,0],[4,4,8], '#6cf').smooth({ iterations: 4, detail: 2 });
```

Smoothing only moves vertices — topology is unchanged — so per-voxel colors are
preserved and the result stays a watertight manifold (exports/paint still work).
Call `.blocky()` to switch back to hard faces (the default).

**Smoothing wants features at least 2 voxels thick.** A `λ` pass pulls each
vertex toward its neighbours, so smoothing a 1-voxel-thick wall or a
`hollow(1)` shell can draw opposite faces together and self-intersect (the mesh
is still a valid manifold and won't error, but it can look pinched). Thicken the
feature (`hollow(2)`, ≥2-voxel walls) or use fewer `iterations` if you see it.

> For a fully organic surface from an implicit field, manifold-js's
> `Manifold.levelSet` or the `api.sdf` engine are better suited; `.smooth()` is
> the lightweight "round my voxels" option that stays inside the voxel workflow.

## MagicaVoxel `.vox` import

Drag a `.vox` file (from MagicaVoxel, Goxel, or any tool that exports the
format) onto the editor, or use Import → choose a `.vox` file. The file's
first model is parsed (palette + occupancy) and dropped into a fresh voxel
session as `voxels.decode(<encoded>)` editor code, centered on the origin and
sitting on z=0. Custom RGBA palettes are honored; files without one fall back
to MagicaVoxel's default 256-color palette.

(Multi-model `.vox` files: only the first model is imported. Open the others
in separate sessions or open them separately for now.)

## MagicaVoxel `.vox` export

In a voxel session, **Export → VOX** writes the grid back out as a MagicaVoxel
`.vox` file (the option appears only when the active language is `voxel`). It's
the inverse of the importer, so a `.vox` round-trips: cells and per-voxel colors
are preserved, and the file opens in MagicaVoxel, Goxel, and other tools that
read the format. The other 3D formats (GLB / 3MF / OBJ / STL) still work too —
they export the *meshed* voxels with vertex colors — but `.vox` is the only one
that keeps the editable voxel grid intact.

Programmatic / AI equivalent:

```js
partwright.exportVOX();              // browser download -> { ok, filename } | { error }
await partwright.exportVOXData();     // bytes over the API (see /ai/file-io.md)
// -> { filename, mimeType: "application/octet-stream", base64, sizeBytes }
```

Both read the current grid (re-derived from the editor code, or the live grid
when voxel paint is active). Format limits, surfaced as a clear `{ error }`:

- **256 voxels per axis.** `.vox` coordinates are single bytes, so one model
  spans at most 256³. Larger grids are rejected — keep the model within 256 per
  axis, or export GLB / 3MF for an arbitrarily large mesh.
- **255 colors.** The palette holds 255 entries. A grid with more distinct
  colors is reduced to the 255 most-frequent, with the rest snapped to the
  nearest kept color — no voxel is ever dropped. `.smooth()` surfacing doesn't
  affect the export; `.vox` always stores the underlying blocky cells.

## Voxel Studio

Click the **🧊 Voxel Studio** button (appears in voxel sessions only, viewport
overlay) to enter a Minecraft-style direct-editing mode. It mirrors the main
Paint menu's layout, adapted for voxels. Pick a **tool**, then click — or
**drag** — across faces on the model:

| Tool | Glyph | What it does |
|------|-------|--------------|
| Brush | 🖌 | Recolor voxels. **Drag** to paint a stroke; use **Size** for a wider brush. |
| Add | ➕ | Build new cubes onto the clicked faces (stacks/extends). Drag to sculpt; respects brush size/shape. |
| Remove | ⌫ | Delete voxels. Drag to erase; respects brush size/shape. |
| Bucket | 🪣 | Recolor the whole face-connected region that shares the clicked voxel's color. |
| Level | 🧱 | Recolor a whole **X/Y/Z layer** through the clicked voxel (pick the axis in the panel). |
| Box fill | ⬚➕ | Click two voxels to fill the inclusive box between them (bridges gaps; use **Add** to grow outward). |
| Box subtract | ⬚⌫ | Click two voxels to carve out the box between them (great for cutting holes). |

**Brush** (for the Brush / Add / Remove tools): a **Size** slider (0 = a single
voxel, up to a wide radius), three brush **shapes** — ● sphere, ◻ cube, ◆
diamond (the 3D analogues of the paint menu's circle/square/diamond) — and a
**Spray** toggle that scatters a random subset of the footprint (with a density
slider) for a speckled look. A click-**drag** paints a continuous stroke that
undoes as a single step.

Pick a color from the swatches or the **custom color** picker (any RGB). **↺
Undo** / **↻ Redo** step through your edits. The editor is locked while the
studio is active so an auto-run can't clobber your edits. When you're done,
click **Bake → code** to replace the editor with `voxels.decode(<your edited
grid>)` and save a new version, or **Cancel** to discard.

> Mesh-only paint features (edge-smoothing/subdivision, geodesic depth, the
> rotatable shape gizmo, and named color regions) don't apply to voxels —
> color lives per-cell in the grid and undo/redo replaces region history.

> Editing *bakes* the procedural code into a static voxel grid — the new
> version captures the edited state exactly, while the previous version (with
> the original code) is preserved in the version history.

### Editing an imported voxel

Image-import (and `.vox`) sessions open as `voxels.decode("…")` code. That
string *is* a live grid — Voxel Studio decodes it, so every tool works on an
imported model too. Use **Box subtract** / **Remove** to carve away parts you
didn't want, **Add** to extend it, and **Paint** / **Bucket** to recolor, then
**Bake** to commit the result as a new `voxels.decode(...)` version.

### Programmatic / AI equivalent

```js
await partwright.setActiveLanguage('voxel');
await partwright.run(`return api.voxels().fillBox([-3,-3,0],[3,3,3], '#888');`);
partwright.activateVoxelPaint();                       // -> { voxelCount } | { error }

// Single-voxel paint / erase (back-compat shortcut):
partwright.paintVoxelFace({ faceIndex: 0, color: [255, 0, 0] });
partwright.paintVoxelFace({ faceIndex: 12, erase: true });

// Multi-tool studio:
partwright.setVoxelTool('add');                                  // -> { tool }
partwright.setVoxelBrush({ radius: 2, shape: 'sphere' });        // wider brush
partwright.voxelStudioApply({ faceIndex: 0, color: [80,160,255] }); // sculpt a blob
partwright.setVoxelTool('bucket');
partwright.voxelStudioApply({ faceIndex: 4, color: '#33cc55' });    // flood recolor
partwright.setVoxelTool('level');
partwright.setVoxelLevelAxis(2);                                  // z layers
partwright.voxelStudioApply({ faceIndex: 8, color: '#ffcc00' });    // recolor a layer
partwright.setVoxelTool('boxRemove');
partwright.voxelStudioApply({ faceIndex: 0 });   // bank one corner (changed:false)
partwright.voxelStudioApply({ faceIndex: 30 });  // complete the box → carve it out

// A drag stroke = one undo step (programmatic equivalent of click-drag):
partwright.setVoxelTool('paint');
partwright.voxelStudioBeginStroke();
partwright.voxelStudioApply({ faceIndex: 0, color: '#ff0000' });
partwright.voxelStudioApply({ faceIndex: 2 });
partwright.voxelStudioEndStroke();               // -> { ok, voxelCount }

partwright.voxelStudioUndo();                                    // -> { undone, voxelCount }
partwright.voxelStudioRedo();                                    // -> { redone, voxelCount }

await partwright.bakeVoxelsToCode({ label: 'castle' });   // commits + saves
// (or) partwright.deactivateVoxelPaint() to cancel without saving
```

- `activateVoxelPaint()` re-runs the current code locally to capture the grid
  + per-triangle voxel/normal provenance. Returns `{ error }` outside voxel
  sessions, on a `.smooth()` grid (call `.blocky()` first), or if the code
  doesn't return a grid.
- `setVoxelTool(tool)` — `'paint' | 'add' | 'remove' | 'bucket' | 'level' |
  'boxAdd' | 'boxRemove'`. Returns `{ tool }` or `{ error }`.
- `setVoxelBrush({ radius?, shape?, spray?, sprayDensity? })` — brush for the
  paint/add/remove tools. `radius` in voxels (0 = single, max 16); `shape` is
  `'sphere' | 'cube' | 'diamond'`; `spray` scatters a random subset;
  `sprayDensity` 0.05..1. Returns the resolved settings.
- `setVoxelLevelAxis(axis)` — `0`/`1`/`2` (x/y/z) for the `level` tool.
- `voxelStudioBeginStroke()` / `voxelStudioEndStroke()` — bracket a run of
  `voxelStudioApply` calls so they collapse into one undo step (the
  programmatic equivalent of a click-drag).
- `voxelStudioApply({ faceIndex, color?, tool? })` applies the active tool at a
  face. `faceIndex` is the triangle index a raycast would return; the API maps
  it back to the originating voxel (and, for **Add**, the empty cell on the
  clicked face). The box tools need **two** calls — the first banks a corner
  (`changed:false`, `pendingBoxCorner` set), the second completes the region.
  Returns `{ changed, voxelCount, tool, pendingBoxCorner }`.
- `paintVoxelFace({ faceIndex, color?, erase? })` is the original single-voxel
  shortcut (paint or erase one voxel); still supported.
- `voxelStudioUndo()` / `voxelStudioRedo()` step the edit history (returns
  `{ undone|redone, voxelCount }`).
- `bakeVoxelsToCode({ label? })` deactivates the studio, writes
  `voxels.decode(...)` to the editor, runs it, and saves a new version. Returns
  `{ versionIndex, voxelCount }` (or `{ error }` for an empty grid).

## Image import

Drag an image (`.png`, `.jpg`, `.gif`, `.webp`) onto the editor, or use
Import → **Image → voxel…** (its own row in the import menu, below
Image → keychain / tile / relief). A parameter modal opens with a live preview so
you can dial in resolution, mode, depth/relief, transparency cutoff, and color
before committing to a new voxel session. The image stands upright: image
width → X, image height → Z, extruded along Y. Transparent pixels drop out (so
logos and sprites voxelize cleanly).

Two modes:

- **Billboard** (default) — every surviving pixel becomes a flat column
  `depth` voxels thick: a standing colored picture.
- **Heightmap** — each pixel's brightness drives a per-column height, turning
  the image into a 3D relief (lithophane-style). An optional `baseThickness`
  adds a solid backing so dark areas stay connected/printable, and `invert`
  raises dark areas instead of bright ones.

Programmatic / AI equivalent:

```js
// imageUrl is a data: URL or a same-origin URL.
// Billboard:
await partwright.importImageAsVoxels(imageUrl, { maxSize: 64, depth: 1, alphaThreshold: 128 });
// Heightmap relief:
await partwright.importImageAsVoxels(imageUrl, { mode: 'heightmap', maxSize: 96, maxHeight: 24, baseThickness: 2 });
// -> { sessionId, voxelCount }  (or { error })
```

- `maxSize` — longest side after downsampling (default 64).
- `mode` — `'billboard'` (default) or `'heightmap'`.
- `depth` — billboard extrusion thickness in voxels (default 1).
- `maxHeight` — heightmap: tallest relief column in voxels (default 16).
- `baseThickness` — heightmap: solid backing slab in voxels (default 1).
- `invert` — heightmap: raise dark areas instead of bright (default false).
- `alphaThreshold` — minimum alpha 0–255 for a pixel to become a voxel
  (default 128). Opaque photos (no alpha) become a full slab.
- `colorMode` — `'original'` (default), `'grayscale'`, or `'flat'`.
- `flatColor` — `[r, g, b]` used when `colorMode` is `'flat'`.
- `gamma` — heightmap: midtone curve on normalized brightness (default 1 =
  linear; >1 sinks midtones, <1 lifts them).
- `brightness` / `contrast` / `saturation` — image adjustments applied before
  sampling, each −1..+1 (0 = unchanged). Reuses the Relief Studio's preprocessor.
- `posterizeColors` — quantize `original` colors to this many clusters via
  k-means for a clean limited voxel-art palette (0 = off; the in-app modal
  exposes 2–12).
- `removeBackground` — drop a solid-color backdrop the alpha cutoff can't (an
  opaque photo's background). `backgroundColor: [r, g, b]` removes that exact
  color; omit it to auto-detect the dominant border color.

The in-app modal exposes all of these (image adjustments live under an
"Image adjustments" disclosure) with a live preview. The Recent Imports list
shows a thumbnail beside each image import and remembers whether it was a voxel
or a relief import — re-clicking a voxel import reopens this modal pre-loaded
with the settings you used.

## Gotchas

- **You forgot to `return` the grid.** The last statement must be
  `return v;` (the grid from `api.voxels()`), not the individual calls.
- **Stair-stepping.** Curves and diagonals are blocky — that's inherent. Use a
  finer scale (more voxels) if you need smoother silhouettes, or switch engines.
- **Diagonal-only contact is non-manifold.** Two voxels that touch only along
  an edge or corner (no shared face) produce a non-manifold edge, which can
  make `genus`/volume stats unreliable. Keep features **face-connected**.
- **No booleans / fillets / history.** Voxel modeling is direct: place and
  remove cubes. For CSG, fillets, or parametric edits, use manifold-js or BREP.
- **Coordinate range is −1024…1023 per axis.** Out-of-range coordinates throw.

## A complete example

```js
// A little red mushroom.
const { voxels } = api;
const v = voxels();
// stem
v.fillBox([-1, -1, 0], [1, 1, 4], '#efe6d5');
// cap
v.sphere([0, 0, 6], 4, '#d6332e');
// flatten the cap's underside so it reads as a dome
for (let x = -4; x <= 4; x++)
  for (let y = -4; y <= 4; y++)
    for (let z = 0; z < 6; z++) v.remove(x, y, z);
// white spots
v.set(2, 0, 8, '#ffffff');
v.set(-2, 1, 7, '#ffffff');
v.set(0, -3, 7, '#ffffff');
return v;
```
