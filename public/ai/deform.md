# Deform, scatter, round, shell, weld & sculpt — mesh-shaping verbs

Blender-style shaping ops for **manifold-js** sessions. All of them are plain
sandbox calls that return a fresh Manifold — chain them like any other helper.
They are also available under `api.meshOps.*`; the flat `api.*` aliases below
are the canonical spelling. (Mesh-only: not available in SCAD/BREP/voxel
sessions.)

## Quick picker

| You want | Reach for |
|---|---|
| Text/relief wrapped around a mug or vase | `api.wrapAround(flatShape, { radius })` |
| A bar/strip curved into an arc | `api.bend(shape, { angle })` |
| A twisted column / drill-bit look | `api.twist(shape, { degrees })` |
| Pyramid/taper toward one end | `api.taper(shape, { scaleTop })` |
| Barrel / vase bulge (non-linear profile along the axis) | `Curves.loft` over profiles (see /ai/curves.md) — taper is linear-only |
| A strip following a 3D path | `api.alongCurve(shape, points)` |
| Spikes / studs / rivets / scales all over a surface | `api.scatter(target, instance, { count })` |
| "Round every sharp edge" on any solid | `api.round(m, { radius })` |
| Round only SOME edges (the top, one part) and keep the rest exact | `api.round(m, { radius, select })` |
| Hollow any solid to a uniform wall (mask, helmet, lamp shade, print-in-resin shell) | `api.shell(m, { thickness })` |
| Grow / shrink a solid uniformly (clearance, fit allowance, thicken a thin sculpt) | `api.offset(m, { distance })` |
| Blend two plain meshes with a smooth seam | `api.smoothWeld(a, b, { radius })` (`select` to blend one joint only) |
| Nudge a surface: bump, dent, pull, flat spot | `api.sculpt.grab/inflate/flatten(...)` |
| Move / scale / rotate ONE part in place ("bigger head", "raise the arm") | `api.editPart(m, 'head', { scale: 1.3 })` (rigid, cut at the seam) or `api.sculpt.transform(m, { select, scale \| rotate \| translate, blend })` (soft warp) |
| Swap / delete / rebuild one part | `api.editPart(m, 'hat', (part, info) => newHat)` — return `null` to delete |
| Check an edit touched only what it should | `partwright.diffVersions(a, b, { geometry: true, render: true })`; the chat tool: `diffVersions { a, b, geometry: true, heatmap: true }` |
| Confine any of the above to one part / region / facing | `select: { label } \| { region } \| { where }` — see below |

**When you're already in `api.sdf` land, stay there** — its `.twist/.bend/.shell/.round/.smoothUnion`
are exact and cheaper. These verbs exist for geometry that *isn't* an SDF
expression: boolean results, imports, text, helper output.

## Selecting part of a shape — `select` + `blend`

`api.sculpt.*`, `api.bend` / `api.twist` / `api.taper` and `api.scatter` can act
on **part** of a shape instead of all of it. Name the part, not coordinates: a
selector is plain data, so it lives in the code and keeps working when edits
move the triangles around.

```js
{ label: 'arm' }                               // an api.label part — or a detected part of an import (api.importWithParts)
{ label: ['hair', 'brows'] }                   // any of several parts
{ region: { center: [0, 0, 40], radius: 8 } }  // a ball
{ where: { facing: 'up', tolerance: 20 } }     // faces pointing a way: 'up' | 'down' | '+x' | '-x' | '+y' | '-y' | [x, y, z]; tolerance in degrees, default 30
{ where: { min: [null, null, 30] } }           // faces above z = 30 (null = unbounded); also max, or box: { min, max }
{ label: 'body', where: { facing: '+y' } }     // several keys AND together
[{ label: 'hand' }, { label: 'arm' }]          // an array ORs its entries
{ label: 'body', except: { label: 'base' } }   // subtract another selector
{ except: { label: 'base' } }                  // everything except the base
```

A face is selected when its label, centroid and normal match. `blend: d` fades
the edit over `d` units outside the selection, so it eases into the
surroundings instead of creasing at the seam. A selector that matches nothing,
or names an unknown part, **throws** with the list of parts. It never silently
does nothing.

