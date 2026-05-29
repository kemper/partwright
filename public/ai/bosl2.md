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
| Round only specific edges | `cuboid([x,y,z], rounding=2, edges="Z")` — see [Anchors and edge selectors](#anchors-and-edge-selectors) |
| Round edges of an arbitrary shape | `minkowski_difference()` or `round3d()` |
| Loft N profiles smoothly | `skin([profiles], slices=N, refine=R)` |
| Sweep profile along a 3D path | `path_sweep(profile, path)` |
| Bezier curve points | `bezier_curve(controls, splinesteps=N)` |
| NURBS-like curves | `bezier_polyline(...)` / `nurbs_curve(...)` |
| Threaded rod / bolt / nut | `threaded_rod(d=, l=, pitch=)`, `screw(spec, ...)`, `nut(spec, ...)` |
| Gear (spur, bevel, worm) | `spur_gear(...)`, `bevel_gear(...)`, `worm_gear(...)` |
| Center distance for a meshing gear pair | `gear_dist(circ_pitch=, teeth1=, teeth2=)` |
| Attachable mounting points | `attachable() { ... children(); }` (see `attachments.scad`) |
| Beams / structural shapes | `i_beam(...)`, `c_beam(...)`, `tube(...)` (hollow cylinder) |
| Cylinders with chamfered/rounded ends | `cyl(h=, d=, rounding=, chamfer=)` or `chamfer1=`/`chamfer2=` per face |
| Cylinder along X / Y axis (no `rotate`) | `xcyl(h=, d=)`, `ycyl(h=, d=)`, `zcyl(h=, d=)` |
| Mirror / linear / radial copies | `xcopies()`, `ycopies()`, `zcopies()`, `xrot_copies(n=)`, `mirror_copy()` |
| 2D grid of copies (corners, rectangular patterns) | `grid_copies(spacing=[dx,dy], n=[nx,ny])` — but see [footguns](#known-footguns) |
| Directional translate (readable shorthand) | `right(n)`, `left(n)`, `up(n)`, `down(n)`, `fwd(n)`, `back(n)` — replaces `translate([±n,0,0])` etc. |
| Axis-aligned rotation (readable shorthand) | `xrot(deg)`, `yrot(deg)`, `zrot(deg)` — replaces `rotate([deg,0,0])` etc. |
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

### A real threaded bolt + matching nut

```scad
include <BOSL2/std.scad>
include <BOSL2/screws.scad>

// `"M16x3"` = M16 with a 3mm pitch (overrides the ISO-coarse default of 2mm).
// Without the `x3` suffix you get the ISO standard for the nominal size.
screw("M16x3", length=30, head="hex", anchor=BOTTOM);

right(30)
  nut("M16x3", anchor=BOTTOM);   // same spec → matching threads
```

`screw()` and `nut()` accept a metric spec string (`"M3"`, `"M8x1.25"`, `"M16x3"`)
or an imperial one (`"#10-32"`). `head=` supports `"hex"`, `"socket"`, `"flat"`,
`"button"`, `"pan"`, `"none"`. **No built-in `washer()` module** — build it
from `cyl()` + `difference()` (see [footguns](#known-footguns)).

For a plain headless threaded rod:
```scad
threaded_rod(d=10, l=40, pitch=1.5, $fn=64);    // M10 x 40
```

### A meshing spur-gear pair

The hard part of gears isn't drawing teeth — it's positioning two gears so
their teeth actually mesh. `gear_dist()` returns the correct center-to-center
distance (accounting for any built-in profile shift); rotating one gear by
half a tooth pitch makes the teeth visually interlock at the contact point.

```scad
include <BOSL2/std.scad>
include <BOSL2/gears.scad>

PITCH = 4;
T1 = 15;
T2 = 30;

// Distance between the two gears' centers so the pitch circles are tangent.
D = gear_dist(circ_pitch=PITCH, teeth1=T1, teeth2=T2);

spur_gear(circ_pitch=PITCH, teeth=T1, thickness=6, shaft_diam=4, $fn=64);

right(D)
  zrot(180 / T2)   // half-tooth offset so teeth interlock visually
  spur_gear(circ_pitch=PITCH, teeth=T2, thickness=6, shaft_diam=4, $fn=64);
```

Use `shaft_diam=` (not `hole_diameter=`) for the central bore; the latter
is silently ignored.

### A hollow pipe tee fitting

When two hollow tubes meet at right angles, the safest idiom is **`difference`
of unioned outer shells minus unioned inner bores** — the two cavities
automatically merge through the junction:

```scad
include <BOSL2/std.scad>

OD = 30;
ID = 24;
HORIZ_L = 80;
VERT_L = 50;

difference() {
  union() {
    xcyl(h=HORIZ_L, d=OD);                                   // horizontal arm
    up(VERT_L/2) zcyl(h=VERT_L, d=OD);                       // vertical arm
  }
  union() {
    xcyl(h=HORIZ_L + 0.2, d=ID);                             // horizontal bore
    up(VERT_L/2 + 0.1) zcyl(h=VERT_L + 0.2, d=ID);           // vertical bore
  }
}
```

`tube(h=, od=, id=)` builds a hollow cylinder in one call, but for **joined**
tubes the difference-of-unions idiom is cleaner — two separate `tube()`s at
right angles leave a closed wall where they intersect.

### A rounded box with stacking lugs

`cuboid(rounding=, edges="Z")` is the BOSL2 verb that has no manifold-js
equivalent: rounded vertical edges with flat top and bottom faces — exactly
what stackable bins need.

```scad
include <BOSL2/std.scad>

W = 80; D = 60; H = 40;
R = 4;             // corner rounding
LUG_D = 5;
LUG_H = 4;
LUG_DX = W/2 - (R + LUG_D/2 + 0.5);
LUG_DY = D/2 - (R + LUG_D/2 + 0.5);

union() {
  cuboid([W, D, H], rounding=R, edges="Z", anchor=BOTTOM);

  // 4 stacking lugs hanging below the floor.
  // NOTE: hand-rolled translates — grid_copies() here would NOT fuse the
  // lugs into the parent union (see Known footguns).
  for (sx=[-1,1], sy=[-1,1])
    translate([sx*LUG_DX, sy*LUG_DY, -LUG_H + 2])     // 2mm overlap into the floor
      cyl(h=LUG_H + 2, d=LUG_D, anchor=TOP);
}
```

### Pattern arrays

```scad
include <BOSL2/std.scad>

ring_copies(n=8, r=30)   // 8 copies around a 30mm circle
  cube([4, 4, 10], center=true);
```

## Anchors and edge selectors

BOSL2's primitive modules accept two related mini-languages that aren't
obvious from the call site:

**`anchor=`** picks which point on the shape sits at the origin (or at the
parent's attach point). Common values:

- `CENTER` (default for most modules) — bbox center on origin.
- `BOTTOM` — bottom face on Z=0. Equivalent to the OpenSCAD idiom of
  building from Z=0 up.
- `TOP` — top face on Z=0; the shape hangs below.
- `LEFT` / `RIGHT` / `FRONT` / `BACK` — the corresponding bbox face.
- Compound anchors: `BOTTOM + LEFT`, `TOP + RIGHT`, etc. — corner/edge anchors.

`screw()` and `nut()` default to `anchor=BOTTOM` (sits on the build plate);
`cuboid()` / `cyl()` default to `anchor=CENTER`. When in doubt, pass it
explicitly.

**`edges=`** picks which edges of a `cuboid` get `rounding=` / `chamfer=`
applied:

- `edges="ALL"` (default when `rounding=` is set) — all 12 edges.
- `edges="Z"` — only the 4 edges parallel to Z (the 4 vertical edges).
- `edges="X"` / `edges="Y"` — edges along that world axis.
- `edges=TOP` — only the 4 edges of the top face. (Similarly `BOTTOM`, `LEFT`, etc.)
- `edges=[TOP, BOTTOM]` — combine selectors.
- `except=[BOTTOM]` — round everything *except* those edges.

Cylindrical primitives use `chamfer1=` / `chamfer2=` to chamfer one end
independently. **`chamfer1` is the anchor-side face, `chamfer2` is the
opposite face** — so with `anchor=RIGHT`, `chamfer1` is the +X (right)
end, `chamfer2` is the −X (left) end.

## Tips for AI agents

- **Always `include <BOSL2/std.scad>` first** unless you only need a specific
  module (then `include <BOSL2/gears.scad>` etc).
- **BOSL2 uses `$fn` heavily.** Most modules respect the global `$fn` for
  curve resolution. Set it once at the top of your file. Prefer
  `$fa = 4, $fs = 0.5` over a flat `$fn` for parts with very different
  scales (so a 16mm thread stays crisp without making a 60mm washer
  absurdly dense).
- **BOSL2 modules are well-documented in their `.scad` source.** If you're
  unsure of a parameter, the leading comment block of each module gives the
  full signature with defaults.
- **BOSL2's `attachable()` system** is the modern way to compose parts with
  named anchor points (`TOP`, `BOTTOM`, `RIGHT`, etc). It's more reliable
  than manual `translate(); rotate();` chains. For numeric-grid placement
  (e.g. 4 corner lugs at fixed offsets), `for` + `translate()` is still
  the cleanest tool.
- **First run is slow** (~1 second extra for the fetch). After that, fresh
  WASM instances pull cached BOSL2 bytes from JS memory.

## Known footguns

These bit AI agents producing real gallery models. They are not bugs in
BOSL2 — they're places where the natural-looking call is wrong or
underdocumented:

- **`grid_copies()` children may not fuse into a parent `union()`.**
  Empirically, putting `grid_copies(spacing=[...], n=[2,2]) lug();` inside
  a `union { shell(); ... }` produces a result where manifold-3d reports
  each lug as a *separate* connected component — even with several
  millimeters of volumetric overlap into the parent. Same input with a
  hand-rolled `for (sx=[-1,1], sy=[-1,1]) translate(...) lug();` fuses
  cleanly into one component. If you're seeing a higher `componentCount`
  than you expect, swap `grid_copies` for an explicit loop.

- **`"Mdxp"` overrides the ISO pitch on `screw()` / `nut()`.** Without the
  `xN` suffix, `screw("M16", ...)` uses the ISO-coarse default (2mm for
  M16). To override: `screw("M16x3", ...)` — and **the matching `nut("M16x3")`
  must use the same pitch suffix** or its threads won't line up.

- **`spur_gear`'s bore param is `shaft_diam=`, not `hole_diameter=`.** The
  latter is silently ignored. To verify: render with both, look at the
  triangle count — if it doesn't change, the parameter is being dropped.

- **BOSL2 ships no `washer()` module.** Build one manually:
  ```scad
  difference() {
    cyl(h=2, d=30, chamfer=0.4);   // outer disc, beveled rim
    cyl(h=3,   d=17);               // through-hole, taller to avoid coplanarity
  }
  ```

- **`prismoid()` takes a square footprint.** For tapered *round* posts
  (e.g. self-locating stacking lugs), use `cyl(h=, d1=, d2=)` with two
  different diameters, OR `cyl(h=, d=, chamfer2=)` for a clean chamfered tip.

- **Flush-touching boolean union (`overlap = 0`) leaves parts as separate
  components.** Same rule as manifold-js: shapes meant to fuse need at
  least 0.5mm of volumetric overlap, often more for tapered/curved
  contact patches. When in doubt, give it 1mm and verify with
  `partwright.componentBounds()` after `runAndSave`.

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
