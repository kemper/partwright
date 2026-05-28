# SDF (signed distance field) modeling — `api.sdf`

**When to reach for this:** the user wants something mesh CSG can't say cleanly. Concretely:

- A **smooth fillet** between two shapes that you'd otherwise have to engineer by hand (`smoothUnion`).
- A **twisted, bent, or tapered** body where you'd otherwise need `.warp(fn)` heroics.
- A **lattice / gyroid / periodic infill** for 3D printing — geometry that's mathematically defined and infinite by nature.
- A **constant-thickness shell** of any shape (`.shell(t)`).
- A **morph or blend** between two designs.

For sharp-edged mechanical work — axis-aligned plates, bored holes, threaded fittings — stay with native Manifold. SDFs add cost and meshing artifacts you don't need.

## How it works (briefly)

`api.sdf` builds an expression tree of distance functions (sphere, box, smoothUnion, twist, …). Calling `.build()` lowers the tree through `Manifold.levelSet` (marching tetrahedra) and returns a normal Manifold you can union, subtract, export, paint, anything.

**Sign convention:** distance is **negative inside, positive outside, zero on the surface** — the standard SDF convention (Inigo Quilez, Shadertoy, libfive). Manifold's `levelSet` uses the opposite convention internally, but the SDF layer handles the flip for you, so you can write distance functions the normal way.

## Quick example

A handle that smoothly joins a sphere to a cylinder — the classic case for SDF:

```js
const { sdf } = api;
const grip = sdf.cylinder(3, 20);                         // radius 3, height 20
const knob = sdf.sphere(5).translate(0, 0, 12);           // a ball at the top
return grip.smoothUnion(knob, 1.5).build();               // k=1.5 controls the fillet radius
```

Compared to the mesh-CSG version (which would need an extra fillet pass) this is one expression.

## Primitives

All primitives are centered at the origin and use the standard SDF convention.

```js
api.sdf.sphere(radius)                  // ball of given radius
api.sdf.ellipsoid(rx, ry, rz)           // per-axis radii — the "squashed sphere" .scale() can't make
api.sdf.box([x, y, z])                  // full extents — spans [-x/2, x/2] etc.
api.sdf.box(size)                       // scalar form: equal-sided cube
api.sdf.roundedBox([x,y,z], r)          // box with rounded edges — OUTER size stays [x,y,z] (r < half min dim)
api.sdf.cylinder(radius, height)        // Z-aligned, spans [-h/2, h/2]
api.sdf.roundedCylinder(radius, height, edgeR)  // rounded top/bottom edges — OUTER radius+height preserved
api.sdf.torus(majorR, minorR)           // ring in XY plane
api.sdf.capsule([x1,y1,z1], [x2,y2,z2], radius)   // hemisphere-capped rod
```

### TPMS lattices (all infinite — see "Bounds for unbounded shapes")

Triply-periodic minimal surfaces. All take `(cellSize, thickness)` — `cellSize` is the period in world units, `thickness` is the wall width (0 = a bare zero-thickness surface). They're mathematically infinite, so you **must** intersect with a finite shape or pass explicit `bounds` to `.build()`.

```js
api.sdf.gyroid(cellSize, thickness)     // the famous one — smooth, isotropic
api.sdf.schwarzP(cellSize, thickness)   // blockier rounded-cubic cells
api.sdf.diamond(cellSize, thickness)    // interpenetrating diamond channels (scaffold look)
api.sdf.lidinoid(cellSize, thickness)   // woven, higher-genus

// Spatially-varying wall thickness — graded variant for every family:
api.sdf.gradedGyroid  (cellSize, (x, y, z) => /* thickness here */)
api.sdf.gradedSchwarzP(cellSize, (x, y, z) => /* thickness here */)
api.sdf.gradedDiamond (cellSize, (x, y, z) => /* thickness here */)
api.sdf.gradedLidinoid(cellSize, (x, y, z) => /* thickness here */)
```

**Sizing `thickness`:** for a printable shell `thickness ≈ cellSize/6 to cellSize/3` is the sweet spot — thinner gets fragile/under-resolved, thicker fills in the pores. With the default `edgeLength` heuristic the four families look comparable at matched parameters; **lidinoid** is the resolution-hungriest because its double-frequency terms create smaller effective features at the same `cellSize` — drop `edgeLength` a touch if it looks jaggy.

