# SDF (signed distance field) modeling — `api.sdf`

**When to reach for this:** the user wants something mesh CSG can't say cleanly. Concretely:

- An **organic figure / creature / body** — a figurine, character, person, animal, or bust. This is the default medium for anything anatomical: capsule limbs blended into ellipsoid masses with `smoothUnion` give continuous, sculpted joins. A `union` of constant-radius spheres and capsules can't — its ceiling is tubes-and-balls. See [Organic figures & creature bodies](#organic-figures--creature-bodies) below.
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

Triply-periodic minimal surfaces. All take `(cellSize, thickness)` — `cellSize` is the period in world units, `thickness` is a **field threshold** (not a wall width): the mesher keeps regions where `|F(p)| < thickness`, so 0 gives a bare zero-thickness surface and larger values fatten the walls until the lattice closes off entirely. They're mathematically infinite, so you **must** intersect with a finite shape or pass explicit `bounds` to `.build()`.

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

**Sizing `thickness`:** `thickness` is a field threshold in the TPMS field's natural units (roughly 0–1.5 range) — **the ratio `cellSize/N` is meaningless here and will produce a solid blob for typical `cellSize` values.**

For **gyroid, schwarzP, and diamond**:
- Open, see-through lattice: `thickness ≈ 0.4–0.7`. Below ~0.3 the shell is too thin to print; above ~0.9 pores begin closing off; **`thickness ≥ 1.1` selects nearly all of space → a solid blob** that passes `isManifold: true` but looks like a plain sphere.
- Safe starting point: `thickness = 0.5`, `cellSize = 8..15` for print-scale parts.
- Tie `edgeLength` to `cellSize / 14..16` (not to the wall thickness) so thin walls resolve without a runaway mesh count.

**Lidinoid is the outlier**: its double-frequency terms create smaller effective features, so use `thickness ≈ 0.3–0.5` and try `edgeLength ≈ cellSize / 10`.

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

## Organic figures & creature bodies

> **For a HUMANOID figure (person / character / hero / bust), prefer the higher-level `api.sdf.figure` builder — `readDoc("figure")`.** It gives you a deterministic posable rig (named joints, no coordinate guessing) plus part/face/hair/clothing builders that always weld to one component. The hand-built recipe below is the right tool for **animals, creatures, and other organic forms** that the humanoid rig doesn't cover, and for understanding what `figure` does under the hood.

This is the method for **figurines, characters, people, animals, and busts** — any anatomical form. The pattern is always the same: build each body part as a **capsule** (limbs, neck, fingers, tail) or **ellipsoid** (head, torso, hips, muscle masses), then weld them with **`smoothUnion`** so the joins are continuous flesh, not visible balls. Use **`mirrorPair`** for left/right symmetry so you only model one side. Don't reach for a plain `union` of constant-radius spheres and capsules here — that's the "primitive soup" failure mode (every limb a tube, every joint a ball); it validates but never resembles the subject.

```js
const { sdf } = api;

// Masses — ellipsoids give per-axis proportions a sphere can't.
const torso = sdf.ellipsoid(6, 4, 9).translate(0, 0, 16);
const hips  = sdf.ellipsoid(5, 4, 4).translate(0, 0, 8);
const head  = sdf.sphere(5).translate(0, 0, 28);
const neck  = sdf.capsule([0, 0, 22], [0, 0, 26], 2);

// Limbs — capsules from joint to joint; mirrorPair makes the matching side.
const arm = sdf.capsule([5, 0, 20], [10, 0, 6], 2).mirrorPair('x');
const leg = sdf.capsule([2.5, 0, 8], [3, 0, -14], 3).mirrorPair('x');

// Weld everything with smooth blends so joints read as continuous body.
const k = 1.5;                                  // ~10% of limb diameter
const body = torso
  .smoothUnion(hips, k)
  .smoothUnion(neck, k)
  .smoothUnion(head, k)
  .smoothUnion(arm, k)
  .smoothUnion(leg, k);

// A flat base keeps it printable (organic figures rarely have a flat foot).
const foot = sdf.box([14, 10, 2]).translate(0, 0, -15);
return body.smoothUnion(foot, 1).build({ edgeLength: 0.4 });
```

Workflow that lands a likeness instead of a blob:

1. **Block the masses first.** Get head : torso : hip : limb proportions right against the reference *before* any detail — `renderView` front and side, fix the silhouette, then move on. Wrong proportions are the #1 reason a figure doesn't resemble its subject.
2. **`smoothUnion` every join** with `k` ≈ 10% of the thinner part's diameter. Too small reads as a glued-on ball; too big melts the limb into the torso.
3. **Symmetry via `mirrorPair`**, not two hand-placed copies — it's exact and halves the code.
4. **Face the front (−Y).** A character's face must point toward −Y (see ai.md coordinate system), so the Front view and the export both show it facing forward.
5. **Detail last, as small additions** — brow, nose, ears, eye sockets — each `smoothUnion`'d (or `smoothSubtract`'d for sockets) onto the blocked body. Surface texture (scales, fur, bark) is `.displace(amount, sdf.noise(...))`.
6. **Judge against the reference, not just `isManifold`.** A figure's success criterion is *resemblance*. Compare your render to the photo/description before calling it done; manifold + prints is necessary, not sufficient.

