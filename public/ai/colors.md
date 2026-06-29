# Color regions

Color regions tag a coplanar set of triangles with an RGB color. Regions are persisted on the saved version, ride through GLB and 3MF exports, and show as swatch badges in the gallery. They do **not** modify the geometry -- the underlying mesh, volume, manifoldness, etc. are unchanged.

```js
// Paint the face that contains [10, 0, 5] with normal [0, 0, 1] (top face) bright red.
const r = partwright.paintRegion({
  point:  [10, 0, 5],
  normal: [0, 0, 1],
  color:  [1, 0, 0],         // RGB in 0..1
  name:   "Top",             // optional, defaults to "Region N"
  tolerance: 0.9995,         // optional cosine threshold for coplanarity (default 0.9995)
});
// r = { id, name, triangles } on success, or { error } if no matching face found

partwright.listRegions()    // [{ id, name, color, source, triangles, order, visible }, ...]
partwright.undoLastPaint()  // reverse just the most recent paint op
partwright.removeRegion(id) // delete one region by id (older mistake)
partwright.hideRegion(id)   // toggle a region off in the viewport without deleting it; exports still include it
partwright.showRegion(id)   // re-show a previously hidden region
partwright.clearColors()    // remove ALL regions — destructive, prefer the two above for single mistakes
```

**Per-region visibility vs. delete.** `setRegionVisibility(id, false)` (or `hideRegion(id)`) toggles a region off in the *viewport* — the painted triangles render unpainted while the region is hidden, but the region itself stays in `listRegions()` and the `visible` flag is persisted across save/load. This is the right tool for "I want to see what the model looks like without this region" or "compare paint vs. no-paint." GLB / 3MF exports always include hidden regions — visibility is a viewer-state flag, not an export filter. Use `removeRegion(id)` when you actually want to delete a region permanently.


**Preview before commit (default workflow).** `paintPreview()` accepts
the same selector args as `paintInBox` / `paintNear` / `paintFaces` but
doesn't commit. By default it returns `{triangleCount, bbox, centroid,
totalArea, largestTriangleArea}` — count and area summary are essentially
free and catch most bad selectors. Inspect the ratio
`largestTriangleArea / (totalArea / triangleCount)`: ratios above ~10
are a fan-topology red flag (see "fan-bleed" below). Pass
`withImage: true` when the count or ratio surprises you — the
yellow-highlighted thumbnail shows the real triangle extents, including
the bleed.

**Diagnose a bad paint.** `paintExplain({region: id})` returns
triangleCount, area, largestTriangleArea, bbox, centroid, a
normal-distribution histogram (`{xPos, xNeg, yPos, yNeg, zPos, zNeg,
oblique}` summing to ~1), and a thumbnail of the region tinted yellow.
Use after a paint that looks wrong — the histogram tells you in one
number whether the region wrapped onto a face you didn't intend
(e.g. `zPos: 0.4, xPos: 0.3` = caught the top AND a side), and
`largestTriangleArea` confirms whether fan-bleed is to blame.

**Avoiding fan-topology bleed.** `cylinder` / `revolve` / `linear_extrude`
generate triangulations where every face triangle has one vertex at
the central axis — long radial "fan wedges" that stretch from the
center out to the rim. After a boolean union, those long triangles
get inherited into the merged mesh. `paintNear` and `paintInBox`
default to a *centroid* containment test, so a fan wedge with its
centroid inside your selector gets painted even though most of its
area extends visibly outside. The result looks like a "paint smear"
beyond the intended region. Two fixes, in order of preference:

```js
// 1. Tighten the containment test — fully_inside requires all 3
//    vertices in the selection, which excludes fan wedges that
//    straddle the boundary:
partwright.paintNear({ point: [0, 5, 2], radius: 3, coverageMode: 'fully_inside', color: ... });

// 2. Or backstop with a max triangle area — set to ~3-5× the
//    typical triangle of the feature you intend to paint:
partwright.paintInBox({ box: { ... }, maxTriangleArea: 4, color: ... });

// 3. If you're authoring the code: refine the mesh before painting
//    so cylinder/revolve geometry has small local triangles instead
//    of radial fans. .refine(2) doubles the resolution; the shape
//    doesn't change.
const head = api.Manifold.cylinder(10, 20).refine(2);
```

Inspect `paintPreview`'s `largestTriangleArea` to choose a sensible
`maxTriangleArea`. Sphere / cube / hull primitives don't have fan
topology and don't need either workaround — the centroid default is
fine there.

**Catalog entries: prefer `byLabel` over coordinate paint.** `paintInBox` /
`paintNear` / `paintFaces` bake a `triangles` list of per-triangle IDs into the
saved file — on complex models this can run to 10–20 MB. `paintByLabels` stores
only the label name and re-resolves on load, keeping catalog files under ~300 KB.
For any model destined for the catalog, design the paint scheme with `label()` +
`paintByLabels` from the start; reach for coordinate selectors only for geometry
you didn't author (imported STL, `fuseAll` BREP), and check the file size after
export.

**Catalog thumbnail lighting.** The catalog 3/4 tile uses flat/ambient shading —
near-white, cream, or low-saturation colors collapse to gray under it. Push the
hue warmer and saturation noticeably higher than you'd pick on a white-background
swatch. Sanity-check a near-white region with a vivid test color first; if it
shows correctly, the region is wired right and the color just needs to be bolder.

**Verify from multiple angles.** Use `renderViews()` for verification
rather than a single `renderView` call. The default `views: 'auto'`
picks angles by the model's bounding box: flat disks get [Top, Iso]
(a front elevation of a disk is a thin sliver), tall columns get
[Front, Right, Iso] (the top of a column is a dot), everything else
gets [Front, Top, Iso]. Use `views: 'tri'` or `'all'` to force a
specific composite. A single angle can hide an asymmetric error —
e.g. a smile curve arching the wrong way.

**Test before commit.** For unfamiliar primitives (revolve axis,
hull edges, decompose order, any boolean chain), call `runIsolated(code)`
on a tiny snippet first — it returns stats + a thumbnail without
mutating the editor or the session. Saves a paint-undo-retry cycle
when the geometry surprises you.

**Engine choice for paint workflows.** SCAD's `revolve`,
`linear_extrude`, and `cylinder` produce radial-fan triangle topology
(every face triangle radiates from the central axis). That topology is
awkward to paint cleanly — `paintInBox` tends to bleed across the
adjacent fan wedges. If a task involves precise painting of curved
features, prefer `manifold-js` from the start. SCAD remains the right
choice for parametric extrusion-heavy parts where painting is secondary.

```js
const preview = partwright.paintPreview({ box: { min: [-5, -5, 8], max: [5, 5, 12] } });
// preview.triangleCount === 0  →  selector matched nothing, widen it
// preview.triangleCount > 5000 →  too greedy, tighten
// otherwise: partwright.paintInBox({box: same, color: [1,0,0]})
```

**Labelled construction (the cleanest paint primitive on
agent-authored manifold-js).** When you're writing the model code AND
plan to paint features after, wrap each feature in `api.label(shape, name)`
at construction time. Painting after is then a pure name lookup — no
coordinates, no bounding boxes, no fan-bleed. The triangle set comes
straight from manifold-3d's `runOriginalID` provenance and is exact
even when shapes overlap.

```js
// In your model code:
const head = api.label(api.Manifold.sphere(10), 'head');
const eyeL = api.label(api.Manifold.sphere(2).translate([-3, 5, 7]), 'eyeL');
const eyeR = api.label(api.Manifold.sphere(2).translate([ 3, 5, 7]), 'eyeR');
return head.add(eyeL).add(eyeR);

