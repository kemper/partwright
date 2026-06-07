---
date: 2026-06-04
branch: claude/confident-allen-cXiyA
files_changed:
  - public/catalog/manifest.json
  - public/catalog/parameterized_chain.partwright.json
  - public/catalog/hot_dog.partwright.json
  - public/catalog/voxel_castle.partwright.json
  - public/catalog/medieval_watchtower.partwright.json
  - public/catalog/retro_tv.partwright.json
  - tests/catalog.spec.ts
---

## Human

I have some cool models that I'd like to add to the catalog. They are all
attached (Parameterized Chain, voxel castles, hotdog, Retro TV, medieval
tower). If you discover some cleanup is needed on any let me know.

## Assistant

Added five exported sessions to `public/catalog/` + manifest rows. Treated the
uploads as raw session exports and normalized them to the catalog convention
rather than dropping them in verbatim.

Cleanup applied during import:

- **Stripped the `chat` transcript from every file.** No existing catalog entry
  carries `chat` (0/76) — it bloats the file with the authoring conversation
  and isn't part of the model. `notes` are kept (the convention; 59/76 carry
  them), as are the `sessionId`/`sessionUrl`/`galleryUrl` geometry-data fields
  (all 72 thumbnailed entries carry those).
- **Dropped the broken v3 from Parameterized Chain.** v3 was byte-identical to
  v2 except for trailing whitespace on blank lines, but its render had crashed
  with "memory access out of bounds" (the 30-link `Curves.sweep` union is
  ~514k triangles and occasionally OOMs the WASM heap). Since the catalog opens
  the *latest* version and pulls its thumbnail from it, shipping v3 would have
  landed users on a crashed version. Removed it; v2 (the working spiral) is now
  latest. Kept v1 (5-link interlocking) too.
- **Renamed the default session names** "Session 5/29/2026" → "Hot Dog" /
  "Voxel Castle" so an imported session reads sensibly (the tile label comes
  from `manifest.name`, but the session name is what the editor shows).
- **Set `session.language: 'voxel'`** on the voxel castle so the imported
  session opens in the voxel engine and the catalog badge/category resolve
  correctly when the payload loads (the per-version `voxel` language already
  drove the engine, but the session-level field was null).

Voxel Castle is the **first** entry in the `voxel` category, which until now
rendered as an empty (hidden) section. That made `tests/catalog.spec.ts`'s
hard-coded "exactly 5 sections / `[customizable, manifold, sdf, scad, brep]`"
assertion stale, so I updated it to 6 sections including `voxel` (in
`CATEGORIES` order, between `sdf` and `scad`).

Categorization (driven by code traits + language): Parameterized Chain and Hot
Dog → Customizable (both declare `api.params`); Medieval Watchtower and Retro
TV → JavaScript; Voxel Castle → Voxel.

Verified by loading each entry via `/editor?catalog=<file>` in a real browser
and screenshotting the rendered result — all five import and render correctly
(chain on its working v2, hot dog with 7 customizer knobs, voxel castle on the
VOXEL engine, watchtower with its 6 paint regions, retro TV). Build + 598 unit
tests pass.
