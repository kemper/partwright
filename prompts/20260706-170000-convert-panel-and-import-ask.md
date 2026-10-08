---
date: 2026-07-06
branch: claude/serene-ritchie-jfdhv6
files_changed:
  - src/ui/convertToCodeModal.ts
  - src/main.ts
  - tests/reconstruct.spec.ts
  - CLAUDE.md
---

## Human

Two follow-ups on the mesh→code feature after seeing the palette-only entry
point: (1) "I would also expect a gui tool in the tools menu. I'd also like
the ability to control some of the thresholds for the deterministic
approach." (2) "if the user is importing an stl … ask them if they'd like to
convert the STL to code as part of the import and give them the same
settings there."

## Assistant

One panel serves all three entry points instead of three UIs:
`src/ui/convertToCodeModal.ts` (modeled on `resizeModal` — Tools-popover
pill, draggable viewport panel) exposes the quality presets plus the actual
API thresholds (section step, levelSet edge, contour tolerance, eval
samples), each placeholdered with the value `deriveOptions` would auto-derive
for the current model's bbox, and a live "≈ N M levelSet samples — build ~Xs"
estimate from the measured per-cell cost. The palette command now opens this
panel; the Tools ▾ menu gets a "⟲ To code" pill next to Resize.

The import ask reuses the panel verbatim: `placeImportedMesh` (the single
interactive chokepoint for toolbar/drag/re-import STL paths) opens it after a
successful import with a context line and a "Keep mesh only" cancel label.
Gated to interactive imports only (`importMeshData`/console stays prompt-free
for agents) and manifold meshes (render-only slices don't close).

Fixed in review-by-test: the panel's action buttons lived inside the
scrollable body and fell below a short viewport when Advanced was open —
moved to a pinned footer and capped the panel height to the space under its
top edge, which is what makes the internal scroll actually engage.
