# Partwright -- AI Agent Instructions

Partwright is a browser-based parametric CAD tool with two modeling engines: **manifold-js** (default, JavaScript DSL with manifold-3d API) and **OpenSCAD** (SCAD language via WASM). You write code that constructs 3D geometry, which renders live. All interaction is via the `window.partwright` programmatic API -- do not drive the app through clicks or keystrokes. `window.mainifold` remains available as a legacy alias for older prompts.

**Coordinate system:** Right-handed, Z-up. XY plane is the ground. Units are arbitrary.

## Contents

- [Before you start](#before-you-start)
- [Choosing an engine](#choosing-an-engine)
- [Common agent mistakes](#common-agent-mistakes)
- [Argument validation](#argument-validation)
- [Console API -- window.partwright](#console-api--windowpartwright)
- [Geometry data](#geometry-data)
- [Writing model code](#writing-model-code)
- [Writing OpenSCAD code](#writing-openscad-code)
- [Common pitfalls for boolean operations](#common-pitfalls-for-boolean-operations)
- [Print-safe geometry](#print-safe-geometry)
- [Color regions](#color-regions)
- [Common gotchas](#common-gotchas)
- [AI-friendly file I/O](#ai-friendly-file-io)
- [Images](#images)
- [Photo-to-model workflow](#photo-to-model-workflow) (optional tooling)
- [Iteration workflow](#iteration-workflow)
- [Visual verification](#visual-verification)
- [Annotations](#annotations)
- [Stat-based verification](#stat-based-verification)
- [Resuming a session](#resuming-a-session)

## Before you start

1. **Use `window.partwright`** -- that's the programmatic API. Do NOT drive the app with clicks, keystrokes, or DOM manipulation.
2. **Pick your engine:** manifold-js (default) or OpenSCAD. See [Choosing an engine](#choosing-an-engine).
3. **manifold-js code must end with `return manifoldObject;`** -- a bare trailing expression won't work. OpenSCAD code uses standard SCAD syntax (no `return`).
4. **Use `runAndSave(code, label, {isManifold: true, maxComponents: 1})`** to validate and commit a version.
5. **Verify visually after structural changes.** Stats alone can't catch warped roofs, twisted spires, or wrong proportions. Call `renderView({ortho: true})` from a few angles, or open the Elevations tab. See [Visual verification](#visual-verification).
6. **Log decisions with `addSessionNote("[PREFIX] ...")`** -- prefixes: `[REQUIREMENT]`, `[DECISION]`, `[FEEDBACK]`, `[MEASUREMENT]`, `[ATTEMPT]`, `[TODO]`.
7. **`await` every async method.** `createSession`, `runAndSave`, `runAndAssert`, `runIsolated`, `runAndExplain`, `loadVersion`, `forkVersion`, `getSessionContext`, every `*Data()` export, every notes/sessions call returns a Promise. Without `await` you'll inspect the Promise object instead of the result and silently work from stale or empty data.

## Choosing an engine

Partwright supports two modeling engines. Pick whichever is best for the task:

| | **manifold-js** (default) | **OpenSCAD** (SCAD) |
|---|---|---|
| Language | JavaScript | OpenSCAD `.scad` |
| Best for | Algorithmic/parametric geometry, complex math, programmatic iteration | Standard OpenSCAD idioms, porting existing `.scad` files, users who think in CSG |
| Code style | `return Manifold.cube([10,10,10], true);` | `cube([10,10,10], center=true);` |
| Strengths | Fast execution, rich JS ecosystem, direct Manifold API access | Familiar to OpenSCAD users, large body of existing `.scad` code online |
| Limitations | Must learn the manifold-3d API | No `text()` (fonts not loaded), no `use<>`/`include<>` with external libraries, slower (fresh WASM instance per run) |

### Switching engines

```js
// Check current engine
partwright.getActiveLanguage()        // -> 'manifold-js' or 'scad'

// Switch engine (also updates the code editor's syntax highlighting)
await partwright.setActiveLanguage('scad')
await partwright.setActiveLanguage('manifold-js')

// Run code with a specific engine (one-shot, doesn't change active engine)
await partwright.run(scadCode)        // uses active engine
// To force a specific engine, switch first then run
```

Selecting a SCAD example from the toolbar dropdown auto-switches to OpenSCAD mode. Session versions remember which engine was used and restore it when loaded.

## Common agent mistakes

- **Driving the UI with clicks/keystrokes** -- CodeMirror's auto-close-brackets will corrupt your code. Use `partwright.setCode()` and `partwright.run()` instead.
- **Forgetting `return`** -- code runs in `new Function()`, so a trailing expression is NOT automatically returned. You must write `return Manifold.cube(...)`.
- **Skipping sessions** -- always create a session (`createSession`) and save versions (`runAndSave`) so the user can review your work in the gallery.
- **Skipping visual verification** -- stats alone can't catch visual defects. After structural changes, screenshot the Elevations tab or use `renderView()`.
- **Flush boolean placement** -- shapes must overlap by at least 0.5 units to union correctly. Merely touching at a face produces disconnected components.
- **Tapering to a near-point on printed geometry** -- `scaleTop=[0.01, 0.01]` or chamfers that collapse the top to sub-millimeter area look fine in `geometry-data` but FDM slicers silently drop sub-extrusion-width layers, so the cap disappears on the print. See [Print-safe geometry](#print-safe-geometry).
- **Not reading session context before modifying** -- when opening an existing session, always call `getSessionContext()` first and read the notes/version history before making changes. See [Resuming a session](#resuming-a-session).
- **Branching off a prior version by hand** -- don't chain `loadVersion` -> `getCode` -> modify -> `runAndSave`. A silent failure (blocked return value, stale buffer) can drop parts of the parent. Use [`forkVersion({index} | {id}, transformFn, label, assertions?)`](#forking-a-prior-version) instead -- it loads the parent's code server-side, applies your transform, validates, and saves atomically.
- **Passing a bare index or id instead of `{index}` / `{id}`** -- `loadVersion` and `forkVersion` take an object with exactly one of `{index: number}` or `{id: string}`, e.g. `loadVersion({index: 2})` or `loadVersion({id: "Kx3Pq9mA2wEr"})`. Bare `loadVersion(2)` will return `{error: "...target must be { index: number } or { id: string }..."}`.
- **Passing the wrong object shape to `setImages`, `setReferenceGeometry`, `query`, `runAndAssert`, etc.** -- the API rejects unknown keys and wrong-type values. See [Argument validation](#argument-validation).
- **Doing `setCode` then `run` when you meant `runAndSave`.** `setCode` doesn't auto-run, `run` doesn't save and doesn't validate, and the gallery won't see the version. `runAndSave(code, label, assertions)` does all three atomically -- prefer it for committed iterations. See also [`runAndSave` is for committed iterations; `runIsolated` is for sanity checks](#runandsave-is-for-committed-iterations-runisolated-is-for-sanity-checks).

## Argument validation

Every `window.partwright` method validates its arguments at runtime. If you pass the wrong type or an object with unexpected keys, the call fails fast with a descriptive error rather than silently accepting bad input.

**Conventions:**

- **Methods that return a value** (e.g. `runAndSave`, `loadVersion`, `query`, `importSession`, `setReferenceGeometry`, notes/session CRUD) return `{ error: "..." }` on a validation failure. The error string names the exact parameter and expected type, e.g. `"setImages(images)[0].src must be a non-empty string, got "". See /ai.md#argument-validation"`.
- **Void setters** (`setCode`, `setClipZ`, `setImages`, `setView`, `setUnits`, `measureAt`, `measureBetween`, `probeRay`, `measurePoints`, `renameSession`) **throw** a `ValidationError`. Wrap calls in a try/catch if you want to handle failure rather than crash the console.
- **No coercion.** `setClipZ("5")` throws -- strings are not auto-converted to numbers. Pass the right type.
- **Unknown object keys are rejected.** `runAndAssert(code, { widthToDeep: [1,2] })` errors on the typo; it does not silently ignore it. Allowed keys are listed on each assertion/options interface.
- **Empty strings are rejected** by default for required string params (names, IDs, note text, code). Optional strings can be omitted but, if provided, must still be non-empty unless noted otherwise.

**Examples of what gets rejected:**

```js
partwright.navigateVersion('backward')            // ValidationError: direction must be one of: "prev" | "next"
partwright.setView('sketch')                      // ValidationError: tab must be one of: ...
partwright.measureAt([5])                         // ValidationError: measureAt(xy) must have exactly 2 elements
partwright.probeRay([0,0,0], [0, '1', 0])         // ValidationError: probeRay(direction)[1] must be a finite number
partwright.setImages([{ src: '' }])  // ValidationError: setImages(images)[0].src must be a non-empty string, got ""
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

// Viewport controls
partwright.setGridVisible(on?)       // Show/hide grid plane (omit to toggle) -> boolean
partwright.isGridVisible()           // Whether grid plane is visible
partwright.setDimensionsVisible(on?) // Show/hide bounding box dimensions (omit to toggle) -> boolean
partwright.areDimensionsVisible()    // Whether dimensions overlay is visible
partwright.setOrbitLock(on?)         // Lock/unlock camera rotation (omit to toggle) -> boolean
partwright.isOrbitLocked()           // Whether camera orbit is locked
partwright.setTheme('dark'|'light')  // Set color theme
partwright.getTheme()                // -> 'dark' or 'light'
partwright.setAutoRun(enabled)       // Enable/disable auto-render on code edit
partwright.isAutoRunEnabled()        // Whether auto-run is active
await partwright.exportGLB()   // Download GLB (browser file dialog -- prefer exportGLBData() in agent flows)
partwright.exportSTL()         // Download STL ("                                       exportSTLData() ")
partwright.exportOBJ()         // Download OBJ ("                                       exportOBJData() ")
partwright.export3MF()         // Download 3MF ("                                       export3MFData() ")
// Agent-friendly variants -- bytes return inline, no file dialog. See AI-friendly file I/O.
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
await partwright.runIsolated(code, view?)  // -> {geometryData, thumbnail}. Default thumbnail is 4-iso composite; pass `view` ({elevation, azimuth, ortho, size}) for a single-angle preview.
await partwright.runAndAssert(code, assertions) // -> {passed, failures?, stats}
await partwright.runAndExplain(code)     // -> {stats, components[], hints[]} (debug disconnects)
await partwright.modifyAndTest(patchFn, assertions?) // Modify current code + test in isolation
partwright.query({sliceAt?, decompose?, boundingBox?}) // Multi-query current geometry in one call
partwright.renderView({elevation?, azimuth?, ortho?, size?})  // Render ONE angle -> data URL
await partwright.renderViews({views?: 'auto'|'tri'|'all', size?})  // multi-angle labeled composite -> data URL; 'auto' (default) picks angles by aspect ratio; prefer for verification
partwright.sliceAtZVisual(z)            // Cross-section SVG at height z -> {svg, area, contours}
partwright.isRunning()                   // -> boolean (is code executing?)

// Images -- attach photos to compare model against
partwright.setImages([{src, label?}, ...])  // replace all; src is data URL or http(s) URL; label is an optional caption
partwright.addImage({src, label?})          // append one; returns {id, src, label?}
partwright.removeImage(id)                  // remove by id; returns true if removed
partwright.clearImages()
partwright.getImages()                      // -> [{id, src, label?}, ...]

// Sessions -- save/compare design iterations
await partwright.createSession(name?)    // -> {id, url, galleryUrl}
await partwright.runAndSave(code, label?, assertions?) // Assert+save in one call -> {passed?, geometry, version, diff, galleryUrl}
await partwright.createSessionWithVersions(name, [{code, label},...]) // Batch create
await partwright.saveVersion(label?)     // Save current state as version
await partwright.listVersions()          // -> [{id, index, label, timestamp, status}]
await partwright.loadVersion({index} | {id})  // Load version into editor -> {id, index, label, code, geometryData, labelsAvailable, labelCount} or {error}
await partwright.forkVersion({index} | {id}, transformFn, label?, assertions?) // Load + modify + validate + save in one call
partwright.getGalleryUrl()               // -> URL for gallery view (human review)
partwright.getSessionUrl()               // -> URL for this session
await partwright.listSessions()          // -> [{id, name, updated}]
await partwright.openSession(id)         // Open existing session
await partwright.clearAllSessions()      // Delete all sessions & versions

// Color regions -- tag face regions with a color (see #color-regions)
partwright.probePixel({pixel, view})                                      // "click in your perception": pixel in a rendered view -> {point, normal, distance, triangleId} or null
partwright.paintConnected({seed: {point, normal?}, maxDeviationDeg?, color, name?}) // BFS-flood from seed gated by seed-normal deviation (not adjacent). For organic / smooth meshes paintRegion can't handle.
partwright.paintRegion({point, normal, color, name?, tolerance?})         // bucket: coplanar flood-fill -> {id, name, triangles} or {error, nearest?}
partwright.paintNearestRegion({point, color, searchRadius?, name?, tolerance?}) // snap seed to nearest face, then flood-fill -> {id, name, triangles, snappedTo} or {error}
partwright.paintNear({point, radius, normalCone?, topOnly?, coverageMode?, maxTriangleArea?, color, name?})    // sphere: paint triangles within radius -> {id, name, triangles, bbox, centroid} or {error}
partwright.paintInBox({box, normalCone?, topOnly?, coverageMode?, maxTriangleArea?, color, name?})             // box: paint triangles inside an AABB -> {id, name, triangles, bbox, centroid} or {error}
partwright.paintFaces({triangleIds, color, name?})                        // brush: paint specific triangle indices -> {id, name, triangles} or {error}
partwright.paintSlab({axis|normal, offset, thickness, coverageMode?, maxTriangleArea?, color, name?})      // slab: paint a planar range -> {id, name, triangles} or {error}
partwright.paintPreview({box?|point+radius?|triangleIds?, normalCone?, coverageMode?, maxTriangleArea?, withImage?, view?}) // dry-run -> {triangleCount, bbox, centroid, totalArea, largestTriangleArea, [thumbnail]}
partwright.paintExplain({region, withImage?, view?}) // diagnose committed region -> {triangleCount, area, largestTriangleArea, bbox, centroid, normalHistogram, [thumbnail]}
partwright.assertPaint({region, expectedTriangleCount?, expectedBoundingBox?, expectedCentroid?}) // verify a region -> {passed, failures?}
partwright.findFaces({box?, normal?, normalTolerance?, color?, region?, maxResults?}) // query triangle ids by geometry/color -> {triangleIds, count, matched, truncated}
partwright.getMesh()                     // -> {numVert, numTri, vertices, triangles, normals, centroids, boundingBox} (typed arrays)
partwright.getMeshSummary({tolerance?, minTriangles?, maxTrianglesPerGroup?, maxGroups?, withinBox?}?) // -> {groups[{id, normal, centroid, area, triangleCount, bbox, triangleIds}], totalTriangles, groupCount, tolerance, unfiltered?}
partwright.listRegions()                 // -> [{id, name, color, source, triangles, order, bbox, centroid}, ...]
partwright.listComponents()              // -> {count, components: [{index, centroid, boundingBox, volume, surfaceArea}]} -- per-piece bbox for unioned models
partwright.paintComponent({index, color, name?, topOnly?}) // One-call: paint the Nth boolean-distinct piece
partwright.listLabels()                  // -> {count, labels: [{name, triangleCount, bbox, centroid}]} -- labels registered via api.label(shape, name) in the current run
partwright.paintByLabel({label, color, name?}) // Paint a labelled feature by name. Exact, survives boolean ops. manifold-js only.
partwright.paintByLabels([{label, color, name?}, ...]) // Batch sibling. N features in one call -> {results, failed}. Coalesces viewport refresh under one rAF.
partwright.getFeatureCentroids({maxGroups?, withinBox?}?)  // Lightweight planning: centroids + normals + bbox per face group, NO triangleIds
partwright.paintPreview({box?|point+radius?|triangleIds?, normalCone?, coverageMode?, maxTriangleArea?, withImage?, view?}) // DRY-RUN -> {triangleCount, bbox, centroid, totalArea, largestTriangleArea, [thumbnail]}
partwright.undoLastPaint()               // Reverse the SINGLE most recent paint op -> {undone, id, ...}
partwright.redoLastPaint()               // Reapply the most recently undone paint -> {redone, id, ...}
partwright.removeRegion(id)              // Delete ONE region by id from listRegions()
partwright.clearColors()                 // Remove ALL regions (destructive — prefer undoLastPaint/removeRegion for fixing single mistakes)

// Notes -- track design context, decisions, and measurements
await partwright.addSessionNote(text)    // -> {id, text, timestamp}
await partwright.listSessionNotes()      // -> [{id, text, timestamp}, ...]
await partwright.updateSessionNote(noteId, text) // Edit a note
await partwright.deleteSessionNote(noteId)       // Remove a note

// Session context -- get everything in one call (for resuming sessions)
await partwright.getSessionContext()     // -> {session, versions[], notes[], currentVersion, versionCount, agentHints}
// agentHints: {apiDocsUrl, recommendedEntrypoint, codeMustReturnManifold, recentErrors[]}
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

## Writing model code

Code runs in a sandbox via `new Function('api', code)`. All transforms return new immutable Manifold instances -- chaining works.

```js
const { Manifold, CrossSection, setCircularSegments } = api;
// MUST return a Manifold object
```

**Sandbox environment:** The `api` object provides `Manifold`, `CrossSection`, and `setCircularSegments`. Standard JavaScript globals (`Math`, `Array`, `Object`, `JSON`, `Date`, `console`, etc.) are available. There is no DOM access, no `fetch`/network, no `require`/`import`, and no file I/O. Do not attempt to load external libraries or make HTTP requests in model code.

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

**Default segment count:** Partwright seeds `setCircularSegments()` from the user's Modeling Quality preset (gear icon in the toolbar) before each run. The default preset is **Highest** (128 segments), so curves render smooth out of the box without any explicit configuration. Users can drop to Low/Medium/High in the settings modal if they prefer faster renders. Your code can still call `setCircularSegments(n)` or pass an explicit segments argument to a primitive to override on a per-script or per-call basis.

### All constructors

```
Manifold: cube, sphere, cylinder, tetrahedron, extrude, revolve,
          union, difference, intersection, hull, compose, smooth, levelSet, ofMesh
CrossSection: square, circle, ofPolygons (CCW outer, CW holes),
              compose, union, difference, intersection, hull
```

### Manifold instance methods

```
Booleans:   .add(other)  .subtract(other)  .intersect(other)  .hull()
Transforms: .translate([x,y,z])  .rotate([rx,ry,rz]) (degrees, applied X->Y->Z)
            .scale(s) or .scale([x,y,z])  .mirror([nx,ny,nz]) (plane normal)
            .warp(fn)  .transform(mat4x3)
Mesh ops:   .refine(n)  .simplify()  .smoothOut()  .calculateNormals(idx, angle?)
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

## Writing OpenSCAD code

When the engine is set to `scad`, code is compiled by OpenSCAD (WASM) instead of running as JavaScript.

**Key differences from manifold-js:**
- **No `return` statement** -- SCAD uses implicit top-level geometry. Just write `cube(10);`, not `return Manifold.cube(...)`.
- **SCAD syntax** -- standard OpenSCAD: `module`, `function`, `for`, `let`, `if/else`, `use`, `include`.
- **Built-in primitives** -- `cube`, `sphere`, `cylinder`, `polyhedron`, `polygon`, `circle`, `square`, `text` (text not available -- fonts not loaded).
- **Transforms** -- `translate`, `rotate`, `scale`, `mirror`, `multmatrix`, `color`, `resize`.
- **Booleans** -- `union()`, `difference()`, `intersection()`, `hull()`, `minkowski()`.
- **Extrusion** -- `linear_extrude(height, twist, slices, scale)`, `rotate_extrude(angle)`.
- **The `--enable=manifold` flag is set automatically** -- OpenSCAD uses the same manifold-3d boolean backend, so CSG results match the JS engine.

**Known limitations (v1):**
- `text()` is not available (font data not loaded to save ~8MB).
- `use <...>` / `include <...>` with external `.scad` libraries does not work (no external file system). Inline all modules.
- BOSL2 and MCAD libraries are not available.
- Each SCAD run creates a fresh WASM instance (~100-300ms overhead). For fast iteration, manifold-js is snappier.

**Example SCAD code:**
```scad
// Cube with cylindrical hole
difference() {
  cube([10, 10, 10], center=true);
  cylinder(h=12, r=4, center=true, $fn=32);
}
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

## Print-safe geometry

If the output will be 3D-printed (FDM/FFF), geometry thinner than the nozzle's extrusion width is silently dropped by slicers. This is a real class of bug that passes every `geometry-data` check (volume, `componentCount`, `genus`, `isManifold` all correct) but renders the top of the model as "missing" on the physical print.

### The classic trap: `scaleTop` near zero

An extrusion with `scaleTop=[0.01, 0.01]` (or any small fraction) tapers linearly to a near-point. The last slices have areas well under 1 mm², which most slicers drop at typical nozzle widths. Example failure mode observed in the wild: a hook band extruded with `scaleTop=[0.01, 0.01]` had layer areas of 118 mm² at z=5.8 collapsing to 0.07 mm² at z=6.55 -- the slicer dropped every layer under ~0.4 mm² and the cap disappeared.

```js
// BAD -- lead-in chamfer via scaleTop=0, tapers to sub-extrusion-width
ring.extrude(6, 4, 0, [0.01, 0.01])

// GOOD -- explicit 45deg chamfer that stops at a flat-top ring of finite width.
// Stack a full-width body + a chamfer frustum whose smaller radius is still >= wall thickness.
const body    = ringCS.extrude(bodyH);
const chamfer = ringCS.extrude(chamferH, 1, 0, outerFrac)  // outerFrac chosen so top width >= wallT
                    .translate([0, 0, bodyH]);
const result  = body.add(chamfer);
```

### Rules of thumb (assume ~0.4 mm nozzle, ~0.2 mm layer height)

- **Minimum wall / feature thickness:** `>= 0.4 mm` (one nozzle width). Prefer `>= 0.8 mm` for anything load-bearing.
- **Minimum cross-sectional area on any printed layer:** `>= ~0.4 mm²` (roughly nozzle width x 1 mm of extruded line).
- **Never taper to a true point on a printed face.** Chamfers, drafts, and lead-ins must land on a flat plateau wider than the nozzle.
- **Decorative points** (spires, finials) either need to be printed as a separate top piece, or accept that the tip will be missing up to the slicer's minimum width.

### Catch this before the user does

After any change that uses `scaleTop` < 1, tapers via `hull`, or brings two surfaces toward a vanishing edge, dense-sample near `zMax` and flag sub-extrusion-width layers:

```js
const bb = partwright.getBoundingBox();
const zMax = bb.max[2];
const layerH = 0.2;
const minArea = 0.4;  // mm^2, assuming ~0.4mm nozzle

const problems = [];
for (let z = zMax - 2; z <= zMax - layerH; z += layerH) {
  const s = partwright.sliceAtZ(z);
  if (s && s.area > 0 && s.area < minArea) {
    problems.push({ z: +z.toFixed(2), area: +s.area.toFixed(3) });
  }
}
if (problems.length) {
  console.warn("Sub-extrusion-width layers detected:", problems);
}
```

Or batch it with `query({ sliceAt: [zMax - 2, zMax - 1.8, ..., zMax - 0.2] })` and check each slice's `area`. If any layer below the actual geometry end falls under threshold, redesign the top to terminate with a flat plateau instead of a near-point taper.

## Color regions

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

partwright.listRegions()    // [{ id, name, color, source, triangles, order }, ...]
partwright.undoLastPaint()  // reverse just the most recent paint op
partwright.removeRegion(id) // delete one region by id (older mistake)
partwright.clearColors()    // remove ALL regions — destructive, prefer the two above for single mistakes
```

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
// hit = { point: [x, y, z], normal: [nx, ny, nz], distance, triangleId } or null

// 3. Flood from the seed, gated by 30° deviation from the seed normal.
//    paintConnected stays on the feature where paintRegion (bimodal
//    on smooth meshes) cannot.
if (hit) {
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

**Editor lock.** When color regions exist, the editor is locked (the model can't be re-run, because new geometry would invalidate the saved triangle indices). To edit code, the user clicks "Unlock to edit" in the UI. Agents that need to iterate on the geometry should call `clearColors()` first, or fork a new uncolored version with `forkVersion`.

**Saving a colored version.** Calling `saveVersion(label)` after painting *will* persist the regions onto a new version — the dedupe check considers code, annotations, and color regions together. If nothing has changed, `saveVersion()` returns `{ skipped: true, reason: "..." }` instead of `null`, so a no-op is visible. If you want to be sure a save happened, check the return shape: `{ id, index, label }` on success, `{ skipped }` on no-op, `{ error }` if no session is open.

**Export behavior.**
- `exportGLB()` -- vertex colors flow through automatically.
- `export3MF()` -- regions become `<basematerials>` entries with per-triangle `pid` attributes (compatible with PrusaSlicer / Bambu Studio multi-material slicing).
- `exportSTL()` and `exportOBJ()` -- formats don't carry color, so colors are dropped.

## Common gotchas

These are the traps that previously cost an agent multiple turns of trial and error. Read once, save the next agent the same loop.

### `paintRegion` flood-fill is bimodal on smooth surfaces

On capsules, hulled spheres, and other smooth (no-edge) geometry, the bend angle between adjacent triangles is roughly the angular subdivision (e.g. 7.5° for a 48-segment cylinder, ≈ cos 7.5° = 0.991). Any tolerance > 0.991 paints almost nothing; any tolerance ≤ 0.99 paints almost everything. There is no useful middle.

**Fix:** use `paintNear` (sphere selector) or `paintInBox` (AABB selector) for organic geometry. Both filter by world coordinates — predictable and bounded:

```js
// Don't:
partwright.paintRegion({ point: [...], normal: [...], color, tolerance: 0.95 }); // floods entire finger

// Do:
partwright.paintNear({ point: [...], radius: 4, color });               // bounded by radius
partwright.paintInBox({ box: { min, max }, normalCone: { axis, angleDeg: 25 }, color });
```

`paintRegion` is still the right tool for flat plates with crisp 90° edges (e.g. a cube face). For curved surfaces, prefer the position-based primitives.

### Trust `probeRay`'s hit normal — don't derive your own

`paintRegion`'s seed-resolution requires the seed normal to align with an actual triangle's normal within `tolerance`. Computed normals (e.g. derived from your construction math) are slightly off from the post-boolean-union mesh normals — they look right but won't match. The fix is one line:

```js
// Don't:
const dorsal = [0, -Math.cos(P), Math.sin(P)];                          // looks correct...
partwright.paintRegion({ point: derivedPoint, normal: dorsal, ... });   // ...silently misses

// Do:
const hit = partwright.probeRay(start, dir).hits[0];
partwright.paintRegion({ point: hit.point, normal: hit.normal, tolerance: 0.999, ... });
```

`probeRay` returns the same data the resolver looks at internally; using it eliminates an entire class of "no matching face found" failures.

### Manifold's `rotate` direction

Manifold uses `rotate([degX, degY, degZ])` applied X→Y→Z. The convention follows the standard right-hand rule about each axis. Quick verification snippet:

```js
const cube = api.Manifold.cube([2, 4, 4], false);          // x∈[0,2], y∈[0,4], z∈[0,4]
const rotated = cube.rotate([90, 0, 0]);                   // rotate +90° about X
// After rotation: y∈[-4,0], z∈[0,4]. (0,1,0) → (0,0,1) → (0,-1,0).
```

If your rotated geometry looks mirrored, negate the angle. This burned 10+ minutes of debugging in earlier sessions — the test snippet above runs in `runIsolated` and resolves it in seconds.

### Painting locks the editor — `clearColors()` to iterate

Once any region exists, the editor goes read-only and `runAndSave` is rejected. To change the geometry mid-session, call `partwright.clearColors()` first, *then* run new code. To preserve a colored version while iterating, call `forkVersion(...)` instead — it loads, transforms, validates, and saves a fresh uncolored child without touching the colored one.

### Verify before you commit

`paintPreview` is count-only by default — call it before any non-trivial paint as a free sanity check on selector geometry. If the count is surprising, opt into the visual:

```js
const dry = partwright.paintPreview({ point: [...], radius: 4 });
// dry.triangleCount > 0? if happy, call paintNear with the same args to commit.
// If the count is wildly off, add withImage: true to see what got selected:
partwright.paintPreview({ point: [...], radius: 4, withImage: true, view: { ortho: true, size: 240 } });
```

Use `assertPaint` to verify regions stayed where you expected after a re-render or version load:

```js
partwright.assertPaint({ region: 'Index nail', expectedTriangleCount: { min: 15, max: 60 } });
```

### `runAndSave` is for committed iterations; `runIsolated` is for sanity checks

`runAndSave` writes a version to the gallery (and the lock state, and the diff, etc.). For "does this code produce 1 component or 7" questions, prefer `runIsolated(code)` — it returns `{ geometryData, thumbnail }` without mutating anything.

```js
const r = await partwright.runIsolated(`
  const { Manifold } = api;
  return Manifold.cube([1, 1, 1], true).hull();
`);
// r.geometryData.componentCount, r.thumbnail (data URL)
```

## AI-friendly file I/O

The standard `exportGLB()` / `exportSTL()` / `exportOBJ()` / `export3MF()` methods trigger a browser download — the file goes to the user's Downloads folder, which an AI agent can't observe. Likewise, `Import` opens an OS file picker that an agent can't dismiss. Use the `*Data()` methods below instead: they return file contents over the API and skip the picker entirely.

### Export — return bytes over the API
```js
// 3D model formats — binary blobs come back as base64
const glb = await partwright.exportGLBData()
// -> { filename: "model_2026-04-28.glb", mimeType: "model/gltf-binary", base64: "...", sizeBytes: 12345 }

const stl = await partwright.exportSTLData()
const tmf = await partwright.export3MFData()

// OBJ is text-typed when the mesh has no painted color regions, otherwise a ZIP.
// Inspect mimeType to tell which: "text/plain" -> use `text`, "application/zip" -> use `base64`.
const obj = await partwright.exportOBJData()

// Session JSON — returns the parsed object directly, no decoding needed
const ses = await partwright.exportSessionData()
// -> { filename: "...partwright.json", mimeType: "application/json", data: { partwright: "1.2", session: {...}, versions: [...] }, sizeBytes }

// Editor source as text
const src = await partwright.exportCodeData()
// -> { filename, mimeType: "text/plain", language: "manifold-js", text, sizeBytes }
```

Each call also adds the export to the Recent Exports inbox so the user can re-download it from the toolbar's Export → Recent Exports list.

### Import — supply the payload directly
```js
// Import a parsed .partwright.json (object or string) as a new active session
const r = await partwright.importSessionData(parsedJson)
// -> { sessionId } or { error }

// Import raw source as a new session
await partwright.importCodeData(code, 'manifold-js')           // optional sessionName arg
await partwright.importCodeData(scadCode, 'scad', 'my-shape')
```

### Recent Exports inbox
Every export — whether the human clicked Export or the agent called `*Data()` — is kept in a small in-memory ring buffer (last 10). The user sees them in the Export dropdown's "Recent Exports" section; agents can read them too.
```js
partwright.listRecentExports()
// -> [{ id, filename, mimeType, source, sizeBytes, timestamp }, ...]   // newest first

await partwright.getRecentExport(id)   // adds bytes (text or base64) to the metadata
partwright.downloadRecentExport(id)    // re-trigger the browser download
partwright.clearRecentExports()
```

This is also the easiest way to inspect what the user just exported manually: the bytes stay in memory until they're pushed out by newer exports.

## Images

Attach reference photos so the model can be compared against them. Each image has just two user-facing fields:

- `src` — a `data:` URL or `http(s)` URL.
- `label` (optional) — a free-form caption. Common values like `"Front"`, `"Right"`, `"Back"`, `"Left"`, `"Top"`, and `"Perspective"` are **presets**: the UI offers them as one-click pickers and the system uses them to order the strip in the Elevations tab. Any other string is also valid (`"south elevation, morning light"`, `"Inspiration: Frank Lloyd Wright"`). Empty / omitted means no caption.

Multiple images may share a label — nothing is overwritten. The label is what appears in the Gallery thumbnail caption, in the lightbox, and in tooltips. Items whose label matches a preset (case-insensitive) sort first in preset order; the rest keep their insertion order at the end.

```js
// Replace the full list. Each item is {src, label?}; the call returns the
// same items with a server-assigned `id` so you can remove individuals later.
const items = partwright.setImages([
  { src: 'data:image/jpeg;base64,...', label: 'Front' },                       // preset
  { src: 'https://cdn.example.com/view-right.jpg', label: 'Right' },           // preset
  { src: 'data:image/png;base64,...',  label: 'south elevation, morning' },    // custom
  { src: 'data:image/png;base64,...' },                                        // no label
])
// items -> [{id: 'A1bC2dE3fG', src: '...', label: 'Front'}, ...]

// Append one without disturbing existing items
const added = partwright.addImage({ src: '...', label: 'Perspective' })

// Remove a specific item by id
partwright.removeImage(added.id)

// Clear all attached images
partwright.clearImages()

// Get the currently attached images
partwright.getImages()  // -> [{id, src, label?}, ...]
```

When images are attached, the Elevations tab shows them in a strip alongside the model views, enabling direct visual comparison.

## Photo-to-model workflow

> **Optional tooling.** This workflow uses `scripts/generate-views.js` and Gemini, which may not be installed in every environment. If unavailable, skip the analysis step and supply images manually via `setImages()`.

To recreate a building or object from a photo:

### 1. Analyze the reference (optional helper)
Use `scripts/generate-views.js` to extract structural analysis:
```bash
node scripts/generate-views.js /path/to/photo.jpg
```
This calls Gemini to analyze the photo and produces a JSON file with:
- Building mass decomposition (main body, wings, garage, etc.)
- Proportion estimates (width:depth:height ratios)
- Roof style, pitch angle, overhangs
- Feature positions (windows, doors, porches) as percentages
- Elevation descriptions for all 4 sides

### 2. Attach images
If you have multiple angle photos (or Gemini-generated views), attach them:
```js
partwright.setImages([
  { src: frontDataUrl, label: 'Front' },
  { src: rightDataUrl, label: 'Right' },
  // ...
])
```

### 3. Build major masses first
Start with the largest geometric volumes and get proportions right before adding detail:
```js
// Decompose into: main body -> wings -> roof -> porch -> details
// Build each mass, validate proportions against reference
const r = await partwright.runAndAssert(code, {
  isManifold: true, maxComponents: 1,
  // Use proportion assertions to match reference
  boundsRatio: { widthToDepth: [1.2, 1.8], widthToHeight: [1.5, 2.5] }
});
```

### 4. Compare elevations after each structural change
Switch to Elevations tab and compare model silhouette against the attached image at each angle. Focus on:
- Overall proportions and mass placement
- Roof profile (side view reveals pitch and overhangs)
- Feature alignment (windows, doors at correct heights)
- Porch depth and column spacing

### 5. Iterate on details
Add features in order of visual impact: roof -> porch -> windows/doors -> trim details.
After each addition, verify the relevant elevation matches the attached image.

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

## Annotations

The user can mark up the model surface using the **Annotate** tool (✏️ button in the viewport
overlay). Two kinds of annotations:

- **Freehand strokes** drawn with the pen sub-mode -- raycast onto the mesh and stored as 3D
  polylines (color + pixel-width per stroke).
- **Text labels** placed with the text sub-mode -- pinned to a 3D anchor on the surface and
  rendered as a screen-facing label (so they stay readable from any angle).

Both kinds are **not part of the model** -- they're a visual feedback layer that
survives orbiting and appears in **every** rendered output: the live viewport, `renderView()`
output, the AI Views tab, and the Elevations tab.

**Lifecycle**: annotations are scoped to the current version. `runAndSave` /
`saveVersion` snapshots the current annotations into the new version, and
`loadVersion` / `navigateVersion` swap them back in when you return. Unsaved
annotations are dropped when you switch versions -- same as unsaved code.

When the user has annotated, treat the marks as a directional cue tied to the geometry under
them. Inspect them via `listAnnotations()` / `listTextAnnotations()`, infer which feature is
being pointed at from the 3D points/anchors, and confirm your interpretation before making
changes.

```js
partwright.listAnnotations()
// -> [{id, color: [r,g,b], width: 4, pointCount: 24, points: [[x,y,z], ...]}]

partwright.listTextAnnotations()
// -> [{id, text: "shorter here", color: [r,g,b], fontSizePx: 28, anchor: [x,y,z]}]

partwright.addTextAnnotation({ anchor: [4, -5, 3], text: "round this corner" })
// -> {id: "..."}

partwright.getAnnotationCount()         // total: strokes + text
partwright.undoAnnotation()             // removes the most recent annotation of either kind
partwright.removeAnnotation("<id>")     // remove a specific one
partwright.clearAnnotations()           // remove all
partwright.clearAnnotationStrokes()     // remove only strokes
partwright.clearTextAnnotations()       // remove only text labels

partwright.setAnnotationsVisible(false) // hides everything (and excludes from renders)
partwright.areAnnotationsVisible()

partwright.setAnnotationColor([r, g, b])  // applies to new strokes AND new text
partwright.setAnnotationWidth(6)          // pixels, for strokes (0.5..64)
partwright.setAnnotationFontSize(32)      // pixels, for text labels (4..256)
```

Each stroke and text label records its own color/width/font-size at creation, so changing the
active settings only affects new annotations.

Annotations are intentionally separate from `paintRegion` colorization:
- **Annotations** are floating visual marks on top of the surface -- per-version, included in
  session exports (`.partwright.json`), but do not modify the model geometry or lock the editor.
- **Color regions** (`paintRegion`) modify the model's vertex colors -- persist with the
  version, export with the model (GLB/3MF), and lock the editor while present.

## Stat-based verification

1. Read `#geometry-data` -- check `status:"ok"`, volume, dimensions, componentCount, isManifold
2. Check `crossSections` quartiles (z25/z50/z75) for expected profile
3. Use `partwright.sliceAtZ(z)` for specific heights
4. Use `partwright.validate(code)` for quick syntax checks
5. Use `partwright.runAndAssert(code, assertions)` for structured validation
