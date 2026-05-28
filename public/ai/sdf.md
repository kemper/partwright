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
api.sdf.box([x, y, z])                  // full extents — spans [-x/2, x/2] etc.
api.sdf.box(size)                       // scalar form: equal-sided cube
api.sdf.roundedBox([x,y,z], r)          // box with all edges rounded by r
api.sdf.cylinder(radius, height)        // Z-aligned, spans [-h/2, h/2]
api.sdf.torus(majorR, minorR)           // ring in XY plane
api.sdf.capsule([x1,y1,z1], [x2,y2,z2], radius)   // hemisphere-capped rod
api.sdf.gyroid(cellSize, thickness)     // INFINITE — see "Bounds for unbounded shapes" below
```

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

Non-uniform scale (`scale([2, 1, 1])`) is intentionally not supported — it stretches the distance metric, breaking marching tetrahedra. If you really need a stretched shape, model it stretched (e.g. `sdf.box([20, 10, 10])`) instead of scaling.

## Modifiers

```js
node.shell(thickness)            // solid shell of given thickness around the original surface (|f| - t/2)
node.round(r)                    // grow by r everywhere, rounding sharp edges
node.twist(degPerUnit, axis?)    // twist around 'z' (default) — useful for spirals
node.bend(degPerUnit, axis?)     // bend perpendicular to 'x' (default)
```

Twist and bend warp space — the resulting field is a Lipschitz *approximation* of the true SDF, but marching tetrahedra still produces a clean watertight mesh.

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

- Labels propagate up through **transforms** (`translate`, `rotate`, `scale`, `mirror`), **modifiers** (`shell`, `round`, `twist`, `bend`), and the **A side of subtract** — so `sphere.label('shell').subtract(hole).translate(0, 0, 5)` still paints under `'shell'`.
- Labels do **NOT** propagate through smooth booleans (`smoothUnion`/`smoothSubtract`/`smoothIntersect`) or sharp `intersect` — those mix two surfaces and "which label wins" is ambiguous. Wrap the outer expression in `.label()` to paint the whole blend as one region.
- The B side of a subtract (the carving tool) has its labels ignored — the geometry is removed, so there's no surface to paint.

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

## What about non-uniform scaling, repetition, custom math?

The current SDF surface is deliberately scoped to the high-value subset:

- **Non-uniform scale** is omitted (breaks the distance metric — model the stretched primitive instead).
- **`repeat()`** for periodic arrays is not yet exposed (use `intersect` with a bounded region + design-time copies, or stick to `gyroid` for periodic surfaces).
- **Custom math** (write your own `f(x,y,z) → distance`) — fall back to `Manifold.levelSet(fn, bounds, edgeLength)` directly when the prebuilt vocabulary doesn't cover your case.

If a missing primitive or op keeps coming up, the right move is to add it to `api.sdf` rather than re-inventing it in user code.

## Common gotchas

- **You forgot `.build()`.** `sdf.sphere(5).translate(...)` is an *expression tree*, not a Manifold. The `return` must be the result of `.build()`.
- **You hit "could not infer finite bounds".** Something in your tree is unbounded (gyroid, or you constructed something whose bounds are infinite). Pass explicit `bounds` or intersect with a finite shape first.
- **Slow renders.** Default `edgeLength` is conservative; if your model is big you'll get a lot of triangles. Tune `edgeLength` upward (coarser) while iterating; tighten only for final renders.
- **Smooth blend looks faceted at the seam.** Lower `edgeLength` or raise `k` — the fillet needs at least a few triangles across its width.
- **Painted region jumps around after edits.** Each `.label()` is matched by name; if you rename the label in code, the existing paint region won't follow. Either keep the name stable, or repaint after the rename.
