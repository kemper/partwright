# BREP / replicad — exact-surface modeling

Partwright exposes a **BREP** (boundary-representation) kernel via
[replicad](https://replicad.xyz) on top of OpenCASCADE.js. There are **two
ways** to reach it, and they're for different use cases:

| You want… | Where you write it | What you get back |
|---|---|---|
| One feature with a true edge fillet inside an otherwise mesh-native model | `api.BREP.*` inside a **manifold-js** session, then `BREP.toManifold(shape, Manifold)` | A Manifold (the BREP is gone once converted) |
| A whole part with STEP export and an exact representation that survives across runs | The **replicad** language (`setActiveLanguage("replicad")`), `return BREP.shape` directly | A BREP shape — STEP export works |

The modeling vocabulary is identical in both. The difference is *what survives*
after your code finishes running.

## Why BREP at all?

Mesh kernels (manifold) approximate curved surfaces with triangles. BREP
kernels keep the exact mathematical surfaces and the topology (which edges
meet which faces). That unlocks features that are genuinely hard or impossible
on a mesh:

- **True selective edge fillets / chamfers.** `BREP.box([10,10,10]).fillet(2)`
  produces a precisely rounded cube — not "smooth the mesh near corners",
  but an actual cylindrical-arc surface tangent to the two flat faces.
- **STEP export.** Manufacturing-grade interop with SolidWorks, Fusion,
  Onshape, FreeCAD — STEP is BREP-native, mesh formats lose the exact
  surfaces irreversibly.
- **Exact face/edge queries.** "What's the radius of this hole?" returns
  `2.5000` from the surface equation, not a noisy fit through triangulated
  vertices.

What BREP **doesn't** do:

- `Manifold.warp`, `Manifold.levelSet`, `Manifold.smooth/.refine` — these
  are mesh-only ops. The BREP namespace does not include them.
- `Curves` helpers (loft, sweep, NACA airfoils, ring/linear/mirror copy)
  are not exposed in BREP-language sessions — they're mesh-native.

## The shape API

```js
const { BREP } = api;

// Primitives
BREP.box([w, d, h]);    // centred at origin
BREP.cylinder(r, h);    // base on XY, height along +Z
BREP.sphere(r);

// Operations (return a new shape; the original is immutable, like Manifold).
// Inputs are NOT consumed — you can reuse the same shape in multiple ops.
shape.fillet(radius, filter?);                  // round edges (filter = selective)
shape.chamfer(distance, filter?);               // bevel edges (filter = selective)
shape.fuse(other);                              // boolean union
shape.cut(other);                               // boolean subtract (this - other)
shape.intersect(other);                         // boolean intersect
shape.translate([x, y, z]);
shape.rotate(degrees, [ax, ay, az]);            // optional 3rd arg: origin

// Array helpers — reach for these instead of `.reduce()` for N-way ops.
BREP.fuseAll([a, b, c, ...]);                   // union of every shape
BREP.cutAll([body, hole1, hole2, ...]);         // body - hole1 - hole2 - ...
BREP.intersectAll([a, b, c, ...]);              // a ∩ b ∩ c ∩ ...
```

All operations chain. Fillets/chamfers can stack:

```js
return BREP.box([20, 20, 10]).fillet(2).chamfer(0.5);
```

### Immutability (important — different from raw replicad)

Partwright's BREP wrapper is **value-style**: ops return a new shape and the
input stays usable. You can reuse a shape across multiple ops:

```js
const base = BREP.box([10, 10, 10]);
const rounded = base.fillet(2);     // base is still alive
const beveled = base.chamfer(0.5);  // base is still alive
return BREP.fuseAll([rounded, beveled.translate([20, 0, 0])]);
```

This means the standard reduce pattern works (though `BREP.fuseAll` reads
clearer):

```js
const cylinders = [/* ...20 shapes... */];
return cylinders.reduce((acc, s) => acc.fuse(s));   // ✓ safe — no consumption
```

### Selective edge filleting — the headline BREP feature

`.fillet(r)` / `.chamfer(d)` accept an optional **`EdgeFilter`** as the second
arg. Without it, every edge is rounded. With it, only the edges that match
every named field are picked — that's the BREP advantage mesh kernels
genuinely can't match.

```js
// Round only the top rim of a cylinder (Z near the top).
const h = 20;
return BREP.cylinder(5, h).fillet(0.8, { minZ: h - 0.001 });

// Round only the edges near a single corner.
return BREP.box([20, 20, 10]).fillet(2, { nearPoint: [10, 10, 5], withinDist: 1 });

// Round all four vertical edges of a box, leave the top/bottom sharp.
return BREP.box([10, 10, 20]).fillet(1, { inDirection: [0, 0, 1] });

// Round only edges in the top-half of the bounding box, along the XY plane.
return BREP.box([20, 20, 20]).fillet(1, { minZ: 10, parallelToPlane: 'XY' });
```

**Filter keys** (all optional; AND-combined when multiple are passed):

| Key | What it picks |
|---|---|
| `minZ`, `maxZ`, `minX`, `maxX`, `minY`, `maxY` | Edges fully within the given axis range |
| `nearPoint: [x,y,z]` + `withinDist: r` | Edges within `r` of the world-space point |
| `parallelToPlane: 'XY' \| 'XZ' \| 'YZ'` | Edges parallel to a standard plane (catches "horizontal" / "vertical" rings) |
| `inDirection: [dx,dy,dz]` | Edges whose direction matches this axis (e.g. `[0,0,1]` for vertical edges) |

### Apply fillet BEFORE boolean cuts, when you can

OCCT's fillet solver is sensitive to edge-graph complexity *after* boolean
ops — it'll silently fail on a configuration that would have worked fine if
filleted first. When you have a choice, fillet the primitive first, then
cut:

```js
// ✓ Good: fillet the base, then cut the bore.
const body = BREP.cylinder(10, 20).fillet(1, { maxZ: 0.001 });  // base rim
return body.cut(BREP.cylinder(4, 21).translate([0, 0, -0.5]));

// ✗ Risky: cut first, then fillet — OCCT's solver may fail on the
// post-cut edge graph with an opaque "fillet failed" error.
const body2 = BREP.cylinder(10, 20).cut(BREP.cylinder(4, 21).translate([0, 0, -0.5]));
return body2.fillet(1, { maxZ: 0.001 });   // might throw
```

If a fillet fails, the error message names this rule and suggests a smaller
radius — read it before retrying blindly.

## Workflow 1 — BREP inside a manifold-js session

Use when most of the part is mesh-native but **one** feature needs an exact
fillet/chamfer. The BREP shape is tessellated to a mesh at the boundary and
the rest of your code stays in the Manifold world:

```js
const { Manifold, BREP } = api;
const filletedBracket = BREP.box([40, 20, 8]).fillet(2);
const bracket = BREP.toManifold(filletedBracket, Manifold);
const hole = Manifold.cylinder(20, 3, 3).translate([0, 0, -5]);
return bracket.subtract(hole);
```

`BREP.toManifold(shape, Manifold)` is the *one-way door*: after this, you have
a Manifold and the BREP source is forgotten. STEP export won't work on the
combined model from this path.

## Workflow 2 — BREP language session (STEP export)

Use when the user wants to send the part to a contract manufacturer or a
traditional CAD tool, or when the whole model is mechanical / fillet-heavy.
Switch the language first with `setActiveLanguage("replicad")`, then return a
BREP shape directly:

```js
const { BREP } = api;
const body = BREP.box([60, 40, 20]).fillet(3);
const cavity = BREP.box([50, 30, 16]).translate([0, 0, 2]);
return body.cut(cavity);
```

After `runAndSave`, call `partwright.exportSTEP()` (or use the export menu) to
write the exact BREP geometry to a `.step` file:

```js
const result = await partwright.exportSTEP();
// { ok: true, filename: "session_v3.step", sizeBytes: 12345 }
```

Painting, render, geometry stats, GLB/STL/3MF export all still work in
BREP sessions because the renderer sees the tessellation. The *extra* thing
you get is STEP.

## Choosing between workflows

- Default to **Workflow 1** (manifold-js + `api.BREP`). It composes with
  every other Partwright feature and doesn't lock you into BREP-only.
- Switch to **Workflow 2** (`setActiveLanguage("replicad")`) when the user
  asks for STEP export, or when the part is dominated by fillet/chamfer
  operations and there's no `warp`/`levelSet`/`Curves` work needed.
- Don't switch back and forth speculatively — each switch resets the
  editor contents to a stub.

## Common errors

- **"BREP code must `return` a BREP shape"** — In a replicad-language
  session, the final value must come from `api.BREP.*`, not from
  `Manifold.*`. If you want to return a Manifold, switch to manifold-js.
- **"BREP tessellation failed"** — OCCT could not tessellate the BREP at
  the default tolerance. Usually a degenerate shape (zero-radius fillet,
  fillet bigger than the smaller edge). Reduce the fillet/chamfer radius.
- **`BREP.fillet(0)`** — radius must be positive. To skip filleting just
  don't call `.fillet`.

## Memory & resource notes

- BREP shapes are OCCT objects on the WASM heap. Inside a manifold-js
  session you don't need to dispose them — the engine cleans up
  intermediates after the run. In a BREP-language session the engine
  keeps the *returned* shape around (for STEP export) until the next
  run replaces it.
- The OpenCASCADE.js WASM bundle is large (~10 MB) and is lazy-loaded
  the first time any session touches `BREP` or switches to the replicad
  language. Subsequent uses are instant — the loader caches.
