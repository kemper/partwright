---
session: "inverse-cad"
timestamp: "2026-07-04T09:00:00Z"
model: claude-fable-5
sequence: 49
---

## Human

"bake the armor into the catalog"

## Assistant

## Key decisions

**Baked `dummy13-faithful-armor`**: all 16 converged armor parts as a
print plate (4×4 grid, each dropped to z=0). Two technical fixes en
route:
- The 16-way boolean union of heavy levelSet meshes hit a fatal WASM
  error — switched to `Manifold.compose(plate)` (mesh merge, correct
  since the grid guarantees no overlaps).
- Composed mesh was 3.52M tris (levelSet density); `simplify(0.03)`
  decimated it 40× to 88.8k within 0.03mm fidelity. The tolerance arg on
  levelSet itself was a no-op — `.simplify()` post-pass is the tool.

Entry: 517KB (over the 500KB advisory, under the 1500 gate — noted),
manifest at 155 entries, lint:catalog OK. Thumbnail from the real
viewport bake.
