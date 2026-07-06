---
date: 2026-07-05
branch: claude/confident-carson-gpo63q
files_changed:
  - src/renderer/atlasUV.ts
  - src/renderer/viewport.ts
  - src/color/textureBake.ts
  - src/main.ts
  - tests/unit/atlasUV.test.ts
  - public/catalog/pomni_articulated.partwright.json
---

## Human

The UV bake experiment looked great — update the whole Pomni catalog
entry with that approach to see it solve a harder problem.

## Assistant

Productized the texture layer as three small pieces instead of a schema
migration:

- **`renderer/atlasUV.ts`** — the per-triangle-cell parameterization is a
  pure formula over (triangleIndex, atlasSize, grid), so NOTHING about
  the UVs persists. A leaf under renderer/ because the viewport can't
  import feature layers while feature layers may import the renderer.
- **`color/textureBake.ts`** — the bake kernel: per-view scoped subsets,
  triangle-ID-buffer visibility, continuous-RGB bilinear sampling, and
  the load-bearing safety rule discovered on the whole-kit run: texels
  bake from an image ONLY when the view's ID buffer PROVES this triangle
  is visible there; everything else falls back to the current palette
  paint. (The first whole-kit bake sampled "loose" texels from
  misprojected pixels — Gemini had recomposed a piece image, moving its
  neck ball, and the silhouette alignment stretched wrong. Strictness +
  palette fallback means an unreliable image can never poison paint that
  is already correct.)
- **Viewport texture path + `bakeTextureAtlas`/`clearTextureAtlas`** —
  the atlas persists as a plain session ATTACHMENT (WebP, label
  `texture-atlas:{atlasSize}:{grid}:{numTri}`), riding the existing
  attachment persistence through save/export/import; an `images-changed`
  listener re-activates it on session open, with numTri as the staleness
  guard (a re-run that changes the mesh falls back to palette colors).

A hard-won debugging lesson from the scratch phase: baking against a
RAW STL parse scrambled sparse triangles because region ids refer to the
APP's mesh indexing (Manifold.ofMesh rewelds); the product API avoids
the whole class by running against currentMeshData + buildTriColors.

The catalog entry now carries the texture (head baked from its seven
verified views at per-pixel quality; body pieces palette-flat by the
fallback rule). Export size needed one more move: the payload embeds
`geometryData.colorRegions`, a byte-identical duplicate of the version's
canonical `colorRegions` (~4 MB here); stripping it from the entry was
verified by import round-trip (texture active, all 254 regions intact)
and brought the file to 22 MB, under the Cloudflare 25 MiB cap. The
structural fix (don't emit the duplicate at export) is filed on #885.
