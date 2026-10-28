---
session: "01QnZGNMZBJsspqb2t2iRps3"
timestamp: "2026-10-28T01:30:00Z"
tools: [playwright, vitest, work-reviewer]
---

## Human

When exporting I can't export an object with multiple parts where the parts
are separate and packed onto the plate or split across plates. Propose a UI
for that?

(After the proposal:) Bed orientation — let each piece keep its modelled
orientation. Go ahead and build the entire export modal for parts and pieces.

## Assistant

## Key decisions

**Split lives in the existing object picker, not a new modal.** Every
multi-object export (Bambu 3MF, generic 3MF, STL, OBJ, GLB) already routes
through `exportPartsModal`; each object row gains a Split menu (Whole /
Pieces (N) / Parts (N)) and, when split, a row per item with its own
checkbox. One UI, every format.

**Parts never cut a solid.** Labels fused into one connected piece can't be
separated without opening the mesh, so "Parts" groups pieces and labels by
union-find: a label spanning pieces pulls them together, a piece carrying
several labels fuses them into one item ("hair + face", flagged with a
warning). Unlabeled pieces travel together. Every item is whole pieces, so
it stays watertight.

**Orientation kept.** Per the user, items keep their modelled orientation
and only translate onto plates; lay-flat is out of scope.

**Measure in the background, reuse the bake.** Split counts need each
object's baked mesh, so the picker measures ticked objects through a
per-export bake cache (`createExportSplitSession`, 30 ms batching into one
pool run; the open object uses its live mesh). The export that follows
reuses those bakes, so the picker adds no second build.

**One packer for preview and file.** `layoutBambuPlates` is shared by the
Bambu builder and the picker's plate preview, so the preview shows exactly
what gets written. A new `'custom'` plate layout takes a plate number per
item; switching to Custom seeds the chips from the previous layout.
`'group'` treats a split object's items as a group of their own.

**Single-object sessions open the picker only when the model has 2+
pieces** (componentCount), so ordinary one-solid exports stay one click.
Voxel objects keep the direct export (their greedy-meshed file mesh isn't
what the picker bakes).

**Split choice remembered per tab only**, not persisted, to avoid a schema
bump. A split-item cap (`renderer.exportMaxSplitItems`, default 200) keeps
an object of thousands of loose shells on Whole.

**Parity:** `split` / `exclude` / `plates` options on the export*Objects
API twins (strict: an impossible split or unknown name errors with the valid
names), `listExportItems()`, the `exportModel` AI tool's split / exclude,
and `split` in the `export-objects` openTool prefill. No separate AI tool
for listExportItems: the exportModel error lists the valid item names.
