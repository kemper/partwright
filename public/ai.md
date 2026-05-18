# Partwright -- AI Agent Instructions

Partwright is a browser-based parametric CAD tool with two modeling engines: **manifold-js** (default, JavaScript DSL with manifold-3d API + a `Curves` helper namespace) and **OpenSCAD** (SCAD language via WASM, with BOSL2 bundled). You write code that constructs 3D geometry, which renders live. All interaction is via the `window.partwright` programmatic API -- do not drive the app through clicks or keystrokes. `window.mainifold` remains available as a legacy alias for older prompts.

**Coordinate system:** Right-handed, Z-up. XY plane is the ground. Units are arbitrary.

## Contents

- [Before you start](#before-you-start)
- [Choosing an engine](#choosing-an-engine)
- [What do I do for X? (verb decision tree)](#what-do-i-do-for-x-verb-decision-tree)
- [Topic index (subdocs)](#topic-index-subdocs)
- [Common agent mistakes](#common-agent-mistakes)
- [Argument validation](#argument-validation)
- [Console API -- window.partwright](#console-api--windowpartwright)
- [Geometry data](#geometry-data)
- [Writing model code (manifold-js)](#writing-model-code-manifold-js)
- [Writing OpenSCAD code](#writing-openscad-code)
- [Common pitfalls for boolean operations](#common-pitfalls-for-boolean-operations)
- [Iteration workflow](#iteration-workflow)
- [Stat-based verification](#stat-based-verification)
- [Visual verification](#visual-verification)

## Before you start

1. **Use `window.partwright`** -- that's the programmatic API. Do NOT drive the app with clicks, keystrokes, or DOM manipulation.
2. **Pick your engine:** manifold-js (default) or OpenSCAD. See [Choosing an engine](#choosing-an-engine).
3. **manifold-js code must end with `return manifoldObject;`** -- a bare trailing expression won't work. OpenSCAD code uses standard SCAD syntax (no `return`).
4. **Use `runAndSave(code, label, {isManifold: true, maxComponents: 1})`** to validate and commit a version.
5. **Log decisions with `addSessionNote("[PREFIX] ...")`** -- prefixes: `[REQUIREMENT]`, `[DECISION]`, `[FEEDBACK]`, `[MEASUREMENT]`, `[ATTEMPT]`, `[TODO]`.

## Choosing an engine

Partwright supports two modeling engines. Pick whichever is best for the task:

| | **manifold-js** (default) | **OpenSCAD** (SCAD) |
|---|---|---|
| Language | JavaScript | OpenSCAD `.scad` |
| Best for | Algorithmic geometry, smooth curves (with `Curves` helpers), mesh-level operations (smooth/refine/SDF/warp) | Mechanical parts with rounding/chamfer/threads (with BOSL2), porting existing `.scad` files |
| Code style | `return Manifold.cube([10,10,10], true);` | `cube([10,10,10], center=true);` |
| Unique strengths | `Curves.loft`, `Curves.sweep`, `Curves.naca4`; `levelSet`, `warp`, `smoothOut` (mesh-level) | BOSL2's `cuboid(rounding=)`, `skin()`, `path_sweep()`, `threaded_rod()`, `spur_gear()` |
| Limitations | Must learn the manifold-3d API | No `text()` (fonts not loaded), slower per-run (~100-300ms WASM init) |

### Switching engines

```js
partwright.getActiveLanguage()        // -> 'manifold-js' or 'scad'
await partwright.setActiveLanguage('scad')
await partwright.setActiveLanguage('manifold-js')
```

Selecting a SCAD example from the toolbar dropdown auto-switches to OpenSCAD mode. Session versions remember which engine was used.

## What do I do for X? (verb decision tree)

Reach for the right tool the first time. If the table sends you to a subdoc, fetch it before writing code.

| Want | manifold-js | OpenSCAD |
|---|---|---|
| Cube / sphere / cylinder | `Manifold.cube/sphere/cylinder(...)` | `cube()`, `sphere()`, `cylinder()` |
| Boolean union / difference / intersection | `.add(o)`, `.subtract(o)`, `.intersect(o)` | `union(){...}`, `difference(){...}`, `intersection(){...}` |
| 2D shape extruded to 3D | `cs.extrude(h, nDiv?, twist?, scaleTop?)` | `linear_extrude(h, twist=, slices=, scale=) polygon(...)` |
| Surface of revolution (vase, lens, bottle) | `cs.revolve(n?, degrees?)` | `rotate_extrude(angle=) polygon(...)` |
| Smooth curve from a few points | `Curves.bezier(controls)` -> `/ai/curves.md` | `bezier_curve()` (BOSL2) -> `/ai/bosl2.md` |
| Arc between two points | `Curves.arc({from, to, radius})` | `arc()` (BOSL2) |
| Airfoil cross-section | `Curves.naca4("2412")` | (write your own with BOSL2 paths) |
| Polygon with rounded corners | `Curves.polyline(points, {fillet: r})` | BOSL2 `round_corners(...)` |
| Wing, hull, fuselage (varying profile along axis) | `Curves.loft([profA, profB], [zA, zB])` -> `/ai/curves.md` | BOSL2 `skin([profiles], z=, slices=)` -> `/ai/bosl2.md` |
| Handle, tube, propeller (profile along 3D path) | `Curves.sweep(profile, pathPoints)` | BOSL2 `path_sweep(profile, path)` |
| Revolve around an arbitrary axis | `Curves.revolveAxis(profile, [ax,ay,az])` | `rotate([...]) rotate_extrude() polygon()` |
| Round/chamfer all sharp edges of a solid | `Curves.fillet(solid, {angle: 60})` | BOSL2 `cuboid(rounding=...)`, `round3d(...)` |
| Ring/linear/mirror copies | `Curves.ringCopy / linearCopy / mirrorCopy` | BOSL2 `ring_copies()`, `xcopies()`, `mirror_copy()` |
| Threaded rod / bolt / nut | (write a helix manually) | BOSL2 `threaded_rod()`, `screw()`, `nut()` |
| Spur / bevel / worm gear | (sample involute manually) | BOSL2 `spur_gear()`, `bevel_gear()`, `worm_gear()` |
| Implicit surface (gyroid, metaball, SDF blend) | `Manifold.levelSet(sdf, bounds, edgeLen)` | (not available) |
| Mesh-level smoothing (rounded blob from cube) | `.smoothOut(angle).refine(n)` | (not available) |
| Arbitrary vertex warp (bend extrusion) | `.warp(fn)` | (not available) |

**Rule of thumb:** if you find yourself writing a `for` loop to manually compute curve points, stop and check whether `Curves` (manifold-js) or BOSL2 (SCAD) already has the verb. AI-generated point-sampling math is brittle; the helpers are deterministic.

## Topic index (subdocs)

The main reference splits into focused subdocs. Fetch them on demand instead of loading everything up front.

- **[/ai/curves.md](/ai/curves.md)** — `Curves.loft/sweep/bezier/arc/naca4/polyline/fillet/...` helpers in manifold-js. Read **before** writing any code involving smooth curves, organic shapes, airfoils, or lofted surfaces.
- **[/ai/bosl2.md](/ai/bosl2.md)** — BOSL2 cheatsheet for OpenSCAD: `cuboid(rounding=)`, `skin()`, `path_sweep()`, `screw()`, `spur_gear()`, attachables. Read **before** writing SCAD code that needs edge rounding, threads, gears, or path-following.
- **[/ai/print-safety.md](/ai/print-safety.md)** — FDM-specific rules: minimum wall thickness, taper traps, sub-extrusion-width layer detection. Read **before** exporting STL/3MF for printing.
- **[/ai/colors.md](/ai/colors.md)** — `paintRegion()` for multi-material output; how colors flow through GLB/3MF/OBJ exports.
- **[/ai/reference-images.md](/ai/reference-images.md)** — Loading photos for elevation comparison; optional photo-to-model workflow.
- **[/ai/file-io.md](/ai/file-io.md)** — `exportGLBData()`, `importSessionData()`, Recent Exports inbox — agent-friendly I/O that skips browser file pickers.
- **[/ai/annotations.md](/ai/annotations.md)** — Reading and writing freehand strokes / text labels the user has placed on the model.

## Common agent mistakes

- **Driving the UI with clicks/keystrokes** -- CodeMirror's auto-close-brackets will corrupt your code. Use `partwright.setCode()` and `partwright.run()` instead.
- **Forgetting `return`** -- code runs in `new Function()`, so a trailing expression is NOT automatically returned. You must write `return Manifold.cube(...)`.
- **Hand-rolling curve math instead of using helpers** -- if you need a smooth surface or curve, check the verb table above. `Curves.loft` / BOSL2 `skin()` are far more reliable than a hand-written polygon-sampling loop.
- **Skipping sessions** -- always create a session (`createSession`) and save versions (`runAndSave`) so the user can review your work in the gallery.
- **Skipping visual verification** -- stats alone can't catch visual defects. After structural changes, screenshot the Elevations tab or use `renderView()`.
- **Flush boolean placement** -- shapes must overlap by at least 0.5 units to union correctly. Merely touching at a face produces disconnected components.
- **Tapering to a near-point on printed geometry** -- `scaleTop=[0.01, 0.01]` or chamfers that collapse the top to sub-millimeter area look fine in `geometry-data` but FDM slicers silently drop sub-extrusion-width layers, so the cap disappears on the print. See [/ai/print-safety.md](/ai/print-safety.md).
- **Not reading session context before modifying** -- when opening an existing session, always call `getSessionContext()` first and read the notes/version history before making changes. See [Resuming a session](#resuming-a-session).
- **Branching off a prior version by hand** -- don't chain `loadVersion` -> `getCode` -> modify -> `runAndSave`. A silent failure (blocked return value, stale buffer) can drop parts of the parent. Use [`forkVersion({index} | {id}, transformFn, label, assertions?)`](#forking-a-prior-version) instead -- it loads the parent's code server-side, applies your transform, validates, and saves atomically.
- **Passing a bare index or id instead of `{index}` / `{id}`** -- `loadVersion` and `forkVersion` take an object with exactly one of `{index: number}` or `{id: string}`, e.g. `loadVersion({index: 2})` or `loadVersion({id: "Kx3Pq9mA2wEr"})`. Bare `loadVersion(2)` will return `{error: "...target must be { index: number } or { id: string }..."}`.
- **Passing the wrong object shape to `setReferenceImages`, `setReferenceGeometry`, `query`, `runAndAssert`, etc.** -- the API rejects unknown keys and wrong-type values. See [Argument validation](#argument-validation).

## Argument validation

Every `window.partwright` method validates its arguments at runtime. If you pass the wrong type or an object with unexpected keys, the call fails fast with a descriptive error rather than silently accepting bad input.

**Conventions:**

- **Methods that return a value** (e.g. `runAndSave`, `loadVersion`, `query`, `importSession`, `setReferenceGeometry`, notes/session CRUD) return `{ error: "..." }` on a validation failure. The error string names the exact parameter and expected type, e.g. `"setReferenceImages(images).front must be a string, got null. See /ai.md#argument-validation"`.
- **Void setters** (`setCode`, `setClipZ`, `setReferenceImages`, `setView`, `setUnits`, `measureAt`, `measureBetween`, `probeRay`, `measurePoints`, `renameSession`) **throw** a `ValidationError`. Wrap calls in a try/catch if you want to handle failure rather than crash the console.
- **No coercion.** `setClipZ("5")` throws -- strings are not auto-converted to numbers. Pass the right type.
- **Unknown object keys are rejected.** `runAndAssert(code, { widthToDeep: [1,2] })` errors on the typo; it does not silently ignore it. Allowed keys are listed on each assertion/options interface.
- **Empty strings are rejected** by default for required string params (names, IDs, note text, code). Optional strings can be omitted but, if provided, must still be non-empty unless noted otherwise.

**Examples of what gets rejected:**

```js
partwright.navigateVersion('backward')            // ValidationError: direction must be one of: "prev" | "next"
partwright.setView('sketch')                      // ValidationError: tab must be one of: ...
partwright.measureAt([5])                         // ValidationError: measureAt(xy) must have exactly 2 elements
partwright.probeRay([0,0,0], [0, '1', 0])         // ValidationError: probeRay(direction)[1] must be a finite number
partwright.setReferenceImages({ fron: '...' })    // ValidationError: setReferenceImages(images).fron is not a recognized field
partwright.setReferenceGeometry(code, { opacity: 2 })  // returns { success: false, error: "... .opacity must be <= 1 ..." }
await partwright.runAndAssert(code, { minVolume: '1000' })  // returns { passed: false, failures: ["... .minVolume must be a finite number ..."] }
await partwright.runAndSave(code, 'v1', { boundsRatio: { widthToDeep: [1,2] } })  // typo caught: not a recognized field
await partwright.query({ sliceAt: 5 })            // returns { error: "... .sliceAt must be an array ..." }
```

When you see a validation error, fix the call -- don't pattern-match around it.

## How to use this tool

1. Navigate with `?view=ai` to see 4 isometric views (e.g. `/editor?view=ai`)
2. Use `window.partwright` in the browser console to interact programmatically
3. Call `partwright.help()` for a full method list, or `partwright.help('methodName')` for a specific method
4. Use `partwright.getGeometryData()` to read current geometry stats programmatically

## Console API -- window.partwright

<a id="console-api--windowmainifold"></a>

```js
partwright.run(code?)          // Run code, update views, return geometry stats
partwright.getGeometryData()   // Current stats (same as #geometry-data)
partwright.validate(code)      // Check code without rendering -> {valid, error?}
partwright.getCode()           // Read editor contents
partwright.setCode(code)       // Set editor contents (no auto-run)
partwright.sliceAtZ(z)         // Cross-section -> {polygons, svg, boundingBox, area}
partwright.getBoundingBox()    // -> {min:[x,y,z], max:[x,y,z]}
partwright.getModule()         // Raw manifold-3d WASM module
partwright.getActiveLanguage() // -> 'manifold-js' or 'scad'
await partwright.setActiveLanguage(lang) // Switch engine + editor mode ('manifold-js' | 'scad')
partwright.toggleClip(on?)     // Toggle 3D clipping plane -> {enabled, z, min, max}
partwright.setClipZ(z)         // Set clip height -> {enabled, z, min, max}
partwright.getClipState()      // -> {enabled, z, min, max}
await partwright.exportGLB()   // Download GLB (browser file dialog -- prefer exportGLBData() in agent flows)
partwright.exportSTL()         // Download STL ("                                       exportSTLData() ")
partwright.exportOBJ()         // Download OBJ ("                                       exportOBJData() ")
partwright.export3MF()         // Download 3MF ("                                       export3MFData() ")
// Agent-friendly variants -- bytes return inline, no file dialog. See /ai/file-io.md.
await partwright.exportGLBData()        // -> {filename, mimeType, base64, sizeBytes}
await partwright.exportSTLData()
await partwright.exportOBJData()        // text or base64 depending on whether colors are painted
await partwright.export3MFData()
await partwright.exportSessionData()    // -> {filename, mimeType, data, sizeBytes} (parsed JSON)
partwright.exportCodeData()             // -> {filename, mimeType, language, text, sizeBytes}
await partwright.importSessionData(parsedJson)         // -> {sessionId} or {error}
await partwright.importCodeData(code, language, name?) // -> {sessionId}
partwright.listRecentExports()                         // Recent Exports inbox
await partwright.getRecentExport(id)
partwright.downloadRecentExport(id)
partwright.clearRecentExports()

// Isolated execution -- test code without changing editor/viewport state
await partwright.runIsolated(code)       // -> {geometryData, thumbnail}
await partwright.runAndAssert(code, assertions) // -> {passed, failures?, stats}
await partwright.runAndExplain(code)     // -> {stats, components[], hints[]} (debug disconnects)
await partwright.modifyAndTest(patchFn, assertions?) // Modify current code + test in isolation
partwright.query({sliceAt?, decompose?, boundingBox?}) // Multi-query current geometry in one call
partwright.renderView({elevation?, azimuth?, ortho?, size?}) // Render from any angle -> data URL
partwright.sliceAtZVisual(z)            // Cross-section SVG at height z -> {svg, area, contours}
partwright.isRunning()                   // -> boolean (is code executing?)

// Reference images & annotations & color regions -- see subdocs:
//   /ai/reference-images.md, /ai/annotations.md, /ai/colors.md

partwright.setReferenceImages({front?, right?, back?, left?, top?, perspective?})
partwright.clearReferenceImages()
partwright.getReferenceImages()

partwright.paintRegion({point, normal, color, name?, tolerance?})
partwright.listRegions()
partwright.clearColors()

partwright.listAnnotations()
partwright.listTextAnnotations()
partwright.addTextAnnotation({anchor, text})
partwright.clearAnnotations()

// Sessions -- save/compare design iterations
await partwright.createSession(name?)    // -> {id, url, galleryUrl}
await partwright.runAndSave(code, label?, assertions?) // Assert+save in one call -> {passed?, geometry, version, diff, galleryUrl}
await partwright.createSessionWithVersions(name, [{code, label},...]) // Batch create
await partwright.saveVersion(label?)     // Save current state as version
await partwright.listVersions()          // -> [{id, index, label, timestamp, status}]
await partwright.loadVersion({index} | {id})  // Load version into editor -> {id, index, label, code, geometryData} or {error}
await partwright.forkVersion({index} | {id}, transformFn, label?, assertions?) // Load + modify + validate + save in one call
partwright.getGalleryUrl()               // -> URL for gallery view (human review)
partwright.getSessionUrl()               // -> URL for this session
await partwright.listSessions()          // -> [{id, name, updated}]
await partwright.openSession(id)         // Open existing session
await partwright.clearAllSessions()      // Delete all sessions & versions

// Notes -- track design context, decisions, and measurements
await partwright.addSessionNote(text)    // -> {id, text, timestamp}
await partwright.listSessionNotes()      // -> [{id, text, timestamp}, ...]
await partwright.updateSessionNote(noteId, text) // Edit a note
await partwright.deleteSessionNote(noteId)       // Remove a note

// Session context -- get everything in one call (for resuming sessions)
await partwright.getSessionContext()     // -> {session, versions[], notes[], currentVersion, versionCount, agentHints}
```

## Geometry data

**Preferred:** Use `partwright.getGeometryData()` to read current geometry stats programmatically.

**Fallback** (if `window.partwright` is not yet initialized): read `document.getElementById("geometry-data").textContent` -- it contains the same JSON.

```json
{
  "status": "ok",
  "vertexCount": 8, "triangleCount": 12,
  "boundingBox": { "x":[-5,5], "y":[-5,5], "z":[-5,5], "dimensions":[10,10,10] },
  "centroid": [0,0,0],
  "volume": 1000, "surfaceArea": 600,
  "genus": 0, "isManifold": true, "componentCount": 1,
  "crossSections": {
    "z25": {"z":-2.5,"area":100,"contours":1},
    "z50": {"z":0,"area":100,"contours":1},
    "z75": {"z":2.5,"area":100,"contours":1}
  },
  "executionTimeMs": 12,
  "codeHash": "a1b2c3d4"
}
```

On error: `{"status":"error","error":"...","executionTimeMs":2,"codeHash":"..."}`

### Common errors
- `Code must return a Manifold object` -- forgot `return` statement
- `function _Cylinder called with N arguments` -- wrong arg count
- Geometry looks wrong -- check `isManifold` and `componentCount` (failed booleans = extra components)

## Writing model code (manifold-js)

Code runs in a sandbox via `new Function('api', code)`. All transforms return new immutable Manifold instances -- chaining works.

```js
const { Manifold, CrossSection, Curves, setCircularSegments } = api;
// MUST return a Manifold object
```

**Sandbox environment:** The `api` object provides:
- `Manifold` and `CrossSection` -- the raw manifold-3d bindings
- `Curves` -- helpers for smooth/organic shapes (loft, sweep, bezier, arc, naca4, polyline with fillet, arbitrary-axis revolve, fillet/chamfer, pattern arrays). See **[/ai/curves.md](/ai/curves.md)**.
- `setCircularSegments`, `setMinCircularAngle`, `setMinCircularEdgeLength` -- global curve resolution defaults.

Standard JavaScript globals (`Math`, `Array`, `Object`, `JSON`, `Date`, `console`, etc.) are available. There is no DOM access, no `fetch`/network, no `require`/`import`, and no file I/O. Do not attempt to load external libraries or make HTTP requests in model code.

### Primitive origins and orientations

```
cube([x,y,z])         -> spans [0,0,0] to [x,y,z]. center=true -> centered at origin
sphere(r, n?)         -> centered at origin
cylinder(h,rLo,rHi?,n?) -> Z-axis, base z=0, top z=h. rHi=0 for cone
tetrahedron()          -> vertices at [1,1,1],[1,-1,-1],[-1,1,-1],[-1,-1,1]. Scale to size.
extrude(cs, h, nDiv?, twist?, scaleTop?, center?)
  -> along Z, z=0 to z=h. twist=degrees, scaleTop=number or [x,y] (0 for cone point)
revolve(cs, n?, degrees?)
  -> around Y axis, then remaps so result is Z-up.
    Profile X=radial distance, Y=height -> after revolve, Y becomes Z automatically.
    Only positive-X side used. degrees defaults to 360.
Segments guide: 6-8 low-poly, 32-48 smooth, 64+ high quality
```

### All constructors

```
Manifold: cube, sphere, cylinder, tetrahedron, extrude, revolve,
          union, difference, intersection, hull, compose, smooth, levelSet, ofMesh
CrossSection: square, circle, ofPolygons (CCW outer, CW holes),
              compose, union, difference, intersection, hull
Curves: arc, bezier, naca4, polyline, loft, sweep, revolveAxis,
        fillet, chamfer, ringCopy, linearCopy, mirrorCopy   (see /ai/curves.md)
```

### Manifold instance methods

```
Booleans:   .add(other)  .subtract(other)  .intersect(other)  .hull()
Transforms: .translate([x,y,z])  .rotate([rx,ry,rz]) (degrees, applied X->Y->Z)
            .scale(s) or .scale([x,y,z])  .mirror([nx,ny,nz]) (plane normal)
            .warp(fn)  .transform(mat4)
Mesh ops:   .refine(n)  .simplify()  .smoothOut(minSharpAngle?, minSmoothness?)
            .calculateNormals(idx, angle?)
Queries:    .volume()  .surfaceArea()  .genus()  .numVert()  .numTri()  .isEmpty()
            .boundingBox()  .status() (0=valid)  .decompose()
Slicing:    .slice(z)  .project()  .trimByPlane(n,off)  .splitByPlane(n,off)
Output:     .getMesh() -> {vertProperties, triVerts, numVert, numTri, numProp}
```

### CrossSection instance methods

```
2D->3D:      .extrude(h, nDiv?, twist?, scaleTop?, center?)  .revolve(n?, degrees?)
Transforms: .translate([x,y])  .rotate(degrees)  .scale(s or [x,y])
            .mirror([nx,ny])  .warp(fn)  .transform(mat3)
Booleans:   .add(other)  .subtract(other)  .intersect(other)  .hull()
Modify:     .offset(delta, joinType?, miterLimit?, segments?)  .simplify(epsilon?)
Queries:    .area()  .isEmpty()  .numVert()  .numContour()  .bounds()
Output:     .toPolygons()  .decompose()  .delete()
```

For smooth curve helpers (`loft`, `sweep`, `naca4`, `bezier`, `polyline` with fillet, etc.), see **[/ai/curves.md](/ai/curves.md)**.

## Writing OpenSCAD code

When the engine is set to `scad`, code is compiled by OpenSCAD (WASM) instead of running as JavaScript.

**Key differences from manifold-js:**
- **No `return` statement** -- SCAD uses implicit top-level geometry. Just write `cube(10);`, not `return Manifold.cube(...)`.
- **SCAD syntax** -- standard OpenSCAD: `module`, `function`, `for`, `let`, `if/else`, `use`, `include`.
- **Built-in primitives** -- `cube`, `sphere`, `cylinder`, `polyhedron`, `polygon`, `circle`, `square`, `text` (text not available -- fonts not loaded).
- **Transforms** -- `translate`, `rotate`, `scale`, `mirror`, `multmatrix`, `color`, `resize`.
- **Booleans** -- `union()`, `difference()`, `intersection()`, `hull()`, `minkowski()`.
- **Extrusion** -- `linear_extrude(height, twist, slices, scale)`, `rotate_extrude(angle)`.
- **2D rounding** -- `offset(r=...)` for rounded outlines; `minkowski() { shape; circle(r); }` for rounded interiors.
- **Curve resolution** -- `$fn=N` for explicit segments, or `$fa`/`$fs` for angle/length-based segmentation.
- **The `--enable=manifold` flag is set automatically** -- OpenSCAD uses the same manifold-3d boolean backend, so CSG results match the JS engine.

**BOSL2 library is bundled** -- start your file with `include <BOSL2/std.scad>` to unlock rounded cuboids, skin/loft, sweep, threaded rods, gears, attachables, and pattern distributors. See **[/ai/bosl2.md](/ai/bosl2.md)**. First BOSL2 run on a fresh page fetches ~4 MB of library source (one-time, then cached).

**Known limitations:**
- `text()` is not available (font data not loaded to save ~8MB).
- External `.scad` libraries (other than the bundled BOSL2) can't be `include`d -- there's no filesystem to read from.
- Each SCAD run creates a fresh WASM instance (~100-300ms overhead). For fast iteration, manifold-js is snappier.

**Example SCAD code (stock):**
```scad
// Cube with cylindrical hole
difference() {
  cube([10, 10, 10], center=true);
  cylinder(h=12, r=4, center=true, $fn=32);
}
```

**Example SCAD code (BOSL2):**
```scad
include <BOSL2/std.scad>
cuboid([40, 30, 20], rounding=3);     // all edges filleted
```

## Common pitfalls for boolean operations

### Always use volumetric overlap, never flush placement
Shapes that merely touch at a face will NOT union correctly -- they stay as separate components. Offset joining geometry by at least 0.5 units along the joining axis.
```js
// BAD -- merlon sits exactly on wall top, stays disconnected
merlon.translate([x, y, wallTopZ])

// GOOD -- merlon overlaps 0.5 units into wall body
merlon.translate([x, y, wallTopZ - 0.5])
```

### Spires on hollow shapes need a base wider than the inner void
A cone on top of a hollow cylinder/box floats inside the void unless its base radius exceeds the inner hollow radius, ensuring it intersects the wall material.
```js
// Keep outer half-width = 10, inner hollow half-width = 8
// Spire base radius must be > 8 to touch wall ring
Manifold.cylinder(spireH, 11, 0, 24).translate([0, 0, keepH - 0.5])
```

### Flag poles on cone tips need to start inside the cone body
A cylinder placed at the exact tip of a cone (where radius = 0) has nothing to union with. Start the pole 1-2 units below the tip so it overlaps solid cone geometry.

### Debugging disconnected components
When `componentCount > 1`, use `runAndExplain(code)` to identify which pieces are floating:
```js
const r = await partwright.runAndExplain(code);
// r.components = [
//   { index: 0, volume: 14800, centroid: [0, 0, 9], boundingBox: {...} },
//   { index: 1, volume: 12,    centroid: [29, 29, 26], boundingBox: {...} },
// ]
// r.hints = [
//   "1 tiny disconnected component(s) detected -- likely floating attachments...",
//   "Components 0 and 1 share a face or near-touch (gap: 0.00) -- need volumetric overlap"
// ]
```

For FDM print-safety pitfalls (sub-extrusion-width layers, taper traps), see **[/ai/print-safety.md](/ai/print-safety.md)**.

## Iteration workflow

### Testing without side effects

Use `runIsolated` to test code variations without changing the editor or viewport:
```js
const r = await partwright.runIsolated(code);
// r.geometryData = full stats (same schema as #geometry-data)
// r.thumbnail = data:image/png base64 string (4 isometric views)
```

### Assertions -- structured validation

Check geometry against expectations in one call:
```js
const r = await partwright.runAndAssert(code, {
  minVolume: 1000,      // volume bounds
  maxVolume: 50000,
  isManifold: true,     // must be valid manifold
  maxComponents: 1,     // detect failed booleans
  genus: 0,             // exact topological genus (0 = solid, N = N holes)
  minGenus: 1,          // genus range -- useful when exact count is unpredictable
  maxGenus: 20,
  minBounds: [10,10,5], // minimum bounding box dimensions [X,Y,Z]
  maxBounds: [50,50,30],
  minTriangles: 100,    // mesh complexity bounds
  maxTriangles: 50000,
  boundsRatio: { widthToDepth: [1.2, 1.8], widthToHeight: [1.5, 2.5] },  // proportion ranges
  notes: "Design rationale or context for this version",  // optional: attached to saved version
});
// r.passed = true/false
// r.failures = ["volume 500.0 < minVolume 1000"] (only if failed)
// r.stats = full geometry stats
```

### Assert + save in one call

`runAndSave` accepts optional assertions. If provided, validates in isolation first -- fails fast
without saving if assertions don't pass. On success, saves the version and returns stat diff:
```js
const r = await partwright.runAndSave(code, "v2 - added towers", {
  isManifold: true, maxComponents: 1
});
// If assertions fail: r.passed = false, r.failures = [...], version NOT saved
// If assertions pass (or no assertions given):
// r.passed       = true (only present when assertions provided)
// r.geometry     = full geometry stats
// r.version      = { id, index, label }
// r.diff         = { volume: { from, to, delta }, componentCount: ..., ... }
// r.galleryUrl   = gallery URL for human review
```

### Forking a prior version

When iterating on a design, the common flow is *load a previous version, tweak it, save as a new version*.
Doing that across separate `loadVersion` -> `getCode` -> modify -> `runAndSave` calls is fragile: if any
step fails silently (wrong arg type, a client-side content filter on `getCode`, etc.) you can end up saving
a regression without noticing. `forkVersion` collapses the whole chain into one server-side call:

```js
const r = await partwright.forkVersion(
  { index: 11 },                       // or { id: "Kx3Pq9mA2wEr" } from listVersions()
  code => code.replace('towerH = 28', 'towerH = 35'),
  "v11a - taller towers",              // label for the new version
  { isManifold: true, maxComponents: 1 } // optional assertions (validated before saving)
);
// On success:
//   r.passed       = true (only when assertions provided)
//   r.parent       = { id, index, label } of the version you forked from
//   r.geometry     = full geometry stats
//   r.version      = { id, index, label } of the newly saved version
//   r.diff         = stat diff vs. the previous current version
//   r.galleryUrl   = gallery URL for human review
// On failure:
//   r.error        = "No version found with index ..." / "transformFn threw: ..." / etc.
//   r.passed=false + r.failures=[...] if assertions didn't pass (nothing saved)
```

`target` is an object with exactly one of `{ index }` (numeric, 1-based) or `{ id }` (string from
`listVersions()[].id`). The two are never mixed, so there's no ambiguity about which field is being
looked up. This is the recommended way to build parallel branches (v11a, v11b, ...) off a shared
parent without a load/read/modify/save round-trip chain.

### Modify and test

Modify current editor code with a transform function and test the result without committing:
```js
const r = await partwright.modifyAndTest(
  code => code.replace('towerH = 28', 'towerH = 35'),
  { isManifold: true, maxComponents: 1 }
);
// r.modifiedCode = the transformed code string
// r.stats        = geometry stats of the modified code
// r.passed       = true/false (only if assertions given)
// r.failures     = [...] (only if failed)
```

### Multi-query current geometry

Query multiple properties of the already-computed geometry in a single call:
```js
const r = partwright.query({
  sliceAt: [5, 10, 15, 20],  // cross-sections at these Z heights
  decompose: true,             // component breakdown
  boundingBox: true,           // bounding box
});
// r.slices     = { z5: {area, contours, ...}, z10: {...}, ... }
// r.components = [{ index, volume, centroid, boundingBox }, ...]
// r.boundingBox = { min: [...], max: [...] }
// r.stats      = current geometry-data stats
```

### Batch session creation

Create a complete session with multiple versions in one call:
```js
const r = await partwright.createSessionWithVersions("Castle", [
  { code: v1Code, label: "v1 - walls" },
  { code: v2Code, label: "v2 - towers" },
  { code: v3Code, label: "v3 - gate" },
]);
// r.session = {id, name}
// r.versions = [{version, geometry}, ...]
// r.galleryUrl = "/editor?session=abc&gallery"
```

### Session notes -- tracking design context

Use session notes to build a persistent record of the design story. This enables any agent (or human) resuming the session later to understand what happened and why.

**When to log notes:**
- Before first version: log the user's requirements and constraints
- On each version: include rationale in the label and optional `notes` field
- When the user gives feedback: log it as a note, then save the next version
- On key decisions: log dimensions, materials, constraints, tradeoffs
- On failed attempts: log what didn't work and why

**Prefix conventions** (so notes are scannable):
```js
await partwright.addSessionNote("[REQUIREMENT] 5.5x5.5x36in boards, snap-on C-channel, screw holes");
await partwright.addSessionNote("[FEEDBACK] User: groove looks too shallow, wants full tongue insertion");
await partwright.addSessionNote("[DECISION] Omitted right wall on end pieces for clearance");
await partwright.addSessionNote("[MEASUREMENT] Tongue width = outerW - 2*wallT = 133.7mm");
await partwright.addSessionNote("[ATTEMPT] v2 tried 3mm walls but too flimsy. Increased to 5mm in v3");
await partwright.addSessionNote("[TODO] Add chamfer to bottom edge for easier print removal");
```

Version-level notes go in the `runAndSave` assertions object:
```js
await partwright.runAndSave(code, "v2 - widened tongue per feedback", {
  isManifold: true,
  notes: "Changed tabW from 20mm to outerW - 2*wallT per user request"
});
```

### Resuming a session

When opening a session you haven't worked on (or returning after time away), **always call `getSessionContext()` first**:
```js
await partwright.openSession(sessionId);
const ctx = await partwright.getSessionContext();
// ctx.session    -- {id, name, created, updated}
// ctx.versions   -- [{index, label, timestamp, notes?, geometrySummary: {volume, boundingBox, ...}}]
// ctx.notes      -- [{id, text, timestamp}]  (all session notes)
// ctx.currentVersion -- {index, label}
// ctx.versionCount
// ctx.agentHints -- {apiDocsUrl, recommendedEntrypoint, codeMustReturnManifold, recentErrors}
//   recentErrors: last 5 validation errors from this page session (helps avoid repeating mistakes)
```

Read the notes and version history before making changes. The notes tell you:
- What the user originally asked for (`[REQUIREMENT]` notes)
- What was tried and why (`[DECISION]` and `[ATTEMPT]` notes)
- What feedback the user gave (`[FEEDBACK]` notes)
- What measurements or constraints matter (`[MEASUREMENT]` notes)
- What still needs to be done (`[TODO]` notes)

### Recommended iteration pattern

1. Write initial code, assert+save in one call: `runAndSave(code, "v1 - base", {isManifold: true, maxComponents: 1})`
2. **Visually verify** -- switch to Elevations tab (`?view=elevations`) and screenshot. Check Front/Side views.
3. Modify code, test with `modifyAndTest(patchFn)` or `runIsolated(code)` -- no side effects
4. When satisfied, save: `runAndSave(modifiedCode, "v2 - improvements", assertions)` -- check the diff
5. Use `query({sliceAt: [...], decompose: true})` for follow-up inspection without re-running
6. Repeat. Gallery URL is in `#geometry-data` or the `runAndSave` return value.

## Visual verification

**CRITICAL: Stats alone cannot catch visual defects.** A roof can be mangled, a spire twisted,
or proportions wrong -- all while volume, componentCount, and genus look correct. After every
structural change:

1. **Check the Elevations tab** (`?view=elevations`) -- shows Front, Right, Back, Left, Top views.
   Side elevations immediately reveal roof profiles, wall alignment, and symmetry issues that
   isometric views can hide.
2. **Use `renderView()` for specific angles:**
```js
partwright.renderView({ elevation: 0, azimuth: 0, ortho: true })   // front elevation
partwright.renderView({ elevation: 0, azimuth: 90, ortho: true })  // right side elevation
partwright.renderView({ elevation: 90, ortho: true })               // top-down plan view
partwright.renderView({ elevation: 30, azimuth: 315 })              // isometric (default)
```
3. **Use `sliceAtZVisual(z)` for cross-section thumbnails:**
```js
const s = partwright.sliceAtZVisual(10);  // returns {svg, area, contours}
// svg = visual rendering of the cross-section profile at z=10
```
4. **Feature-specific checks:**
   - Added a roof? Check side elevation -- should be a clean triangle/gable profile.
   - Cut a door/window? Check front elevation -- opening should be visible.
   - Added a tower? Check top-down -- should be circular, properly positioned.
   - Made something hollow? Slice at mid-height -- should show wall ring, not solid fill.

### View tabs

- `?view=ai` -- 4 isometric views (alternating cube corners)
- `?view=elevations` -- Front, Right, Back, Left, Top orthographic + 1 isometric (6 views)
- Use Elevations for shape verification, AI Views for overall appearance.

## Stat-based verification

1. Read `#geometry-data` -- check `status:"ok"`, volume, dimensions, componentCount, isManifold
2. Check `crossSections` quartiles (z25/z50/z75) for expected profile
3. Use `partwright.sliceAtZ(z)` for specific heights
4. Use `partwright.validate(code)` for quick syntax checks
5. Use `partwright.runAndAssert(code, assertions)` for structured validation
