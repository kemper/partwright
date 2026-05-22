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

Limitations: manifold-js only (SCAD has no equivalent). For
geometry you didn't author with labels (user-imported, legacy code),
fall back to `paintComponent` below.

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
Prefer `paintByLabel` when you control the code; reach for
`paintComponent` when you don't.

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
```

**Verifying paint before you commit it.** `paintPreview` accepts the same selectors as `paintInBox` / `paintNear` / `paintFaces`, *without* adding a region. Default: count-only (free sanity check). Pass `withImage: true` to also get a thumbnail with the candidate triangles tinted bright yellow on top of any existing paint.

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

**Editor lock.** When color regions exist, the editor is locked (the model can't be re-run, because new geometry would invalidate the saved triangle indices). To edit code, the user clicks "Unlock to edit" in the UI. Agents that need to iterate on the geometry should call `clearColors()` first, or fork with `forkVersion` — which by default carries the colors onto the new geometry (pass `carryColors: false` for an uncolored child).

**Saving a colored version.** Calling `saveVersion(label)` after painting *will* persist the regions onto a new version — the dedupe check considers code, annotations, and color regions together. If nothing has changed, `saveVersion()` returns `{ skipped: true, reason: "..." }` instead of `null`, so a no-op is visible. If you want to be sure a save happened, check the return shape: `{ id, index, label }` on success, `{ skipped }` on no-op, `{ error }` if no session is open.

**Export behavior.**
- `exportGLB()` -- vertex colors flow through automatically.
- `export3MF()` -- regions become `<basematerials>` entries with per-triangle `pid` attributes (compatible with PrusaSlicer / Bambu Studio multi-material slicing).
- `exportSTL()` and `exportOBJ()` -- formats don't carry color, so colors are dropped.

