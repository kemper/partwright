---
session: "ccojv5"
timestamp: "2026-10-24T18:00:20Z"
---

## Human

I recently merged the ability to import a .3mf file, but it just imported right
away. The one I imported (a Bambu 3MF) had multiple plates and multiple parts.
The import should be more intelligent: ideally it should know we have parts on
multiple plates, and at minimum we should be able to import the parts as
multiple objects. Maybe this also applies to multi-part STL files — I'm open to
some unification between the two imports. Do whatever you think is best, then
create a PR and I'll test.

## Assistant

## Key decisions

**Parser reports structure, not just a merged mesh.** `parse3MF` still returns
ONE merged mesh (so the single-object path and `importMeshData` stay
backward-compatible), but each build item is now a contiguous triangle run
(`objects[i].firstTriangle`) tagged with its Bambu/Orca plate. Plates come
from `model_settings.config` `<plate>` → `<model_instance>` (object_id,
instance_id); Bambu writes one build item per instance in order, so the k-th
item of an object is instance k. Plate preview PNGs are read when present.

**Splitting is a pure module** (`src/import/meshImportSplit.ts`):
`planImportSplit` turns a mode (none / object / plate / piece) + selection
into object groups (unique names, plate grouping), and `extractTriangles`
cuts a group out keeping triangle order so 3MF colours stay aligned. Each
object is recentred on its own XY origin — Partwright objects are independent,
and a Bambu file places plates ~300 mm apart in bed space.

**3MF: a chooser only when there's a choice.** A 3MF with 2+ objects opens an
"Import 3MF" modal (objects under their plates, tri-state plate checkboxes,
one-object-per-3MF-object / per-plate / all-in-one, destination when the
session holds real work). Default is one object per 3MF object, threaded under
its plate via the existing object-list groups. Single-object 3MFs keep the old
flow untouched.

**STL unification without new friction.** Multi-body STLs already open the
Part Detection panel with a "found N separate parts" proposal (and e2e specs
depend on it), so instead of a second pre-import modal the panel gains a
"Split into N objects" action. Both paths share one placement core,
`placeImportedObjects` (new session / this session / reuse current /
compose), with a cancellable progress modal and plate grouping.

**API parity:** `importMeshData` gains `split` + `objects`;
`inspectMeshData` lists objects / plates / pieces without importing;
`splitImportIntoObjects` is the twin of the STL button (only for an unedited
single-import object — anything else should use `extractObjectPiece`). No
in-app AI tool: these need file bytes the chat can't supply. The split cap is a
new Advanced setting (`import.maxSplitObjects`, default 100).

**Camera fix found in testing:** after building N objects and switching back to
the first, the camera was still framed on the last (smaller) object and sat
inside the first — an explicit `resetView()` after the switch fixes it.

**Follow-up not done here:** Bambu *parts* inside one object (components with
their own names/extruders) could become Partwright parts (labels) via the
existing `ImportedMesh.parts` mechanism.
