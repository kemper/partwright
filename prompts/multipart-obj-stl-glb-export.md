---
date: 2026-06-19
branch: claude/affectionate-feynman-547jlg
files_changed:
  - src/export/multiPart.ts
  - src/export/gltf.ts
  - src/export/stl.ts
  - src/export/obj.ts
  - src/renderer/viewport.ts
  - src/ui/exportPartsModal.ts
  - src/main.ts
  - public/ai.md
  - public/ai/file-io.md
  - tests/multipart-export.spec.ts
---

## Human

We recently merged multi-part 3MF export. Investigate the other export formats and
implement multi-part OBJ, GLB, and STL exports too, doing it the "nicest" way each
format natively supports rather than blindly copying 3MF's grid-of-objects.

## Assistant

The merged 3MF flow (`build3MFProject` + the part picker + `bakeColoredMeshForPart`)
already had the format-agnostic half: pick parts, bake each part's latest version
WITH its colours off-editor. So the work was per-format *bundling* + wiring, reusing
that bake pipeline. Deliberately did NOT touch `threemfProject.ts` — another session
owns the Bambu 3MF work there, so I kept the blast radius off that file.

**Per-format bundling, matched to what each format natively supports** (the key
decision — a grid-of-soup is the wrong model for the scene-graph formats):

- **OBJ** — one `.obj` with a named `o <part>` object per part, grid-arranged so they
  don't overlap. OBJ supports named objects natively, so parts stay distinct and
  individually selectable. Vertex indices are cumulative (OBJ `f` indices are global).
  Painted → shared `.mtl` (OBJ+MTL in a `.zip`), uncoloured parts bind to Default.
- **GLB** — one glTF scene with a named node per part, grid-arranged. glTF is a scene
  graph, so distinct named meshes is its natural form. Built a temporary `THREE.Scene`
  from the baked meshes (NOT the live viewport, which only holds the active part),
  reusing the viewport's `meshGLToBufferGeometry` (exported it) so colour semantics
  match single-part GLB exactly. Disposed the temp geometries/materials.
- **STL** — a `.zip` with one `.stl` per part. STL is a flat triangle soup with no
  object names or colour, so separate files are the only faithful way to keep parts
  distinct (a single merged soup would erase the boundaries). Refactored `buildSTL`
  into a reusable `buildSTLBuffer` so the per-part files share the writer + header.

**Shared layout helper** (`multiPart.ts`): `gridLayout` (the centred ⌈√N⌉-column grid,
mirroring the generic 3MF layout) + `uniquePartStem` (sanitise/dedupe object/node/file
names). Used by OBJ + GLB (STL needs no layout — separate files).

**Wiring** (`main.ts`): generalised `showExportPartsModal` to take a format-specific
title/description instead of the 3MF-only `bambu` flag. Added a format-agnostic
`exportMultiPartFlow` (picker → bake → build → download) and routed the existing OBJ/
STL/GLB toolbar actions to it when `parts.length > 1` (single-part unchanged) — exactly
how the single "3MF" button already auto-routes. Added console/`window.partwright` API
twins `export{OBJ,STL,GLB}Parts` + `*PartsData` (bytes-returning) via a shared
`bakePartsForExport`/`exportPartsApi` core, registered in the `help()` table, and
documented in `ai.md` + `ai/file-io.md` (the UI↔API parity rule). No in-app AI chat
tool — matching the precedent that 3MF-parts is console-only.

Verified with a new e2e spec (builders emit named objects / per-part files / named
nodes; full bake pipeline via the API twins; the OBJ part picker) and a screenshot of
the "Export parts to OBJ" modal. Existing 3MF multipart spec still green after the
modal-signature change.