// After runAndSave, paint by name. For multiple features, BATCH —
// one tool call paints them all and coalesces the viewport refresh:
partwright.paintByLabels([
  { label: 'head', color: [0.4, 0.7, 0.4] },
  { label: 'eyeL', color: [0,   0,   0  ] },
  { label: 'eyeR', color: [0,   0,   0  ] },
]);
// -> { results: [...], failed: [] }
// Reach for paintByLabel({label, color}) only when painting a single
// feature. listLabels() returns what's available; check it if a paint
// call reports "no label X".
```

`api.labeledUnion([{name, shape}, ...])` is sugar that labels each
entry and unions them in one call. Labels are runtime-only state
(manifold-3d assigns fresh originalIDs every run); region descriptors
persist the name, and rehydration re-resolves by name on the next
load — so saved-version round-trips work as long as the code still
defines the same label names.

**Color in the code (self-coloring models).** Skip the paint step
entirely: pass a `color` to the label and it renders + exports colored
on the spot, with the editor still editable.

```js
const body = api.label(api.Manifold.cube([20, 20, 20], true), 'body', { color: '#3b82f6' });
const knob = api.label(api.Manifold.cylinder(6, 4, 4, 32).translate([0, 0, 13]), 'knob', { color: [1, 0, 0] });
return body.add(knob);            // blue body + red knob, no paintByLabel call
// api.labeledUnion([{ name, shape, color }, ...]) takes the same per-entry color.
```

`color` is a hex string (`'#rrggbb'` / `'#rgb'`) or an `[r,g,b]` array in
0..1. It re-resolves every run (keyed by the label name), so it survives
Customizer parameter changes — wire a `color` param in as
`{ color: p.accent }` for a live color knob, or give each instance of a
parametric count a distinct name (`'petal' + i`) for per-instance color.

These model-declared colors are a derived **underlay**: manual paint
(`paintByLabel` / the paint tools) composites on top as an optional
override. They are not written
into the saved paint sidecar — the code re-derives them on load. Read the
active set with `partwright.getModelColors()` →
`{ count, colors: [{ name, color, triangleCount }] }`; a zero
`triangleCount` means that label's triangles were consumed by a later
boolean (see `listLabels().lostLabels`). Prefer model-declared color when
the color is intrinsic to the design; reach for `paintByLabel` when a
human is tweaking colors interactively or overriding the code.

**BREP supports the same `{ color }` arg.** `BREP.label(shape, name,
{ color })` (both as `api.BREP.*` inside a manifold-js session and in a
full `replicad`-language session) takes the identical hex-or-`[r,g,b]`
color and feeds the same model-color underlay — so `getModelColors()`
and export pick it up exactly like the manifold-js path. The color is
keyed by name and rides through booleans, transforms, and (best-effort)
fillet/chamfer.

> **Coverage caveat for fused composites.** The *color* you attach is
> exact, but which triangles a label *resolves to* after `fuseAll` is
> best-effort — the spatial-signature resolver scrambles on many-feature
> composites (see gotcha #9 in `replicad.md`). A **single label over the
> whole shape resolves to ~100% coverage and colors cleanly**; for
> per-feature multi-color on a fused composite, reach for the coordinate
> paint selectors (`paintInCylinder` / `paintSlab` / `paintInBox` /
> `paintNear`) instead, exactly as that gotcha recommends.

### Geometric paint in code — `api.paint.*`

`api.label({ color })` colors a *named subtree*. To color a **region of the surface** from code — without labelling a separate solid — use `api.paint.*`, the in-code counterparts of the `paintInBox` / `paintSlab` / `paintInCylinder` / `paintByLabel` tools. Each call records a region during the run; Partwright resolves it against the fresh mesh afterward and folds it into the same model-color underlay (never the paint sidecar — the code re-derives it). Later calls win on overlap.

```js
const part = api.Manifold.cube([30, 30, 30], true).refine(16);
api.paint.slab({ axis: 'z', offset: 10, thickness: 10, color: '#e23b3b' });          // flat band; axis ('x'|'y'|'z') or normal [x,y,z]
api.paint.box({ min: [-15, -15, -15], max: [0, 0, 0], color: [0.23, 0.51, 0.96] });   // axis-aligned box
api.paint.cylinder({ center: [0, 0], rMin: 0, rMax: 6, zMin: -15, zMax: 15, color: '#22c55e' }); // (annular) vertical shell
api.paint.label('body', '#888');   // recolor an existing api.label(...) region by name
return part;
```

Like the tools, these resolve **by triangle**, so paint a refined mesh (`refine(n)` / higher segments) for crisp edges. `color` is the same hex/`[r,g,b]` form as `api.label`. Arguments are validated strictly (unknown keys, bad color/axis throw). Use `api.paint.*` when the colors are intrinsic to the design and you want them to live with the code; reach for the standalone `paintByLabel` / `paint*` tools for interactive, coordinate, or click-driven painting between runs. (manifold-js sandbox only.)

Because the code is the source of truth, these colors are **read-only at runtime**: `getModelColors()` lists them, but `getRegions()`/`listRegions()` stay empty, and `replaceColor` / palette operations / the paint panel's Clear button don't touch them — change a code-declared color by editing the `color` argument and re-running.

### Algorithmic colourways — `api.paint.pattern`

The colour twin of `api.surface.*` textures: instead of one flat region, a
**procedural field** assigns each triangle in a scope ONE palette colour. Every
triangle stays a single flat colour, so the result is multi-material printable
(each colour maps to a filament slot). Use it for animal coats / camo / any
repeating colour motif — it reads far better than hand-placed `paint.box` bands.

```js
api.paint.pattern({
  pattern: 'stripes',                 // 'stripes' | 'spots' | 'patches' | 'gradient'
  colors:  ['#D6913E', '#5A3A1F'],    // [base, mark, third?] — hex or [r,g,b]; ≥2
  scope:   'body',                    // an api.label region (so it never touches eyes/nose); omit = whole model
  axis:    'z',                       // stripes: band direction
  scale:   5,                         // feature size (stripe period / spot spacing / blotch size)
  warp:    0.45,                      // 0..1 organic wiggle of stripe lines / edges
  coverage: 0.5,                      // duty cycle / spot radius / base-coat fraction / threshold
  seed:    1,                         // reproducible noise
});
```

- **`stripes`** — tabby / tiger / zebra / brindle. `sin(axis)` with an fBm
  domain-warp so the bands wiggle organically and wrap the whole form.
- **`spots`** — leopard / cheetah / dalmatian. Worley/cellular scatter; a 3rd
  colour tints the spot core (rosettes).
- **`patches`** — calico / cow / tortoiseshell. Low-frequency fBm split into 2–3
  irregular colour zones.
- **`gradient`** — siamese / colourpoint. Darkens the extremities; pass
  `anchors: [[x,y,z], …]` (ear/paw/tail/face points) so the field marks triangles
  within `scale` of the nearest one (the face mask darkens too) — without anchors
  it falls back to distance-from-centre.

**Regional scoping — different patterns on different parts, seam-free.** The
`scope` accepts geometric predicates that AND with the label and narrow by
triangle centroid: `above`/`below` a plane, inside a `box`, inside a `sphere`.
Multiple `api.paint.pattern` calls composite (later wins), so you can layer them:

```js
// spotted head + striped body on ONE continuous mesh (no SDF label seam)
api.paint.pattern({ pattern:'stripes', colors:['#D6913E','#5A3A1F'], scope:'body' });
api.paint.pattern({ pattern:'spots',   colors:['#E8C07A','#3A241A'],
                    scope:{ label:'body', sphere:{ center:[0,-1,23], radius:11 } } });

