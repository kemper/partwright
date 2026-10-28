---
session: "0124MugS7aLdW18UJDeEAS17"
timestamp: "2026-10-28T05:00:00Z"
tools: [playwright, vitest]
---

## Human

(Same request as the selection commit.) The single-file and multi-file
import dialogs get "Add to object: [pick]"; models become named parts of the
chosen object, keeping that object's code where it is JavaScript.

## Assistant

**Part 4 of 4** (tracking: #1172).

- **Keep the code, don't bake it.** "Add to current object" used to bake the
  object into a mesh and compose the import with it, throwing the object's
  code away. Now a JavaScript object's code is wrapped in an IIFE and composed
  with `api.importWithParts(i)` (`import/composeIntoCode.ts`, unit-tested); a
  second import extends the same compose list instead of nesting. Leading
  removal and part-edit lines are hoisted above the wrapper so later Parts
  panel edits (which go at the top) still run after them.
- **Named parts, beside the object.** A model without parts becomes one part
  named after its file (clashes get "name 2"); a 3MF keeps its parts. The
  mesh is placed just past the object's +X side on the same floor so it
  doesn't land inside it; 3MF colour seeds are matched with the shift undone.
  The new parts end up selected, so the Parts panel opens on them.
- **Falls back** to the old bake-and-compose for SCAD / BREP / voxel objects,
  or when the wrapped code fails to run (with a note). The object's language
  is read from its saved version, because the mesh import path switches the
  editor to JavaScript before placing.
- **Picker:** both dialogs list the session's objects (default: the open one);
  `placeImportedObjects` and the API's `current-object` target go through the
  same `addImportToObject`. No convert-to-code offer after adding to an
  object — it would rebuild the whole object.