```js
// Soft-selection transform (Blender's proportional editing): move / scale /
// rotate just the selection, about the centre of its bounding box unless you pass pivot.
m = api.sculpt.transform(m, { select: { label: 'head' }, scale: 1.4, blend: 3 });
m = api.sculpt.transform(m, { select: { label: 'arm' }, rotate: [0, -25, 0], pivot: [10, 0, 22] });
m = api.sculpt.transform(m, { select: { where: { min: [null, null, 40] } }, translate: [0, 0, 5], blend: 4 }); // stretch the top

m = api.twist(m, { select: { label: 'arm' }, degrees: 90, axis: 'x' });   // over the arm's own extent and axis
m = api.bend(m, { select: { label: 'arm' }, angle: 60 });                  // the arm's min-X end (its root) stays put; anchor: 'max' | 'center'
m = api.taper(m, { select: { label: 'leg' }, scaleTop: 0.6, blend: 2 });
m = api.sculpt.inflate(m, { at: [0, -9, 36], radius: 6, amount: 2, select: { label: 'head' } }); // can't bleed onto the neck
const studs = api.scatter(m, stud, { count: 40, where: { label: 'shell', where: { facing: 'up' } } });
```

Facts to respect:
- **The selection deforms over its own bounds.** `twist` / `taper` / `bend` measure the selection's extent (and refine to its size), and twist turns about the centre line of the selection's bounding box, so one arm twists about itself and not the world origin. A scoped `bend` keeps the selection's min-X end fixed (`anchor: 'min'`, the default), so a limb stays on its socket. Pass `anchor: 'max'` or `'center'` to change that.
- **A hard edge (no `blend`) moves whole triangles at the seam.** Triangles straddling the boundary stretch. Big scales or rotations of a part fused into the body read better with a `blend` of a few units.
- **The fade weights the motion, not the position.** In the blend zone `sculpt.transform` and `twist` turn by a fraction of the angle (and scale or move by a fraction), so the surface follows the arc instead of pinching inward. `bend` and `taper` fade by position.
- **Only `sculpt.transform` refines for `blend`.** It refines to about `blend / 3` edges so the fade has vertices, over the whole shape, and errors before building a mesh over the ~3M-triangle budget. Keep `blend` reasonable on huge imports, or pass `segmentLength`. The brushes and deforms refine by their own radius or span as before.
- **Labels carry through.** The ops warp vertices without remeshing, so every `api.label` part keeps its faces, and `paintByLabel` / `withinPart` still work afterwards. `round` / `smoothWeld` remesh, so they need `keepLabels: true` for the same result (below) — except when scoped with `select`, which keeps labels by default.
- **`round`, `smoothWeld` and `editPart` take the same selectors** (below) — and so do surface textures (`api.surface.<id>({ select })`, see /ai/textures.md).
- **Imports:** after `acceptParts`, an imported mesh's detected parts are labels (`api.importWithParts(0)`), so `select: { label: 'hair' }` works on STL figurines too. That's the way to "make the head bigger" on an upload.

## Deforms (warp-based)

All deforms auto-refine the mesh first (`refineToLength`) so coarse boxes
actually curve — pass `segmentLength` to control the density or `refine: false`
to skip. A post-refine budget of ~3M triangles throws with an actionable error.

```js
// Wrap: author FLAT — content along X, thickness along Y (+Y = outward),
// height along Z. x=0 lands at the front of the cylinder (−Y side).
api.wrapAround(shape, {
  radius: 15,          // cylinder radius the y=0 plane wraps onto (arc length preserved)
  axis: 'z',           // cylinder axis: 'z' (default) | 'x' | 'y'
  angleOffset: 0,      // degrees around the cylinder
});
// Errors if the X span exceeds a full turn (2πr) or the shape reaches the axis.

// Text on a mug (the classic):
let label = api.text("HELLO", { size: 10, height: 2 });   // extrudes along +Z
const bb = api.bbox(label);
label = label.rotate([90, 0, 0])                          // stand up: height→Z, depth→−Y
             .translate([-bb.size[0] / 2, 1.0, 12]);      // center x, push outward, up the mug
return mugBody.add(api.wrapAround(label, { radius: 15.5 })); // embossed band

api.bend(shape, { angle: 90 });        // X extent → arc in the XY plane (+angle bends toward +Y; Z untouched)
api.twist(shape, { degrees: 180, axis: 'z' });   // rotation grows linearly along the axis, about the world origin
api.taper(shape, { scaleTop: 0.3, scaleBottom: 1, axis: 'z', center: [0, 0] }); // scaleTop can be [sx, sy]
api.alongCurve(strip, [[0,0,0], [20,10,0], [40,0,8]], { up: [0,0,1] });
// alongCurve maps the shape's X extent onto the polyline arclength with a
// parallel-transported frame (Y offset rides `up`); corners stay as sharp as
// the polyline — subdivide the curve for smooth sweeps.
```

