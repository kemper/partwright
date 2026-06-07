---
date: 2026-06-06
branch: claude/inspiring-brown-MHzmu
pr: "#403"
files_changed:
  - examples/print_fit_rail_plate.js
  - examples/print_fit_snap_box.js (deleted)
  - public/catalog/print_fit_rail_plate.partwright.json
  - public/catalog/print_fit_snap_box.partwright.json (deleted)
  - public/catalog/manifest.json
  - tests/print-fit.spec.ts
---

## Human

Reviewing the rebuilt print-fit catalog, the user reported:
1. The dovetail rail plate's screw holes run down the center, directly under the
   rail — a screwdriver can never reach them.
2. They didn't see any hooks in the gallery.
3. They don't believe the snap-fit box would actually work — drop it.

## Assistant

**Rail plate screws (real bug):** Confirmed via model:preview — both the rail and
the screw holes were centered at x = plateW/2, so every countersink sat under
the dovetail rail. Fixed by widening the plate (38 → 44 mm) and moving the
screws into two columns flanking the rail at x = plateW*0.15 and plateW*0.85
(~6.6 and ~37.4 mm), clear of the ~9.5 mm rail-base half-width plus the ~4 mm
countersink head radius. The auto-count parameter now drives Z *levels* (2
screws per level) instead of a single center column, so the plate also mounts
level. Rebaked the catalog thumbnail.

**Hooks in gallery (no code bug):** The wall-hook entry was already correctly
registered in manifest.json with a valid thumbnail, and catalogCategories.ts has
no per-group display limit. Screenshotted the live /catalog page — all four
print-fit tiles render, including Dovetail Wall Hook. The user was almost
certainly looking at a Cloudflare preview from before the bake landed; confirmed
present now.

**Snap-fit box (dropped):** Removed the example, its catalog payload, its
manifest row, and its baker fixtures. Kept the `snapFit` *builder* in printFit.ts
— it's a core library primitive with its own tests, independent of the catalog
example — and added a `snapFit.clip (rounded)` case to print-fit.spec.ts so the
`rounded` option (formerly only exercised by the deleted box) stays covered.
