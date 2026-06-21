# Catalog palettes

Committed `{label: "#rrggbb"}` paint palettes for catalog entries that are
colored via `paintByLabels` at bake time (figures, and any scad/replicad
entry whose `label()` carries no baked color). These are the durable bake
inputs — pass one to the bake script:

```bash
node scripts/build-catalog-entry.cjs ... --palette-file public/catalog/palettes/<id>.json
```

Regenerate the whole directory from the baked entries' `byLabel`
colorRegions (idempotent; prunes stale files):

```bash
node scripts/extract-catalog-palettes.cjs
```

Entries with colors baked in code (`api.label({color})`) have no palette
file here — that's expected. To recover a palette for an entry that was
never committed here, `--palette-from-existing <entry.partwright.json>`
on the bake script derives it on the fly.