## Scatter — instances on a surface

```js
const spikes = api.scatter(base, spike, {
  count: 120,          // required, 1..5000 (may place fewer under constraints)
  seed: 1,             // deterministic placement — same seed, same model
  alignToNormal: true, // instance +Z points along the surface normal
  spin: true,          // random rotation about the normal
  scale: [0.8, 1.2],   // uniform per-instance scale (number or [min, max] range)
  offset: -0.5,        // along the normal; NEGATIVE sinks the base in so the union fuses
  minSpacing: 4,       // Poisson-ish minimum distance between anchors
  where: (p, n) => n[2] > 0.2,  // optional: a predicate (position + unit normal)…
  // where: { label: 'shell', where: { facing: 'up' } },  // …or a selector object (see "Selecting part of a shape")
});
return api.expectUnion([base, spikes], { expectComponents: 1 });
```

Returns the **union of the instances only** (like `circularPattern`) — add it to
the base yourself. Author the instance with its base at the origin, "up" = +Z.
A total-triangle budget (~2M) throws before building a runaway union.

## Round — fillet every edge of any solid (or just some)

```js
return api.round(booleanResult, {
  radius: 2,             // fillet radius, convex edges AND concave creases
  mode: 'both',          // 'both' | 'convex' | 'concave'
  resolution: 192,       // lattice cap (32..320); higher = finer, slower
});
```

The mesh analogue of BOSL2 `rounding=` / Blender Bevel, built as morphological
opening+closing of a signed-distance lattice, remeshed via `levelSet`. Facts to
respect: features thinner than `2·radius` are smoothed **away** — and in
practice a flat face starts visibly bulging into a pill well before that limit,
so on a shape with one thin dimension keep the radius under ~1/4 of the
thinnest extent (a 5-unit-thick shell wants radius ≲ 1.2, not 1.8); the output
is a remeshed surface, so the input's `api.label` parts are dropped **unless you
pass `keepLabels: true`** (below); accuracy is ~the lattice voxel, and a radius
too small for the model errors with the fix in the message. For exact
edge-picked fillets use BREP; for SDF trees use `.round()`.

**`keepLabels: true` keeps the parts.** Each remeshed triangle takes the part of
the input surface nearest to it, so `byLabel` / part colours, `paintByLabel`,
`withinPart` and selectors still work on the result. This is how to fillet a
labelled model, or a detected import (`api.importWithParts`), without losing its
parts. It adds a nearest-surface pass over the output, roughly half the remesh's
own time on a large model, so it's off by default. An input with no labels is
returned exactly as it would be without the option:

```js
m = api.round(api.importWithParts(0), { radius: 1.2, keepLabels: true });
```

Part boundaries land at triangle resolution: in a fillet that blends two parts,
the edge falls where the two input surfaces meet. It's off by default, so
existing models render exactly as before.

**`select` rounds only some edges and leaves the rest EXACT.** An edge is
rounded when it lies within `radius` of a selected face; the rounding fades out
over `blend` (default = radius). Everything the op doesn't change — other
edges, flat faces, the tessellation, labels — stays the input's own geometry:
only the rounded strip is remeshed and spliced in (the seam is about a tenth of
a voxel). Labels carry through by default here (`keepLabels: false` to drop
them in the strip).

```js
m = api.round(box, { radius: 3, select: { where: { facing: 'up' } } });   // round the top edges only
m = api.round(fig, { radius: 1, select: { label: 'head' } });            // soften the head and its neck crease
```

It works on a fine lattice over just the selected area, so a small selection
is fast (a few seconds) and a selection covering most of a big model is slower
than plain `round` — use plain `round` for "everything".

**Convex shapes have an exact alternative — use it.** The lattice's ~voxel
error reads as gentle waviness/pillowing on large flat mirror-shaded faces
(a die body showed it clearly). For a convex rounded box/prism, build the
EXACT shape instead: `Manifold.hull` of corner spheres (flat faces stay
perfectly flat, edge fillets are perfectly cylindrical — and far fewer
triangles). Reserve `api.round` for shapes with no exact construction:
boolean results, imports, organic/non-convex forms.

