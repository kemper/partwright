---
session: "017xgfPQK41H8feC99NhRjKm"
timestamp: "2026-10-23T14:08:04Z"
tools: [playwright]
---

## Human

"No worry about cleanup (we can have an AI do that later as a capability). Add
the ability to hide a part with a eye icon. Hiding seems like it doesn't need a
code change but I trust your judgment and that you'll succeed. Then merge it."

## Assistant

## Key decisions

**Hiding is view state, not code.** Unlike delete, hiding is about what you
look at, not what the model is. It belongs with the highlight (per tab, not
saved or exported) rather than in the code, so exports, versions and
`renderViews` still include the part.

**Collapse triangles in place, don't rebuild.** `src/renderer/hiddenTriangles.ts`
collapses each hidden triangle to a point in the live geometry (index buffer
for the indexed path, positions for the per-triangle-colour path). Triangle
numbering is unchanged, so paint/measure picks on visible triangles still map
to the right ids, and a zero-area triangle is never drawn or ray-hit. The
indexed path shares `mesh.triVerts` as its index buffer, so it edits a copy.
Considered and rejected: a filtered geometry (breaks face-index → triangle-id
mapping) and multi-material groups (every `solid.material` consumer assumes
one material, and three.js still ray-casts invisible groups).

**Re-applied on every mesh update.** `updateMesh` builds fresh geometry each
run, so `main.ts` re-applies from the `setOnMeshUpdate` hook. The label mesh
is already current by then, so there's no one-frame flash. When the displayed
mesh was re-tessellated (textures, paint refine), the label mesh's triangle
ids are mapped with the existing `remapTriangleSets`.

**State is keyed per object** (`part:<name>` / `piece:<n>`). Part hides
follow the name across edits; piece hides are dropped when that piece number
no longer exists. A fused part leaves an opening where it was, which is what
"hide a surface" means here; documented in `ai.md`.

**Shared icons.** The paint panel's eye / eye-off SVGs moved to
`src/ui/icons.ts` so the object list reuses them instead of copying.

**Parity:** `partwright.setObjectPartHidden(name | {piece}, hidden)`, a
`setObjectPartHidden` AI tool (retry-safe, always available, like
`highlightObjectPart`), `hidden` flags in `listObjectParts()`, `help()`
and `ai.md`.