**Mixing two lattices:** use **sharp `union`** to butt two regions side-by-side (preserves their labels for paint). `intersect` two infinite TPMS gives their common surface (also infinite — still needs an outer bound).

`gradedGyroid`'s thickness function is called once per mesh sample (millions of times) — keep it to cheap arithmetic.

## Boolean operations (sharp)

Plain Manifold-style booleans. Methods chain; functional forms also work.

```js
a.union(b)              // == sdf.union(a, b)
a.subtract(b)           // a minus b
a.intersect(b)          // a ∩ b
```

## Smooth booleans (THE killer feature)

`k` is the blend radius — bigger `k` = wider/softer fillet.

```js
a.smoothUnion(b, k)        // blended weld between two shapes
a.smoothSubtract(b, k)     // softened pocket
a.smoothIntersect(b, k)    // blended overlap

// Or in functional form:
api.sdf.smoothUnion(a, b, k)
api.sdf.smoothSubtract(a, b, k)
api.sdf.smoothIntersect(a, b, k)
```

**Heuristic for `k`:** start at ~10% of the smallest dimension involved in the join. Too small → fillet looks like a sharp seam. Too big → the shapes lose their identity and merge into a blob.

## Transforms

```js
node.translate(x, y, z)   // or .translate([x, y, z])
node.rotate(rx, ry, rz)   // degrees, Manifold's X→Y→Z convention
node.scale(s)             // UNIFORM only — non-uniform scale breaks SDFs
node.mirror('x' | 'y' | 'z')
```

Non-uniform scale (`scale([2, 1, 1])`) is intentionally not supported — it stretches the distance metric, breaking marching tetrahedra. For a squashed/stretched sphere use `sdf.ellipsoid(rx, ry, rz)`; for a stretched box just give `sdf.box([20, 10, 10])` the dimensions you want.

## Modifiers

```js
node.shell(thickness)            // solid shell of given thickness around the original surface (|f| - t/2)
node.round(r)                    // grow by r everywhere, rounding sharp edges
node.twist(degPerUnit, axis?, center?)  // twist around 'z' (default); center=[u,v] offsets the twist line
node.bend(degPerUnit, axis?)     // bend perpendicular to 'x' (default)
node.taper(rate, axis?)          // linearly scale the cross-section along 'z' (default)
```

Twist, bend, and taper warp space — the resulting field is a Lipschitz *approximation* of the true SDF, but marching tetrahedra still produces a clean watertight mesh.

**`.round(r)` grows the whole shape by `r`.** It's literally `f - r`, which offsets the iso-surface outward by `r` in every direction — so `cylinder(2, 10).round(0.5)` produces a shape with radius 2.5 AND height 11, not "the same cylinder with rounded edges". When you want the rounding WITHOUT the inflation, reach for `sdf.roundedBox` / `sdf.roundedCylinder`, which preserve the outer dimensions for you.

**For `.twist()` on a primitive with corners** (cube, box, roundedBox), give the corners a small `.round(...)` or use `roundedBox(...)` first. The marched edges of a sharp-cornered primitive can chatter visibly along the helix at high twist rates; pre-rounding eliminates this without needing finer `edgeLength`. The optional `center` arg, e.g. `.twist(9, 'z', [10, 0])`, spirals the shape around an off-centre vertical line instead of its own axis — useful for asymmetric spirals.

**For `.bend(degPerUnit, axis)`**: `axis` names the *input axis sampled* to compute the rotation amount — NOT the rotation axis. The rotation happens in the plane perpendicular to `axis`. So `bend(45, 'x')` reads the X coordinate of each point and rotates it in the XY plane (around Z) by `x * 45°`.

**For `.taper(rate, axis)`**: the cross-section perpendicular to `axis` scales by `1 + rate*coord` — scale is 1 at the origin, so positive `rate` widens toward +axis and negative narrows toward +axis (equivalently, widens toward −axis). Examples:
- `sdf.box([10,10,40]).taper(-0.02, 'z')` — obelisk that shrinks ~2% per unit of height (wider bottom, narrower top).
- `sdf.cylinder(2, 30).taper(+0.05, 'z')` — funnel that widens upward (5% per unit).
- A primitive *centred on the origin* has scale=1 at its midpoint, so a +rate widens its top half and narrows its bottom half. Translate the shape if you want the taper anchored to one end instead of the middle.

## Combinators

