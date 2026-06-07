---
date: "2026-06-07T14:30:00Z"
task: "feat: engine-aware headless preview + photo→voxel CLI"
pr: 470
areas: [tooling, import-export, renderer, surface]
cost: medium
---

## Liked / Worked
- The Vite-SSR `previewModel.ts` pattern is the unsung hero. Adding the `voxel`
  and `scad` engines to the stateless tier was ~20 lines because the engines
  already run unmodified in Node — and the same SSR trick let me dogfood the
  real `src/import/imageToVoxel.ts` from a CLI script with zero reimplementation.
- `composePng` being exported from `preview.mjs` meant I could render any mesh
  (not just `model:preview` output) to a 4-view PNG. The fast `photo → grid →
  mesh → PNG` loop (~3s, no browser) is exactly the right inner loop for
  iterating on generated geometry, and it caught real issues (floating tail
  tips, head absorbed into a chunky body) a human-eyes-on screenshot reveals
  instantly.
- The voxel engine's pure-JS purity made a `keepLargest()` weld helper trivial
  to write *inside the model snippet* (BFS over `v.forEach`), guaranteeing a
  single printable piece across 8 generated variants.

## Lacked
- The stateless preview tier silently supported only manifold-js. `api.voxels`
  lives in a *separate* engine, so the `voxels.decode(...)` code the app's image
  import emits could never preview through `model:preview` — an invisible cliff.
  Cost ~several turns mapping the engine layer before I realized the fix was to
  make the tier engine-aware, not write a one-off.
- No way to get a chat-attached image onto disk. Every photo task needs a manual
  download step (a Google Photos share link, scraped via curl + the init-data
  blob — only the cover image is in the static HTML). Cost ~3 turns.

## Learned
- `replicad`/OpenCASCADE will **not** init under Node SSR: its Emscripten glue
  uses `__dirname` (shimmable) and then resolves its `.wasm` to a server-style
  `/node_modules/...` path that doesn't exist on the Node filesystem. OpenSCAD,
  by contrast, inits cleanly (~600ms). So the stateless tier tops out at
  manifold-js + voxel + scad; replicad needs the Phase-2 daemon.
- `manifold.decompose()` can report `componentCount > 1` for a grid that is
  fully **face-connected** (verified by a 6-neighbour BFS) — it counts interior
  pockets / edge-only touches. For "is this one printable piece?", a face-
  connectivity BFS is the trustworthy check, not `componentCount`.
- Voxel smooth surfacing (`v.smooth`) at ~1 voxel/unit looks lumpy/bumpy, not
  smooth — it needs `detail` (supersample) ≥ 2 to read as a clean toy surface.

## Longed for
- A `partwright fetch <url> [--out dir]` (or a known drop-folder convention) so
  chat-attached / shared images land on disk without hand-scraping a share page.
- A `--compare a.js b.js c.js` mode for `preview`/`photo` that stitches one iso
  view per model into a single contact sheet — I rendered 8 separate 4-view PNGs
  to compare variants; one grid would be far easier to eyeball.
- `imageToVoxel` should accept "snap to my active palette" directly if/when this
  becomes an in-app feature, instead of the CLI passing a `--palette` JSON while
  the app keeps the palette in localStorage.
