---
date: 2026-06-07
branch: claude/inspiring-brown-MHzmu
pr: "#403"
files_changed:
  - public/catalog/print_fit_dovetail_system.partwright.json (rebaked with V3 code)
---

## Human

The catalog still shows the V2 hook, not V3.

## Assistant

Root cause: the catalog baker reads from `/tmp/catalog-bake/` using hyphenated filenames (`print-fit-dovetail-system.js`), but the previous bake step had copied with underscores (`print_fit_dovetail_system.js`). The baker silently used the stale V2 file already present with hyphenated name. Fixed by copying with the correct filename, then rebaking.
