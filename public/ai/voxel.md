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
| `v.rotate('x' \| 'y' \| 'z', degrees)` | Rotate the whole grid about the origin around that axis. `degrees` must be a multiple of 90 (the only angles that stay on the voxel lattice); positive = right-hand rule. About the origin, so `translate` first to pick a pivot. Use it to reorient a model — e.g. `v.rotate('z', 180)` spins a +Y-facing figure to face the −Y front. |
| `v.mirror('x' \| 'y' \| 'z')` | Add a mirrored copy across that axis's 0-plane (great for symmetric models; the mirrored copy wins where it overlaps an existing voxel). |
| `v.hollow(thickness?)` | Remove interior voxels, leaving a shell of the given wall thickness (default 1). |
| `v.sdf(node, opts?)` | Rasterize an `api.sdf.*` expression into the grid — gyroids, TPMS lattices, smooth blends, twists → colored voxels. See [SDF → voxel](#sdf--voxel-vsdf). |
| `v.keepLargest(count?)` | Keep only the largest face-connected component(s), deleting smaller islands (`count` default 1). The cheap printability fix for a fragmented grid — e.g. an SDF lattice that sheds stray specks. |
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
  smoothing, giving finer rounding on large, coarse shapes (at more triangles).
  The result is scaled back to the original world size. **Caution:** `detail > 1`
  on small, dense features (face pixels, fine voxel detail) tends to *add*
  stair-stepping rather than remove it — use plain `iterations` tuning there.

```js
return voxels().fillBox([-4,-4,0],[4,4,8], '#6cf').smooth({ iterations: 4, detail: 2 });
```

Smoothing only moves vertices — topology is unchanged — so per-voxel colors are
preserved and the result stays a watertight manifold (exports/paint still work).
Call `.blocky()` to switch back to hard faces (the default).

### Keeping a flat / blocky base (printability)

Plain `.smooth()` rounds the bottom too, so the model rocks on the build plate.
Three options pin part of the model so it stays printable while the rest rounds:

- **`flatBottom: true`** — pins the Z of the bottom-most plane. The build-plate
  face stays perfectly flat; sides and edges still round. The cheap fix for
  "it won't sit flat" — reach for this first.
- **`baseLayers: N`** — keeps the bottom `N` voxel layers fully **blocky** (a
  solid, sharp pedestal) while the body above smooths. Use when you want a
  deliberate base/stand, or sharp first-layer walls for adhesion.
- **`lockBox: [[x0,y0,z0],[x1,y1,z1]]`** — keeps the voxels in that inclusive
  box (voxel coordinates, any corner order) blocky, for a custom base region
  that isn't the whole bottom.

```js
// Smooth character on a perfectly flat bottom face:
return voxels().sphere([0,0,6], 6, '#e7b').fillBox([-2,-2,0],[2,2,1],'#888')
  .smooth({ iterations: 3, flatBottom: true });

// Smooth body on a sharp 2-layer pedestal:
return voxels().sphere([0,0,8], 6, '#6cf').fillBox([-7,-7,0],[7,7,2],'#444')
  .smooth({ baseLayers: 2 });
```

All three combine with `iterations` / `detail`, and the pinned region acts as a
fixed boundary the smoothed part still relaxes toward — so the seam between the
blocky base and the rounded body stays clean. (`baseLayers` already covers the
bottom plane, so it subsumes `flatBottom`.)

**Smoothing wants features at least 2 voxels thick.** A `λ` pass pulls each
vertex toward its neighbours, so smoothing a 1-voxel-thick wall or a
`hollow(1)` shell can draw opposite faces together and self-intersect (the mesh
is still a valid manifold and won't error, but it can look pinched). Thicken the
feature (`hollow(2)`, ≥2-voxel walls) or use fewer `iterations` if you see it.

> For a fully organic surface from an implicit field, manifold-js's
> `Manifold.levelSet` or the `api.sdf` engine are better suited; `.smooth()` is
> the lightweight "round my voxels" option that stays inside the voxel workflow.

## SDF → voxel (`v.sdf`)

The same declarative **SDF namespace** that manifold-js sessions use — `api.sdf`
— is available in voxel sessions, and `v.sdf(node, opts?)` **rasterizes** it into
the grid. Instead of hand-writing triple loops with the field math inline, you
compose primitives and let the engine sample them:

```js
const { voxels, sdf } = api;
const v = voxels();
// A gyroid infill lattice clipped to a rounded cube — one expression.
v.sdf(sdf.gyroid(10, 0.6).intersect(sdf.roundedBox([34, 34, 34], 5)), { res: 0.6, color: '#7ad0ff' });
return v;
```

This is the bridge between the smooth/implicit world and the blocky one. Reach
for it when you want a shape that's painful to place cube-by-cube — **gyroids /
TPMS lattices** (`sdf.gyroid`, `sdf.schwarzP`, `sdf.diamond`, `sdf.lidinoid`),
**smooth-blended organic forms** (`sdf.smoothUnion`), **twisted / bent /
tapered** bodies — but you still want the voxel pipeline (VOX export, per-cell
color, the blocky aesthetic). It's **additive**: it unions into whatever is
already in the grid, so mix it freely with `v.fillBox` / `v.sphere` / `v.set`.

### How sampling works

The voxel at integer coord `(i, j, k)` tests the field at world
`(i·res, j·res, k·res)` and is occupied when `f ≤ level` (inside the surface).
So an SDF centered at the origin produces a voxel model centered at the origin,
and the model's size in voxels is `worldSize / res`.

### Options (`v.sdf(node, opts)`)

| Option | Default | What it does |
|--------|---------|--------------|
| `res` | `1` | World units per voxel. Smaller = finer & larger (in voxels). `res: 0.5` doubles the voxel resolution. |
| `color` | `'#cccccc'` | Fill color when no `colors` entry applies. |
| `colors` | — | Map of SDF `.label(name)` → color. Each cell is colored by the labelled region it sits **deepest inside** (SDF union = min distance). Unlabelled / unmapped geometry falls back to `color`. |
| `bounds` | node's own | Explicit world sampling box `{ min:[x,y,z], max:[x,y,z] }`. **Required for infinite SDFs** (a bare `sdf.gyroid(...)` or `.repeat()` — intersect with a finite shape or pass this). |
| `level` | `0` | Iso level. `f ≤ level` is filled; a small positive value dilates the solid, negative erodes it. |

Two-tone example (label the SDF subtrees, map them to colors):

```js
const { voxels, sdf } = api;
const shell  = sdf.sphere(16).subtract(sdf.sphere(13)).label('shell');
const core   = sdf.gyroid(7, 0.7).intersect(sdf.sphere(13)).label('core');
return voxels().sdf(sdf.union(shell, core), {
  res: 1,
  colors: { shell: '#5bd0ff', core: '#ff6b9d' },
});
```

### Notes & gotchas

- **`api.sdf.build()` / `levelSet` is NOT available here** — there's no Manifold
  engine in a voxel session. Use `v.sdf(node)` to rasterize instead (the error
  message says so if you try `.build()`).
- **TPMS `thickness` is in field units, not world units.** A gyroid's field only
  ranges about ±1.5, so `thickness ≥ 1.5` fills almost solid; for an *open*
  lattice use a thin wall like `0.4`–`0.8`. Verify with a render — don't guess.
- **Sample budget.** `v.sdf` samples once per cell over the bounds; a tiny `res`
  over big bounds is capped (`import.voxelSdfMaxSamples`, default 8M) and throws,
  asking for a coarser `res` or tighter `bounds`, rather than freezing.
- **Printability — fragmentation.** Open lattices can fragment into many
  disconnected components (each a separate piece on the plate). Check
  `componentCount`. Fixes, cheapest first: call **`v.keepLargest()`** to drop
  stray specks; thicken walls so the lattice stays face-connected; weld a solid
  core/skin through it (e.g. `lattice.union(smallSolidCore)`, or subtract an
  inner shape from an outer solid and union the lattice inside).
- **Thin TPMS struts at `res: 1` can be non-manifold.** A lattice strut only one
  voxel wide tends to touch its neighbour along an *edge* (diagonal), not a face
  — a non-manifold edge. The fix is **resolution, not thickness**: a finer `res`
  (e.g. 0.6–0.7) thickens the same world-space strut to ≥2 voxels so it
  rasterizes face-connected. (`v.keepLargest()` can't repair this — diagonal
  contacts aren't separate components, they're a bad join *within* one.)
- **`colors`/`.label()` does NOT survive `smoothUnion`.** A label on a sub-shape
  that's then `smoothUnion`'d is never the *deepest* region at the blended
  surface, so its `colors` entry yields zero voxels (same reason the mesh path
  hard-unions across labels — see `/ai/sdf.md`). For a smooth-blended organic,
  either label the *outer* expression, or fill one base `color` and recolor
  detail regions afterward with `v.fillBox`/`v.set`/`v.sphere`.

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
Undo** / **↻ Redo** (also **Cmd/Ctrl+Z** / **Shift+Cmd/Ctrl+Z**) step through
your edits. The panel is **draggable** by its header and closes with its **×**
or **Esc** (discarding edits). The editor is locked while the studio is active
so an auto-run can't clobber your edits.

Two ways to commit when you're done:

- **Update code** — keeps your existing code and appends your edits as readable
  `v.set(...)` / `v.remove(...)` statements before the `return`. Best when the
  code is procedural (`v.fillBox`, `v.sphere`, …) and you want to keep it
  editable.
- **Save as raw voxel data** — replaces the editor with `voxels.decode(<your
  edited grid>)` of the whole grid. It **warns first** because it overwrites
  whatever code is there. The result is still an editable voxel session you can
  re-open in the Studio.

> Mesh-only paint features (edge-smoothing/subdivision, geodesic depth, the
> rotatable shape gizmo, and named color regions) don't apply to voxels —
> color lives per-cell in the grid and undo/redo replaces region history.

### Editing an imported voxel

Image-import (and `.vox`) sessions open as `voxels.decode("…")` code. That
string *is* a live grid — Voxel Studio decodes it, so every tool works on an
imported model too. Use **Box subtract** / **Remove** to carve away parts you
didn't want, **Add** to extend it, and **Paint** / **Bucket** to recolor, then
**Update code** (appends the edits) or **Save as raw voxel data** (replaces with
the full decoded grid) to commit a new version.

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
partwright.setVoxelBrush({ block: [5,5,1], depth: 0 });          // add a 5×5×1 plate flush to the clicked face
partwright.voxelStudioApply({ faceIndex: 0, color: '#cc8844' });    // stamp the block
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

// Commit — two options:
await partwright.updateVoxelCode({ label: 'castle' });   // keep code, append edits
await partwright.bakeVoxelsToCode({ label: 'castle' });  // replace with voxels.decode(...)
// (or) partwright.deactivateVoxelPaint() to cancel without saving
```

- `activateVoxelPaint()` re-runs the current code locally to capture the grid
  + per-triangle voxel/normal provenance. Returns `{ error }` outside voxel
  sessions, on a `.smooth()` grid (call `.blocky()` first), or if the code
  doesn't return a grid.
- `setVoxelTool(tool)` — `'paint' | 'add' | 'remove' | 'bucket' | 'level' |
  'boxAdd' | 'boxRemove'`. Returns `{ tool }` or `{ error }`.
- `setVoxelBrush({ radius?, shape?, spray?, sprayDensity?, block?, depth? })` —
  brush/block settings. For paint/remove: `radius` in voxels (0 = single, max
  16); `shape` is `'sphere' | 'cube' | 'diamond'`; `spray` scatters a random
  subset; `sprayDensity` 0.05..1. For the `add` tool: `block` is the `[x,y,z]`
  size in voxels (1..32 each) and the block is anchored to the clicked face so a
  thick block never pokes out the far side of a thin tile. `depth` (≥ 0; the
  panel slider tops out at 16 but a typed value can go deeper) sinks
  the add block into the surface, and for the box tools extrudes the
  fill/subtract along the clicked face (a `boxAdd` grows a slab that many extra
  layers, a `boxRemove` carves that many deeper); `0` = flush to the face.
  Returns the resolved settings.
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
  `{ undone|redone, voxelCount }`). In the UI, Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z
  do the same while the studio is active.
- `updateVoxelCode({ label? })` ("Update code") keeps the current procedural
  source and appends the edits as `v.set` / `v.remove` statements, runs it, and
  saves a new version. Returns `{ versionIndex, voxelCount }` (or `{ error }`).
- `bakeVoxelsToCode({ label? })` ("Save as raw voxel data") replaces the editor
  with `voxels.decode(...)` of the whole grid, runs it, and saves a new version.
  Returns `{ versionIndex, voxelCount }` (or `{ error }` for an empty grid). The
  in-app button confirms before overwriting; the API call does not.

## Image import

Use Import → **Image → voxel…** (its own row in the import menu, below
Image → keychain / tile / relief), or drag an image (`.png`, `.jpg`, `.gif`,
`.webp`) onto the editor. The parameter modal opens **first** (mirroring the
relief wizard); its button reads **Choose image…** until you pick one, then
**Choose a different image…** to swap. A live preview lets you dial in
resolution, mode, depth/relief, transparency cutoff, and color before committing
to a new voxel session. The image stands upright: image width → X, image
height → Z, extruded along Y. Transparent pixels drop out (so logos and sprites
voxelize cleanly).

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
// Fixed palette + editable builder code instead of a decode blob:
await partwright.importImageAsVoxels(imageUrl, {
  palette: [[20, 20, 30], [200, 60, 60], [240, 220, 180]],   // pixels snap to nearest
  codeStyle: 'calls',                                          // v.fillBox(...) you can edit
});
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
  exposes 2–12). Ignored when `palette` is set.
- `palette` — a fixed list of `[r, g, b]` colors; each surviving `original`-mode
  pixel snaps to its nearest entry (perceptual / LAB distance). This both
  **limits the color count** and lets you **choose the exact colors** (overrides
  `posterizeColors`). Empty / omitted / `null` = keep per-pixel color (or
  posterize). Use `partwright`'s extraction (the modal's "Palette" tab seeds
  from the image) to start from the image's own colors, then tweak.
- `codeStyle` — `'decode'` (default) writes the compact `voxels.decode("…")`
  blob; `'calls'` writes human-readable `v.fillBox(…)` / `v.set(…)` builder
  calls you can hand-edit. Same-color blocks are merged into boxes via greedy
  run-length grouping, and evenly-spaced repeats of an identical box (dots,
  stripes, grids) collapse further into a single `for` loop — so a repeated
  pattern costs one line instead of many. Very large or very colorful grids
  automatically fall back to `'decode'` so the editor stays responsive — limit
  the palette or lower the resolution to keep the output editable.
- `removeBackground` — drop a solid-color backdrop the alpha cutoff can't (an
  opaque photo's background). `backgroundColor: [r, g, b]` removes that exact
  color; omit it to auto-detect the dominant border color.

The in-app modal exposes all of these (image adjustments live under an
"Image adjustments" disclosure) with a live preview. Under **Color → Palette**
the modal seeds an editable swatch list from the image (k-means), and you can
recolor, add, or remove swatches or re-extract a different count; every pixel
then snaps to the nearest swatch. The **Editor code** toggle picks between the
compact data blob and editable builder calls, and shows live whether the current
model fits in editable calls or will fall back to compact data (so the fallback
is never a surprise). The Recent Imports list shows a
thumbnail beside each image import and remembers whether it was a voxel or a
relief import — re-clicking a voxel import reopens this modal pre-loaded with
the settings you used.

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
- **Catalog thumbnail faces iso azimuth ≈45° (the +X,−Y corner) by default.** The
  catalog 3/4 tile camera looks from the +X/−Y corner — camera-facing surfaces are
  the −Y and +X faces. By default, build characters and faced models with their
  front on the −Y/+X corner; a face authored on flat +Y shows the *back* of the
  head in the tile. **Or pin the tile angle** instead of reorienting the model:
  `partwright.setThumbnailCamera({ azimuth, elevation })` (degrees) before saving
  makes the thumbnail render from any angle you choose.

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