## Shell & offset — uniform walls and 3D offsets for any solid

```js
const hollow = api.shell(m, {
  thickness: 2,          // wall thickness, world units
  side: 'inside',        // 'inside' (default): hollow it, outer surface unchanged
                         // 'outside': a skin around it; inner surface = m's surface
  resolution: 192,       // lattice-size cap (32..320); only matters on big models / thin walls
});
const bigger = api.offset(m, { distance: 0.3 });   // grow by 0.3 (fit clearance, small part)
const thinner = api.offset(m, { distance: -1 });   // shrink by 1
```

`api.shell` is the tool for **"hollow this sculpt/import to a uniform wall"**:
masks, helmets, lamp shades, resin-print hollowing. It is exact where it
matters: **the input's own surface is kept as-is** (every sculpted detail, its
tessellation and its `api.label` parts); only the new wall surface is built,
from the exact distance to the input, so the wall is the requested thickness to
within a fraction of the lattice voxel. Areas thinner than `2·thickness` stay
solid (nothing to hollow there). The result is a **closed** hollow solid, so cut
the opening yourself with a boolean:

```js
// Wearable mask from a head sculpt whose face points toward −Y:
const head = Manifold.ofMesh(api.imports[0]);
const shellHead = api.shell(head, { thickness: 2.5 });
const bb = head.boundingBox();
const cutY = bb.min[1] + 0.45 * (bb.max[1] - bb.min[1]);   // keep the front 45%
const back = Manifold.cube([1e3, 1e3, 1e3], true).translate([0, cutY + 500, 0]);
return shellHead.subtract(back);                               // eye holes etc. next
```

`api.offset` grows (`distance > 0`) or shrinks (`< 0`) the whole solid along its
normals — a true 3D offset (Minkowski with a ball): grown convex edges come out
rounded, and features thinner than `2·|distance|` vanish when shrinking. The
output is a remeshed surface; pass `keepLabels: true` to carry `api.label` parts
across (same mechanism as `round`).

**Smallest distance / thickness.** The op runs on a lattice capped at
`resolution` cells along the model's longest side, and the distance (or
thickness) must span at least ~1.5 cells: **minimum ≈ 1.5 × model span ÷
resolution** — ~1.6 units on a 200-unit head at the default 192, ~0.9 at
`resolution: 320`. A 0.3 fit clearance therefore works on a part up to ~38
units across (~64 at 320); for a larger assembly, offset just the mating
feature and union it back. The error message states the limit. Below the cap,
`resolution` changes nothing (the lattice is already as fine as the distance
needs).

Cost: one lattice pass, roughly independent of the input's triangle count past
the nearest-surface queries — about **12 s for a ~1M-triangle head** at the
default resolution. For a big import, `partwright.simplifyModel(...)` it once
first so every later run is cheaper.

