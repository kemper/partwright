# Partwright -- AI Agent Instructions

Partwright is a browser-based parametric CAD tool with three modeling engines: **manifold-js** (default, JavaScript DSL with manifold-3d API + a `Curves` helper namespace), **OpenSCAD** (SCAD language via WASM, with BOSL2 bundled), and **BREP / replicad** (JavaScript with `api.BREP.*` — OpenCASCADE B-rep for exact fillets/chamfers and STEP export). You write code that constructs 3D geometry, which renders live. All interaction is via the `window.partwright` programmatic API -- do not drive the app through clicks or keystrokes. `window.mainifold` remains available as a legacy alias for older prompts.

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
- [Common gotchas](#common-gotchas)
- [Iteration workflow](#iteration-workflow)
- [Stat-based verification](#stat-based-verification)
- [Visual verification](#visual-verification)
- [Spending mode](#spending-mode)

## Before you start

1. **Use `window.partwright`** -- that's the programmatic API. Do NOT drive the app with clicks, keystrokes, or DOM manipulation.
2. **Pick your engine:** manifold-js (default) or OpenSCAD. See [Choosing an engine](#choosing-an-engine).
3. **manifold-js code must end with `return manifoldObject;`** -- a bare trailing expression won't work. OpenSCAD code uses standard SCAD syntax (no `return`).
4. **Use `runAndSave(code, label, {isManifold: true, maxComponents: 1})`** to validate and commit a version.
5. **Verify visually after structural changes.** Stats alone can't catch warped roofs, twisted spires, or wrong proportions. Call `renderViews()` to see several angles at once, and `renderViews({views: "box"})` for a guaranteed all-faces check before declaring done. See [Visual verification](#visual-verification).
6. **Log decisions with `addSessionNote("[PREFIX] ...")`** -- prefixes: `[REQUIREMENT]`, `[DECISION]`, `[FEEDBACK]`, `[MEASUREMENT]`, `[ATTEMPT]`, `[TODO]`.
7. **`await` every async method.** `createSession`, `runAndSave`, `runAndAssert`, `runIsolated`, `runAndExplain`, `loadVersion`, `forkVersion`, `getSessionContext`, every `*Data()` export, every notes/sessions call returns a Promise. Without `await` you'll inspect the Promise object instead of the result and silently work from stale or empty data.

## Choosing an engine

Partwright supports three modeling engines. Pick whichever is best for the task:

| | **manifold-js** (default) | **OpenSCAD** (SCAD) | **BREP / replicad** |
|---|---|---|---|
| Language | JavaScript | OpenSCAD `.scad` | JavaScript (`api.BREP.*`) |
| Kernel | manifold-3d mesh | OpenSCAD CSG | OpenCASCADE B-rep |
| Best for | Algorithmic geometry, smooth curves, mesh-level ops (`warp`/`levelSet`/`smoothOut`), painting | Mechanical parts with BOSL2 (threads, gears, attachables), porting existing `.scad` files | True edge fillets/chamfers, exact surfaces, STEP export, mechanical-CAD interop |
| Code style | `return Manifold.cube([10,10,10], true);` | `cube([10,10,10], center=true);` | `return BREP.box([10,10,10]).fillet(2);` |
| Unique strengths | `Curves.loft/sweep/naca4`; `levelSet`/`warp`/`smoothOut` (mesh-level) | BOSL2's `cuboid(rounding=)`, `skin()`, `path_sweep()`, `threaded_rod()`, `spur_gear()` | Exact `fillet()`/`chamfer()`, `.blobSTEP()` export, BREP shapes survive across runs |
| Limitations | Must learn the manifold-3d API | No `text()` (fonts not loaded), slower per-run (~100-300ms WASM init) | No `warp`/`levelSet`; no `Curves` helpers; 10 MB WASM lazy-load on first use |

**Crucial:** You can ALSO use the BREP namespace **inside a manifold-js session** without switching languages — `api.BREP.box(...).fillet(r)`, then `api.BREP.toManifold(shape, api.Manifold)` to drop back into the Manifold world. This is the right move for "one feature needs an exact fillet" without committing to a BREP-only session. Switch to the **replicad** language only when you need STEP export of the *combined* shape, or when the part is dominated by BREP operations. See `/ai/replicad.md` for the full BREP API.

### Switching engines

```js
partwright.getActiveLanguage()        // -> 'manifold-js' or 'scad' or 'replicad'
await partwright.setActiveLanguage('scad')
await partwright.setActiveLanguage('manifold-js')
await partwright.setActiveLanguage('replicad')
```

Switching is non-destructive. Your in-progress code in the previous language is stashed as a per-session draft and restored when you switch back — both languages stay live until the session is deleted. Saved versions are not touched; each version remembers the language it was authored in, and navigating to one auto-swaps the engine. A single session can hold mixed manifold-js + SCAD versions.

Selecting a SCAD example from the toolbar dropdown auto-switches to OpenSCAD mode.

## What do I do for X? (verb decision tree)

Reach for the right tool the first time. If the table sends you to a subdoc, fetch it before writing code.

<<<<<<< HEAD
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
| Ring/linear/mirror copies | `api.circularPattern / linearPattern / mirrorCopy` (or `Curves.ringCopy / linearCopy / mirrorCopy`) | BOSL2 `ring_copies()`, `xcopies()`, `mirror_copy()` |
| Place A on top of B (no mental trig) | `api.placeOn(a, b, {gap?, at?})` | BOSL2 attachments: `attach(TOP, BOTTOM)` |
| Align A's edge/face to B (per axis) | `api.alignTo(a, b, {x?, y?, z?})` (min/max/center) | BOSL2 `position()`/`anchor()` |
| Do two shapes overlap? Volume change? | `api.intersects(a, b)`, `api.volumeDelta(a, b)` | (no equivalent; render and check stats) |
| Is a point inside the solid? | `api.pointInside(m, [x,y,z])` | (no equivalent) |
| Did my boolean give the expected component count? | `api.expectUnion(parts, {expectComponents})` | (no equivalent — check stats `componentCount` after run) |
| Per-piece bbox + volume (find leaked components) | `api.componentBounds(m)` or window `partwright.componentBounds()` | `partwright.componentBounds()` (window API, works for SCAD too) |
| Repair a non-manifold mesh after a failing boolean / STL import | `api.heal(m)` (or window `partwright.healCurrent()`) | `partwright.healCurrent()` (window API) |
| Cross-section image (any axis, for debugging cavities) | `partwright.renderSection({axis, offset?, size?})` | `partwright.renderSection(...)` — same window API |
| Threaded rod / bolt / nut | (write a helix manually) | BOSL2 `threaded_rod()`, `screw()`, `nut()` |
| Spur / bevel / worm gear | (sample involute manually) | BOSL2 `spur_gear()`, `bevel_gear()`, `worm_gear()` |
| Smooth fillet / blend between two shapes (no edge-picking) | `a.smoothUnion(b, k)` via `api.sdf` -> `/ai/sdf.md` | (not available) |
| Lattice / gyroid / periodic infill | `api.sdf.gyroid(cell, thickness)` -> `/ai/sdf.md` | (not available) |
| Twisted / bent body (one expression) | `api.sdf.<shape>(...).twist(deg)` -> `/ai/sdf.md` | (`linear_extrude(twist=)` for the extrusion case only) |
| Constant-thickness shell of any shape | `node.shell(t)` via `api.sdf` -> `/ai/sdf.md` | (not available) |
| Raw SDF function | `Manifold.levelSet(sdf, bounds, edgeLen)` | (not available) |
| Mesh-level smoothing (rounded blob from cube) | `.smoothOut(angle).refine(n)` | (not available) |
| Arbitrary vertex warp (bend extrusion) | `.warp(fn)` | (not available) |
=======
| Want | manifold-js | OpenSCAD | BREP (`api.BREP.*`) |
|---|---|---|---|
| Cube / sphere / cylinder | `Manifold.cube/sphere/cylinder(...)` | `cube()`, `sphere()`, `cylinder()` | `BREP.box([w,d,h])`, `BREP.sphere(r)`, `BREP.cylinder(r, h)` |
| Boolean union / difference / intersection | `.add(o)`, `.subtract(o)`, `.intersect(o)` | `union(){...}`, `difference(){...}`, `intersection(){...}` | `.fuse(o)` / `.cut(o)` / `.intersect(o)`, or `BREP.fuseAll([a,b,c])` / `BREP.cutAll([body,…holes])` / `BREP.intersectAll([…])` for N-way |
| 2D shape extruded to 3D | `cs.extrude(h, nDiv?, twist?, scaleTop?)` | `linear_extrude(h, twist=, slices=, scale=) polygon(...)` | (use manifold-js + BREP for one piece) |
| Surface of revolution (vase, lens, bottle) | `cs.revolve(n?, degrees?)` | `rotate_extrude(angle=) polygon(...)` | (use manifold-js) |
| Smooth curve from a few points | `Curves.bezier(controls)` -> `/ai/curves.md` | `bezier_curve()` (BOSL2) -> `/ai/bosl2.md` | (use manifold-js Curves) |
| Arc between two points | `Curves.arc({from, to, radius})` | `arc()` (BOSL2) | (use manifold-js Curves) |
| Airfoil cross-section | `Curves.naca4("2412")` | (write your own with BOSL2 paths) | (use manifold-js Curves) |
| Polygon with rounded corners | `Curves.polyline(points, {fillet: r})` | BOSL2 `round_corners(...)` | (use manifold-js Curves) |
| Wing, hull, fuselage (varying profile along axis) | `Curves.loft([profA, profB], [zA, zB])` -> `/ai/curves.md` | BOSL2 `skin([profiles], z=, slices=)` -> `/ai/bosl2.md` | (use manifold-js Curves) |
| Handle, tube, propeller (profile along 3D path) | `Curves.sweep(profile, pathPoints)` | BOSL2 `path_sweep(profile, path)` | (use manifold-js Curves) |
| Revolve around an arbitrary axis | `Curves.revolveAxis(profile, [ax,ay,az])` | `rotate([...]) rotate_extrude() polygon()` | (use manifold-js Curves) |
| Round/chamfer all sharp edges of a solid | `Curves.fillet(solid, {angle: 60})` (mesh-smoothing) | BOSL2 `cuboid(rounding=...)`, `round3d(...)` | **`.fillet(radius)` / `.chamfer(distance)` -> `/ai/replicad.md` (exact, BREP-true)** |
| Round/chamfer ONLY specific edges (e.g. top rim only) | (not available) | BOSL2 `edge_profile()` (rough) | **`.fillet(r, {minZ, maxZ, nearPoint+withinDist, parallelToPlane, inDirection})` — selective, BREP-only. See `/ai/replicad.md` for the full EdgeFilter.** |
| STEP export | (not available) | (not available) | **`partwright.exportSTEP()` after a BREP-language run -> `/ai/replicad.md`** |
| STEP import (read a `.step` / `.stp` file as a CAD shape) | (use partwright.importFile UI, choose manifold-js — tessellates) | (not available) | **partwright.importFile UI, choose BREP — preserves exact surfaces. `api.imports[0]` in the replicad sandbox is the BrepShape.** |
| Ring/linear/mirror copies | `api.circularPattern / linearPattern / mirrorCopy` (or `Curves.ringCopy / linearCopy / mirrorCopy`) | BOSL2 `ring_copies()`, `xcopies()`, `mirror_copy()` | (use manifold-js helpers) |
| Place A on top of B (no mental trig) | `api.placeOn(a, b, {gap?, at?})` | BOSL2 attachments: `attach(TOP, BOTTOM)` | (use manifold-js — convert BREP→Manifold first) |
| Align A's edge/face to B (per axis) | `api.alignTo(a, b, {x?, y?, z?})` (min/max/center) | BOSL2 `position()`/`anchor()` | (use manifold-js — convert BREP→Manifold first) |
| Do two shapes overlap? Volume change? | `api.intersects(a, b)`, `api.volumeDelta(a, b)` | (no equivalent; render and check stats) | (use manifold-js — convert BREP→Manifold first) |
| Is a point inside the solid? | `api.pointInside(m, [x,y,z])` | (no equivalent) | (use manifold-js — convert BREP→Manifold first) |
| Did my boolean give the expected component count? | `api.expectUnion(parts, {expectComponents})` | (no equivalent — check stats `componentCount` after run) | (use manifold-js — convert BREP→Manifold first) |
| Per-piece bbox + volume (find leaked components) | `api.componentBounds(m)` or window `partwright.componentBounds()` | `partwright.componentBounds()` (window API, works for SCAD too) | `partwright.componentBounds()` (window API — works on tessellated mesh) |
| Repair a non-manifold mesh after a failing boolean / STL import | `api.heal(m)` (or window `partwright.healCurrent()`) | `partwright.healCurrent()` (window API) | `partwright.healCurrent()` (works on tessellated mesh) |
| Cross-section image (any axis, for debugging cavities) | `partwright.renderSection({axis, offset?, size?})` | `partwright.renderSection(...)` — same window API | `partwright.renderSection(...)` — same window API |
| Threaded rod / bolt / nut | (write a helix manually) | BOSL2 `threaded_rod()`, `screw()`, `nut()` | (coming; today use OpenSCAD/BOSL2) |
| Spur / bevel / worm gear | (sample involute manually) | BOSL2 `spur_gear()`, `bevel_gear()`, `worm_gear()` | (coming; today use OpenSCAD/BOSL2) |
| Implicit surface (gyroid, metaball, SDF blend) | `Manifold.levelSet(sdf, bounds, edgeLen)` | (not available) | (mesh-only; not in BREP) |
| Mesh-level smoothing (rounded blob from cube) | `.smoothOut(angle).refine(n)` | (not available) | (mesh-only; not in BREP) |
| Arbitrary vertex warp (bend extrusion) | `.warp(fn)` | (not available) | (mesh-only; not in BREP) |
>>>>>>> origin/main

**Rule of thumb:** if you find yourself writing a `for` loop to manually compute curve points, stop and check whether `Curves` (manifold-js) or BOSL2 (SCAD) already has the verb. AI-generated point-sampling math is brittle; the helpers are deterministic.

**Cross-engine recipe:** Inside a manifold-js session, mix BREP for the feature that needs exactness and Manifold for everything else:

```js
const { Manifold, BREP } = api;
const bracket = BREP.toManifold(
  BREP.box([40, 20, 8]).fillet(2),    // exact fillet — BREP-true
  Manifold
);
const hole = Manifold.cylinder(20, 3, 3).translate([0, 0, -5]);
return bracket.subtract(hole);
```

No language switch needed. See `/ai/replicad.md` for the full BREP API and when to switch to a dedicated BREP session for STEP export.

## Topic index (subdocs)

The main reference splits into focused subdocs. **Fetch each by calling `readDoc({name: "<short-name>"})`** — that's a tool call, not a URL the model can navigate to. Pull a subdoc on demand instead of loading everything up front.

| `readDoc` name | When to read it |
|---|---|
| `curves` | Before writing manifold-js code with `Curves.loft/sweep/bezier/arc/naca4/polyline/fillet/...` (smooth curves, organic shapes, airfoils, lofted surfaces). |
| `sdf` | Before reaching for `api.sdf.*` — smooth blends (`smoothUnion`), domain warps (`twist`/`bend`), lattices (`gyroid`), constant-thickness shells. Anything the prompt frames as "smooth", "blended", "twisted", "lattice", or "gyroid" lives here. |
| `bosl2` | Before writing SCAD code that needs edge rounding (`cuboid(rounding=)`), threads (`screw`), gears (`spur_gear`), path-following (`path_sweep`), or attachables. |
| `replicad` | Before using `api.BREP.*` inside a manifold-js session, or before switching to the replicad/BREP language. Covers exact fillets/chamfers, STEP export, and the manifold-js ↔ BREP boundary. |
| `print-safety` | Before exporting STL/3MF for FDM printing — minimum wall thickness, taper traps, sub-extrusion-width layer detection. |
| `colors` | Before any paint operation — the picker decision tree, labelled construction, vision-driven painting, export behavior. |
| `reference-images` | When the user attaches a photo or asks you to model from one — `setImages` shape, label conventions, the five-step photo-to-model loop. |
| `file-io` | Before exporting or importing programmatically — `*Data()` byte-returning methods, Recent Exports inbox, session payload shape. |
| `annotations` | When the user has marked up the model with the Annotate tool (or you need to write annotations programmatically). |

## Common agent mistakes

- **Driving the UI with clicks/keystrokes** -- CodeMirror's auto-close-brackets will corrupt your code. Use `partwright.setCode()` and `partwright.run()` instead.
- **Forgetting `return`** -- code runs in `new Function()`, so a trailing expression is NOT automatically returned. You must write `return Manifold.cube(...)`.
- **Hand-rolling curve math instead of using helpers** -- if you need a smooth surface or curve, check the verb table above. `Curves.loft` / BOSL2 `skin()` are far more reliable than a hand-written polygon-sampling loop.
- **Not saving versions** -- a session is always open for you; save your work with `runAndSave` so the user can review it in the gallery.
- **Skipping visual verification** -- stats alone can't catch visual defects. After structural changes, call `renderViews()`; `renderViews({views: "box"})` is the only set that shows the back, left, and bottom faces.
- **Flush boolean placement** -- shapes must overlap by at least 0.5 units to union correctly. Merely touching at a face produces disconnected components.
- **Tapering to a near-point on printed geometry** -- `scaleTop=[0.01, 0.01]` or chamfers that collapse the top to sub-millimeter area look fine in `geometry-data` but FDM slicers silently drop sub-extrusion-width layers, so the cap disappears on the print. See [/ai/print-safety.md](/ai/print-safety.md).
- **Not reading session context before modifying** -- when resuming work in an established session, call `getSessionContext()` first and read the notes/version history before making changes. See [Resuming a session](#resuming-a-session).
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

1. Open `/editor` (or any session URL) -- you drive the tool programmatically, not through the tabs
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
partwright.getActiveLanguage() // -> 'manifold-js' | 'scad' | 'replicad'
await partwright.setActiveLanguage(lang) // Swap engine ('manifold-js' | 'scad' | 'replicad'); stashes the prev draft, restores the other
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
await partwright.runIsolated(code, view?)  // -> {geometryData, thumbnail}. Default thumbnail is 4-iso composite; pass `view` ({elevation, azimuth, ortho, size}) for a single-angle preview.
await partwright.runAndAssert(code, assertions) // -> {passed, failures?, stats}
await partwright.runAndExplain(code)     // -> {stats, components[], hints[]} (debug disconnects)
await partwright.modifyAndTest(patchFn, assertions?) // Modify current code + test in isolation
partwright.query({sliceAt?, decompose?, boundingBox?}) // Multi-query current geometry in one call
partwright.renderView({elevation?, azimuth?, ortho?, size?, edges?})  // Render ONE angle -> data URL. edges: 'none'|'crease'|'wireframe' (default 'crease' uncolored / 'none' painted)
await partwright.renderViews({views?: 'auto'|'tri'|'all'|'box', angles?, size?, edges?})  // multi-angle labeled composite -> data URL; 'auto' (default) picks angles by aspect ratio; 'box' = all 6 faces (the all-faces final check); pass `angles` for a custom set; `edges` sets the overlay on every tile; prefer for verification
partwright.sliceAtZVisual(z)            // Cross-section SVG at height z -> {svg, area, contours}
partwright.renderSection({axis?, offset?, size?})  // Slice on any axis -> {dataUrl, svg, axis, offset, area, contours}. axis: 'x'|'y'|'z' (default 'z'). offset defaults to bbox midpoint along axis. Engine-agnostic (works for SCAD too).
partwright.componentBounds()             // -> [{index, volume, triangleCount, bbox: {min,max,size,center}}], largest first. Use to find leaked / satellite pieces after a boolean.
partwright.pointInside([x,y,z])          // -> boolean (or null if no geometry). Tiny-probe-cube method; ambiguous within ~1e-5 of the surface.
partwright.healCurrent({tolerance?})     // -> {ok, volumeDelta, triangleDelta, componentCountBefore, componentCountAfter}. Runs .simplify() on the current model and applies the result. Engine-agnostic.
partwright.isRunning()                   // -> boolean (is code executing?)

// Spending mode (AI budget) -- respect what the user set; see #spending-mode
partwright.getSpendingMode()             // -> {mode, thinking, renderResolution, renderResolutionPx, verificationAngles, painting, sessionNotes, ...}
partwright.setSpendingMode('balanced')   // 'cheap' | 'balanced' | 'expensive' (sets thinking, vision, paint, notes, caps at once)

// Images -- attach photos to compare model against (see /ai/reference-images.md)
partwright.setImages([{src, label?}, ...])  // replace all; src is data URL or http(s) URL; label is an optional caption
partwright.addImage({src, label?})          // append one; returns {id, src, label?}
partwright.removeImage(id)                  // remove by id; returns true if removed
partwright.clearImages()
partwright.getImages()                      // -> [{id, src, label?}, ...]

// Annotations & color regions -- see /ai/annotations.md and /ai/colors.md

partwright.paintRegion({point, normal, color, name?, tolerance?})
partwright.listRegions()
partwright.clearColors()

partwright.listAnnotations()
partwright.listTextAnnotations()
partwright.addTextAnnotation({anchor, text})
partwright.clearAnnotations()

// Sessions -- save/compare design iterations.
// NOTE: the in-app chat agent is scoped to the ONE session already open and
// has no session create/open/list tools — just use runAndSave. The
// create/open/list/clear console methods below are for the browser console and
// the external Claude Code agent only.
await partwright.createSession(name?)    // -> {id, url, galleryUrl}
await partwright.runAndSave(code, label?, assertions?) // Assert+save in one call -> {passed?, geometry, version, diff, galleryUrl}
await partwright.createSessionWithVersions(name, [{code, label},...]) // Batch create
await partwright.saveVersion(label?)     // Save current state as version
await partwright.listVersions()          // -> [{id, index, label, timestamp, status}]
await partwright.loadVersion({index} | {id})  // Load version into editor -> {id, index, label, code, geometryData, labelsAvailable, labelCount} or {error}
await partwright.forkVersion({index} | {id}, transformFn, label?, assertions?, carryColors=true) // Load + modify + validate + save atomically; carries parent colors -> {..., codeDiff, colors}
await partwright.copyColorsFromVersion({index} | {id}) // Re-apply a prior version's colors onto the current mesh -> {source, carried, dropped}
partwright.getGalleryUrl()               // -> URL for gallery view (human review)
partwright.getSessionUrl()               // -> URL for this session
await partwright.listSessions()          // -> [{id, name, updated}]
await partwright.openSession(id)         // Open existing session
await partwright.clearAllSessions()      // Delete all sessions & versions

// Parts -- multiple independent objects within one session. Each part has its
// own code + version history; the CURRENT part is what every other method
// (run, save, paint, export, listVersions, ...) acts on. Versions are scoped
// per part. Use parts for several distinct objects in one session (e.g. a box
// and its lid); save them as separate STLs/parts, or model each in isolation.
partwright.listParts()                   // -> [{id, name, order, isCurrent}]
partwright.getCurrentPart()              // -> {id, name, order} or null
await partwright.createPart(name?)       // New empty part + switch to it -> {id, name, order}
await partwright.changePart(id)          // Switch active part (loads its latest version)
await partwright.renamePart(id, name)    // Rename a part
await partwright.deletePart(id)          // Delete a part + its versions (refuses the last one)

// Color regions -- tag face regions with a color. Full API in /ai/colors.md.
// Quick reference (~30 methods total):
partwright.probePixel({pixel, view})                                      // pixel-in-render -> {point, normal, distance, triangleId}
partwright.paintConnected({seed, maxDeviationDeg?, color, name?})         // BFS-flood by seed-normal deviation (organic meshes)
partwright.paintRegion({point, normal, color, name?, tolerance?})         // bucket: coplanar flood-fill (edge-bounded)
partwright.paintNearestRegion({point, color, searchRadius?, name?})       // snap-to-nearest variant
partwright.paintNear({point, radius, normalCone?, color, name?})          // sphere selector
partwright.paintStroke({points, radius, resolution?, maxEdge?, shape?, color, name?}) // SMOOTH brush: subdivides mesh for a rounded painted edge (see note below)
partwright.paintInBox({box, normalCone?, color, name?})                   // AABB selector
partwright.paintInOrientedBox({box: {center, size, quaternion?}, color, smooth?, resolution?, maxEdge?})  // rotated box selector (same as UI Box tool); SMOOTH edges by default
partwright.paintFaces({triangleIds, color, name?})                        // explicit triangle ids
partwright.paintSlab({axis|normal, offset, thickness, color, name?, smooth?, resolution?, maxEdge?})  // planar range; SMOOTH edges by default
partwright.paintByLabel({label, color, name?})                            // by api.label() name (manifold-js) or top-level `label("name")` (SCAD)
partwright.paintByLabels([{label, color, name?}, ...])                    // batch sibling
partwright.paintComponent({index, color, name?, topOnly?})                // by listComponents() index
partwright.paintPreview({...selector, withImage?, view?})                 // dry-run
partwright.paintExplain({region, withImage?, view?})                      // diagnose committed region
partwright.assertPaint({region, expectedTriangleCount?, ...})             // verify
partwright.findFaces({box?, normal?, normalTolerance?, color?, ...})      // query by geometry/color
partwright.getMesh()                     // raw mesh access for procedural workflows
partwright.getMeshSummary({tolerance?, ...}?)                             // grouped coplanar faces
partwright.getFeatureCentroids({maxGroups?, withinBox?}?)                 // lightweight planning
partwright.listRegions() / listComponents() / listLabels()                // inventory
partwright.undoLastPaint() / redoLastPaint()                              // single-op undo
partwright.removeRegion(id) / setRegionVisibility(id, visible)            // per-region edits
partwright.hideRegion(id) / showRegion(id) / clearColors()
partwright.getBucketTolerance() / setBucketTolerance(t)                   // UI bucket tool config
partwright.getBrushSize() / setBrushSize(r)                               // UI brush tool config
partwright.getBrushSmooth() / setBrushSmooth(on) / setBrushSmoothDivisor(2..1024) // UI smooth-brush config (detail = radius ÷ divisor)

// Notes -- track design context, decisions, and measurements
await partwright.addSessionNote(text)    // -> {id, text, timestamp}
await partwright.listSessionNotes()      // -> [{id, text, timestamp}, ...]
await partwright.updateSessionNote(noteId, text) // Edit a note
await partwright.deleteSessionNote(noteId)       // Remove a note

// Session context -- get everything in one call (for resuming sessions)
await partwright.getSessionContext()     // -> {session, versions[], notes[], currentVersion, versionCount, agentHints}
// agentHints includes `spending` -- the user's budget (see #spending-mode)
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
- `sdf` -- signed-distance-field builder for smooth blends, twists, gyroids, and shells. Tree-of-expressions style, lowered to a Manifold via `.build()`. See **[/ai/sdf.md](/ai/sdf.md)**.
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
Segments: OMIT the segment argument so curves inherit the user's quality
  preset (recommended). Pass an explicit 6-8 only for an intentional
  low-poly look; only override upward when one specific feature needs more
  resolution than the preset. Never hard-code a low count (e.g. 32) just to
  "make it smooth" — that shadows the preset and looks chunky to the user.
```

**Default segment count:** Partwright seeds `setCircularSegments()` (and `$fn` for OpenSCAD) from the user's Modeling Quality preset (gear icon in the toolbar) before each run. Presets are Low (16) / Medium (32) / High (64) / Very High (128, the default) / Ultra (1024), plus a **Custom** option for an exact count (3–4096). So curves render smooth out of the box without any explicit configuration — and a user who wants ultra-smooth output picks **Ultra** (or a Custom value) once and it persists. **An explicit segments argument always overrides this preset for that primitive**, so leave it off unless you specifically want a different resolution than the user chose. The current preset is reported in the per-turn "Session toggle state" suffix; honor it. You can still call `setCircularSegments(n)` or pass an explicit count to override on a per-script or per-call basis when a design genuinely needs it.

### All constructors

```
Manifold: cube, sphere, cylinder, tetrahedron, extrude, revolve,
          union, difference, intersection, hull, compose, smooth, levelSet, ofMesh
CrossSection: square, circle, ofPolygons (CCW outer, CW holes),
              compose, union, difference, intersection, hull
Curves: arc, bezier, naca4, polyline, loft, sweep, revolveAxis,
        fillet, chamfer, ringCopy, linearCopy, mirrorCopy   (see /ai/curves.md)
sdf: sphere, ellipsoid, box, roundedBox, cylinder, roundedCylinder,
     torus, capsule,
     gyroid/schwarzP/diamond/lidinoid + their graded* variants (TPMS),
     union/subtract/intersect, smoothUnion/Subtract/Intersect,
     .translate/.rotate/.scale/.mirror, .shell/.round/.twist/.bend/.taper,
     .polarArray/.polarRepeat/.mirrorPair/.repeat/.repeatN,
     .label(name), .build({edgeLength?, bounds?})        (see /ai/sdf.md)
meshOps (flat on api): intersects, contains, pointInside, bbox,
                       componentBounds, volumeDelta,
                       alignTo, placeOn, mirrorAcross, mirrorCopy,
                       linearPattern, circularPattern, spiralPattern,
                       expectUnion, expectDifference, expectComponents,
                       heal                                     (see below)
```

### Mesh-operations helpers (`api.meshOps`, also flat as `api.*`)

These are agent-leverage helpers: tasks you'd otherwise solve with mental trig (placement), boolean-fails-silently bugs (expectUnion), or "is this point inside?" introspection guesses.

**Predicates — return plain values, never mutate inputs.** Use them to validate your own work before declaring a build done.

```
api.intersects(a, b)             // true if a∩b has any volume (bbox fast-reject)
api.contains(outer, inner)       // true if inner ⊂ outer
api.pointInside(m, [x,y,z])      // true if point is inside the solid
api.bbox(m)                      // { min, max, size, center } — the missing accessor
api.componentBounds(m)           // [{ index, volume, triangleCount, bbox }], largest first
api.volumeDelta(a, b)            // b.volume() - a.volume()
```

**Alignment + patterns — return a Manifold, lazy/chainable.** These eat the mental-trig category of bug ("I rotated 60° times 6 but accidentally went CW"; "the lid should sit on the box top but I added the box height to the wrong axis").

```
api.alignTo(shape, target, {x?, y?, z?})
   // axes are 'min'|'max'|'center' (also left/right/top/bottom/front/back).
   // target: a Manifold | 'origin' | { min:[x,y,z], max:[x,y,z] } literal.

api.placeOn(shape, target, {at?, gap?})
   // shape's minZ → target's maxZ.
   // at: 'center' (default — match target's XY center)
   //     'preserve' — keep shape's own XY (skip re-centering)
   //     [x, y]    — match a specific point
   // gap: 0 leaves a touching seam (boolean treats as 2 pieces);
   //      negative (e.g. -0.5) overlaps volumetrically — what you usually want.

api.mirrorAcross(shape, plane)            // plane: 'x'|'y'|'z' or a normal vector
api.mirrorCopy(shape, plane)              // shape unioned with its mirror — symmetric parts
api.linearPattern(shape, count, step)     // step: number (X) or [x,y,z] vector

api.circularPattern(shape, count, {axis?, angle?, center?, radius?})
   // axis: 'z' default; angle: 360 default = full ring.
   // ENDPOINT CONVENTION:
   //   angle === ±360 → N copies at 360/N (no duplicate at seam).
   //   any other angle → endpoints INCLUSIVE: first copy at 0°, last at angle°
   //                     (step = angle/(count-1)).
   // radius: shortcut — pushes shape outward by `radius` BEFORE rotating
   //   (so you write `circularPattern(stud, 8, {radius: 25})` instead of
   //   pre-translating the stud yourself).

api.spiralPattern(shape, count, {anglePerCopy, risePerCopy, axis?, center?})
   // The "staircase / screw / spring" case — each copy gets both a rotation
   // AND an axial translation. Steps + helical fins + threaded rod profile
   // all fall under this one.
```

**Robust booleans + heal — catch silent failures.** `expectUnion` is the one to reach for when an agent has hit "I expected one piece, got three" — it tells you *immediately* instead of after the next render, and the error message includes a bbox/volume dump of each component so you can see which piece floated free.

```
api.expectUnion(parts, {expectComponents: 1})   // union + component-count check
api.expectDifference(a, b, {expectNonEmpty: true})
api.expectComponents(m, n)                      // standalone "is m exactly n pieces?" predicate
api.heal(m, {tolerance?})                       // .simplify() + status check, for STL imports / suspect booleans
```

Examples:

```js
const { Manifold } = api;
// Lid sitting on a box, centered, with 0.5mm gap so they don't fuse:
const box = Manifold.cube([40, 20, 10], true);
const lid = Manifold.cube([40, 20, 2], true);
return api.expectUnion([box, api.placeOn(lid, box, { gap: 0.5 })], { expectComponents: 2 });

// 6 legs around a table column, with a runtime check that they actually merged:
const column = Manifold.cylinder(20, 2, 2);
const leg = Manifold.cube([2, 6, 18], true).translate([0, 5, 9]); // pre-positioned
return api.expectUnion([column, api.circularPattern(leg, 6)], { expectComponents: 1 });

// Did the boolean carve too much? Did it carve anything?
const after = body.subtract(carveout);
if (api.volumeDelta(body, after) === 0) throw new Error("subtract did nothing");
```

### Manifold instance methods

```
Booleans:   .add(other)  .subtract(other)  .intersect(other)  .hull()
Transforms: .translate([x,y,z])  .rotate([rx,ry,rz]) (degrees, applied X->Y->Z)
            .scale(s) or .scale([x,y,z])  .mirror([nx,ny,nz]) (plane normal)
            .warp(fn)  .transform(mat4)
Mesh ops:   .refine(n)  .simplify(tolerance)  .smoothOut(minSharpAngle?, minSmoothness?)
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

### Mesh-operations equivalents in SCAD

The `api.*` mesh-ops helpers (intersects, placeOn, circularPattern, expectUnion…) are sandbox helpers exclusive to manifold-js. SCAD has native equivalents — most of them in BOSL2:

| `api.*` helper (manifold-js) | SCAD / BOSL2 equivalent |
|---|---|
| `api.placeOn(a, b)` (place A on top of B) | BOSL2 `attach(TOP, BOTTOM)` on attachable parents (`cuboid(... ){ attach(...) cuboid(...); }`) |
| `api.alignTo(a, b, {...})` | BOSL2 `position(<anchor>)` + `anchor=<anchor>` on attachable shapes |
| `api.linearPattern(s, n, step)` | BOSL2 `xcopies(spacing, n=)`, `ycopies(...)`, `zcopies(...)` |
| `api.circularPattern(s, n)` | BOSL2 `ring_copies(n=N, r=R)` (or `rot_copies(rots=[...])`) |
| `api.mirrorCopy(s, plane)` | BOSL2 `mirror_copy([nx,ny,nz])` |
| `api.expectUnion(parts, {expectComponents})` | No language-level equivalent — read `componentCount` off `getGeometryData()` after running and assert in JS test harness |

The **introspection helpers** (cross-section image, per-piece bbox, point-in-solid, healing) work the same regardless of engine — they're on `window.partwright`:

```js
partwright.renderSection({ axis: 'z', offset: 5 })   // SVG data URL of the slice
partwright.componentBounds()                          // per-piece bbox/volume for the current model
partwright.pointInside([0, 0, 5])                     // true / false
partwright.healCurrent()                              // simplify + rebuild current geometry
```

These are engine-agnostic — call them after a SCAD render to debug cavities, find leaked components, or clean up a problematic boolean result.

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

For 3D-printable output (FDM/FFF), features thinner than the nozzle's extrusion width are silently dropped by the slicer even though `geometry-data` (volume, `componentCount`, `genus`, `isManifold`) looks correct. The classic trap is `scaleTop` near zero tapering to sub-extrusion-width layers near `zMax`.

Before exporting anything intended for printing, **call `readDoc({name: "print-safety"})`** for the rules of thumb, the dense-sample slice check, and the worked failure mode.

## Color regions

Color regions tag a coplanar set of triangles with an RGB color. Regions are persisted on the saved version, ride through GLB and 3MF exports (vertex colors / `<basematerials>` `pid` attributes), and show as swatch badges in the gallery. They do **not** modify the geometry. STL and OBJ exports drop them — formats don't carry color.

The paint helpers are exposed both as tool calls (`paintRegion`, `paintFaces`, `paintNear`, `paintStroke`, `paintInBox`, `paintSlab`, `paintNearestRegion`, `paintComponent`, `paintByLabel`, `paintByLabels`, `paintConnected`, `paintPreview`, `paintExplain`, `findFaces`, `probePixel`, `probeRay`, `getMeshSummary`, `listComponents`, `listLabels`, `undoLastPaint`, `redoLastPaint`, `removeRegion`, `clearColors`) and on `window.partwright`.

Before painting anything substantial, **call `readDoc({name: "colors"})`** for the picker decision tree (which `paint*` for which intent), the labelled-construction workflow, vision-driven painting with `probePixel`/`paintConnected`, undo/redo, and export behavior.

### `paintStroke` — smooth, rounded painted edges (use sparingly)

All the other selectors paint whole existing triangles, so a painted edge follows the tessellation (stair-stepped on coarse meshes). `paintStroke` instead **subdivides the mesh under the stroke** so the painted region's outline is rounded — the smooth-brush equivalent of dragging a paintbrush. It is the only paint tool that changes the triangle count, so it costs more (a mesh rebuild) than the region selectors.

Reach for it **only when a visibly rounded painted edge matters** (a curved stripe, a soft-edged patch). For ordinary fills, `paintNear` / `paintInBox` / `paintConnected` / `paintRegion` are cheaper and sufficient.

Drive it by vision, not by guessing coordinates: render a view, pick pixels along the desired path, `probePixel` each to get world-space surface points, then pass them as `points`:

```js
// Render → probe a few pixels along the stroke → paint a smooth stroke through them.
const a = await partwright.probePixel({ pixel: [120, 90],  view: { elevation: 30, azimuth: 45 } });
const b = await partwright.probePixel({ pixel: [160, 110], view: { elevation: 30, azimuth: 45 } });
partwright.paintStroke({ points: [a.point, b.point], radius: 3, resolution: 256, color: [0.9, 0.2, 0.2] });
```

`resolution` is the smoothness detail (target triangle edge = radius / resolution; higher = smoother + more triangles), default **256**, range 2–1024. For absolute control pass `maxEdge` instead (target edge in mesh units, e.g. `maxEdge: 0.1` for crisp 0.1-unit edges) — it overrides resolution. A single point stamps a rounded dot.

`paintSlab` and `paintInOrientedBox` share the same subdivision pipeline: their analytic boundary (slab planes / box faces) is **smoothed by default**, so a slab band or box patch gets a clean edge across coarse faces and reconstructs deterministically on reload. Same knobs — `smooth` (default true), `resolution` (model bbox diagonal / resolution, default 256), and `maxEdge` (absolute override). Pass `smooth: false` for the old blocky behavior. The id-baking selectors (`paintInBox`, `paintNear`, `paintInCylinder`, `paintFaces`, …) can't be smoothed — they lock onto existing triangles; refine the model mesh first if you need a finer edge from them.

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

Once any region exists, the editor's Run button is disabled in the UI (re-running would change the triangle indices the colors were painted against). The programmatic `runAndSave` is *not* blocked, but re-running new geometry with colors still in memory leaves them resolved against the old triangles. So to change the geometry mid-session, call `partwright.clearColors()` first, *then* run new code — or use `forkVersion(...)`, which re-resolves the parent's colors onto the new geometry by descriptor (pass `carryColors: false` for an uncolored child).

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

The standard `exportGLB()` / `exportSTL()` / `exportOBJ()` / `export3MF()` methods trigger a browser download — an AI agent can't observe what landed in the user's Downloads folder. Use the `*Data()` siblings (`exportGLBData()`, `exportSTLData()`, …) to get the bytes back as base64 over the API instead, and `importSessionData()` to import a session payload without touching the OS file picker.

**Call `readDoc({name: "file-io"})`** before exporting or importing programmatically — covers the Recent Exports inbox, the full method list, and the import payload shape.

## Reference images & photo-to-model

The user can attach reference photos via `partwright.setImages([...])`; they appear in the Images tab and Gallery. There's also an analyze-and-build workflow that takes a single photo and bootstraps a model from it.

**Call `readDoc({name: "reference-images"})`** when the user attaches a photo or asks you to model something from an image — covers `setImages` arguments, label conventions for elevation matching, and the five-step photo-to-model loop (major masses first, verify each elevation, iterate details).

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
  { isManifold: true, maxComponents: 1 }, // optional assertions (validated before saving)
  true                                  // carryColors (default true) — re-apply parent colors
);
// On success:
//   r.passed       = true (only when assertions provided)
//   r.parent       = { id, index, label } of the version you forked from
//   r.geometry     = full geometry stats
//   r.version      = { id, index, label } of the newly saved version
//   r.diff         = stat diff vs. the previous current version
//   r.codeDiff     = { changed, added, removed, diff } — what actually changed in the SOURCE.
//                    Verify your transform landed here: changed:false means the code is
//                    byte-identical to the parent (your edit was a no-op).
//   r.colors       = { carried: [names], dropped: [names] } when the parent had colors
//   r.galleryUrl   = gallery URL for human review
// On failure:
//   r.error        = "No version found with index ..." / "transformFn threw: ..." / etc.
//   r.passed=false + r.failures=[...] if assertions didn't pass (nothing saved)
```

`target` is an object with exactly one of `{ index }` (numeric, 1-based) or `{ id }` (string from
`listVersions()[].id`). The two are never mixed, so there's no ambiguity about which field is being
looked up. This is the recommended way to build parallel branches (v11a, v11b, ...) off a shared
parent without a load/read/modify/save round-trip chain.

**Color carry-over.** If the parent version has color regions, `forkVersion` re-applies them to the
forked geometry automatically — each region's geometry-relative descriptor (box / slab / `byLabel` /
coplanar / connected-from-seed) is re-resolved against the new mesh, so a dimension tweak does **not**
force you to repaint. Regions whose descriptor no longer matches (a label the new code dropped, raw
triangle ids on changed topology) are skipped and reported in `r.colors.dropped`. Pass `carryColors:
false` for an intentionally uncolored fork.

> When the AI tool form is used, pass `patches: [{find, replace}, ...]` instead of a `transformFn`.
> Each `find` must occur **exactly once** in the parent code — a find that matches zero or multiple
> times is rejected with an error rather than silently saving the parent unchanged, so copy the exact
> text (whitespace included) from `getCode()`/`loadVersion()`.

### Copying colors onto a rebuilt version

When you rebuild geometry from scratch with `runAndSave` (rather than forking) but it matches an
earlier *painted* version, transfer the colors in one call instead of repainting region by region:

```js
const r = await partwright.copyColorsFromVersion({ index: 7 }); // the painted version
// r.source  = { index, label }
// r.carried = [names] re-resolved onto the current mesh
// r.dropped = [names] whose descriptor no longer matches — repaint those
```

This is in-memory like any paint op — your next `runAndSave` serializes the current regions, so they
persist with it. (You don't need this after `forkVersion`, which already carries colors.)

### Modify and test

Modify current editor code with a transform function and test the result without committing:
```js
const r = await partwright.modifyAndTest(
  code => code.replace('towerH = 28', 'towerH = 35'),
  { isManifold: true, maxComponents: 1 }
);
// r.modifiedCode = the transformed code string
// r.codeDiff     = { changed, added, removed, diff } — confirm the tweak landed.
//                  changed:false means your transform matched nothing (a no-op);
//                  the stats below would then describe the UNCHANGED code.
// r.stats        = geometry stats of the modified code
// r.passed       = true/false (only if assertions given)
// r.failures     = [...] (only if failed)
```

> Prefer the AI tool's `find`/`replace` (or `patches`) form over a bare `code => code.replace(...)`
> transform: a string `replace` whose needle is absent returns the code **unchanged with no error**,
> so the tweak silently no-ops. The `find`/`replace` form is rejected when the needle doesn't match
> exactly once. Either way, check `codeDiff.changed` before trusting the result.

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
// ctx.agentHints -- {apiDocsUrl, recommendedEntrypoint, codeMustReturnManifold, recentErrors, spending}
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
2. **Visually verify** -- call `renderViews()` (cheap) to catch obvious errors; before declaring done, do an all-faces pass with `renderViews({ views: "box" })`.
3. Modify code, test with `modifyAndTest(patchFn)` or `runIsolated(code)` -- no side effects
4. When satisfied, save: `runAndSave(modifiedCode, "v2 - improvements", assertions)` -- check the diff
5. Use `query({sliceAt: [...], decompose: true})` for follow-up inspection without re-running
6. Repeat. Gallery URL is in `#geometry-data` or the `runAndSave` return value.

## Visual verification

**CRITICAL: Stats alone cannot catch visual defects.** A roof can be mangled, a spire twisted,
or proportions wrong -- all while volume, componentCount, and genus look correct. You see the
model only by rendering it (there is no live screenshot), so call the render tools after every
structural change:

1. **Iterate cheap with `renderViews()`** -- one composite PNG of several labeled angles. The
   default `views: "auto"` picks angles from the bounding box; keep `size` small while iterating.
```js
await partwright.renderViews()                       // auto angle set, cheap
await partwright.renderViews({ views: "tri" })       // front + top + iso
```
2. **Do a guaranteed all-faces check before declaring done with `views: "box"`.** It renders all
   six orthographic faces -- front, back, left, right, top, AND bottom. `auto`/`tri`/`all` never
   show the back, left, or bottom, which is exactly where an unseen mistake hides. Bump `size` for
   a sharper final read:
```js
await partwright.renderViews({ views: "box", size: 640 })   // final all-faces inspection
```
3. **Target specific angles** -- pass an explicit `angles` list to `renderViews`, or use
   `renderView()` for a single angle:
```js
await partwright.renderViews({ angles: [               // any custom set in one composite
  { elevation: 0, azimuth: 180, ortho: true, label: "back" },
  { elevation: -90, ortho: true, label: "underside" },
] })
partwright.renderView({ elevation: 0, azimuth: 0, ortho: true })   // front elevation
partwright.renderView({ elevation: 90, ortho: true })             // top-down plan view
partwright.renderView({ elevation: 30, azimuth: 315 })            // isometric (default)
```
4. **Use `sliceAtZVisual(z)` for cross-section thumbnails:**
```js
const s = partwright.sliceAtZVisual(10);  // returns {svg, area, contours}
// svg = visual rendering of the cross-section profile at z=10
```
5. **Feature-specific checks:**
   - Added a roof? Check side elevation -- should be a clean triangle/gable profile.
   - Cut a door/window? Check front elevation -- opening should be visible.
   - Added a tower? Check top-down -- should be circular, properly positioned.
   - Made something hollow? Slice at mid-height -- should show wall ring, not solid fill.
   - Anything asymmetric front-to-back or left-to-right? Use `views: "box"` -- the back and left
     faces are invisible to every other preset.

### Edge overlay (`edges`)

Both `renderView` and `renderViews` take an `edges` option controlling what is drawn
on top of the shaded surface:

- **`'crease'`** (default for uncolored models) -- only feature edges: corners and the
  silhouette. Sharpens shape-reading without spraying facet noise across tessellated
  curves. This is what you want almost always.
- **`'none'`** -- plain shaded surface, no overlay. Default for painted models, since an
  overlay competes with the colors you're checking. Use it on uncolored models too when you
  want the cleanest read of form and surface.
- **`'wireframe'`** -- every triangle edge (full topology). Reach for this only to inspect
  tessellation density or debug a failed boolean (stray edges, non-manifold artifacts); on a
  dense mesh it compounds into a dark mass, so it's the wrong default for shape verification.

```js
await partwright.renderViews({ views: "box", edges: "none" })       // cleanest shape read
partwright.renderView({ elevation: 30, azimuth: 315, edges: "wireframe" })  // inspect topology
```

### Render tiers

- **While iterating:** `renderViews()` (auto) or `renderView()` at the default size -- cheap.
- **Final check:** `renderViews({ views: "box", size: 512-768 })` -- every face, high resolution.
  More angles x larger size = more input tokens, so spend it on the final pass, not every turn.

## Spending mode

The user sets a **budget** that controls how much compute/tokens the AI agent
should spend. **Read it at the start of a session and respect it:**

```js
partwright.getSpendingMode()
// -> { mode: "balanced", thinking: "off", verifyWithImages: true,
//      renderResolution: "medium", renderResolutionPx: 384,
//      verificationAngles: "auto", painting: false, sessionNotes: true,
//      maxIterations: "medium", maxSpendUsd: 2 }
```

`mode` is `"cheap"`, `"balanced"`, `"expensive"`, or `"custom"` (the user
hand-tuned the toggles). It maps to the in-app AI presets Minimal / Standard /
Full. It's also included in `getSessionContext().agentHints.spending`.

`setSpendingMode("cheap"|"balanced"|"expensive")` applies a preset — it sets
thinking, image verification, painting, session notes, and the iteration/spend
caps in one shot. The user can also adjust each knob individually in the AI
panel's toggle strip.

**Enforced by the app — you don't have to do anything, but know the limits:**

- **`renderResolution`** sets the **default** pixel `size` for `renderView()` /
  `renderViews()` (low=256, medium=384, high=512) when you don't pass one. Keep
  routine checks at the default; pass a larger `size` only for a deliberate
  final high-res inspection. (The hard budget guard is the USD spend cap.)
- **`painting`** — when `false`, the paint tools are removed from your tool list
  and the paint console API returns an error. Don't try to paint; tell the user
  to raise the budget if they want color.
- **`sessionNotes`** — when `false`, `addSessionNote` is removed from your tool
  list. The chat transcript already records your reasoning, so this just saves a
  round-trip; don't work around it.

**Advisory — adjust your own behavior to match:**

- **`thinking`** (`off`/`low`/`medium`/`high`) — when `off`, keep reasoning
  minimal and act directly.
- **`verifyWithImages`** — when `false`, reason from stats/code alone; render
  images sparingly only when the user explicitly needs a visual check.
- **`verificationAngles`** (`auto`/`tri`/`all`) — the default angle set for
  `renderViews()`; lower means fewer image tokens per check.
- **`maxIterations`** / **`maxSpendUsd`** — hard caps; the turn stops when either
  trips. Pace your tool calls so you finish useful work before the cap.

Honor the budget unless the user overrides it for a specific request.

## Annotations

Users can mark up the model surface with the **Annotate** tool (✏️ in the viewport overlay): freehand strokes raycast onto the mesh, and text labels pinned to a 3D anchor. Annotations are per-version, persist in session exports, and are distinct from color regions — they do not modify geometry or lock the editor.

**Call `readDoc({name: "annotations"})`** when the user has placed annotations and you want to read them, or when you need to write annotations programmatically — covers the `getAnnotations` / `setAnnotations` shape and the persistence model.

## Stat-based verification

1. Read `#geometry-data` -- check `status:"ok"`, volume, dimensions, componentCount, isManifold
2. Check `crossSections` quartiles (z25/z50/z75) for expected profile
3. Use `partwright.sliceAtZ(z)` for specific heights
4. Use `partwright.validate(code)` for quick syntax checks
5. Use `partwright.runAndAssert(code, assertions)` for structured validation
