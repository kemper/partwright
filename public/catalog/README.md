# Catalog

Static `.partwright.json` files surfaced on the `/catalog` page. Each
entry is a self-contained session payload (schema 1.3+) that imports as
a fresh session when a user clicks its tile.

## Adding a new entry

The starter set is generated from `examples/*.{js,scad}` by
`scripts/generate-catalog.cjs` (see [Regenerating from examples](#regenerating-from-examples)
below). For one-off entries authored interactively in the app:

1. Build the model in the editor and save at least one version.
2. Click `↓ Export` → `Session (.partwright.json)`. In the dialog, **enable
   the Thumbnail option** so the catalog tile gets a real preview image.
3. Drop the downloaded `.partwright.json` into this directory.
4. Add a corresponding entry to `manifest.json`:

   ```json
   {
     "id": "my-model",
     "name": "My Model",
     "description": "Short blurb.",
     "file": "my_model.partwright.json",
     "language": "manifold-js"
   }
   ```

5. Commit. Cloudflare Pages serves these as static assets — no build step
   required.

## Regenerating from examples

The starter entries are produced by driving a running dev server with
Playwright, capturing real thumbnails for each example. To regenerate:

```bash
npm run dev                                        # in one terminal
node scripts/generate-catalog.cjs http://localhost:5173   # in another
```

Re-run any time `examples/` or the entry list at the top of the script
changes.

## Baking a single entry (with gates and palettes)

`scripts/build-catalog-entry.cjs` bakes one entry from a source file by
driving a running dev server. For painted models (figures, scad/replicad)
pass a palette, and turn the quality checks into **exit-code gates** so a
regression can't be committed by accident:

```bash
npm run dev    # in one terminal
node scripts/build-catalog-entry.cjs \
  --source examples/figure_karate.js --name "Karate Master" \
  --out public/catalog/karate.partwright.json \
  --palette-file public/catalog/palettes/karate.json \
  --max-genus 3 --require-labels skin,eyes,iris,pupil,headband
```

- `--max-genus N` — fail if the baked solid's genus exceeds `N` (catches a
  prop ring grazing a shell, near-tangent micro-handles, …).
- `--require-labels a,b,c` — fail if any listed label is missing, lost, or
  (when painting) resolves to 0 triangles — the "buried eyes" failure mode
  where a sub-cell feature aliases away and its paint silently no-ops.
- On a gate failure the script exits non-zero **without writing the entry**.

**Palettes live in `public/catalog/palettes/<id>.json`** (flat
`{label: "#rrggbb"}`) — committed, so re-bakes on a fresh container don't
have to reconstruct colors. If an entry's palette was never committed,
`--palette-from-existing <old-entry.partwright.json>` derives it from the
baked entry's `byLabel` colorRegions; `scripts/extract-catalog-palettes.cjs`
does the same for the whole catalog and refreshes the palettes directory.

## Auditing thumbnails for staleness

A thumbnail (and the geometry stats baked alongside it) is **not**
automatically re-rendered when an entry's code changes — so a redesigned
model can keep showing its old tile until someone re-bakes it. To catch
that drift across the whole catalog:

```bash
npm run dev                                  # in one terminal
npm run audit:catalog -- http://localhost:5173   # in another
```

`scripts/catalog-audit.cjs` re-imports every entry, re-runs its stored
code through the real app engine (covers all four: manifold-js / scad /
replicad / voxel), and compares the freshly-computed geometry against the
stats that were baked with the stored thumbnail. A material **volume** or
**component-count** divergence means the thumbnail is stale (triangle-count
wobble alone is just tessellation noise and is ignored). Set
`ONLY=id1,id2` to audit a subset. Fresh PNGs for flagged entries land in
`/tmp/catalog-audit/` for eyeballing.

To fix a flagged entry, re-bake its thumbnail *and* stats from the current
code with `node scripts/catalog-fix-thumbnails.cjs <id,id,...>` (it
preserves color regions and entry metadata), or use the `rethumb` mode of
`scripts/catalog-regen.cjs` for the thumbnail alone.

## Notes

- Files are fetched at runtime by `src/ui/catalog.ts`. Keep them small;
  the embedded thumbnail is a base64 PNG and dominates file size.
- A missing/broken entry renders a disabled placeholder tile rather than
  blocking the whole page.
- Entries without an embedded thumbnail show the hexagon placeholder.
- **Thumbnail orientation: iso azimuth ≈135° (the +X,−Y corner) by default.** The
  catalog 3/4 tile camera looks from the +X/−Y corner — by default, put the
  model's front face there. A face authored on flat +Y shows the *back* of the
  head in the tile. For voxel characters, see also `/ai/voxel.md` Gotchas.
  **Override:** pin a per-entry tile angle instead of baking orientation into the
  geometry. Every bake path supports it:
  - `scripts/single-catalog-entry.cjs` and `scripts/build-catalog-entry.cjs` —
    set `THUMB_AZIMUTH` / `THUMB_ELEVATION` (degrees) in the environment.
  - `generators/*.ts` entries — add `thumbCamera: { azimuth, elevation }` to the
    entry/spec object.
  - `partwright bake` fixtures — add `"thumbCamera": { "azimuth": N, "elevation": N }`
    to the `.meta.json`.
  - Or call `partwright.setThumbnailCamera({ azimuth, elevation })` before saving.
  The pin is stored on the session and exported with the entry, so re-renders
  keep the angle.
- **File size: prefer `byLabel` paint for catalog entries.** Coordinate paint
  (`paintInBox` / `paintNear`) bakes per-triangle ID lists that can push a file
  to 10–20 MB; `paintByLabels` stores only the label name and stays under ~300 KB.
  Check the exported `.partwright.json` size before committing. The `lint:catalog`
  gate fails any entry over 1.5 MB and flags entries over 500 KB as advisory.
