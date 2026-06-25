---
session: "busycray"
timestamp: "2026-06-21T16:09:31Z"
model: claude-opus-4-8
sequence: 5
---

## Human

"Let's build the oracle tool" (#697) → after investigation, reframed to: the
local headless figures look lower-quality than the Chrome rendering, but Chrome
is very slow. Is it possible to improve the headless tool? [Chose: ship the
rasterizer upgrade as default; also build a warm-browser fast path next.]

## Assistant

## Key decisions

**First established #697's componentCount oracle is STALE** (not built): Node SSR
and the browser agree exactly on componentCount + genus across 8 cases (incl. a
genus-37 witch), and `Manifold.ofMesh`-in-Node is faithful (direct == ofMesh on
every case), so the agent's proposed one-line "fix" was a no-op. The paint half
was already shipped by `figure:smoke`. No oracle needed.

**Diagnosed the real complaint — render quality, not mesh.** Browser
`triangleCount` == headless `triangleCount` (376,582 for chibi_wizard), same
topology. The gap is 100% the headless rasterizer: flat per-face shading
(faceted) + no antialiasing (jagged silhouettes) + one dull light.

**Upgraded the rasterizer in `scripts/cli/preview.mjs`** (benefits
`model:preview`, `figure:smoke` renders, and eval contact sheets):
- `vertexNormals()` — area-weighted per-vertex normals (same scheme as Three.js
  `computeVertexNormals`), computed once per model, shared across views →
  smooth Gouraud shading instead of faceted flat shading.
- `renderTile()` rewritten for SS=2 supersampled AA (render 2×, box-downsample)
  → anti-aliased edges.
- `shadeLights()` — key + fill + ambient instead of one hard light → reads as
  form, closer to the browser's lit look.

Verified: before/after shows the hat brim de-facets and the staff/silhouettes
anti-alias (shown to user). Same mesh, no GL dependency, stays fast — simple
sphere still 2.0s; the SS work is a negligible fraction (WASM meshing dominates).
Re-pinned the shoulders eval reference + pixel baseline so the committed corpus
is coherent with the new renderer.

**Next (separate deliverable, approved):** a warm persistent headless browser so
true app-fidelity renders cost a few seconds (amortized warmup) instead of ~60s.