For a hard or unfamiliar subject, spend 3 lines on a proof-of-concept first — one `smoothUnion` of two ellipsoids, rendered — to confirm the method reaches the look before you build the whole figure.

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
node.displace(amount, field)     // push the surface in/out by a scalar field (organic texture)
```

Twist, bend, and taper warp space — the resulting field is a Lipschitz *approximation* of the true SDF, but marching tetrahedra still produces a clean watertight mesh.

**`.displace(amount, field)`** is the *stochastic* warp — the rough-surface counterpart to the smooth twist/bend/taper. It moves the surface in and out by up to `amount` world units along a scalar `field(x,y,z)` (positive pushes OUTWARD). Pass `api.sdf.noise(...)` for organic texture (rock, bark, coral, terrain) or any custom `(x,y,z)=>number` returning roughly `[-1, 1]`. Two rules keep it printable:
- **Mesh fine enough to resolve the field.** Set `edgeLength` smaller than the noise's smallest feature (~`1/frequency` / `2^octaves`); otherwise the bumps alias into hundreds of speckle components. If `componentCount` explodes, your `edgeLength` is too coarse for the noise frequency, or the amplitude is too high.
- **Keep `amount` well under the noise wavelength (~`1/frequency`)**, or grooves/peaks pinch off floating islands. For deep, reliable texture, shape the field to one side — e.g. `(x,y,z) => -(n(x,y,z)*0.5 + 0.5)` carves **inward only**, which can never detach a piece, the dependable recipe for textured shells and grooved surfaces.

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
node.repeatN([nx, ny, nz], [px, py, pz], { stagger? })   // finite N-per-axis grid; optional stagger for brick/honeycomb
```

- **`polarArray`** mirrors the Manifold-side `circularPattern`: `axis` defaults to `'z'`, `angle` defaults to 360 (full ring, no duplicate at the seam; any other angle places endpoints inclusively), and `radius` pushes each copy outward along the first perpendicular axis before rotating. The whole array meshes as ONE region unless you label individual copies.
- **`polarRepeat`** is the **domain-warp** cousin of `polarArray`: instead of unioning N rotated copies, it folds the angular coordinate around the axis into one sector, so the child SDF is evaluated **once** per sample rather than N times. Reach for it when `count` is large (gears, fan blades, sun rays, fluted columns) — `polarArray` is fine up to a dozen or so; past that, `polarRepeat` is noticeably cheaper and produces identical geometry. Only supports a full revolution (no `angle` arg); use `polarArray` for partial sweeps. **One subtlety**: the angular fold makes the field continuous across the sector boundary but only C⁰ — adjacent copies meet in a hard seam at the fold, *even if your child uses `smoothUnion`*. If neighbouring copies should blend, size the joining material (root cylinder, hub) generously so the seam sits hidden inside the surface.
- **`mirrorPair`** is just `node.union(node.mirror(axis))` — model one half, get the symmetric whole.
- **`repeat`** is a **domain warp**: your input shape becomes the *unit cell* of an infinite tiling. So orient your input first — e.g. for a grid of holes through a Y-thin panel, `sdf.cylinder(1, 5).rotate(90, 0, 0).repeat([6, 0, 6])` (the rotate turns the Z-aligned cylinder into a Y-aligned hole, THEN repeat tiles it on the XZ grid). `repeat` is **infinite** on every axis with a non-zero period, exactly like the TPMS lattices — you must intersect it with a finite shape or pass explicit `bounds` to `.build()`. Use it for truss/peg arrays; use `gyroid`/`schwarzP`/etc. for smooth periodic surfaces.
- **`repeatN([nx, ny, nz], [px, py, pz], opts?)`** is the finite-count cousin. `nx`/`ny`/`nz` are integer counts per axis (0 disables that axis); the array centres on the origin. Bounds are **finite** even before any intersect — no clipping required. Use it for "I want a 6×6 grid of holes" without the bookkeeping of sizing a clipping region. Points outside the array snap to the nearest boundary cell. **Centring detail**: at **odd** N a cell sits exactly on the origin; at **even** N the array straddles the origin (cells at ±period/2, ±3·period/2, …). Pick odd counts when you want a central feature dead-centre; pick even counts when you want a symmetric gap there.

  **Stagger** (`opts.stagger = { along, by, amount? }`) brick-shifts alternating rows: every other cell along `by` gets nudged by `amount * period` along `along`. The classic running-bond brick wall is `repeatN([8, 5, 0], [4, 2, 0], { stagger: { along: 'x', by: 'y' } })` — 5 rows of 8 bricks, every other row offset by half a brick (the default `amount: 0.5`). Honeycomb hex patterns are the same trick with a hex-prism cell. `along` and `by` must be different axes; `amount` is clamped to `[0, 1]`.