// one pattern above an XY plane, another below
api.paint.pattern({ pattern:'patches', colors:[...], scope:{ label:'body', above:{ axis:'z', at:16 } } });
api.paint.pattern({ pattern:'stripes', colors:[...], scope:{ label:'body', below:{ axis:'z', at:16 } } });
```

> **Why a geometric scope and not separate SDF `.label()` regions?** In an
> `api.sdf` model, `.label()` partitions the tree and meshes each labelled subtree
> independently — a smooth blend *across* a label degrades to a hard union, i.e. a
> visible **seam/pinch at the neck/hips/tail**. Keep the body one fused `label`
> and target sub-regions by geometric scope instead — same per-region colour, no
> seam.

Like the other `api.paint.*` ops these resolve **by triangle** (refine for
crisper field edges) and are validated strictly (unknown keys / bad colour /
axis throw). manifold-js sandbox only.

SCAD has the same `label()` pattern, but **without** the `{ color }`
option — a SCAD `label()` is a passthrough wrapper for `paintByLabel`
only, so color a SCAD model with an explicit `paintByLabel` call. Partwright pre-injects a
passthrough `module label(name) { children(); }` into every SCAD
compile so the wrapper is portable to vanilla OpenSCAD too (the helper
does nothing geometrically — `paintByLabel` is the only thing that
acts on it). Wrap each top-level statement you intend to paint:

```scad
label("body") cube([10,10,10]);
translate([20,0,0]) label("wheel") sphere(r=4);
label("post") translate([0,20,0]) cylinder(r=2, h=8);
```

Then `paintByLabel({label:'body', color:[1,0,0]})` works exactly like
the manifold-js case. Constraints:

- **Top-level only.** Labels inside a SCAD boolean (the `{ ... }` of
  `difference()`, `intersection()`, `union()`, `hull()`, etc.) are
  lost — OpenSCAD's CGAL backend doesn't carry provenance through
  booleans.

  ```scad
  // ✗ WRONG — both labels stripped by CGAL; paintByLabel can't find them
  difference() {
    label("body") cube([20, 20, 30]);
    label("hole") cylinder(r=4, h=30);
  }

  // ✓ RIGHT — one label outside; the whole result tags as "body"
  label("body") difference() {
    cube([20, 20, 30]);
    cylinder(r=4, h=30);
  }

  // ✓ ALSO RIGHT — labels at the top level (separate statements union
  //   implicitly; the difference happens in Manifold not CGAL)
  label("body") cube([20, 20, 30]);
  label("knob") translate([0, 0, 32]) cylinder(r=4, h=6);
  ```

  When labels are lost this way, the engine attaches a `warning`
  diagnostic to the run and returns the dropped names as
  `runAndSave(...).lostLabels` (also reachable via `listLabels().lostLabels`
  on the next call) — so you don't have to diff the labelMap by hand.
  `listLabels()`'s main `labels` array contains only what survived.
- **`for`-loop expansion can also drop labels.** A single source
  `label("c") cube();` inside `for (i = [0:9])` produces 10 AMF objects
  but one scanner statement, so the engine falls back to auto-named
  regions. `runAndSave(...).lostLabels` reports this case too.
- **Literal names only.** `label("body")` works; `label(str("c", i))`
  doesn't (the name is computed at SCAD runtime and we can't read it).
  For-loop bodies that use `label()` produce auto-named regions.
- **Only label when you plan to paint.** No-label SCAD takes a faster
  single-STL path; using `label()` switches to a single multi-object
  AMF compile (similar cost, slightly more parsing). When no labels
  are present, there is zero overhead.

For geometry you didn't author with labels (user-imported, legacy
code), fall back to `paintComponent` below.

**Paint by feature on unioned models (legacy fallback).** When the
geometry is a boolean union of distinct pieces but the code didn't
use `api.label`, the one-call form is `paintComponent(index, color)`
— it decomposes and paints in a single round trip:

```js
const { components } = partwright.listComponents();
// components: [{index, centroid, boundingBox, volume, surfaceArea}, ...]
// Sort by centroid.y / volume to identify which piece is which, then:
for (const c of components) {
  partwright.paintComponent({ index: c.index, color: chooseColor(c.index) });
}
```

This avoids guessing world coordinates, survives small parametric
tweaks to the model, and skips the listComponents → paintInBox pair.
Prefer `paintByLabel` when you control the code (whether manifold-js
or SCAD); reach for `paintComponent` when you don't.

**Paint by part on multi-part STL imports — `paintIsland`.** A user-
uploaded multi-part STL (articulated print-in-place kit, separable
mechanism, harlequin figure) usually imports as a render-only mesh
(no Manifold), which means `paintComponent` and `Manifold.decompose()`
both error with "No geometry loaded". The fix: `listComponents()`
now falls back to face-connected island BFS in that case, and
`paintIsland({index, color})` paints one island. **This is the right
primitive whenever an import has multiple parts that overlap in 3D
space** — a hat sitting over a head, gloves touching pants, puffs
inside arms. Spatial selectors (`paintInBox`, `paintNear`,
`paintInCylinder`) catch every triangle that's in the bounding
volume regardless of which part it belongs to; `paintIsland` selects
by topology and never bleeds across parts:

```js
const { count, components, source } = partwright.listComponents();
// source: 'manifold' (decompose result) or 'mesh-island' (BFS fallback).
// For a 25-piece articulated kit: count === 25, source === 'mesh-island'.
// Each entry: {index, triangleCount, boundingBox, centroid}.

