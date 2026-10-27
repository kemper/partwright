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

### Review follow-ups

An independent review of the draft found one blocker and several gaps, all
fixed here:

- **Convert + "the current object" rewrote the user's object.** Those two
  choices now exclude each other in the dialog. The API refuses the
  combination, and placement never converts an object that existed before.
- **"Already imported" false positives.** A file of identical objects (four
  feet) was entirely ticked off by one import. Each distinct import (by id)
  now accounts for one model, preferring the model named like its object.
- **A new session is not "this session".** Choosing it re-ticks the flagged
  models, and nothing counts as skipped.
- **Layout by file in `file` / `none` modes,** so centring or gridding never
  pulls a 3MF's own objects apart.
- **Bounds.** A total-triangle cap across all files
  (`import.maxImportTotalTriangles`), checked while reading so a huge batch
  stops early. The per-file copies are dropped once merged. `keep` no longer
  copies the mesh. Cutting the objects reuses one scratch vertex map, so it
  isn't O(objects × all vertices).
- **No second weld ladder** for an STL the reader already found isn't a clean
  solid.
- **Colours.** The merged palette is capped, so one many-colour file loses its
  colours instead of every file losing theirs. Skipped colours and 3MF
  modifier parts are reported.
- **Cancel during placement** no longer starts the conversion step. A
  conversion that finishes during a cancel is counted. Warnings go to the
  Diagnostic Log, not one toast per object. The interactive path has a
  try/catch.
- The layout-suggestion thresholds became config knobs.

### Empty open object (#1147)

The human reported that importing an STL into an existing project created a
new session instead of asking. The cause was the gate every interactive
import used: `currentPartIsExpendable()` looked only at the open object, so an
empty new object (made with "+") counted as "nothing to protect" even in a
session with other objects.

- A new `nothingToProtect()` replaces that gate in every interactive import:
  STL, code file, generated code, relief, STEP, multi-object 3MF and
  multi-file. It is true only for no session, or a session whose only object
  is an untouched starter. A fresh editor keeps its one-step import.
- With an empty object open in a bigger session, the dialogs offer to fill it
  and make that the default. This reuses the import-target modal's
  `addReplacesStarter` option (it existed but nothing used it). The
  multi-object dialogs map it to the placer's `reuse-current`: the first
  object fills it and the rest become new objects. A filled object named
  "Object N" takes the import's name.
- The API's `importMeshFiles` with `target: 'current-object'` likewise fills
  an empty object, and converting is allowed then.
- Relief and STEP (BREP) only get the gate fix. Their "current object" choice
  stays disabled, since they can't fill or combine.
