---
date: 2026-06-06
branch: claude/inspiring-brown-MHzmu
pr: "#403"
files_changed:
  - src/geometry/printFit.ts
  - examples/print_fit_project_box.js
  - examples/print_fit_knob.js
  - examples/print_fit_snap_box.js
  - examples/print_fit_rail_plate.js (new)
  - examples/print_fit_wall_hook.js (new)
  - examples/print_fit_wall_mount.js (deleted)
  - public/catalog/print_fit_knob.partwright.json
  - public/catalog/print_fit_project_box.partwright.json
  - public/catalog/print_fit_snap_box.partwright.json
  - public/catalog/print_fit_rail_plate.partwright.json (new)
  - public/catalog/print_fit_wall_hook.partwright.json (new)
  - public/catalog/print_fit_wall_mount.partwright.json (deleted)
  - public/catalog/manifest.json
  - tests/catalog.spec.ts
---

## Human

After reviewing the rebuilt print-fit catalog, the user requested:
- Split the Dovetail Wall Mount into two separate catalog entries (rail plate + hook) because they have independent parameters
- Add rounded snap tabs to the snap-fit box
- Add vent slots to the electronics project box
- Make all models parametric via api.params()
- The dovetail rail plate should auto-scale screw count with rail length

## Assistant

**Why split wall mount into two parts:** The wall plate has railLength/screwSpacing/screwSize as parameters, while the hook has hookReach/lipHeight. These parameters have no sensible cross-component relationship — combining them in one Customizer panel would be confusing. Splitting into catalog entries means each can be parameterized independently and users print one plate + N hooks.

**Rounded snap tabs — chamfer not arc fillet:** The initial instinct was to add a quarter-cylinder fillet at the snap tab's retention edge. The problem: a cylinder tangent to two flat faces has zero-volume overlap, so `.add()` produces a separate manifold component (componentCount rises from 1 to 2). The fix is a 45°-rotated cube subtracted at the corner: `Manifold.cube([w,c,c]).translate([x,-c/2,-c/2]).rotate([45,0,0]).translate([0,y,z])`. This creates a clean diagonal bevel via subtraction only — no floating geometry. The same issue and fix applied to the inner J-corner chamfer on the wall hook arm.

**Arm cross-section for wall hook:** Used `CrossSection.square([w,h]).offset(-r).offset(r,'round')` for the arm and lip profiles, giving a rounded-rectangle cross-section. The arm extrudes along Z then rotates [-90,0,0] which maps Z→-Y, so Z translation must add armThk to reach the correct positive-Z position.

**Dovetail groove through-hook:** Length set to `hookBlockH + 20` so the groove spans 10mm past each end of the hook block, allowing free sliding in both directions along the rail.

**Auto-screw count:** `Math.max(1, Math.round(usableLen / screwSpacing) + 1)` distributes screws between endMargin from each end, with at least one screw always present.

**Catalog test fix:** The page-wide Parametric badge assertion previously assumed only customizable + fidget-toys sections could have parametric tiles. Since all print-fit entries now use api.params(), added `printFitBadges` to the expected total.
