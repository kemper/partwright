---
session: "0124MugS7aLdW18UJDeEAS17"
timestamp: "2026-10-28T04:30:00Z"
tools: [playwright, vitest]
---

## Human

(Same request as the selection commit.) A "Parts" tool panel that pops up when
parts are selected and is always under Tools, acting on all parts when none
are selected; it takes over the object list's drawer actions and adds bulk
hide/delete. Arrange (grid, pack, printer bed with overflow plates), align,
distribute, drop/centre/snap, nudge and exact moves, rotate 90°, lay flat,
mirror, scale, duplicate and arrays, group/ungroup, batch rename, cut with a
part — written as code lines, with a console API and an AI tool.

## Assistant

**Parts 2 and 3 of 4** (tracking: #1172), one commit because the panel and
the actions it drives share the same `main.ts` wiring.

- **Edits are code lines, applied after the run.** `api.movePart`,
  `rotatePart`, `scalePart`, `mirrorPart`, `copyPart`, `groupParts` and
  `cutWithPart` are recorded by the JS sandbox and applied to the returned
  mesh by moving each part's own triangles (provenance runs). That works the
  same for `api.label` parts and import parts, keeps the model parametric,
  and makes every edit visible and undoable in the source. The cost: only
  parts that are separate solids can move — a fused part gets a clear error
  telling the user to move it where it is built.
- **Line management** (`editor/partOpCode.ts`, pure + unit-tested): one block
  near the top; repeated moves of a part fold into one line (so arrow-key
  nudges don't pile up), quarter turns about one axis add up, renames rewrite
  the lines, and deleting a copy or group cascades over the lines that read it.
- **Deletes stay removal lines** so Undo / Recover deleted keep working: the
  engine skips edits of removed parts, a removed copy is skipped by name, and
  deleting a group removes its members.
- **Duplicate finds free space** (`freeOffset`) instead of a fixed offset,
  after the first screenshot showed a copy landing on its neighbour.
- **Panel** (`ui/partsPanel.ts`): the rail's per-row drawers are gone; the
  selected row gets a ⋯ that opens the panel. It auto-opens when a selection
  starts unless another tool panel is up (opening would close it), and stays
  closed for that selection once closed by hand, except when it grows from
  one part to several. The body only redraws when its signature changes, so
  typed values survive mesh updates. Rapid arrow keys coalesce while an edit
  runs.
- **Parity:** `partwright.partAction` / `undoPartEdit` (validated, in
  `help()`), `ai.md` section, `partAction` / `undoPartEdit` AI tools
  (save-gated), command-palette entries. `renameObjectPart` routes through the
  new rename when edit lines or import part names mention the part. New tuning
  knobs (gap ratio, snap and nudge steps, undo depth, copy cap) are in Advanced
  settings.