// Identify which island is which by bbox/centroid (top-most → hat,
// largest below it → torso, leftmost arm-like → left arm, etc.).
// Then paint each part by its island index:
partwright.paintIsland({ index: 7, color: [0.85, 0.10, 0.10], name: 'hat-left' });
partwright.paintIsland({ index: 8, color: [0.10, 0.20, 0.85], name: 'hat-right' });
```

`paintIslandAt({point, color})` is the grounded sibling: pair with
`probePixel` to "click the part in the iso render" and paint that
island without enumerating first — handy when an island's index is
ambiguous but its visible location isn't:

```js
const hit = await partwright.probePixel({ view: 'iso', u: 0.42, v: 0.31 });
if (hit?.point) partwright.paintIslandAt({ point: hit.point, color: [1, 0, 0] });
```

**Limitation:** islands are detected by *welded* vertex adjacency —
two parts that physically touch at a shared vertex (a hat brim
resting on a head with no gap) appear as one island and will both
get painted. Print-in-place kits with proper clearance gaps split
cleanly, one island per part. When islands fuse together, fall back
to combining `paintIsland` with `paintInBox`/`paintConnected` to
carve the touching boundary.

**Avoiding over-paint.** When `paintInBox` / `paintNear` catches side
walls or the bottom face by mistake, pass `topOnly: true` — restricts
to upward-facing triangles (axis +Z within 30°). Equivalent to
`normalCone: { axis: [0, 0, 1], angleDeg: 30 }` but easier to remember.

**Cheap planning.** `getFeatureCentroids({maxGroups, withinBox?})`
returns face-group centroids + normals + bbox + area, WITHOUT the
triangleId arrays that make `getMeshSummary` expensive on complex
models. Use this when planning paint targets; only escalate to the
full `getMeshSummary` when you actually need the per-triangle ids.

**Fixing mistakes.** If a paint operation went wrong, prefer the surgical
tools over `clearColors()`:

- `undoLastPaint()` reverses the single most recent paint. The removed
  region goes onto a redo stack — `redoLastPaint()` puts it back. This
  is the right call ~95% of the time when you painted something wrong.
- `removeRegion(id)` deletes one specific region (id from
  `listRegions()`). Use when the mistake wasn't the most recent paint.
- `clearColors()` removes every region. Only call this when the user
  explicitly asks to start over.

Calling `clearColors()` to fix a single mistake forces you to repaint
every other region from scratch — multiple round-trips, multiple chances
to introduce new mistakes. Don't do it.

You also don't need to repaint when the **geometry** changes between
versions: `forkVersion` re-applies the parent's color regions to the
forked mesh automatically (each region's descriptor is re-resolved against
the new geometry), and `copyColorsFromVersion({index})` transfers a painted
version's colors onto the current mesh in one call. Regions whose descriptor
no longer resolves are reported in `dropped` — repaint only those.

**How face matching works.** `paintRegion` flood-fills outward from the seed triangle, including any neighbor whose normal is within `tolerance` of the seed's. Pick `point` slightly inside the model surface and pass the outward-pointing `normal` -- the seed resolver looks for the triangle whose plane the point lies on and whose normal aligns with yours.

**Diagnostic on failure.** When `paintRegion` can't resolve a seed, the returned `error` string includes the position and normal of the *nearest* triangle, the angle off your requested normal, and a suggested tolerance value that would accept it. The same data is available structured under `{ error, nearest: { point, normal, distance, angleDeg, suggestedTolerance } }`. So a failed call tells you exactly what to change rather than leaving you guessing.

```js
const r = partwright.paintRegion({ point: [50, 50, 50], normal: [0, 0, 1], color: [1, 0, 0] });
// r.error = "paintRegion: no face matched at point=[50.00, 50.00, 50.00], normal=[0.000, 0.000, 1.000], tolerance=0.9995. Nearest face is at [...] with normal [...] (3.2° off requested, distance 12.345). try tolerance 0.9981 (currently 0.9995)"
// r.nearest = { point, normal, distance, angleDeg, suggestedTolerance }
```

**`paintRegion` is strict about seed placement** -- the point must lie on the surface within ~0.01 units. If you'd rather snap to the nearest face within a tolerance and skip the trial-and-error of placing a point exactly, use `paintNearestRegion`:

```js
// Snap [8, 0.39, 5] to whatever face is closest within 1.0 units, then paint.
const r = partwright.paintNearestRegion({
  point: [8, 0.39, 5],
  color: [0, 0.6, 1],
  searchRadius: 1.0,        // optional cap; omit to always pick the closest face
  name: "Fin",              // optional
  tolerance: 0.9995,        // optional flood-fill tolerance, same semantics as paintRegion
});
// On success: { id, name, triangles, snappedTo: { point, normal, distance } }
// On failure: { error: "...nearest face is X.XX units away, outside searchRadius=...", nearestDistance }
// The seed normal is taken from the snapped triangle, so callers don't have to know it in advance.
```

**Targeting faces by geometry instead of by point.** `findFaces` queries triangle indices by box, normal, color, or region — pass the result straight to `paintFaces` to color procedurally. `getMeshSummary` partitions the mesh into coplanar face groups (sorted largest-first) and reports each group's centroid, normal, area, and bounding box; pick a group, then call `paintFaces({ triangleIds: group.triangleIds, color })`.

```js
// Find every roughly-upward face inside a bounding box (e.g. the top of a part).
const top = partwright.findFaces({
  box: { min: [-50, -50, 9], max: [50, 50, 11] },
  normal: [0, 0, 1],
  normalTolerance: 0.95,    // ~18° cone around +Z
});
// -> { triangleIds: [...], count, matched, truncated }
partwright.paintFaces({ triangleIds: top.triangleIds, color: [1, 0.6, 0], name: "Top" });