## Generative fields & grammars

Two helpers turn procedural recipes into meshable SDF — the algorithmic-design counterpart to placing primitives by hand.

```js
api.sdf.noise({ seed?, frequency?, octaves?, lacunarity?, gain?, ridged? })  // → (x,y,z)=>number field
api.sdf.lsystem({ axiom, rules, iterations, angle?, length?, radius?,
                  radiusScale?, lengthScale?, seed?, blend?, label?, leaf? })  // → SdfNode
```

- **`noise(opts?)`** returns a seeded fractional-Brownian-motion field in roughly `[-1, 1]` — hand it straight to `node.displace(amount, field)`. `frequency` sets feature size (cycles per unit), `octaves` layers detail, `ridged: true` gives sharp creases (eroded rock, brain coral) instead of smooth hills. Same seed → identical noise, so models are reproducible. The field is a plain function, so you can wrap it: `(x,y,z) => n(x, y, z*0.2)` stretches features vertically (bark grain); `(x,y,z) => -(n(x,y,z)*0.5+0.5)` carves inward only.
- **`lsystem(opts)`** grows a Lindenmayer system into an SDF skeleton of welded capsules — fractal plants, corals, branching structures. `rules` rewrite the `axiom` string `iterations` times, then a 3D turtle walks it: `F` draws a segment, `+ -` yaw, `& ^` pitch, `\ /` roll, `[ ]` branch, `!` thin. `radiusScale`/`lengthScale` taper toward the tips; `blend` smooth-unions the joints (the SDF fillet, applied along the whole skeleton); `leaf: { symbols, radius, label }` drops foliage spheres as a second paint region. Stochastic productions are supported (`rules: { X: [{ p: 1, to: '...' }, ...] }`). **Cost scales as `segments × grid`** — keep `iterations` modest (≈3–5, a few hundred segments) and `edgeLength` ≥ ~0.6, or builds get slow.

**Ordering: intersect FIRST, then warp.** Domain warps (`twist`, `bend`, `taper`, `repeat`, `polarRepeat`) don't shrink their input's bounds — only spatial booleans do. So `infinite.twist(...)` stays infinite (and `.build()` fails); `infinite.intersect(finiteBox).twist(...)` works because the intersect makes bounds finite before the twist tries to compute its sweep. Same applies to `repeat(...).twist(...)` — clip the lattice first, then warp. (`repeatN` is already finite, so this ordering rule doesn't apply to it.)

## Building (lowering to a Manifold)

```js
return node.build();                              // sensible defaults
return node.build({ edgeLength: 0.25 });          // finer mesh
return node.build({ bounds: { min: [-30,-30,-30], max: [30,30,30] } });  // override bounds
return node.build({ edgeLength: 0.5, level: 0, tolerance: 0.05 });
return node.build({ edgeLength: 0.5, detail: [{ center: [0, 0, 52], radius: 9, edgeLength: 0.15 }] });
```

**`edgeLength` controls quality and speed.** Default is ~1/32 of the smallest bbox extent, clamped to `[0.1, 5]`. Halving `edgeLength` quadruples-or-more the triangle count and runtime — bump it down only when you can see facets you don't want.

### Detail regions — fine features on a big model {#detail-regions}

A uniform grid makes small features (a figurine's face, engraved lettering, a
fine clasp) faceted unless you pay for a fine grid over the *whole* model.
`detail` refines locally instead: after the march, triangles inside each
sphere are subdivided down to that sphere's `edgeLength` and the new vertices
are re-projected onto the exact SDF surface. The mesh stays watertight, labels
and welds are unaffected, and cost scales with the sphere's surface area only.

```js
// A 60-tall figure on a 0.5 grid, with the head meshed ~3× finer:
return body.build({
  edgeLength: 0.5,
  detail: [{ center: rig.joints.headCenter, radius: 9, edgeLength: 0.16 }],
});
```

- Up to 16 spheres; each only refines (a sphere coarser than the global grid
  is a no-op). Refinement is capped at ~400k triangles per labelled region.
- For figures, `api.sdf.figure.faceDetail(rig)` returns ready-made spheres (head + a finer mouth sphere)
  covering the head — see `/ai/figure.md`.

**`bounds`** is auto-inferred from the primitives in your tree. **Override it explicitly** when you use `gyroid` or `.repeat()` (which are unbounded), or when you intersect with something to cut a finite chunk from an infinite surface.

> **In a `voxel` session, `api.sdf` is also available — but you rasterize it into the grid with `v.sdf(node, opts)` instead of `.build()`** (there's no Manifold engine to lower through). Same expression vocabulary (gyroids, TPMS, smooth blends, twists), blocky colored-voxel output. `.label()` regions map to voxel colors via the `colors` option. See `/ai/voxel.md#sdf--voxel-vsdf`.

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
