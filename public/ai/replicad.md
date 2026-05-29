# BREP / replicad — exact-surface modeling

## Gotchas cheat sheet — read first

These are the issues every agent has tripped on at least once. Internalise
them before writing BREP code or you'll burn iterations on silent failures.

1. **`BREP.box([w,d,h])` is centred in X and Y but its base is at z=0**
   (NOT centred in Z). A `BREP.box([10,10,10])` spans `x,y ∈ [-5,+5]` but
   `z ∈ [0,10]`. To centre it in Z, follow with `.translate([0,0,-h/2])`.
   `BREP.cylinder(r,h)` is the same (base at z=0). `BREP.sphere(r)` IS
   centred at the origin.

2. **EdgeFilters work in WORLD coordinates** — replicad bakes
   `translate`/`rotate` into the geometry, so after
   `BREP.cylinder(5, 8).translate([0, 0, 10])` the cylinder's top rim is
   at `z=18` in world space; pick it with `{ minZ: 17.999 }`.

3. **`inBox`-style filters (`minZ`/`maxZ`/`minX`/...) are unreliable on
   the planar coincident edges of a `BREP.box`.** OCCT's containment
   test leaves edges sitting exactly on the box's face plane "just
   outside tolerance," so `BREP.box([20,20,10]).fillet(1, {maxZ: 0.001})`
   silently selects 0 edges (and now throws a clear "matched 0 of N"
   error pointing here). **Workaround**: combine the bounds with
   `inDirection` or `parallelToPlane` so you also require the edge
   orientation match. `fillet(1, { maxZ: 0.001, inDirection: [1,0,0] })`
   picks the X-parallel bottom edges; `parallelToPlane: 'XY'` picks the
   four bottom-rim edges of a box. Cylinder rims work without this
   workaround because cylinder rim edges are *curved* (not coincident
   with the bbox face).

4. **`BREP.listEdges(shape, filter?)` is your fillet-debugger.** Call it
   before any tricky `.fillet(r, filter)` to see exactly which edges
   your filter is picking. Returns `[{index, midpoint, direction, bbox,
   chord, isClosed}]` — eyeball it, then write a filter that matches by
   inspection.

5. **Apply `.fillet()` / `.chamfer()` BEFORE `.cut()` / `.fuse()` when
   you can.** OCCT's solver is sensitive to the post-boolean edge graph
   and silently fails on configurations that would have worked filleted
   first.

6. **Fillet/chamfer radii can have a precision cliff.** If `0.5` works
   but `0.6` fails with an unhelpful "fillet failed" error, the failure
   is usually local geometry (a small adjacent edge or a sliver face),
   not the absolute radius. Try a slightly different value, or fillet a
   different set of edges first to change the local graph.

7. **`fillet` / `chamfer` drop labels on remeshed faces.** A
   `BREP.label(shape, 'top')` survives `.translate`, `.fuse`, `.cut` —
   but the faces the fillet solver remeshes lose their label and the
   new rounded surfaces have none. Label *after* the fillet if you need
   to paint the rounded surface.

8. **`paintInBox` on fused BREP solids can leak.** OCCT can leave
   interior seam triangles inside the bounding volume; the default
   centroid coverage test catches them. Pass `coverageMode:"fully_inside"`
   or use `paintConnected` from a probed seed.

