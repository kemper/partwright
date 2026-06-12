---
session: "01CZby"
timestamp: "2026-06-07T14:20:00Z"
---

## Human

I want to create highly detailed voxel versions of my photos, constrained to a
fixed colour palette I own (15 colours), and iterate quickly by having previews
generated from the CLI. Also: I want to be able to generate previews for all 4
engines I have, even if that requires CLI updates — do that first so the voxel
preview comes out correctly.

(Scope narrowed during the session to one photo — a wide-eyed gray tabby,
supplied via a Google Photos share link.)

## Assistant

## Key decisions

**Made the stateless preview tier engine-aware instead of writing a one-off
photo script.** `src/tools/previewModel.ts` (behind `model:preview` and
`partwright preview/run`) only ran `manifold-js`. The voxel `voxels.decode(…)`
code the app's image import emits runs in a *separate* engine (`api.voxels` is
not in the manifold-js sandbox), so it could never preview through that path.
Rather than bridge photos→PNG in isolation, `previewModel` now takes a `lang`
and dispatches to the right engine — the same dogfooding the app does — so any
voxel/SCAD model previews through the standard tool. `--lang` threads through
`scripts/cli/preview.mjs`, `scripts/cli/main.mjs`, and `scripts/model-preview.mjs`.

**Three of four engines run in the fast (no-browser) tier; replicad stays
Phase-2.** Spiked each under Vite SSR in Node: `voxel` is pure JS (trivial),
`scad`'s OpenSCAD WASM initialises cleanly (~600 ms), but `replicad`'s
OpenCASCADE glue resolves its `.wasm` to a server-style `/node_modules/…` path
that doesn't exist on Node's filesystem (`__dirname` shim gets past the first
error, then the binary 404s). Fixing that is fragile WASM-path plumbing, and the
Phase-2 daemon already drives replicad via the real app, so `STATELESS_ENGINES`
is `['manifold-js','voxel','scad']` and replicad is documented as
`iterate --lang replicad`.

**Reconstruct a Manifold from the mesh for non-manifold-js stats.** The voxel
and SCAD paths hand back `manifold: null` (voxel never builds one; the worker
frees SCAD's). `previewModel` now round-trips `Manifold.ofMesh(mesh)` to compute
volume/genus/components — voxel meshes are welded + watertight so this is exact —
and frees the reconstructed handle. The rasterizer also prefers the mesh's own
`triColors` (per-triangle, the layout `composePng` already wants) over
label-derived colours, so per-voxel palette colours render faithfully.

**`partwright photo` is the CLI front door to the existing image→voxel
pipeline, not a reimplementation.** `scripts/cli/photo.mjs` does file IO on the
main thread (sharp: decode + EXIF-orient + Lanczos downsample, optional crop)
and loads `src/import/imageToVoxel.ts` + the voxel mesher via SSR, so the codegen
matches the in-app import exactly (one source of truth, no drift). It resizes to
the target longest-side with sharp first so the pipeline's own nearest-neighbour
downsample is a no-op — area averaging beats point-sampling a 12 MP photo to
64 px. One command emits the `voxels.decode(…)` model, a 4-view PNG, and stats
(voxel count, dims, per-slot palette histogram). Palette via `--palette` (JSON
of `"#rrggbb"` or `{name,hex}`); the user's 15-colour palette lives under
`.plans/` (gitignored, personal), and the CLI default is the app's 6-slot
palette.

This is the prototype for a possible in-app "photo → voxel" feature; keeping the
conversion in the shared TS module means the CLI and a future UI stay in sync.
