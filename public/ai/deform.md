# Deform, scatter, round, weld & sculpt — mesh-shaping verbs

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
| Blend two plain meshes with a smooth seam | `api.smoothWeld(a, b, { radius })` |
| Nudge a surface: bump, dent, pull, flat spot | `api.sculpt.grab/inflate/flatten(...)` |

**When you're already in `api.sdf` land, stay there** — its `.twist/.bend/.shell/.round/.smoothUnion`
are exact and cheaper. These verbs exist for geometry that *isn't* an SDF
expression: boolean results, imports, text, helper output.

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
  where: (p, n) => n[2] > 0.2,  // optional predicate: position + unit normal
});
return api.expectUnion([base, spikes], { expectComponents: 1 });
```

Returns the **union of the instances only** (like `circularPattern`) — add it to
the base yourself. Author the instance with its base at the origin, "up" = +Z.
A total-triangle budget (~2M) throws before building a runaway union.

## Round — fillet every edge of any solid

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
is a remeshed surface (labels/paint regions on the input do NOT carry through —
round first, label/paint after); accuracy is ~the lattice voxel, and a radius
too small for the model errors with the fix in the message. For exact
edge-picked fillets use BREP; for SDF trees use `.round()`.

**Convex shapes have an exact alternative — use it.** The lattice's ~voxel
error reads as gentle waviness/pillowing on large flat mirror-shaded faces
(a die body showed it clearly). For a convex rounded box/prism, build the
EXACT shape instead: `Manifold.hull` of corner spheres (flat faces stay
perfectly flat, edge fillets are perfectly cylindrical — and far fewer
triangles). Reserve `api.round` for shapes with no exact construction:
boolean results, imports, organic/non-convex forms.

## smoothWeld — smoothUnion for plain meshes

```js
return api.smoothWeld([body, head, arm], { radius: 4 });  // or (a, b, {radius})
```

`api.sdf`'s `smoothUnion`, but for arbitrary Manifolds. Parts should overlap or
touch; the seam grows a smooth fillet of ~`radius`. Same lattice mechanics and
caveats as `round` (remeshed output, labels don't carry through).

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
