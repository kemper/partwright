# AI-friendly file I/O

The standard `exportGLB()` / `exportSTL()` / `exportOBJ()` / `export3MF()` methods trigger a browser download — the file goes to the user's Downloads folder, which an AI agent can't observe. Likewise, `Import` opens an OS file picker that an agent can't dismiss. Use the `*Data()` methods below instead: they return file contents over the API and skip the picker entirely.

**In-app chat:** the assistant downloads through ONE tool, **`exportModel({format, objects?, filename?})`** — `format` `'stl' | 'obj' | 'glb' | '3mf'` (the current object, or several bundled with `objects`), `'3mf-objects'` (the Bambu Studio / OrcaSlicer plate project; default every object), `'step'` (BREP sessions) or `'vox'` (voxel sessions). It saves a file to the user's computer, so the user confirms each call; the prompt names the format and the objects. It returns `{ ok, format, filename?, parts? }` or `{ error }`.

## Export — return bytes over the API
```js
// 3D model formats — binary blobs come back as base64
const glb = await partwright.exportGLBData()
// -> { filename: "model_2026-04-28.glb", mimeType: "model/gltf-binary", base64: "...", sizeBytes: 12345 }

const stl = await partwright.exportSTLData()
const tmf = await partwright.export3MFData()

// OBJ is text-typed when the mesh has no painted color regions, otherwise a ZIP.
// Inspect mimeType to tell which: "text/plain" -> use `text`, "application/zip" -> use `base64`.
const obj = await partwright.exportOBJData()

// MagicaVoxel .vox — voxel sessions only; keeps the editable voxel grid (cells
// + palette), unlike the meshed GLB/3MF/OBJ/STL exports. Returns { error } off a
// voxel session or past the format's 256-per-axis / 255-color limits. See /ai/voxel.md.
const vox = await partwright.exportVOXData()
// -> { filename: "model_2026-04-28.vox", mimeType: "application/octet-stream", base64: "...", sizeBytes }

// Session JSON — returns the parsed object directly, no decoding needed
const ses = await partwright.exportSessionData()
// -> { filename: "...partwright.json", mimeType: "application/json", data: { partwright: "1.2", session: {...}, versions: [...] }, sizeBytes }

// Lower level: just the ExportedSession object, with include* toggles. Defaults to
// the current session; thumbnails are OFF by default (annotations, notes, colour
// regions AND the AI chat transcript ON — pass includeChat: false before sharing a
// file with someone). exportSessionData takes the same toggles (minus
// includeColorRegions). Returns null when there is no such session, { error } on bad args.
const raw = await partwright.exportSession(undefined, { includeThumbnails: true, includeNotes: false, includeChat: false })

// Editor source as text
const src = await partwright.exportCodeData()
// -> { filename, mimeType: "text/plain", language: "manifold-js", text, sizeBytes }
```

Each call also adds the export to the Recent Exports inbox so the user can re-download it from the toolbar's Export → Recent Exports list.

## Multi-object 3MF — bundle several objects into one file

> The session's left-rail entries are **objects** (each with its own code + versions). They were called "parts" before; the old names — `export3MFParts`, `exportOBJParts`, … and their `*PartsData` twins — still work as deprecated aliases, and results also carry the old `parts` count.

`export3MFObjects(objectIds?, filename?, { bambu?, printer?, nozzle?, filament?, plateLayout?, packStrategy?, split?, exclude?, plates? })` bundles several objects into **one** 3MF. Two modes:

- **`{ bambu: true }`** (default) — a Bambu Studio / OrcaSlicer **project**: objects distributed across build plates (see `plateLayout`), painted colours bound to filaments (one filament per distinct colour). The console/AI twin of the **"3MF — Bambu/Orca"** menu item.
- **`{ bambu: false }`** — a **generic** multi-object 3MF: objects grid-arranged (no overlap), opens in any slicer, no Bambu metadata. The console/AI twin of the generic **"3MF"** export in a multi-object session.