// Or get a structural overview and pick by area.
const summary = partwright.getMeshSummary({ minTriangles: 4 });
// summary.groups is sorted largest first.
const largestSideFace = summary.groups.find(g => Math.abs(g.normal[2]) < 0.1);
partwright.paintFaces({ triangleIds: largestSideFace.triangleIds, color: [0.2, 0.4, 0.9] });
```

`findFaces` filters all AND together. Pass `region: <id>` from `listRegions()` to subset by an existing painted region. The default `normalTolerance` is `0.95` (≈18° cone) — looser than `paintRegion`'s `0.9995` because it's intended for catching whole faces of a primitive, not exact-coplanar fills.

**Predictable paint primitives (no flood-fill tolerance to tune).** `paintRegion` is the right tool when you have a flat face with sharp edges around it — pick a point on the face, paint that face. It's the *wrong* tool on smooth surfaces (capsules, hulled spheres, organic shapes) because the flood-fill threshold is bimodal: too tight and you paint 2 triangles, too loose and you paint the whole connected component, with almost no useful middle. Reach for `paintNear` or `paintInBox` instead — both filter triangles by world-space geometry, so the region you paint is described in coordinates rather than tolerances.
```js
// Sphere: every triangle whose centroid is within `radius` of `point`.
// `normalCone` (optional) further restricts to triangles whose face normal is
// within `angleDeg` of `axis`. Both narrow the result without flood-fill magic.
partwright.paintNear({
  point:  [10, 5, 67],                    // world-space center
  radius: 4,
  normalCone: { axis: [0, -1, 0.45], angleDeg: 25 }, // dorsal-facing only
  color:  [0.88, 0.30, 0.45],
  name:   "Index nail",
});
// -> { id, name, triangles, bbox, centroid } or { error }

// Box: every triangle whose centroid lies inside an axis-aligned box.
partwright.paintInBox({
  box: { min: [-3, -2, 60], max: [3, 0, 75] },
  normalCone: { axis: [0, -1, 0], angleDeg: 30 },    // optional
  color: [0.88, 0.30, 0.45],
  name:  "Front of fingertip",
});
```

`paintNear` and `paintInBox` ignore mesh edges entirely — they collect triangles by *position* and (optionally) by face-normal direction, so the result is independent of how the boolean union tessellated the surface. Use them for organic geometry; use `paintRegion` for flat plates with crisp 90° edges.

**Smooth, rounded painted edges (`paintStroke`).** Every selector above paints whole *existing* triangles, so a painted edge is stair-stepped on a coarse mesh. `paintStroke` instead **subdivides the mesh along the stroke's outline** so the painted edge is rounded — the smooth-brush equivalent of dragging a paintbrush along a path. Only the rim triangles are refined (the interior is left coarse), which keeps it lean; the painted band may contain hairline T-junctions (invisible on screen and fine for GLB/most slicers, but not strictly watertight). It's the only paint tool that grows the triangle count, so it's more expensive than the selectors: reach for it **only when a visibly rounded painted edge matters** (a curved stripe, a soft-edged patch), and prefer `paintNear`/`paintInBox`/`paintConnected` otherwise. Drive it by vision — render, pick pixels along the path, `probePixel` each for world-space points:

```js
const a = await partwright.probePixel({ pixel: [120, 90],  view: { elevation: 30, azimuth: 45 } });
const b = await partwright.probePixel({ pixel: [160, 110], view: { elevation: 30, azimuth: 45 } });
partwright.paintStroke({
  points: [a.point, b.point],   // ordered surface points; a single point stamps a rounded dot
  radius: 3,                     // mesh units, > 0
  resolution: 64,                // curve segments: target edge = radius / resolution. Edge is clipped exact, so this only smooths curves. Default 64, range 2–1024
  // maxEdge: 0.1,               // OR: absolute target edge length (mesh units); overrides resolution
  shape: 'circle',               // circle | square | diamond
  // surface: 'geodesic',        // 'geodesic' (default) | 'slab' — see below
  // depth: 0,                   // slab only: how far through the wall paint reaches (0 = auto = ½ radius)
  // wrapAngleDeg: 90,           // wrap tolerance 0–180: max edge bend paint flows across (90 stops at right-angle corners; API default 180 = wrap freely) — see below
  color: [0.9, 0.2, 0.2],
});
// -> { id, name, triangles, resolution, maxEdge, meshTriangleCount } or { error }
```

The painted edge is **clipped to the exact outline** (the mesh is cut along the brush's analytic boundary), so a square gets dead-straight edges and a circle a clean curve — even on a coarse mesh, and watertight. Because the edge is exact, `resolution` only controls how many segments a *curve* is approximated with (straight square/diamond edges are crisp at any setting and stay nearly free — a slab square paints in ~10 triangles). Default `resolution` is **64** (plenty smooth with the clip); raise it for very large curves, or use the absolute `maxEdge` override for explicit sizing.

**The brush is a *surface* tool, not a 3D ball.** `surface: 'geodesic'` (the default) flood-fills the footprint along the *connected* surface from the stroke, so paint follows curves and wraps over edges but never bleeds through to the opposite wall of a thin or hollow part — no tuning needed. `surface: 'slab'` instead keeps a thin shell within `depth` (mesh units) of the picked surface along its normal; raise `depth` to deliberately reach through a wall, lower it to hug the surface (`0` = auto = half the radius). Sessions saved before this feature load as `slab`. The interactive brush exposes the same controls — `getBrushSurface()` / `setBrushSurface('geodesic'|'slab')` and `setBrushDepth(u)`.

**Wrap tolerance — stop a stroke at sharp edges (`wrapAngleDeg`).** Applies to *both* surface modes. It's the maximum edge bend (degrees, 0–180) paint may flow across as the stroke follows the surface: the spread crosses an edge only when the two faces bend by ≤ this angle, so it flows smoothly over gentle curves and bumpy near-coplanar facets but **stops at a sharp fold**. `90` stops at right-angle corners — paint on one exterior face of a box won't reach the adjacent faces, and a stroke inside one wall of a hollow part won't bleed onto the next wall — while `180` (the `paintStroke` API default) wraps across any edge. The interactive brush adds a **Wrap tolerance** slider (default 90°) and `getBrushWrapAngle()` / `setBrushWrapAngle(deg)`. A finite gate (< 180°) builds the surface-connectivity field even in slab mode, so it's a touch more work than an ungated slab stroke.

**Airbrush — soft speckle (`paintAirbrush`).** Sprays a geodesic soft-edged region whose boundary fades out via a stochastic per-triangle **dither**, not colour blending — every triangle stays one printable colour. Coverage = `strength` (0..1, core density; default 0.4 for a light spackle) fading to 0 across the outer `softness` (0..1) band; `seed` makes the speckle reproducible. It's always surface-following (never bleeds through a wall) and works with any `shape` (circle/square/diamond spackle). It's a mode of the interactive brush too — the brush panel's **Spray** toggle (Slab is disabled while spraying, since a spray is geodesic-only).

```js
partwright.paintAirbrush({
  points: [a.point, b.point],   // surface points (probePixel)
  radius: 4,                     // mesh units
  strength: 0.4,                 // 0..1 core density (light spackle default)
  softness: 0.5,                 // 0..1 feathered-edge width
  seed: 1,                       // deterministic dither
  shape: 'circle',               // circle | square | diamond
  color: [0.9, 0.2, 0.2],
});
// -> { id, name, triangles, strength, softness, seed, meshTriangleCount } or { error }
```

**Paint by visual reasoning (organic / character meshes).** When bounding boxes won't separate the features (a hand from a sleeve at the same Z; an ear from a head), use `probePixel` + `paintConnected`. `probePixel` translates a pixel position in a rendered view back to an exact surface point + normal + triangleId — essentially clicking in your own perception. `paintConnected` then flood-fills from that seed, gated by deviation from the SEED normal, so it stays on the feature without bleeding to side faces with different orientations.

```js
// 1. Render the angle that shows the feature clearly.
const img = partwright.renderView({ elevation: 0, azimuth: 0, ortho: true, size: 320 });
// (the image is forwarded to you as a multimodal block)