**Not the same as the other shells.** `api.sdf`'s `node.shell(t)` is CENTRED on
the surface (`|f| − t/2`: half the wall outside, half inside) — use it when the
model is already an SDF tree and that's what you want. `BREP.shell(shape, -t,
{ topZ: true })` (replicad sessions) is negative-inward and needs an open-face
filter. `api.shell`'s default puts the whole wall INSIDE the input surface.

## smoothWeld — smoothUnion for plain meshes

```js
return api.smoothWeld([body, head, arm], { radius: 4 });  // or (a, b, {radius})
```

`api.sdf`'s `smoothUnion`, but for arbitrary Manifolds. Parts should overlap or
touch; the seam grows a smooth fillet of ~`radius`. Same lattice mechanics and
caveats as `round` (remeshed output). Pass `keepLabels: true` to keep each
input's `api.label` parts on the welded surface (e.g. weld a labelled head onto
a body and still paint them separately).

`select` (+ `blend`) blends only the joint near the selected faces; elsewhere
the parts meet with a plain, exact union (same splice as scoped `round`, labels
kept by default):

```js
return api.smoothWeld([body, arm, leg], { radius: 3, select: { label: 'arm' } });  // fillet the shoulder only
```

## editPart — edit one part as a solid

```js
m = api.editPart(m, 'head', { scale: 1.3 });                         // bigger head, still on the neck
m = api.editPart(m, 'arm', { rotate: [0, -40, 0] }, { blend: 1.5 }); // raise the arm, fillet the shoulder
m = api.editPart(m, { label: 'hat' }, () => null);                    // delete the hat
m = api.editPart(m, 'hat', (part, info) => newHat.translate(info.seam)); // swap it
```

Cuts `m` into the part and the rest along the surface halfway between the
part's faces and all the others — a head comes off at the neck, an arm at the
shoulder — applies the edit, and unions the result back. The part is a name or
any selector (`{ label }`, `{ region }`, `{ where }`, …); it works on `api.label`
parts and on detected import parts (`api.importWithParts(i)`).

- **The edit** is `{ scale, rotate, translate, pivot }` (scale: number or
  `[x, y, z]`; rotate: Euler degrees; applied about `pivot`, which defaults to
  the seam's centre so a scaled head stays attached and a rotated arm turns at
  the shoulder) or a function `(part, info) => Manifold | null`. `info` =
  `{ center, min, max, seam, seamBox }` (`seam` is the cut's centre, null when
  the part was the whole model). Return `null` to delete the part.
- **`blend`** fillets the seam (a scoped `smoothWeld` around the cut). The
  default is a small fillet (1/32 of the part's cut box), which also closes the
  hairline gaps a lattice cut leaves where the edited part meets the rest; pass
  a bigger value for a visible fillet, or `blend: 0` for a plain union (a
  rotated part then shows a small ledge at a flat cut, a scaled one a lip).
- **Selecting the whole model** applies the edit to all of it (no cut).
- **Cost:** a few seconds to ~15 s per call (the cut, then the seam fillet);
  `resolution` (32..128) trades cut accuracy for time.
- **Rigid, exact faces.** Unlike `sculpt.transform` (a soft warp of the whole
  surface), every face keeps its exact geometry; only the cut is approximate
  (a lattice of `resolution` samples, default 64, along the part's box).
  Labels carry through, small separate pieces elsewhere in the model are left
  alone, a hollow part keeps its cavity, and any pocket the edit seals at a
  curved seam is filled.
- **Check the result** with `diffVersions(a, b, { geometry: true })` after a
  `runAndSave`: `changedParts` and per-part `changedFraction` show whether
  anything besides the part moved (a neighbour sharing the seam shows a small
  fraction, e.g. the strip of body the bigger head now covers).

## Sculpt — declarative brush nudges

One-line, code-serializable versions of Blender's grab / inflate / flatten
brushes, with a smooth falloff over `radius`. For *nudging* a mostly-done model
— a nose pulled out, a dent, a flattened stand — not freeform sculpting.

```js
m = api.sculpt.grab(m,    { at: [0, -15, 2], radius: 8, offset: [0, -5, 0] }); // drag surface by offset
m = api.sculpt.inflate(m, { at: [0, -12, 8], radius: 10, amount: 3 });         // bump out (negative = dent)
m = api.sculpt.flatten(m, { at: [0, 0, -15], radius: 12, normal: [0, 0, 1], strength: 1 }); // press flat
```

Find coordinates with `probeRay` / `getBoundingBox`, or from your rendered
views. Each op auto-refines the region (`segmentLength` ≈ radius/5 by default).

## Viewport material — `api.material(...)`

Declare how the model is **shaded** in the viewport (geometry, exports, and
printability untouched — it's presentation, and it re-applies on every run
because it lives in the code):

```js
api.material('brass');                       // presets: plastic, matte, satin, gold,
                                             // brass, copper, steel, chrome, glass,
                                             // rubber, ceramic, wood
api.material({ preset: 'glass', roughness: 0.02 });          // preset + overrides
api.material({ color: '#b87333', metalness: 1, roughness: 0.3 }); // fully custom
// Fields: preset?, color?, metalness?, roughness?, clearcoat?, transmission?, opacity? (all 0..1)
```

Painted models keep their paint colors — the preset's metal/rough/clearcoat
still applies ("painted + brass" = colored metal). Headless previews and baked
thumbnails don't show it; verify in the browser viewport.

## Animation exports (tool calls, not sandbox code)

```js
await partwright.exportTurntable({ seconds: 6, revolutions: 1 });     // camera orbit → .webm
await partwright.exportExplode({ seconds: 6, spread: 0.8 });          // components fly apart + reassemble
await partwright.exportParamSweep('height', 10, 40, { steps: 12 });   // Customizer param morph
```

Each records the live viewport in real time and downloads the video. Explode
needs a multi-component model; param sweep re-runs the model per step
(manifold-js only). The tab must stay visible while recording.