9. **Labels propagate through `circularPattern` and individual
   `fuse`/`cut` ops, but get SCRAMBLED by `BREP.fuseAll` on
   many-feature composites.** Three subagents independently hit this:
   `paintByLabel({label:'dial'})` returned 804 triangles at the back
   plate's lower-left quadrant instead of the dial; `'spindle'`
   painted at the wrong z range; `'lip'` covered most of the model.
   The root cause is in the spatial-signature resolver
   (`buildLabelMapFromShape` in `brepRuntime.ts`) — bbox-containment +
   smallest-volume tiebreak collides when many labeled features stack
   inside one larger feature's bbox.

   **Workaround**: for multi-feature BREP composites, default to
   coordinate-based selectors:
   - `partwright.paintInCylinder({center, rMin, rMax, zMin, zMax, color})`
     for rings / shells / coffee inside a mug / hour-marker rings.
   - `partwright.paintSlab({normal:[0,0,1], offset, thickness, color})`
     for z-bands (lighthouse stripes, dial face, back plate).
   - `partwright.paintInBox({box:{min,max}, color})` for axis-aligned
     features (logo patches, viewfinder windows).
   - `partwright.paintNear({point, radius, color, normalCone?})` for
     small focused features (eyes, dots).

   **Debug first**: before any `paintByLabel` on a BREP composite, call
   `partwright.listLabels()` — it returns `{name, triangleCount, bbox,
   centroid}` per label. If a label's `bbox` doesn't match the feature
   you labelled, the scramble happened — switch to coord selectors.

10. **`fuse` / `fuseAll` only weld shapes that volumetrically OVERLAP — and
    Partwright models must end up as ONE solid to 3D-print.** This is the
    single most common BREP defect. OCCT's boolean union leaves shapes that
    merely *touch* (a coincident face, a point/edge kiss, or a razor-thin
    sliver of overlap) as a **disconnected compound** — it tessellates and
    *looks* like one model, but it's N separate solids. On a 3D printer those
    extra pieces float free and detach (or try to print in mid-air). Decorative
    bits are the usual culprits: a coffee disc 0.5 mm narrower than the mug
    bore, a lantern sitting on a 2 mm gap above the balcony, eyes resting
    exactly on a sphere's surface.

    **Rules that keep it one solid:**
    - Make every fused piece bite **≥ 0.5 units (ideally 1–2 mm)** *into* its
      neighbour — overlap a real volume, not a face. A thin annular overlap
      (e.g. a disc whose rim grazes a wall) often still fails to bond; give it
      depth (seat it from the floor up, or sink it well inside).
    - **Always verify `componentCount === 1`** after `runAndSave`. The result's
      `warnings` will call out a multi-component model; don't save over it.
    - When `componentCount > 1`, call **`runAndExplain(code)`** — it decomposes
      the result and names each floater with a concrete overlap suggestion
      (which face it sits on, how far to translate it). Fix, re-run, repeat
      until it's 1.
    - If a feature genuinely can't reach the body (a finial above a gap, a
      pendant bulb on a thin arm), bridge it with an explicit connector
      (a small `cylinder`/`box` that overlaps both), or merge it into the
      neighbour's primitive — don't leave it floating.

    A truly separate assembly (e.g. a lid you intend to print apart) is the
    rare exception; if that's the goal, model each piece as its own **part**
    (`createPart`) rather than as floaters in one mesh.

## The two ways to reach BREP

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
BREP.box([w, d, h]);    // centred in X and Y, BASE at z=0 (NOT centered in Z)
BREP.cylinder(r, h);    // axis on Z, base at z=0, height along +Z
BREP.sphere(r);         // centred at origin

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

// Higher-order primitives (built on the basics above).
BREP.cone(rBottom, rTop, h);                    // truncated cone (frustum)
                                                //   base radius rBottom at z=0,
                                                //   top radius rTop at z=h.
                                                //   set rTop=0 for a full cone.
BREP.torus(majorR, minorR);                     // donut, axis along Z
BREP.revolve([[x0,z0],[x1,z1],...]);            // solid of revolution around Z.
                                                //   profile is an [x,z] polygon
                                                //   in the half-plane x≥0
                                                //   (x is the radial axis).
                                                //   Polygon closes automatically.

// Patterns — N copies fused into one solid. Single tool call instead of
// N hand-coded translate+rotate copies.
BREP.circularPattern(shape, count, { radius, axis?, angle? });   // N around a circle
BREP.linearPattern(shape, count, { step, axis? });               // N along a line

// Hollow shells.
BREP.shell(shape, thickness, { topZ: true });   // hollow the shape, leaving
                                                // walls of `thickness`, open
                                                // on the top face (other
                                                // openFaceFilter options:
                                                // {bottomZ:true}, {minZ}/{maxZ},
                                                // {normalAxis:[ax,ay,az]}).