In Bambu mode you can pick the target machine (these match the export modal's dropdowns):
- **`printer`** — dual-nozzle: `"h2c"` (default), `"h2d"`, `"h2dpro"`, `"x2d"`; single-nozzle: `"h2s"`, `"a2l"`, `"x1c"`, `"x1e"`, `"x1"`, `"p1s"`, `"p1p"`, `"p2s"`, `"a1"`, `"a1mini"`. Sets the printer profile + bed + process so Bambu opens it natively without converting.
- **`nozzle`** — `"0.2"` | `"0.4"` (default) | `"0.6"` | `"0.8"`.
- **`filament`** — `"pla"` (default) | `"petg"` | `"abs"` | `"asa"` | `"tpu"` | `"pc"`. One material for all colours; sets the filament type + temps.
- **`plateLayout`** — how selected objects spread across build plates. `"grid"` / `"group"` **shelf-pack** objects by their real footprint into the printer's bed, spilling onto extra plates when they don't all fit (so nothing lands off the plate):
  - `"separate"` (default) — **one object per plate**. Best for a handful of objects; unwieldy past ~30.
  - `"grid"` — **all objects packed together**, filling each plate before starting the next. Best for many small objects you want to print in as few jobs as possible.
  - `"group"` — **each object group packed onto its own plate(s)** (objects sharing a `group`; ungrouped objects print separately). A **split** object's items count as a group of their own. A group too big for one bed spills onto more plates. Best for large collections organised into groups.
  - `"custom"` — **you pick the plate**: pass `plates: { "<item or object name>": n }` (1-based). Items sharing a number share a plate; plates come out in number order; anything unnamed gets a plate of its own; a plate that doesn't fit the bed spills onto the next. The picker's **Custom** layout (a Plate menu on every row).

**`packStrategy`** — how objects that *share* a plate (or the whole generic model) are spatially arranged. Works in **both** modes (Bambu and generic); orthogonal to `plateLayout`:
- `"grid"` (default) — a compact, roughly-square cluster **centred** on the plate. Keeps objects toward the middle of the bed, away from the far left/right edges that aren't always printable on wide beds like the H2C.
- `"horizontal"` — fill left→right across the full bed width, wrapping to new rows.
- `"vertical"` — fill front→back down the full bed depth, wrapping to new columns.

```js
// Every object in the session, one per Bambu plate (default H2C / 0.4 / PLA):
await partwright.export3MFObjects()
// -> { ok: true, filename: "...3mf", objects: 3 }

// Target a P1S with a 0.6 nozzle in PETG:
await partwright.export3MFObjects(undefined, "tree", { printer: "p1s", nozzle: "0.6", filament: "petg" })

// All objects packed onto ONE plate (grid) — good for many small objects:
await partwright.export3MFObjects(undefined, "tray", { plateLayout: "grid" })

// One plate per group (30-object collection organised into groups):
await partwright.export3MFObjects(undefined, "collection", { plateLayout: "group" })

// All objects on one plate, arranged left→right in horizontal rows:
await partwright.export3MFObjects(undefined, "row", { plateLayout: "grid", packStrategy: "horizontal" })

// Specific objects as a generic multi-object 3MF (ids from listObjects()):
await partwright.export3MFObjects(["obj_abc", "obj_def"], "assembly", { bambu: false })
```

### Splitting an object into pieces or parts

An object exports as **one** file object by default — a chess set modelled as one object of 17 separate solids lands in the slicer as one rigid lump. **`split`** breaks it up:

- **`"pieces"`** — one file object per **connected solid** (`componentCount`), named after the part covering most of it (else `Piece N`).
- **`"parts"`** — one file object per **`api.label` part**. Parts fused into one solid can't be pulled apart without cutting the mesh open, so they stay together as one item (`"hair + face"`, flagged `fused`); pieces no label touches travel together as `Unlabeled`. A label spread over several pieces (four wheels labelled `wheels`) is one item.

Items keep their **modelled position and orientation** — the exporter only moves them onto plates. Item names are `"<object> · <item>"`; **`exclude: [names]`** leaves some out. **`listExportItems(objectIds?)`** shows what applies — per object `{ id, name, size, pieceCount, splits, pieces, parts }`, with `pieces` / `parts` null when that split doesn't apply (one solid, no separable parts, or more than the *Export split limit* in Advanced Settings). Asking for a split the object can't use is an error that lists the splits it supports. `split` / `exclude` also work on `exportSTLObjects` / `exportOBJObjects` / `exportGLBObjects` (one `.stl` / OBJ object / GLB node per item).

```js
await partwright.listExportItems()
// -> { objects: [{ name: "Chess set", pieceCount: 17, splits: ["whole", "pieces", "parts"],
//                  pieces: [{ name: "Chess set · King", size: [30, 30, 62], labels: ["King"] }, …], parts: […] }] }

// Every piece on its own plate, minus the brim tab:
await partwright.export3MFObjects(undefined, "chess", { split: { "Chess set": "pieces" }, exclude: ["Chess set · Brim tab"] })

// Pieces packed together, kings and queens on a plate of their own:
await partwright.export3MFObjects(undefined, "chess", {
  split: { "Chess set": "pieces" }, plateLayout: "custom",
  plates: { "Chess set · King": 1, "Chess set · Queen": 1, "Chess set · Board": 2 },
})
```

In the app, every export's object picker has a **Split** menu on each object made of separate pieces or parts (Whole / Pieces (N) / Parts (N)), with a row per item to leave pieces out; the Bambu picker also previews each plate. A **single-object** session whose model has two or more pieces opens the picker too, instead of exporting the pieces fused into one object.

Each object's **latest version** is re-baked with its colours (both code-declared `api.label`/`api.paint.*` and saved manual paint). Bambu mode places objects on plates using your configured **bed size** (printer settings) for the plate stride, and arranges multiple objects sharing a plate (`"grid"` / `"group"`) in a sub-grid within the bed. Both modes carry colours via `m:colorgroup`, so any slicer sees them.

`export3MFObjects` triggers a browser download; **`export3MFObjectsData(objectIds?, filename?, { bambu?, … })`** is the bytes-returning twin — it returns `{ filename, mimeType, base64, sizeBytes, objects }` (plus `items` — the written item names — and `itemCount` when something was split; `objects` still counts session objects) so an agent can read the exported 3MF back (unzip the base64) without the download path.

```js
const r = await partwright.export3MFObjectsData(undefined, 'assembly', { bambu: true })
// -> { filename, mimeType, base64: "...", sizeBytes, objects: 3 }
```

## 3MF filament colours

Every distinct colour in a 3MF becomes its **own filament** in Bambu Studio / OrcaSlicer — so a figure painted "black" five times with five slightly different blacks opens with five black filaments. In the app, both 3MF exports open a **Filament colors** step that pre-merges near-identical shades (tolerance slider, default from Advanced Settings → UI → *Export colour merging*), caps the count (**Max filaments**, e.g. 4 for one AMS), and lets the user re-assign or recolour each filament. It is **export-only**: the session's paint is never changed.

The console twins take the same choices as options on `export3MF`, `export3MFData`, `export3MFObjects` and `export3MFObjectsData` (no option = every colour exported as-is, the historical behaviour):

- `mergeColors: number` — merge colours within this perceptual distance (CIE76 ΔE) of a more-used colour. ~2 is barely visible; **10** merges shades that look the same on the model.
- `maxColors: number` — after merging, fold the least-used colours into their nearest kept colour until at most this many remain.
- `colorMap: { "#from": "#to" }` — explicit recolours/merges keyed on the ORIGINAL colours (as `listExportColors` lists them). An entry for a colour overrides where the auto-merge sent it; an entry for a kept colour also carries every colour merged into it. Chains collapse (`a→b, b→c` sends both to `c`); a cycle (`a→b, b→a`) is rejected.

Merge targets are always colours the model already uses (never a blend). Unpainted faces on a painted model export as the default blue `#4a9eff` (`unpainted: true` in the listing) — map it with `colorMap` if that matters.

```js
partwright.listExportColors({ mergeColors: 10 })
// -> { colors: [{ hex: "#1f1712", triangles: 179313, share: 0.378, names: ["hair"] }, …],
//      merges: { "#1b1b1b": "#1f1712", "#f2f2ef": "#f7f7f4", … }, filaments: 5 }
await partwright.export3MFData('figure', { mergeColors: 10, maxColors: 4 })
await partwright.export3MFObjects(undefined, 'figure', { mergeColors: 10, colorMap: { '#1f1712': '#111111' } })
```

## Multi-object OBJ / STL / GLB

The same object-bake pipeline backs OBJ, STL, and GLB. Each takes `(objectIds?, filename?)` (default: every object) and has a `*Data` twin that returns `{ filename, mimeType, base64, sizeBytes, objects }` instead of downloading. They're the console/AI twins of the **OBJ / STL / GLB** menu items in a multi-object session (the single button auto-routes to the object picker when the session has more than one object). Each format bundles objects the way its file format does best:

- **`exportOBJObjects` / `exportOBJObjectsData`** — one `.obj` with a named `o <name>` group per object, **grid-arranged** so they don't overlap. Painted objects add a shared `.mtl` (OBJ + MTL bundled in a `.zip`); with no paint anywhere it's a plain `.obj`.
- **`exportSTLObjects` / `exportSTLObjectsData`** — a `.zip` with **one `.stl` per object**. STL is a flat triangle soup with no object names or colour, so separate files are the only faithful way to keep objects distinct.
- **`exportGLBObjects` / `exportGLBObjectsData`** — one `.glb` scene with a named node per object, **grid-arranged**. Painted objects export as vertex colours. glTF is a scene graph, so distinct named meshes is its natural multi-object form.

```js
// Every object as named objects in one OBJ:
await partwright.exportOBJObjects()
// -> { ok: true, filename: "...zip", objects: 3 }

// Specific objects, bytes returned (no download):
const r = await partwright.exportGLBObjectsData(["obj_abc", "obj_def"], "assembly")
// -> { filename, mimeType, base64: "...", sizeBytes, objects: 2 }
```

Like 3MF, each object's **latest version** is re-baked with its colours (code-declared `api.label`/`api.paint.*` and saved manual paint) before bundling.

## Import — supply the payload directly
```js
// Import a parsed .partwright.json (object or string) as a new active session
const r = await partwright.importSessionData(parsedJson)
// -> { sessionId } or { error }

// Same, from an already-parsed object (e.g. exportSession() output): validates the
// shape, regenerates thumbnails and opens the session
await partwright.importSession(exported)
// -> { id, name, warning? } or { error }

// Import raw source as a new session
await partwright.importCodeData(code, 'manifold-js')           // optional sessionName arg
await partwright.importCodeData(scadCode, 'scad', 'my-shape')

// Import an STL mesh (binary or ASCII) from base64 bytes as a new session.
// This is the only way an agent can import an STL — there's no file picker to
// click. `base64` may be a bare base64 string or a `data:` URL; it round-trips
// with exportSTLData().base64.
const imp = await partwright.importMeshData(base64, 'part.stl', { sessionName: 'imported part' })
// -> { sessionId, target, object, isManifold, triangleCount, vertexCount } or { error }
// isManifold:false = welded render-only (displays + exports, but no booleans /
// paint / cross-sections) — typical for sculpted or scanned models.

// The same call imports a .3mf package (detected by the filename or ZIP magic):
// Bambu Studio / OrcaSlicer / PrusaSlicer projects and plain 3MF from any tool.
// Build-item + component transforms are baked in, units converted to mm, the
// model recentred on XY (z=0 stays the plate), modifier/support parts skipped.
// Colours come in as paint regions: slicer filament assignments (per object /
// part extruder + per-triangle MMU painting — triangles the slicer split between
// filaments take the majority filament) or plain-3MF basematerials /
// m:colorgroup. The file's filament palette becomes the ACTIVE palette (reused
// if an identical one exists) with regions bound to its slots, so a re-export
// maps back onto the same AMS/MMU slots. Pass { adoptPalette: false } to keep
// the current palette. Round-trips with export3MFData().base64.
const tmf = await partwright.importMeshData(base64, 'model.3mf')
// -> { sessionId, isManifold, triangleCount, vertexCount, format: '3mf',
//      flavor: 'bambu'|'prusa'|'generic', colorSource: 'filaments'|'materials'|'none',
//      palette: [{ name, hex }], colorRegions, activePalette,
//      objects: [{ name, triangleCount, firstTriangle, plate? }], plates: [{ id, name }] }

// MagicaVoxel .vox and STEP from base64 bytes, the same way:
await partwright.importVoxData(base64, 'castle.vox')                    // -> {…, voxelCount}
await partwright.importStepData(base64, 'bracket.step')                 // exact BREP object (STEP export kept)
await partwright.importStepData(base64, 'bracket.step', { mode: 'mesh' }) // tessellated mesh import

// From a URL — the Import → From URL… dialog, headless:
await partwright.importFromUrl('https://example.com/part.stl', { target: 'new-object' })
await partwright.importFromUrl('https://…/#share=…')   // share link: decoded locally, new session
// -> { kind: 'remote'|'share', source?, filename?, sessionId, target?, object? } or { error }
```

**Where an import lands — `target`.** Every byte/URL import takes `opts.target`, the
API twin of the import-target dialog:

| `target` | Result |
|---|---|
| `'new-session'` (default) | a fresh session named after the file (`sessionName` overrides) |
| `'new-object'` | a new object in the current session; it becomes current |
| `'current-object'` | added to the current object (`changeObject(name)` first to pick another): a mesh becomes a **named part** of it, placed beside its geometry. A JavaScript object **keeps its code** — it is wrapped in `const __partwrightBase = (() => { … })();` and composed with `api.importWithParts(i)`, so the Parts panel / `partAction` can arrange the new part; SCAD/BREP/voxel objects (or code that won't compose) are baked into a mesh and composed instead. A voxel import is composed with its geometry; a blank starter object is replaced. A `.js`/`.scad` file replaces the object's code. Render-only meshes and BREP shapes can't be combined. |

Targets other than `'new-session'` need an open session. Unsaved work on the current
object is saved as a version first, exactly as in the dialog.

`importFromUrl` fetches in the browser (CORS and the page CSP apply; 25 MB cap,
`import.remoteFetchTimeoutMs` timeout) and routes by type: `.partwright.json` → a new
session; `.stl` / `.step` / `.vox` → as above (`stepMode: 'mesh'` tessellates STEP);
`.js` / `.scad` → code. Share links, session files and `.js` / `.scad` run model code when
imported, so `geometryOnly: true` refuses them (the in-app assistant always passes it and asks
the user to use Import → From URL…, which previews first — a code-bearing URL is refused before the user is even asked to confirm). Images and SVGs need a converter — use `importImageAsRelief({src})`,
`importImageAsVoxels(url)` or `importSvgAsRelief({svgText})`.

### Multi-object files — one object per 3MF object, plate, or STL piece

By default a file imports as ONE object. A 3MF often holds several objects
(a Bambu/Orca project can spread them across several build plates), and an STL
can hold several separate solids. `split` makes one object each instead — the
console twin of the **Import 3MF** chooser the UI opens for a multi-object 3MF,
and of the **Split into N objects** button offered after a multi-body STL import.

```js
// Look first (no import): the objects / plates / pieces a split works with.
await partwright.inspectMeshData(base64, 'kit.3mf')
// -> { format: '3mf', flavor, title?, triangleCount,
//      objects: [{ index, name, triangleCount, plate?, parts?: [name] }],
//      plates: [{ id, name, objectCount }], palette, splitModes: ['none', 'object', 'plate'] }
await partwright.inspectMeshData(base64, 'blocks.stl')
// -> { format: 'stl', triangleCount, isManifold, pieces: [{ index, name, triangleCount }], splitModes }  (one piece for a single solid)

// One object per 3MF object, threaded under its plate in the object list:
await partwright.importMeshData(base64, 'kit.3mf', { split: 'object' })
// One object per build plate (each keeps its plate's layout):
await partwright.importMeshData(base64, 'kit.3mf', { split: 'plate' })
// Only some objects (indices from inspectMeshData), as separate objects:
await partwright.importMeshData(base64, 'kit.3mf', { split: 'object', objects: [0, 2] })
// One object per separate solid of an STL (largest first):
await partwright.importMeshData(base64, 'blocks.stl', { split: 'piece' })
// -> adds importedObjects: [{ id, name, group? }]; isManifold is true only when every object is.
```

Each object is recentred on its own XY origin (z = 0 stays the plate) and keeps
its colours; the file's palette is adopted once for all of them.

**Parts inside an object become labelled parts.** A Bambu/Orca object made of
several parts (each `<part>` with its own name and filament), a PrusaSlicer
object with several volumes, or a plain-3MF object built from components imports
with those parts as labels — the code loads it with `api.importWithParts(0)`,
and `listObjectParts()` / the object list show each part by the slicer's name
(an unnamed one becomes "Part N"). When several 3MF objects share one Partwright
object (`split: 'plate'`, or a whole file as one object), each 3MF object becomes
a part ("<object> · <part>" for one that has parts of its own). This applies
with or without `split`. `objects`
without `split` imports just those objects as one. A split lands in a new session,
or with `target: 'new-object'` as new objects in the current session
(`'current-object'` is refused — a split makes separate objects). Splits are capped by
**Advanced settings → Import → Max objects per split import** (default 100).

To split an object that's already imported — a single, unedited mesh import —
call `await partwright.splitImportIntoObjects()` (-> `{ objects: [{ id, name }] }`):
the largest piece becomes the object's next version (its history keeps the whole
mesh) and the others become new objects. It refuses a painted object (the
pieces would come in uncoloured). For any other object, move pieces out one at
a time with `extractObjectPiece(index)`.

### Several files at once — `importMeshFiles`

Choosing or dropping several STL and 3MF files (mixed) in the UI imports them
together through one **Import N files** dialog; `importMeshFiles` is its
console twin. Models are numbered file by file: an STL is one model, a 3MF one
per object (its `inspectMeshData` order).

```js
await partwright.importMeshFiles([
  { filename: 'bracket.stl', base64: b1 },
  { filename: 'bolt.stl', base64: b2 },
  { filename: 'kit.3mf', base64: b3 },
], {
  mode: 'object',     // one object per model (default) | 'file': one per file | 'none': one object, each model a named part
  layout: 'grid',     // 'keep' (where the files put them) | 'center' (each on the origin, on the plate) | 'grid' (side by side)
  convert: false,     // true: rebuild each new object as editable code (render-only models stay meshes)
  target: 'new-object', // 'new-session' (default) | 'new-object' (this session) | 'current-object' (mode 'none'; fills an empty object)
  models: [0, 2],     // optional: only these models
  skipExisting: true, // default: leave out models already imported into this session
})
// -> { sessionId, target, object, importedObjects: [{ id, name, group? }],
//      models: [{ index, file, name, triangleCount, imported, skipped? }], converted, notes }
```

- **Layout default:** `grid` when two models would sit on top of each other
  (separately made parts, each modelled around the origin), else `keep` (an
  assembly whose files share one coordinate frame).
- **Layout units:** in `object` mode each model moves on its own; in `file`
  and `none` modes each FILE moves as a unit, so a 3MF keeps its own
  arrangement inside the object.
- **Already imported:** a model counts as already in the session when some
  version of an object holds an import of the same file name with the model's
  triangle count (or the whole file's). Each such import accounts for one
  model (the one named like its object first), so one imported foot doesn't
  tick off all four identical feet. `skipExisting` leaves those out, so
  re-running a cancelled batch only adds what's missing; the UI dialog shows
  them unticked with an "Already imported" note (re-ticked when the target is
  a new session).
- **`current-object`:** an EMPTY current object (untouched starter code, no
  saved version — e.g. one just made with `createObject()`) is filled by the
  import rather than combined with. Otherwise each model becomes a named part
  of it, beside its geometry (a JavaScript object keeps its code — see the
  target table above), and `convert: true` is refused (it would rebuild the
  object's own code too). The import dialogs let the user pick which object
  ("Add to object"); from the console, `changeObject(name)` first.
- In `object` mode, a 3MF's objects are grouped under its file name in the
  object list. Colours from 3MF files carry over through one merged palette.
- Capped by **Advanced settings → Import → Max files per import** (default 50),
  **Max triangles per multi-file import** (default 20M, all files together)
  and **Max objects per split import**. When the files together carry more
  colours than the 3MF colour cap, the files that would overflow it come in
  uncoloured (listed in `notes`).

## Recent Exports inbox
Every export — whether the human clicked Export or the agent called `*Data()` — is kept in a small in-memory ring buffer (last 10). The user sees them in the Export dropdown's "Recent Exports" section; agents can read them too.
```js
partwright.listRecentExports()
// -> [{ id, filename, mimeType, source, sizeBytes, timestamp }, ...]   // newest first

await partwright.getRecentExport(id)   // adds bytes (text or base64) to the metadata
partwright.downloadRecentExport(id)    // re-trigger the browser download
partwright.clearRecentExports()
```

This is also the easiest way to inspect what the user just exported manually: the bytes stay in memory until they're pushed out by newer exports.

## Publish to a print site (assisted)

`partwright.publish(platform?)` opens the **assisted-publish** modal for the major model-sharing sites — **Printables**, **MakerWorld** (Bambu), **Thingiverse**, and **Thangs**. Pass an optional platform id (`'printables'` | `'makerworld'` | `'thingiverse'` | `'thangs'`) to preselect one.

```js
partwright.publish()              // open the modal, default platform
partwright.publish('makerworld')  // preselect MakerWorld
```

None of these platforms expose a public *upload* API a browser app can call, so Partwright **cannot post the model for the user**. The flow instead **prepares** the publish: it downloads a single **ZIP** containing the model file (in the platform's preferred format — Bambu/Orca 3MF for MakerWorld, generic 3MF for Printables, STL for Thingiverse/Thangs), a rendered `cover.png`, and a `details.txt` (also copied to the clipboard), then opens the platform's site — the user signs in, hits its Upload button, drops the files, and pastes. The modal also has an **"✨ Auto-populate with AI"** button (enabled only when an AI model is connected — otherwise disabled with a "connect an AI model first" tooltip) that reviews the session's code, geometry stats, notes, recent AI chat, and a 4-iso snapshot to draft the title/description/tags via the active provider. Bundling into one ZIP avoids the browser's "open multiple files?" prompt that several separate downloads trigger. Every platform's direct upload route is auth-gated and unreliable (404/500/login bounce), so each target opens a stable landing page rather than a fragile deep link. Returns `{ error }` if there's no geometry or the platform id is unknown.
