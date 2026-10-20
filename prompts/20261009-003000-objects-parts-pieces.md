---
session: "jx4qtt"
timestamp: "2026-10-09T00:30:00Z"
tools: [subagent]
---

## Human

The left-hand list of "Part 1", "Part 2", … works more like workspaces: one
entry can hold several disconnected shapes, and telling an AI to "create a new
part" is ambiguous. Slicers distinguish objects from parts. After discussing the
options: rename them to **Objects**, and have the rail also list the **parts**
inside an object. My worry was that detecting parts is hard once several shapes
fuse into one solid. Can labels track them? Open tracking issues and do all three
steps in one PR with visual proof. Be careful not to rename the things already
called "parts" that really are pieces of a model.

## Assistant

## Key decisions

**Vocabulary.** I went with three terms, matching slicers (Bambu/Orca: an object
contains parts):
- **object**: a rail row with its own code and version history; it becomes its
  own 3MF object.
- **part**: an `api.label` region inside one object.
- **piece**: a connected component, i.e. what actually comes off the print bed.

I rejected "Workspace": the left nav rail is already headed "Workspace", and the
word implies a container rather than a printable thing.

**Parts are tracked, not detected.** `api.label` records an `originalID` that
manifold-3d carries through every boolean on each triangle's `runOriginalID`.
Labels therefore survive several shapes fusing into one solid. That makes labels
the right source for the per-object parts list. Pieces come from a new pure
`computeMeshPieces`, which welds via the MeshGL merge vectors (falling back to
position) and then runs union-find. Each piece is named after the label covering
most of its triangles.

**Rename scope.** Things renamed:
- user-facing strings and the default "Object N" names;
- the `window.partwright` methods (`listObjects`, `createObject`, `changeObject`,
  …, `export*Objects`);
- the in-app AI tool names, and the per-tool `part` target, which becomes
  `object` (the legacy `part` key is still accepted);
- the docs.

The old `*Part*` console methods remain as deprecated aliases, and the old tool
names still dispatch, so existing prompts, agents and chat history keep working.
**Persisted keys are untouched**: the `parts` IndexedDB store, `Version.partId`,
the exported `parts` array, `?part=`, and the 159 catalog JSON files. Renaming
those would cost a DB migration and a catalog rewrite for no visible gain.
Internal identifiers that mirror storage (`Part`, `partList.ts`, DOM ids like
`#btn-add-part`) are also unchanged, with a note in their headers.

**Things deliberately NOT renamed**, because "part" there already means a piece
of a model, which is the new meaning:
- arrange mode (`listArrangeParts`, `selectParts`, "Parts in your code");
- `labeledUnion(parts)`;
- `ExplodePart`;
- figure-rig parts;
- generic "mechanical parts" prose;
- the relief importer's "Make a part from an image".

**Rail UI.**
- The open object's row gets a ▾ disclosure, expanded by default. It lists:
  - parts, each with its drawn colour and triangle count;
  - an "Unlabeled" bucket;
  - lost labels, struck through and tagged "lost";
  - "Pieces · N" when there is more than one piece.
- The section is rebuilt on every mesh update without re-rendering the whole
  rail.
- Clicking a part or piece toggles a viewport tint. The tint sits in the mesh
  group with `raycast` disabled, so paint and arrange picks still hit the model.
  `updateMesh` disposes it, so it can never outlive the mesh it was built for.
- Only the open object is expanded, because it is the only one with a live mesh
  and label map. Showing every object would mean persisting label data
  (a schema change) or re-running each object's code.

**API parity.** `listObjectParts()` and `highlightObjectPart()` are added to both
the console API and the in-app AI tools.

**Arrange mode.** A new `label: true` option on `addManagedDeclaration` wraps only
the parts being ADDED: `api.label(box1, 'box1')`, or `BREP.label` for replicad.
Existing hand-written elements are left as written, because re-labelling them
would call `asOriginal()` and erase any labels inside them. Matching, dropping
and removing all go through `elementName()`, so a labelled element and a bare
one are treated the same. The default stays off, so callers that don't opt in
behave exactly as before; the palette opts in.

**AI guidance.** The system prompt and `ai.md` now spell out object vs part vs
piece. "Add a handle" means label it in code, not `createObject`. They also tell
the agent to label every meaningful feature.

**Fixes from the review pass** (work-reviewer subagent):
- An arrange-mode boolean op result is labelled only when no operand carries
  labels anywhere in its construction (`partCarriesLabels`, transitive).
  Labelling calls `asOriginal()`, which would erase inner labels.
- The highlight overlay is excluded from GLB scene export.
- The parts summary and highlight pair the label map with the mesh it indexes
  (`currentLabelMesh`), not with the displayed mesh. Paint refine, simplify and
  texture passes re-tessellate the displayed mesh without rebuilding the map.
- Piece welding:
  - manifold meshes are trusted as indexed, so the count matches
    `componentCount`;
  - merge pairs are unioned, so chains resolve;
  - meshes without merge vectors use a numeric sort-based position weld instead
    of string keys.
- Each piece is named by the part covering the most surface area, not the most
  triangles. A fine-meshed handle shouldn't name the mug.
- Labels that end with 0 triangles are listed as lost.
- Mobile gets 44px touch targets; hover styles are gated to hover-capable
  devices.
- Missed "part" → "object" strings are renamed in toasts, the import dialogs and
  the help() table.
