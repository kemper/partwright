---
session: "jx4qtt"
timestamp: "2026-10-09T17:00:00Z"
tools: [subagent]
---

## Human

Let's do #1003 (editing parts from the Objects rail). Go big and do as much of
it as you can so I can test. My earlier steer: these are tool functions we
already have, which can now be applied to one specific part because the left
rail lets people select it. Keep the way they work unified.

## Assistant

## Key decisions

**The selection is a scope, not a new editor.** One selection lives in the leaf
`src/ui/partSelection.ts`. The rail, the viewport (double-click a part), the
paint panel, the Surface panel and the AI chat all read it.
- Paint descriptors gain an optional `scope: { label }`, so every tool clips the
  same way instead of each tool growing its own "part mode".
- `pattern` already had `scope.label`, so the field generalises an existing
  idea.
- `scope` is keyed by name, which means scoped paint survives code edits.

**Interactive vs scripted paint are deliberately separate.**
- The interactive tools commit through `addPaintRegion`, which applies the rail
  selection.
- Script and agent paint uses `addRegion` with an explicit `scope`. A wrapper
  over the committing `partwright.paint*` methods strips `scope`, runs the call
  inside `withExplicitPaintScope`, and corrects the returned triangle count.
- A user's UI selection never silently narrows an agent's call. The selection
  reaches the AI as chat context instead: a chip in the input, and a prefixed
  context line on the message.

**Clip at every assignment path, not just one.**
- `addRegion` clips on add, through a scope clipper that `main.ts` publishes.
- `resolveDescriptorTriangles` clips on every re-resolve (`clipToPartScope`).
- The worker-computed brush footprints are clipped too. A real UI drag test
  found they bypassed the resolver.
- On refined (subdivided) meshes, `labelTrianglesOnMesh` maps the run mesh's
  label sets through `baseTriangleOf`, cached per topology (`triVerts`).

**Retire the paint panel's Labels list.** Its whole-part fill moves to the rail
swatch, so there's one place for it. The panel shows a "Painting: handle ✕" chip
instead. Replace-within-a-part needed a new `colorMatch` descriptor kind:
recolouring whole regions would leak outside the part.

**Unmatched paint is kept, never dropped.** Rehydrate used to discard regions
that resolved to 0 triangles, so a renamed label silently lost its paint on the
next save. Label-keyed regions are now kept dormant and surfaced in:
- the rail (Reassign / Keep / Delete);
- the export confirm;
- `runAndSave` / `saveVersion` (`unmatchedPaint`).

A rename suggestion fires when one label vanished in the same run that another
appeared in an overlapping bbox.

**Code-writing actions reuse the API.** Every rail action calls the same
`window.partwright` method an agent would, which gives UI ↔ API parity:
- `renameObjectPart` (string literals plus re-keyed paint);
- `bakeObjectPartColor` (`api.paint.label`);
- `extract/delete/exportObjectPiece`.

The piece filters wrap the original code untouched in an IIFE and match pieces
by bounding box, so small parameter edits keep tracking them. A real-engine
check confirmed labels survive `decompose` / `compose`. The filters tolerate the
editor's auto-format rewriting the spec line.

**Fixed a pre-existing bug on the way.** After a second smooth paint plus undo,
the code-declared colour underlay vanished. The cause was in
`reresolveModelRegions`: on a full rebuild it carried refined-space ids through
a map built from the base mesh. It now re-resolves from the descriptor.

**Schema 1.20** for the additive `scope` / `colorMatch`. Unknown descriptor
kinds now resolve to an empty region instead of throwing, which protects the
next bump.