// Debug: snapshot all edges (optionally filtered) — call this BEFORE a
// fillet/chamfer to see which edges your filter is hitting. Saves the
// trial-and-error against silent "0 matched" failures.
const list = BREP.listEdges(shape, filter?);
// → [{index, midpoint:[x,y,z], direction:[dx,dy,dz], bbox:[6 nums], chord, isClosed}]

// Labelling — the BREP equivalent of `api.label`. Attaches a name to every
// face of a shape; the label survives boolean ops via OCCT's History, and
// translate/rotate via positional face matching. Fillet/chamfer preserve
// labels on unchanged faces but drop them on new rounded surfaces.
BREP.label(shape, 'name');                      // wrap a shape with a label
```

### Worked examples for the new primitives

```js
// Cone — apex up, base 10 mm radius, 15 mm tall.
return BREP.cone(10, 0, 15);

// Truncated cone (frustum) — pulley hub silhouette.
return BREP.cone(10, 7, 8).fuse(BREP.cylinder(7, 12).translate([0, 0, 8]));

// Donut — wheel rim or O-ring.
return BREP.torus(20, 3);

// V-groove pulley in 4 lines, where it used to take 25:
//   profile is the cross-section in the XZ half-plane,
//   X is the radial axis from the Z spin axis.
return BREP.revolve([
  [0, 0],   [20, 0],   [20, 5],   [15, 10],
  [20, 15], [20, 20],  [0, 20],
]);

// 6-bolt circle (no hand-coded angles).
const hole = BREP.cylinder(2.5, 12).translate([0, 0, -1]);
const bolts = BREP.circularPattern(hole, 6, { radius: 32, rotateCopies: false });
return BREP.cutAll([flangeBody, bolts]);

// 4-slot vent row.
const slot = BREP.box([1.5, 4, 12]);
const vents = BREP.linearPattern(slot, 4, { step: 5, axis: [1, 0, 0] });
return body.cut(vents);

