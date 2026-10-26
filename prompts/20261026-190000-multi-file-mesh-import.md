---
session: "0124MugS7aLdW18UJDeEAS17"
timestamp: "2026-10-26T19:00:00Z"
tools: [playwright, vitest]
---

## Human

Import several STL files at once, and a mix of STL and 3MF. Let the user
choose one object vs several objects vs parts, and laid down in the same place
vs a grid. Put a practical cap on the number of files, and let people cancel.
If an import is cancelled midway, detect what already came in and leave it
unticked on a re-import (unless the user ticks it). Fold the "convert to code
vs mesh only" choice into the multi-file dialog instead of popping the convert
tool afterwards. Open to recommendations.

## Assistant

**Reuse the multi-object 3MF path instead of a new pipeline.** The files are
merged into one source the existing splitter already understands: each STL is
one item and each 3MF object is one item, each with its own vertices so a
layout move never drags a neighbour. `planImportSplit`, the shared object
builder (colours, part labels, manifold probe) and `placeImportedObjects` then
do the rest. The new pure module (`multiFileImport.ts`) is unit-tested.

**Choices offered.**
- Structure: one object per model (default), one per file (only when a 3MF
  has several objects), or everything as one object with each model a named
  part (`api.importWithParts`).
- Layout: keep file positions, centre each on the plate (the user's "same
  location"), or a grid. The default is the grid when two similar-size models
  overlap most of their footprint (separately modelled parts, all around the
  origin), else keep (an assembly sharing one frame). The grid uses shelf
  packing so mixed sizes don't waste space.
- Mesh only vs convert to code: converts each new object after placing it.
  Render-only models stay meshes, and the dialog says the parts are lost when
  a converted object combines several models.
- Destination: the existing This session / New session / Current object.

**"Already imported" detection** is file name + triangle count. Welding keeps
the triangle count, so the key is stable. It is read from every version of
the session's objects, raw from IndexedDB (no mesh data loaded), so an object
that was later converted to code still counts. Matching models start
unticked with a note, and the toast says how many were skipped. A cancelled
placement says how many were left, and that re-importing picks them up.

**Limits.** `import.maxImportFiles` (default 50) refuses bigger batches up
front, because every file is read before the dialog opens.
`import.maxSplitObjects` still caps the objects made. Cancel works while
reading, building, placing and converting.

**No post-import popup for batches.** The convert / part-detection prompt
stays on the single-STL path only.

**Parity.** The `partwright.importMeshFiles` console twin is in `help()`,
`ai.md` and `ai/file-io.md`. There is no in-app AI tool, because it needs
local file bytes the chat can't supply. `convertToCode`'s body moved into a
shared function with a quiet mode, so a batch reports once instead of
toasting per object.

Also fixed in passing: `importMeshData(opts.objects)` threw a plain `Error`
inside `guard()`, which escaped as an exception instead of returning
`{ error }`.
