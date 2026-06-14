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

## Multi-part 3MF — one part per build plate

`export3MFParts(partIds?, filename?)` bundles several Session Parts into **one** 3MF, placing each part on its **own build plate** (a Bambu Studio / OrcaSlicer "project" 3MF) with painted colours bound to filaments. This is the console/AI twin of the part-picker the UI shows when you export 3MF in a multi-part session.

```js
// Every part in the session, one per plate:
await partwright.export3MFParts()
// -> { ok: true, filename: "...3mf", parts: 3 }

// Just specific parts (ids from listParts()):
await partwright.export3MFParts(["part_abc", "part_def"], "assembly")
```

Each part's **latest version** is re-baked with its colours (both code-declared `api.label`/`api.paint.*` and saved manual paint). The file is also a valid generic multi-object 3MF, so non-Bambu slicers/viewers still open it and see every part + colour (they just won't split it onto separate plates). A single selected part falls back to the ordinary single-object 3MF. This triggers a browser download — there is no `*Data()` byte-returning variant yet.

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
