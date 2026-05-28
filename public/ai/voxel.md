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
those colors out. (The face-region **paint tools** are mesh-triangle based and
designed around the solid engines — painting *on top of* a voxel model is a
planned follow-up; for now, set color per voxel in code.)

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

## Image import

Drag an image (`.png`, `.jpg`, `.gif`, `.webp`) onto the editor, or use
Import → choose an image file. Opaque pixels become colored voxels in a new
voxel session; transparent pixels drop out (so logos and sprites voxelize
cleanly). The image stands upright as a billboard: image width → X, image
height → Z, extruded along Y. Large images are downsampled so the longest side
fits 64 voxels by default.

Programmatic / AI equivalent:

```js
// imageUrl is a data: URL or a same-origin URL.
await partwright.importImageAsVoxels(imageUrl, { maxSize: 64, depth: 1, alphaThreshold: 128 });
// -> { sessionId, voxelCount }  (or { error })
```

- `maxSize` — longest side after downsampling (default 64).
- `depth` — how many voxels deep to extrude (default 1).
- `alphaThreshold` — minimum alpha 0–255 for a pixel to become a voxel
  (default 128). Opaque photos (no alpha) become a full slab.

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