```js
node.polarArray(count, { axis?, angle?, radius? })  // ring of rotated copies, unioned
node.polarRepeat(count, { axis?, radius? })         // ring as a DOMAIN WARP — child evaluated ONCE per sample
node.mirrorPair('x' | 'y' | 'z')                    // node ∪ its mirror — symmetric parts in one call
node.repeat([px, py, pz])                           // infinite grid tiling (0 = no repeat on that axis)
node.repeatN([nx, ny, nz], [px, py, pz])            // finite N-per-axis grid, centred on origin — bounds stay finite
```

- **`polarArray`** mirrors the Manifold-side `circularPattern`: `axis` defaults to `'z'`, `angle` defaults to 360 (full ring, no duplicate at the seam; any other angle places endpoints inclusively), and `radius` pushes each copy outward along the first perpendicular axis before rotating. The whole array meshes as ONE region unless you label individual copies.
- **`polarRepeat`** is the **domain-warp** cousin of `polarArray`: instead of unioning N rotated copies, it folds the angular coordinate around the axis into one sector, so the child SDF is evaluated **once** per sample rather than N times. Reach for it when `count` is large (gears, fan blades, sun rays, fluted columns) — `polarArray` is fine up to a dozen or so; past that, `polarRepeat` is noticeably cheaper and produces identical geometry. Only supports a full revolution (no `angle` arg); use `polarArray` for partial sweeps.
- **`mirrorPair`** is just `node.union(node.mirror(axis))` — model one half, get the symmetric whole.
- **`repeat`** is a **domain warp**: your input shape becomes the *unit cell* of an infinite tiling. So orient your input first — e.g. for a grid of holes through a Y-thin panel, `sdf.cylinder(1, 5).rotate(90, 0, 0).repeat([6, 0, 6])` (the rotate turns the Z-aligned cylinder into a Y-aligned hole, THEN repeat tiles it on the XZ grid). `repeat` is **infinite** on every axis with a non-zero period, exactly like the TPMS lattices — you must intersect it with a finite shape or pass explicit `bounds` to `.build()`. Use it for truss/peg arrays; use `gyroid`/`schwarzP`/etc. for smooth periodic surfaces.
- **`repeatN([nx, ny, nz], [px, py, pz])`** is the finite-count cousin. `nx`/`ny`/`nz` are integer counts per axis (0 disables that axis); the array centres on the origin. Bounds are **finite** even before any intersect — no clipping required. Use it for "I want a 6×6 grid of holes" without the bookkeeping of sizing a clipping region. Points outside the array snap to the nearest boundary cell.

