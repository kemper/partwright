// frame_shin_2x — measured reconstruction (sibling of frame_thigh_2x)
// Architecture (all numbers probed):
//  - knee ball: sphere r3.0 c(0,-28,2.5), clipped flat at z=0 (build plate)
//  - neck: Y-prism y -26..-24 of D-profile [circle r1.5 c(0,2.5) cut z>=1.2]
//  - shaft: chamfered-octagon 5x5 (0.5 x 45deg long-edge chamfers) y -24..0,
//    with a 0.5 x 45deg perimeter chamfer on the -Y end face (hull, faces pinned)
//  - window slab void z 1.0..4.1 from shaft face y=-5.0 past the spool
//    (bridges z 0..1 and 4.1..5 connect shaft to spool) — genus handle 1
//  - ankle spool at (0,0): revolve r2.5, 45deg V-groove to r1.5 @z2.5 (z 1.5..3.5),
//    0.5 chamfers at z0/z5 faces (r2.0), truncated-cone dimples r1.0->r0.5
//    depth 0.5 on both faces — subtracted LAST (bridge overlaps spool center)
const { Manifold, CrossSection, geom } = api;

const SEG = 96;

// chamfered octagon profile (x,z), half-width hw, z 0..5, 0.5 chamfers
function oct(hw) {
  return geom.fromPoints([
    [-(hw - 0.5), 0], [hw - 0.5, 0], [hw, 0.5], [hw, 4.5],
    [hw - 0.5, 5], [-(hw - 0.5), 5], [-hw, 4.5], [-hw, 0.5],
  ]);
}
// oct(2.5) offset inward by 0.5 (perpendicular, miter) — for the end-face chamfer
const octSmall = geom.fromPoints([
  [-1.7929, 0.5], [1.7929, 0.5], [2.0, 0.7071], [2.0, 4.2929],
  [1.7929, 4.5], [-1.7929, 4.5], [-2.0, 4.2929], [-2.0, 0.7071],
]);
// extrude an (x,z) CrossSection along +Y from y0 to y1
function yPrism(cs, y0, y1) {
  return cs.extrude(y1 - y0, 0, 0, [1, 1]).rotate([90, 0, 0]).translate([0, y1, 0]);
}

// ---- knee ball (clipped at z=0) ----
const ball = Manifold.sphere(3, SEG).translate([0, -28, 2.5])
  .intersect(Manifold.cube([8, 8, 6], false).translate([-4, -32, 0]));

// ---- neck: D-profile (circle r1.5 c(0,2.5), flat bottom z=1.2) ----
const neckCS = CrossSection.circle(1.5, SEG).translate([0, 2.5])
  .intersect(CrossSection.square([4, 4], false).translate([-2, 1.2]));
const neck = yPrism(neckCS, -26, -24.0);

// ---- shaft end-face chamfer: hull, outer faces pinned on y=-24 and y=-23.5 ----
const endCh = yPrism(octSmall, -24.0, -23.99)
  .add(yPrism(oct(2.5), -23.5, -23.49)).hull();

// ---- shaft (runs to spool center; window carves the bridges) ----
const shaft = yPrism(oct(2.5), -23.5, 0);

let body = ball.add(neck).add(endCh).add(shaft);

// ---- window slab void: z 1.0..4.1 from shaft face y=-5.0 (genus handle 1) ----
const slab = Manifold.cube([7, 8.5, 3.1], false).translate([-3.5, -5.0, 1.0]);
body = body.subtract(slab);

// ---- ankle spool at (0,0): revolve profile (r,z) about Z ----
const spoolProfile = geom.fromPoints([
  [0, 0], [2.0, 0], [2.5, 0.5], [2.5, 1.5], [1.5, 2.5],
  [2.5, 3.5], [2.5, 4.5], [2.0, 5], [0, 5],
]);
const spool = spoolProfile.revolve(SEG);
body = body.add(spool);

// ---- dimples: subtract LAST ----
const dimpleBot = Manifold.cylinder(0.5, 1.0, 0.5, 48, false);
const dimpleTop = Manifold.cylinder(0.5, 0.5, 1.0, 48, false).translate([0, 0, 4.5]);
body = body.subtract(dimpleBot).subtract(dimpleTop);

return body;
