---
session: "5ecjfq"
timestamp: "2026-11-15T16:02:17Z"
sequence: 7
tools: [explore]
---

## Human

Confirmed the design (opaque layers by default, a checkbox for an estimated
blending preview) and said to proceed with best judgement; the owner will test
what gets built.

## Assistant

## Key decisions

**The preview is a real coloured mesh, not a shader.** The model's triangles
are split at band boundaries and each piece gets its band's colour, producing
an ordinary `MeshData` with per-triangle colours. A shader on the viewport
material would have been less code, but it would only exist in the interactive
viewport. A mesh can be drawn by the viewport, by the offscreen renderer the
AI looks through, and by the headless preview, and it unit-tests without a GPU.

**The layer slider is one more split plane, with a cap.** Pieces above the cut
are dropped and the opening is closed by chaining the cut segments into loops
and triangulating them (holes by even-odd nesting), so a hollow model shows a
ring rather than a filled square or a see-through shell. An open mesh that
cannot be capped is reported (`capped: false`) and still drawn.

**Flat faces on a boundary pick a side by which way they face.** A top surface
exactly on a layer boundary belongs to the layer below it; an underside on the
same boundary belongs to the layer above. Getting this wrong would colour the
top of every band in the next band's colour.

**Blending only touches upward-facing pieces,** and adds split planes for the
first few layers of each band so the estimate can vary with depth on slopes.
Side walls stay the pure band colour.

**Layer colours are stored as a line of model code** (`api.print.layerColors`),
edited by a pure text helper that reuses the lexical mask from the surface
codegen, so a call inside a comment or string is never touched. This follows
the app's existing paint-in-code and surface-in-code pattern: versioned with
the model and drivable by the AI, with no session schema change.

**Still not wired into the app.** These modules are imported only by their
tests; the engine hook, viewport, panel, export and API come next.