// 2. Identify the feature's pixel in the rendered image. Then probe
//    that exact pixel back into world space — the view spec MUST
//    match the renderView call above.
const hit = partwright.probePixel({
  pixel: [180, 220],
  view: { elevation: 0, azimuth: 0, ortho: true, size: 320 },
});
// On a hit:  { point: [x,y,z], normal: [nx,ny,nz], distance, triangleId, nextStep }
// On a miss: { hit: false, modelPixelBounds: {minX,minY,maxX,maxY}, reason, hint }
//   — the miss tells you where the model projects, so re-aim inside those
//   bounds and probe again rather than treating it as a failure.

// 3. Flood from the seed, gated by 30° deviation from the seed normal.
//    paintConnected stays on the feature where paintRegion (bimodal
//    on smooth meshes) cannot.
if ('point' in hit) {
  partwright.paintConnected({
    seed: { point: hit.point, normal: hit.normal },
    maxDeviationDeg: 30,
    color: [0.4, 0.7, 0.4],
    name: 'skin',
  });
}
```

The seed point returned by `probePixel` is *exactly* on the mesh surface (raycast result, not a snap), so paint primitives that need precise seed placement (`paintRegion` in particular) work without seed-tolerance issues. The model's pixel-position estimation has built-in error (~±10-20px on a 320 render); `paintConnected` absorbs that fine since the seed normal anchors the flood. For `paintNear`, pick a radius generous enough for the same.

**Brush + slab + procedural targeting.**

```js
// Brush: paint specific triangle indices (no flood-fill). Use findFaces(),
// getMeshSummary(), or getMesh() to source ids procedurally; the Paint UI also
// emits indices when picking faces interactively.
partwright.paintFaces({
  triangleIds: [12, 13, 14, 27],
  color: [0, 0.6, 1],
  name: "Inset detail",
});

// Direct mesh access. getMesh() exposes typed arrays (vertices, triangles,
// per-triangle normals, per-triangle centroids, bbox) so you can implement any
// selection strategy yourself. Triangle indices are stable for a saved version.
const mesh = partwright.getMesh();
// mesh.numTri, mesh.normals (Float32Array, 3 per tri), mesh.centroids, ...
const ids = [];
for (let t = 0; t < mesh.numTri; t++) {
  const cz = mesh.centroids[t * 3 + 2];
  const nz = mesh.normals[t * 3 + 2];
  if (cz > 60 && nz < -0.5) ids.push(t);   // backward-facing tris up high
}
partwright.paintFaces({ triangleIds: ids, color: [0.9, 0.3, 0.4] });

// Slab: paint every face whose centroid falls inside a planar slab.
// Axis-aligned slab (most common — pick X/Y/Z and slide along that axis):
partwright.paintSlab({
  axis: "z",
  offset: 0,           // slab spans Z in [offset, offset + thickness]
  thickness: 5,
  color: [1, 0.4, 0],
  name: "Bottom 5mm",
  // Smoothing is ON by default: the two slab edges are subdivided so the band
  // has clean straight edges even across coarse faces. Tune or disable it:
  // resolution: 256,  // target edge = model bbox diagonal / resolution (2–1024)
  // maxEdge: 0.1,     // OR absolute target edge length (overrides resolution)
  // smooth: false,    // keep the raw blocky tessellation
});

// Tilted/oblique slab — pass an arbitrary normal vector. Doesn't need to be
// unit-length; it gets normalized. The slab is the set of points P satisfying
// offset <= P · normal <= offset + thickness.
partwright.paintSlab({
  normal: [1, 0, 1],   // 45° between +X and +Z
  offset: 0,
  thickness: 8,
  color: [0.8, 0, 0.5],
});

