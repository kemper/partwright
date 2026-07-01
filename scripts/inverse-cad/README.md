# inverse-cad — headless STL → parametric-code iteration loop

Give an AI agent an STL file. It iterates a Partwright manifold-js snippet
until the produced mesh is close to the target. Runs in the shell, never
touched by the app bundle.

Tracking: [#878](https://github.com/kemper/partwright/issues/878).

## Not a Partwright feature

Everything under `scripts/inverse-cad/` is offline tooling. The app doesn't
import from here. The scripts consume the same engine layer that
`scripts/model-preview.mjs` uses (vite-node → the manifold-js worker) so a
candidate snippet renders exactly the way it would in the app, but the loop
itself lives in shell scripts you run by hand.

## Pieces

| File | Role |
|---|---|
| `stl.mjs` | Parse and write STL (binary + ASCII). Vertex/triangle only, no color. |
| `mesh.mjs` | Vertex-weld and connected-component split on a raw triangle soup. |
| `splitStl.mjs` | CLI: split a multi-part STL into one file per component. |
| `sampleMesh.mjs` | Uniform surface point sampling weighted by triangle area, plus a k-d tree for nearest-neighbor queries. (TODO) |
| `distance.mjs` | Chamfer, Hausdorff, symmetric-difference volume. (TODO) |
| `invariants.mjs` | Bbox, PCA axes, symmetry, RANSAC primitive fits. (TODO) |
| `eval.mjs` | Score a candidate `.js` vs target STL, render side-by-side. (TODO) |
| `iterate.mjs` | The main loop. (TODO) |
| `GRAMMAR.md` | Curated primitive subset the AI composes from. (TODO) |

## Splitting a multi-part STL

```bash
node scripts/inverse-cad/splitStl.mjs input.stl --out out/
# writes out/input.00.stl, out/input.01.stl, ...
node scripts/inverse-cad/splitStl.mjs input.stl --report   # prints components, no files
```

The splitter welds coincident vertices (default tolerance `1e-5` in STL
units), builds a triangle adjacency graph via shared edges, and BFS-labels
components. Each component is written back as a fresh binary STL.