// Project enclosure — outer shell minus inner cavity in one shell op.
const outer = BREP.box([80, 50, 30]).fillet(3, { inDirection: [0, 0, 1] });
return BREP.shell(outer, -3, { topZ: true });   // 3 mm walls, open top
```

### Labelled construction — paintByLabel inside a BREP session

`BREP.label(shape, name)` attaches a name to every face of a shape so
`paintByLabel({label})` finds those triangles after the model runs. The
label propagates through every subsequent op:

```js
// Phase A — full BREP language session. Labels propagate through the fuse,
// and `paintByLabel({label: 'dome'})` (called between runAndSave and the
// reply) finds every dome triangle, including the parts that survived the
// boolean.
const { BREP } = api;
const base   = BREP.label(BREP.cylinder(30, 5),                 'base');
const collar = BREP.label(BREP.cylinder(25, 8).translate([0, 0, 5]),  'collar');
const dome   = BREP.label(BREP.sphere(20).translate([0, 0, 13]),      'dome');
return BREP.fuseAll([base, collar, dome]);
```

```js
// Phase C — manifold-js session reaching into BREP for one feature. The
// label flows through `BREP.toManifold(...)` into the manifold-js engine's
// label map, so `paintByLabel({label: 'flange'})` still works.
const { Manifold, BREP } = api;
const flange = BREP.label(BREP.box([40, 20, 8]).fillet(2), 'flange');
const flangeM = BREP.toManifold(flange, Manifold);
return flangeM.subtract(Manifold.cylinder(20, 3, 3).translate([0, 0, -5]));
```

Same `paintByLabel` / `paintByLabels` calls afterward — no separate `BREP`
codepath. Limitations:

- **Fillet / chamfer best-effort:** faces the solver actually remeshes lose
  their label; the new rounded surfaces have none. Faces that pass through
  unchanged keep theirs.
- **Manifold ops on a Manifold returned from `BREP.toManifold`:** if you then
  call `.subtract()` etc. on that Manifold, the triangle ids get remapped
  and the BREP-side labels are dropped. For a labelled feature you want to
  combine with Manifold, label it *after* the boolean (via `api.label` on
  the result), or do the combine in BREP first and convert once at the end.

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

> **Edge filters always operate in world coordinates** — after every
> `translate` / `rotate` on the shape (Partwright bakes the transform into
> the geometry). So a cylinder of height 8 translated to `z=5` has its top
> rim at world `z=13`, and `.fillet(0.5, { minZ: 12.999 })` is the way to
> hit it. Don't reason in the cylinder's local frame.

### Painting a BREP solid — what works, what bleeds

Once a BREP shape is tessellated for the viewport, **every Partwright paint
tool works the same way it does on a mesh-native model**. The picks below
are tuned for what BREP geometry tends to look like:

| Situation | Reach for | Why |
|---|---|---|
| The feature was wrapped with `BREP.label(shape, 'name')` and the label *survived* (no fillet/chamfer remeshed that face) | `paintByLabel` / `paintByLabels` | The bullseye — no coordinate math, propagates through booleans. |
| A `fuseAll` solid where labels were dropped or never applied; you can render the model | `renderViews` → `probePixel` → `paintConnected` | The flood is gated by deviation from the seed normal, so it follows a curved face without bleeding across the next one. Best general-purpose painter on labeled-less BREP. |
| A cylindrical/conical region (inner bore wall, rim band) | `paintInCylinder` | Cleanly carves out a shell — works regardless of where OCCT placed the seam edges. |
| A pure axis-aligned slab (top 2 mm, side band) | `paintSlab` | Doesn't care about interior seam triangles. |
| An axis-aligned box selection on a **fused BREP solid** | Use `paintInBox` with `coverageMode: "fully_inside"` (or fall back to `paintConnected`) | See warning ↓ |

> **Warning — `paintInBox` on fused BREP solids.** OCCT's boolean fuse can
> leave interior intersection-seam triangles inside the resulting solid's
> bounding volume. The default `centroid` coverage test treats those
> seam triangles as "inside the box" and you get patchy paint on a
> surface that *looks* solid. Mesh-kernel models don't do this because
> their booleans drop interior surfaces. The fix on BREP: pass
> `coverageMode: "fully_inside"`, or use `paintConnected` from a probed
> surface seed instead.

> **`paintByLabel` after a fillet.** Fillet / chamfer remesh the faces
> they touch; those faces lose their labels (untouched faces keep theirs).
> If `paintByLabel` reports zero triangles on a label you know existed
> before the fillet, switch to `paintConnected` from a probed seed on
> the same feature — or label the result *after* the fillet by exposing
> the post-fillet sub-shape and wrapping it.

### STEP file import

Drag a `.step` / `.stp` file into the editor (or use Import → Choose file). A
chooser asks whether to land it as **BREP (recommended)** or as a
**manifold-js mesh**.

- **BREP** lands the file as a `BrepShape` exposed at `api.imports[0]` inside
  a fresh replicad-language session. Use it the same as any other shape —
  fillet/chamfer/cut/fuse all work. The default starter is `return api.imports[0];` so you can iterate immediately.
- **manifold-js** tessellates the STEP through OCCT and lands the mesh in
  the regular `api.imports[0]` slot of a manifold-js session, the same way
  STL imports work. Paint and mesh booleans apply. STEP-roundtrip is lost
  at tessellation time.

If you're given a STEP file as a reference and the user wants to refillet /
re-machine / re-export it, pick BREP. Pick manifold-js only when the
downstream work is mesh-specific (painting, vertex warps, etc.).

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
// ✓ Right place to call it — between tool calls, NOT inside model code.
const result = await partwright.exportSTEP();
// { ok: true, filename: "session_v3.step", sizeBytes: 12345 }
```

> **`exportSTEP` is a tool call, not a sandbox API.** Like every other
> `partwright.*` method, it runs between code runs. Calling it from
> inside `runCode` / `runAndSave` (i.e. in the same string of code that
> defines the shape) is rejected with the standard "model code cannot
> call paint/export tools" error. Run the model first, *then* export.

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
