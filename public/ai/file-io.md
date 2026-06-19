# AI-friendly file I/O

The standard `exportGLB()` / `exportSTL()` / `exportOBJ()` / `export3MF()` methods trigger a browser download — the file goes to the user's Downloads folder, which an AI agent can't observe. Likewise, `Import` opens an OS file picker that an agent can't dismiss. Use the `*Data()` methods below instead: they return file contents over the API and skip the picker entirely.

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

// Editor source as text
const src = await partwright.exportCodeData()
// -> { filename, mimeType: "text/plain", language: "manifold-js", text, sizeBytes }
```

Each call also adds the export to the Recent Exports inbox so the user can re-download it from the toolbar's Export → Recent Exports list.

## Multi-part 3MF — bundle several parts into one file

`export3MFParts(partIds?, filename?, { bambu? })` bundles several Session Parts into **one** 3MF. Two modes:

- **`{ bambu: true }`** (default) — a Bambu Studio / OrcaSlicer **project**: each part on its **own build plate**, painted colours bound to filaments. The console/AI twin of the **"3MF — Bambu/Orca"** menu item.
- **`{ bambu: false }`** — a **generic** multi-object 3MF: parts grid-arranged (no overlap), opens in any slicer, no Bambu metadata. The console/AI twin of the generic **"3MF"** export in a multi-part session.

```js
// Every part in the session, one per Bambu plate (default):
await partwright.export3MFParts()
// -> { ok: true, filename: "...3mf", parts: 3 }

// Specific parts as a generic multi-object 3MF (ids from listParts()):
await partwright.export3MFParts(["part_abc", "part_def"], "assembly", { bambu: false })
```

Each part's **latest version** is re-baked with its colours (both code-declared `api.label`/`api.paint.*` and saved manual paint). Bambu mode places each part on its plate using your configured **bed size** (printer settings) for the plate stride. Both modes carry colours via `m:colorgroup`, so any slicer sees them.

`export3MFParts` triggers a browser download; **`export3MFPartsData(partIds?, filename?, { bambu? })`** is the bytes-returning twin — it returns `{ filename, mimeType, base64, sizeBytes, parts }` so an agent can read the exported 3MF back (unzip the base64) without the download path.

```js
const r = await partwright.export3MFPartsData(undefined, 'assembly', { bambu: true })
// -> { filename, mimeType, base64: "...", sizeBytes, parts: 3 }
```

## Multi-part OBJ / STL / GLB

The same part-bake pipeline backs OBJ, STL, and GLB. Each takes `(partIds?, filename?)` (default: every part) and has a `*Data` twin that returns `{ filename, mimeType, base64, sizeBytes, parts }` instead of downloading. They're the console/AI twins of the **OBJ / STL / GLB** menu items in a multi-part session (the single button auto-routes to the part picker when the session has more than one part). Each format bundles parts the way its file format does best:

- **`exportOBJParts` / `exportOBJPartsData`** — one `.obj` with a named `o <part>` object per part, **grid-arranged** so they don't overlap. Painted parts add a shared `.mtl` (OBJ + MTL bundled in a `.zip`); with no paint anywhere it's a plain `.obj`.
- **`exportSTLParts` / `exportSTLPartsData`** — a `.zip` with **one `.stl` per part**. STL is a flat triangle soup with no object names or colour, so separate files are the only faithful way to keep parts distinct.
- **`exportGLBParts` / `exportGLBPartsData`** — one `.glb` scene with a named node per part, **grid-arranged**. Painted parts export as vertex colours. glTF is a scene graph, so distinct named meshes is its natural multi-part form.

```js
// Every part as named objects in one OBJ:
await partwright.exportOBJParts()
// -> { ok: true, filename: "...zip", parts: 3 }

// Specific parts, bytes returned (no download):
const r = await partwright.exportGLBPartsData(["part_abc", "part_def"], "assembly")
// -> { filename, mimeType, base64: "...", sizeBytes, parts: 2 }
```

Like 3MF, each part's **latest version** is re-baked with its colours (code-declared `api.label`/`api.paint.*` and saved manual paint) before bundling.

## Import — supply the payload directly
```js
// Import a parsed .partwright.json (object or string) as a new active session
const r = await partwright.importSessionData(parsedJson)
// -> { sessionId } or { error }

// Import raw source as a new session
await partwright.importCodeData(code, 'manifold-js')           // optional sessionName arg
await partwright.importCodeData(scadCode, 'scad', 'my-shape')

// Import an STL mesh (binary or ASCII) from base64 bytes as a new session.
// This is the only way an agent can import an STL — there's no file picker to
// click. `base64` may be a bare base64 string or a `data:` URL; it round-trips
// with exportSTLData().base64.
const imp = await partwright.importMeshData(base64, 'part.stl', { sessionName: 'imported part' })
// -> { sessionId, isManifold, triangleCount, vertexCount } or { error }
// isManifold:false = welded render-only (displays + exports, but no booleans /
// paint / cross-sections) — typical for sculpted or scanned models.
```

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