**Ordering: intersect FIRST, then warp.** Domain warps (`twist`, `bend`, `taper`, `repeat`, `polarRepeat`) don't shrink their input's bounds — only spatial booleans do. So `infinite.twist(...)` stays infinite (and `.build()` fails); `infinite.intersect(finiteBox).twist(...)` works because the intersect makes bounds finite before the twist tries to compute its sweep. Same applies to `repeat(...).twist(...)` — clip the lattice first, then warp. (`repeatN` is already finite, so this ordering rule doesn't apply to it.)

## Building (lowering to a Manifold)

```js
return node.build();                              // sensible defaults
return node.build({ edgeLength: 0.25 });          // finer mesh
return node.build({ bounds: { min: [-30,-30,-30], max: [30,30,30] } });  // override bounds
return node.build({ edgeLength: 0.5, level: 0, tolerance: 0.05 });
```

**`edgeLength` controls quality and speed.** Default is ~1/32 of the smallest bbox extent, clamped to `[0.1, 5]`. Halving `edgeLength` quadruples-or-more the triangle count and runtime — bump it down only when you can see facets you don't want.

**`bounds`** is auto-inferred from the primitives in your tree. **Override it explicitly** when you use `gyroid` or `.repeat()` (which are unbounded), or when you intersect with something to cut a finite chunk from an infinite surface.

## Painting SDFs — paint-by-label

`api.sdf` integrates with the existing `partwright.paintByLabel({label, color})` flow.

```js
const { sdf } = api;
// Mark each paintable region with .label():
const head = sdf.sphere(10).label('head');
const eye = sdf.sphere(2).translate(3, 8, 0).label('eye');
return sdf.union(head, eye).build();

// Then from a separate tool call, after runAndSave:
partwright.paintByLabel({ label: 'eye', color: [0, 0, 1] });
```

**How it works:** at `.build()` time the tree is partitioned at each `.label()`. Each labelled subtree is meshed separately and registered with the run's label registry (the same one `api.label(shape, name)` uses for Manifold parts), then the pieces are hard-unioned. `paintByLabel` then resolves names against the registry exactly as it does for mesh-CSG.

**The trade-off:** because labelled subtrees mesh separately, **smooth blends across labels degrade to hard unions.** If you want a smooth weld between two paintable regions, label the OUTER expression instead:

```js
// Smooth blend preserved, but painted as a single region:
return sdf.smoothUnion(sdf.sphere(5), sdf.sphere(5).translate(4, 0, 0), 1)
  .label('body')
  .build();

// Two separately-paintable regions, but the join becomes a hard union:
return sdf.union(sdf.sphere(5).label('a'), sdf.sphere(5).translate(4, 0, 0).label('b'))
  .build();
```

**Label propagation rules:**

- Labels propagate up through **transforms** (`translate`, `rotate`, `scale`, `mirror`), **modifiers** (`shell`, `round`, `twist`, `bend`), and the **A side of both `subtract` and `smoothSubtract`** — so `sphere.label('shell').subtract(hole).translate(0, 0, 5)` and `sphere.label('shell').smoothSubtract(dimple, 0.5)` both paint under `'shell'`. The result of a subtract IS A's surface (with a chunk or a soft bite removed), so A's label is the natural owner.
- Labels do **NOT** propagate through `smoothUnion`, `smoothIntersect`, or sharp `intersect` — those mix two surfaces and "which label wins" is ambiguous. Wrap the outer expression in `.label()` to paint the whole blend as one region.
- The B side of a subtract / smoothSubtract (the carving tool) has its labels ignored — the geometry is removed, so there's no surface to paint.

## Mixing SDF and mesh CSG

`.build()` returns a regular Manifold, so you can boolean it with hand-coded Manifold parts. This is the right pattern when only PART of the model needs the SDF features.

```js
const { Manifold, sdf } = api;

// Smooth, blended grip — SDF's strength:
const grip = sdf.cylinder(3, 30)
  .smoothUnion(sdf.sphere(5).translate(0, 0, 18), 1.5)
  .build();

// Crisp mounting plate — Manifold's strength:
const plate = Manifold.cube([20, 20, 2], true).translate([0, 0, -1]);

return grip.add(plate);
```

## Bounds for unbounded shapes

`gyroid` is mathematically infinite — it has no natural bounding box. To mesh it, **intersect with a finite shape OR pass explicit `bounds`**:

```js
// Gyroid infill clipped to a box:
const { sdf } = api;
const infill = sdf.gyroid(5, 0.5).intersect(sdf.box([20, 20, 20]));
return infill.build();   // bounds are inferred from the box

// Gyroid alone with explicit bounds:
return sdf.gyroid(5, 0.5)
  .build({ bounds: { min: [-10, -10, -10], max: [10, 10, 10] } });
```

Without bounds, `.build()` throws — it can't mesh an infinite domain.

## What about non-uniform scaling and custom math?

The current SDF surface is deliberately scoped to the high-value subset:

- **Non-uniform scale** is omitted (it breaks the distance metric — model the stretched primitive instead, or use `sdf.ellipsoid(rx, ry, rz)` for squashed spheres).
- **Custom math** (write your own `f(x,y,z) → distance`) — fall back to `Manifold.levelSet(fn, bounds, edgeLength)` directly when the prebuilt vocabulary doesn't cover your case.

If a missing primitive or op keeps coming up, the right move is to add it to `api.sdf` rather than re-inventing it in user code.

## Common gotchas

- **You forgot `.build()`.** `sdf.sphere(5).translate(...)` is an *expression tree*, not a Manifold. The `return` must be the result of `.build()`.
- **You hit "could not infer finite bounds".** Something in your tree is unbounded (gyroid, or you constructed something whose bounds are infinite). Pass explicit `bounds` or intersect with a finite shape first.
- **Slow renders.** Default `edgeLength` is conservative; if your model is big you'll get a lot of triangles. Tune `edgeLength` upward (coarser) while iterating; tighten only for final renders.
- **Smooth blend looks faceted at the seam.** Lower `edgeLength` or raise `k` — the fillet needs at least a few triangles across its width.
- **Painted region jumps around after edits.** Each `.label()` is matched by name; if you rename the label in code, the existing paint region won't follow. Either keep the name stable, or repaint after the rename.