// Oriented shape: paint inside a rotated box (same selector as the UI Box tool).
// Edge smoothing is ON by default here too (subdivides the mesh near the box
// faces). smooth / resolution / maxEdge work exactly as for paintSlab.
partwright.paintInOrientedBox({
  box: { center: [10, 0, 5], size: [8, 4, 2], quaternion: [0, 0, 0.3827, 0.9239] },
  color: [0.2, 0.7, 0.9],
  // smooth: false, resolution: 256, maxEdge: ...
});
```

**Two kinds of region — durable descriptors vs. baked triangle ids.** This distinction matters more than any other when you paint several regions in a session:

- **Re-resolvable analytic descriptors** — `paintSlab`, `paintInOrientedBox`, `paintInCylinder`, and `paintStroke` persist *what they meant* (the slab plane, oriented box, cylindrical shell, or brush path), not a fixed triangle list. On every reconcile they re-collect against the live mesh, so they **survive both subdivision and a model re-run**, and their boundary can be subdivided for a clean edge (smoothing is on by default for these). These are the robust choice.
- **`paintByLabel`** is the most durable of all: it re-resolves by *name* from the label map each time, so it tracks the geometry through any re-tessellation as long as the label exists. If a feature is its own part, `api.label(part, "handle")` it in the model code and `paintByLabel("handle", color)` — no coordinates to guess.
- **Id-baking selectors** — `paintInBox`, `paintNear`, `paintFaces`, `paintConnected` — lock onto the *current* tessellation and store raw triangle ids. They **cannot be smoothed** (refine the mesh first with `.refine(n)` if you need a finer edge), and their ids are valid only against the base mesh they were taken on. They are carried across in-session subdivision via a parent→children remap, but a **model re-run replaces the base mesh and the ids no longer point at the same surface** — that's the usual cause of a previously-good region reporting `triangleCount: 0` or landing on the wrong faces. After any code change, repaint id-baked regions or, better, re-express them as an analytic/`byLabel` descriptor.

> **Ordering heuristic:** prefer the durable forms (analytic descriptors, `paintByLabel`) so order doesn't matter. If you must use id-baked selectors alongside smoothing paints, commit the mesh-changing ops first (or keep them in a single saved version), since a later subdivision/re-run is what disturbs raw ids.

**Painting a feature that sticks out past a round body — select by radius, not a box plane.** A flat box face cutting across a curved junction (e.g. a handle meeting a cylindrical mug wall) leaves a ragged, stair-stepped boundary, because the box plane and the curved surface disagree. Select by *radial distance from the part's axis* instead — `paintInCylinder({ rMin, rMax, zMin, zMax })` (or a `normalCone` to grab only the outward-facing skin) — so the boundary follows the curve cleanly. Radius-based selection is the canonical tool for inner/outer walls of mugs, vases, and any revolved shape.

> **Non-Z cylinders — `axis`.** `paintInCylinder` runs along **Z** by default (radius in XY, the `zMin..zMax` band along Z). For a part whose round axis points along X or Y, pass `axis: 'x'` or `axis: 'y'` (mirrors `paintSlab`'s axis shorthand) instead of rotating the model: radius is then measured in the plane normal to that axis and the band runs along it. `center` is the `[a,b]` pair in the radial plane (for `axis:'x'` that's `[y,z]`, for `'y'` it's `[z,x]`). The same `axis` field works in `paintPreview({ cylinder: { …, axis } })`.

**Verifying paint before you commit it.** `paintPreview` accepts the same selectors as `paintInBox` / `paintNear` / `paintFaces` *and* the analytic `cylinder` / `slab` forms, *without* adding a region. Default: count-only (free sanity check). Pass `withImage: true` to also get a thumbnail with the candidate triangles tinted bright yellow on top of any existing paint. The `cylinder` / `slab` previews show the **unsmoothed** selection (preview never subdivides) — use it to validate a radial shell or slab offset/thickness in one cheap call before committing the real smoothing paint:

```js
// Validate the inner wall of a mug before painting it:
partwright.paintPreview({ cylinder: { rMin: 18, rMax: 22, zMin: 2, zMax: 88 } });
// Validate a slab band:
partwright.paintPreview({ slab: { axis: "z", offset: 0, thickness: 5 } });
```

```js
const dry = partwright.paintPreview({
  point: [10.4, 5.2, 67],
  radius: 3,
  normalCone: { axis: [0, -0.89, 0.45], angleDeg: 25 },
});
// dry = { triangleCount, bbox, centroid }   // count-only, cheap
// If dry.triangleCount looks off, opt into the visual:
const visual = partwright.paintPreview({
  point: [10.4, 5.2, 67], radius: 3, withImage: true,
  view: { elevation: 0, azimuth: 180, ortho: true, size: 320 }, // optional
});
// visual = { triangleCount, bbox, centroid, thumbnail }
```

**Explaining a region after the fact.** `paintExplain({region: id})`
returns counts, bbox, centroid, surface area, a normal-distribution
histogram, and a yellow-highlighted thumbnail of just that region.
Use when a painted region looks wrong and you need to diagnose *why*
without re-running the selector:

```js
partwright.paintExplain({ region: 'mouth' });
// -> { id, name, color, source, triangleCount, area, bbox, centroid,
//      normalHistogram: { xPos, xNeg, yPos, yNeg, zPos, zNeg, oblique },
//      thumbnail }
// Pass `withImage: false` to skip the WebGL render when you only need
// the histogram (e.g. "is this region all top-facing or did it wrap?").
```

**Asserting paint after you commit it.** `assertPaint` checks a region against expected triangle count and bbox/centroid ranges — same shape as `runAndAssert`, but for color regions. Use this in iterative agent loops to catch regressions when the underlying mesh changes (e.g. after a forkVersion).

```js
partwright.assertPaint({
  region: 'Index nail',                              // or numeric region id
  expectedTriangleCount: { min: 15, max: 60 },       // or exact number
  expectedBoundingBox: {
    z: [60, 75],                                     // any subset of axes
    y: [3, 7],
  },
  expectedCentroid: { z: [62, 72] },
});
// -> { passed: true, region: { ... } }
//    or { passed: false, failures: ["..."], region: { ... } }
```

**Bucket tolerance.** `paintRegion`'s `tolerance` is a cosine threshold for the bend angle between adjacent faces (default `0.9995`, ≈ 1.8°). The flood-fill crosses an edge only when the bend at that edge is below the angle threshold — checked between the *parent* face and each *neighbor*, not against the seed. This means flood-fill follows curved surfaces: a 32-sided cylinder bends ~11° per face, so any tolerance ≥ cos(11°) ≈ `0.98` covers the whole cylinder. Set tolerance to `-1` (180°) to paint the entire connected mesh. The Paint UI exposes the same control as a slider labeled in degrees (0°–180°).

**Re-running with colors in memory.** The editor stays writable even when color regions exist (there is no paint lock), but re-running new geometry would invalidate the saved triangle indices the colors were painted against — leaving the paint resolved against stale triangles. Agents that need to iterate on the geometry should call `clearColors()` first, or fork with `forkVersion` — which by default carries the colors onto the new geometry (pass `carryColors: false` for an uncolored child).

**Saving a colored version.** Calling `saveVersion(label)` after painting *will* persist the regions onto a new version — the dedupe check considers code, annotations, and color regions together. If nothing has changed, `saveVersion()` returns `{ skipped: true, reason: "..." }` instead of `null`, so a no-op is visible. If you want to be sure a save happened, check the return shape: `{ id, index, label }` on success, `{ skipped }` on no-op, `{ error }` if no session is open.

**Export behavior.**
- `exportGLB()` -- vertex colors flow through automatically.
- `export3MF()` -- regions become `<basematerials>` entries with per-triangle `pid` attributes (compatible with PrusaSlicer / Bambu Studio multi-material slicing).
- `exportSTL()` and `exportOBJ()` -- formats don't carry color, so colors are dropped.

## Recoloring regions in bulk

`replaceColor({from, to, tolerance?})` recolors **every** region whose color matches `from` (within `tolerance`, default 0.01) to `to`. Colors are `[r,g,b]` in 0..1 — the same range as `paintFaces`/`paintRegion`. Returns `{ replaced: count }`.

```js
// turn every red region blue
partwright.replaceColor({ from: [1, 0, 0], to: [0, 0, 1] })  // -> { replaced: 3 }
```

This only changes region *colors*, not which triangles they cover — to repaint different triangles, use the paint selectors.

**It only rewrites user paint regions.** Colors declared *in code* (`api.paint.*` / `api.label({color})`) are re-derived from the source on every run, so `replaceColor` — like the palette slot/replace/merge operations — deliberately leaves them alone. To change one, edit the `color` argument in the code and re-run. When nothing matched but the model has code-declared colors, the result carries a `hint` saying exactly that.

## Stamping an image onto the surface

`paintImage({imageUrl, view|at+normal, size, ...})` projects a **raster image** onto the model as paint — the right tool for a logo, sticker/decal, styled text or wordmark, a shirt graphic, or face/skin detail. It maps the image's actual pixels onto the triangles, so a logo stays a logo and lettering stays legible. **Do not reach for `paintNear`/`paintInBox` for a graphic** — those flood one flat colour and turn a picture into a blob.

**Easiest — project from a named view:**

```js
// put a graphic on the chest of a figure, projected from the front,
// centred (and auto-sized) on the "shirt" label
await partwright.paintImage({
  imageUrl: graphicDataUrl,  // a data: URL or a same-origin URL
  view: 'front',             // front|back|left|right|top|bottom — projects flat along that axis
  label: 'shirt',            // optional: centre on this api.label region; auto-sizes when size is omitted
  // size: 30,               // decal width in model units (optional when `label` is given)
  rotationDeg: 0,            // spin around the projection axis (optional)
  removeBackground: true,    // drop the image's background so only the subject paints (default true)
})
// -> { ok, name, triangles, avgColor } or { error }
```

**Precise — explicit anchor + direction** (when you need exact placement):

```js
await partwright.paintImage({
  imageUrl: logoDataUrl,
  at: [0, 0, 10],            // stamp centre, ON the surface (world coords)
  normal: [0, 0, 1],         // the outward face direction there
  size: 12,                  // decal width in world units
  detail: 96,                // triangle rows across the stamp; higher = crisper. 0 = flat
})
```

- **Placement:** pass `view` (auto-anchored at the model centre, optionally centred on a `label`) for the common case, OR explicit `at` + `normal` for precision — get those from `probeRay({origin, direction})` (returns hit point + face normal), `probePixel`, or a known face centre. With `view`, the projection direction is the view axis (front=-Y, back=+Y, right=+X, left=-X, top=+Z, bottom=-Z) and the surface anchor is found by ray-casting toward the model centre.
- Only **forward-facing** triangles inside the footprint are painted, and a depth slab stops paint bleeding through to the far side.
- After painting, **verify** with `renderView`/`renderViews` from the projection direction — confirm the graphic landed where you intended and is the right size before saving.
- The stamp subdivides the footprint for crisp edges (smooth mode), so the model's triangle count rises locally — call `getGeometryData()` after if you care about the budget.
- Call `saveVersion('stamped')` afterwards to persist it (paint isn't auto-saved).

## The filament palette — paint to real print slots

A multi-color model prints by mapping its regions onto a printer's loaded **filament slots** (AMS / MMU). The palette is the shared set of those slots; painting with palette colors keeps a model printable on a known spool set. The palette is a cross-session user preference (localStorage), not part of the session.

```js
partwright.getPalette()
// -> { id, name, capacity, constrained, slots: [{ id, name, hex, td }, ...] }
//    capacity   = how many slots the printer can load at once (the AMS/MMU budget)
//    constrained= true means paint snaps to the nearest slot color
//    td         = a slot's transmission distance (drives the relief optical preview)

// Paint a region with a palette slot's color (convert its hex to the 0..1 rgb paint takes):
const slot = partwright.getPalette().slots[0];
const [r, g, b] = [parseInt(slot.hex.slice(1,3),16)/255, parseInt(slot.hex.slice(3,5),16)/255, parseInt(slot.hex.slice(5,7),16)/255];
partwright.paintByLabel({ label: 'body', color: [r, g, b] });
```

Manage the palette (all return `{ ok }`/`{ id }`/the slot, or `{ error }`):

```js
partwright.listPalettes()                       // -> [{ id, name, active }]
partwright.createPalette('PLA basics')          // -> { id }  (then setActivePalette to switch)
partwright.setActivePalette(id)
partwright.addFilament({ name: 'Teal', hex: '#1fa89a', td: 1 })   // -> { id, name, hex, td }
partwright.updateFilament(slotId, { hex: '#0e7d72' })
partwright.removeFilament(slotId)
partwright.setPaletteCapacity(4)                // AMS with 4 slots
partwright.setPaletteConstrained(true)          // snap paint to the loaded slots
```

Aim for a region count within `capacity` for a single-pass multi-material print; beyond it the UI flags the model over-budget.

