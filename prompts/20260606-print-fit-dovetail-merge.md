---
date: 2026-06-06
branch: claude/inspiring-brown-MHzmu
pr: "#403"
files_changed:
  - examples/print_fit_dovetail_system.js (new, replaces rail_plate + wall_hook)
  - examples/print_fit_rail_plate.js (deleted)
  - examples/print_fit_wall_hook.js (deleted)
  - public/catalog/print_fit_dovetail_system.partwright.json (new)
  - public/catalog/print_fit_rail_plate.partwright.json (deleted)
  - public/catalog/print_fit_wall_hook.partwright.json (deleted)
  - public/catalog/manifest.json
---

## Human

Opened the Rail Plate from the catalog and saw only 1 part — no hook alongside it.

## Assistant

The rail plate and wall hook were separate catalog entries that had to be opened
separately. Since they only make sense as a pair (no reason to print one without
the other), merging them into a single "Dovetail Rail System" entry — the same
pattern the Electronics Project Box uses for base + lid — was clearly right.

The combined file exposes all five params (railLength, screwSpacing, screwSize,
hookReach, lipHeight), places the plate at the origin, and positions the hook
beside it (offset by plateW + 20mm in X, centered on the plate's Z midpoint so
the thumbnail shows both parts at comparable apparent size). componentCount=2,
both labeled with distinct colors. Rebaked the single combined thumbnail.
