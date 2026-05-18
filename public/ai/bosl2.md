# BOSL2 in OpenSCAD

BOSL2 (Belfry OpenScad Library v2) is bundled with the app and lazy-loaded the
first time your SCAD code references it. To use it, start your file with one
of:

```scad
include <BOSL2/std.scad>   // pulls in attachments, transforms, shapes, distributors, math
use     <BOSL2/std.scad>   // same, but doesn't auto-expose modules at the call site
```

After `include <BOSL2/std.scad>`, you have access to the full standard set:
rounding masks, paths, bezier curves, skin/loft, sweep, screws, gears,
threading, attachments, and more.

> The library is BSD-2-Clause licensed (see `/openscad-libs/BOSL2/LICENSE`).
> It loads once per page session — ~4 MB of `.scad` source. The first BOSL2
> run on a fresh page takes an extra second or two; subsequent runs are fast.

## Capability map (verbs we previously couldn't do)

| Want | BOSL2 module |
|---|---|
| Round/chamfer edges of a cuboid | `cuboid([x,y,z], rounding=2)` or `..., chamfer=2` |
| Round edges of an arbitrary shape | `minkowski_difference()` or `round3d()` |
| Loft N profiles smoothly | `skin([profiles], slices=N, refine=R)` |
| Sweep profile along a 3D path | `path_sweep(profile, path)` |
| Bezier curve points | `bezier_curve(controls, splinesteps=N)` |
| NURBS-like curves | `bezier_polyline(...)` / `nurbs_curve(...)` |
| Threaded rod / bolt / nut | `threaded_rod(d=, l=, pitch=)`, `screw(...)`, `nut(...)` |
| Gear (spur, bevel, worm) | `spur_gear(...)`, `bevel_gear(...)`, `worm_gear(...)` |
| Attachable mounting points | `attachable() { ... children(); }` (see `attachments.scad`) |
| Beams / structural shapes | `i_beam(...)`, `c_beam(...)`, `tube(...)` |
| Mirror / linear / radial copies | `xcopies()`, `ycopies()`, `zcopies()`, `xrot_copies(n=)`, `mirror_copy()` |
| Polygon rounding (2D) | `round_corners()` |

## Worked examples

### Filleted box (the #1 missing CAD verb)

```scad
include <BOSL2/std.scad>

cuboid([40, 30, 20], rounding=3);   // all 12 edges rounded with radius 3
```

For per-edge control:
```scad
include <BOSL2/std.scad>

cuboid([40, 30, 20], rounding=3, edges="Z");   // only the 4 vertical edges
```

### Loft (skin) between profiles

```scad
include <BOSL2/std.scad>

profiles = [
  circle(r=20, $fn=64),
  square([30, 30], center=true),
  circle(r=10, $fn=64),
];
zs = [0, 30, 60];

skin(profiles, z=zs, slices=20, refine=2);   // smooth blend
```

### Sweep a profile along a 3D path

```scad
include <BOSL2/std.scad>

path = arc(d=80, angle=270, n=64);  // 3/4 circle in XY
path3d = path3d(path);
profile = circle(r=4, $fn=24);

path_sweep(profile, path3d);
```

### A real threaded bolt

```scad
include <BOSL2/std.scad>

threaded_rod(d=10, l=40, pitch=1.5, $fn=64);    // M10 x 40
```

### A spur gear

```scad
include <BOSL2/std.scad>

spur_gear(mod=2, teeth=20, thickness=6, hole_diameter=5, $fn=64);
```

### Pattern arrays

```scad
include <BOSL2/std.scad>

ring_copies(n=8, r=30)   // 8 copies around a 30mm circle
  cube([4, 4, 10], center=true);
```

## Tips for AI agents

- **Always `include <BOSL2/std.scad>` first** unless you only need a specific
  module (then `include <BOSL2/gears.scad>` etc).
- **BOSL2 uses `$fn` heavily.** Most modules respect the global `$fn` for
  curve resolution. Set it once at the top of your file.
- **BOSL2 modules are well-documented in their `.scad` source.** If you're
  unsure of a parameter, the leading comment block of each module gives the
  full signature with defaults.
- **BOSL2's `attachable()` system** is the modern way to compose parts with
  named anchor points (`TOP`, `BOTTOM`, `RIGHT`, etc). It's more reliable
  than manual `translate(); rotate();` chains.
- **First run is slow** (~1 second extra for the fetch). After that, fresh
  WASM instances pull cached BOSL2 bytes from JS memory.

## When NOT to reach for BOSL2

Use plain OpenSCAD (no `include`) for very simple parts — primitives,
booleans, basic `linear_extrude`/`rotate_extrude`. The 1-second first-load
penalty isn't worth it for a 20-line script.

For mesh-level smoothing, SDFs, or `warp(fn)`-style deformation, switch to
the manifold-js engine — those are JS-only capabilities (BOSL2 can't reach
into the mesh after CSG).

## Library inventory

The full BOSL2 module set is mirrored under `/openscad-libs/BOSL2/`:

```
affine, attachments, ball_bearings, beziers, bosl1compat, bottlecaps,
builtins, color, comparisons, constants, coords, cubetruss, distributors,
drawing, fnliterals, gears, geometry, hinges, hooks, isosurface, joiners,
linalg, linear_bearings, lists, masks, math, metric_screws, miscellaneous,
modular_hose, nema_steppers, nurbs, partitions, paths, polyhedra, regions,
rounding, screw_drive, screws, shapes2d, shapes3d, sliders, skin, sponges,
stacks, std, strings, structs, threading, transforms, trigonometry, tripod,
turtle3d, utility, vectors, version, vnf, walls, wiring
```

Pull only what you need:
```scad
include <BOSL2/gears.scad>      // just gears + dependencies
include <BOSL2/screws.scad>     // just screws + dependencies
include <BOSL2/std.scad>        // the kitchen sink (most common)
```
