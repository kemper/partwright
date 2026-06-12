---
date: 2026-06-06
branch: claude/inspiring-brown-MHzmu
pr: "#403"
files_changed:
  - examples/print_fit_dovetail_system.js (rewritten)
  - public/catalog/print_fit_dovetail_system.partwright.json (rebaked)
---

## Human

The hook orientation is off by 45 degrees. The whole idea is that the rail would
run horizontally and the hook would slide on but be a vertically oriented hook from
the horizontal rail. I also really want a curved hook — make it a nice curved and
attractive hook that people could 3D print and hang things like jackets onto.

## Assistant

Two distinct problems required a complete rewrite of `print_fit_dovetail_system.js`:

**Rail orientation (geometry bug):** The original file applied `rotate([0,-90,0])` to
the dovetail tail, making the rail run along Z (vertical). Since `printFit.dovetail()`
already runs along X by default, the correct approach needs *no rotation at all* on
the tail — just `tail.translate([0, plateT-0.5, plateH/2])`. The plate itself is
built by extruding a chamfered height×thickness profile along Z (railLen) and then
applying `rotate([0,-90,0]).translate([railLen,0,0])`, producing:
- Plate: X 0..railLen × Y 0..plateT × Z 0..plateH
- Rail (tail): X 0..railLen, protrudes +Y, centred at Z=plateH/2

Screw columns moved from flanking-in-X to flanking-in-Z at `[plateH*0.15, plateH*0.85]`
(clear of the rail which is centred at Z=plateH/2 ± 8mm). The hook block's dovetail
socket likewise needed no rotation — `socket.translate([-10, 0, hookBlockH/2])`.

**Curved coat hook arm (design change):** The rectangular J-hook extrusion was replaced
with a proper cylindrical arm built from three joined solids:

1. **Stem** — `Manifold.cylinder(stemLen, armR, armR, 24).rotate([-90,0,0])` — straight
   section going in +Y from the block face.

2. **Quarter-torus bend** — `Manifold.revolve(CrossSection.circle(armR).translate([bendR,0]), 24, 90)`.
   Manifold.revolve sweeps in the XY plane (X=radius, Y→Z after revolve, final arc in XY
   at Z=0). Two chained rotations reorient it: `.rotate([-90,0,0]).rotate([0,0,90])`
   maps the arc from (bendR,0,0)→(0,bendR,0) to (0,bendR,0)→(0,0,-bendR) — forward
   then curving downward, which is the right shape for a coat hook.

3. **Tapered tip + ball cap** — `Manifold.cylinder(tipLen, armR, armR*0.55, 24)` rotated
   180° around X to hang in -Z, plus a sphere cap at the tip.

Each segment connects at the same centre point and radius (armR=7mm), so the union is
clean and the junctions are geometrically continuous. The arm exits the block at 75% of
block height (armZCenter=hookBlockH*0.75), curves downward to ~8mm below the block base,
giving a classic J-profile without any flat-extruded surfaces.

Removed the `lipHeight` parameter (not applicable to the curved arm). Rebaked the
catalog thumbnail.
