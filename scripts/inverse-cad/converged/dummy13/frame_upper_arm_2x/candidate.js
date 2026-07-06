// frame_upper_arm_2x — sibling transfer from frame_thigh_2x (fork end shifted y-8)
// Verified against bootstrap traces + z=2.5/4.75/4.3 plan sections by chord math:
//  - spool at (0,0): r2.5, r2.0 face chamfers, 45deg V-groove to r1.5 @z2.5,
//    truncated-cone dimples r1.0->r0.5 depth 0.5 (no hole at z=4.3 => flat floor)
//  - window slab z 1.0..4.1, ends at shaft face y=5 (plan section: [+-2.5, 5.0])
//  - shaft oct2.5 y 0..6.5; 45deg flare y 6.5..8 (band4 chord hw 3.2509 @y7.251)
//  - fork oct4 y 8..14; slot hole y 7.6284..8.95 == thigh slot -8 (point-for-point)
//  - cavity y 9..11.6 (plan [+-3.10, 9.00..11.60]); bump r2.00 c(0,7.45)
//  - channel y 11.6..14 (plan [+-1.60, 11.60..14.00])
//  - diagonal flare chamfer: z=4.75 face x=y-4.35 == thigh's at y+8
const { Manifold, CrossSection, geom } = api;

const SEG = 96;

// chamfered octagon profile (x,z), half-width hw, z 0..5, 0.5 chamfers
function oct(hw) {
  return geom.fromPoints([
    [-(hw - 0.5), 0], [hw - 0.5, 0], [hw, 0.5], [hw, 4.5],
    [hw - 0.5, 5], [-(hw - 0.5), 5], [-hw, 4.5], [-hw, 0.5],
  ]);
}
// extrude an (x,z) CrossSection along +Y from y0 to y1
function yPrism(cs, y0, y1) {
  return cs.extrude(y1 - y0, 0, 0, [1, 1]).rotate([90, 0, 0]).translate([0, y1, 0]);
}

// ---- body: shaft + flare + fork ----
const shaft = yPrism(oct(2.5), 0, 6.5);
const flare = yPrism(oct(2.5), 6.49, 6.5).add(yPrism(oct(4), 8.0, 8.01)).hull();
const fork = yPrism(oct(4), 8, 14);
// diagonal chamfer prism (tactic 5.16): true 45deg chamfer perpendicular to the
// tilted flare face; profile in (d,z), d = plan distance along face normal (1,-1)/sqrt2.
const diagProfile = geom.fromPoints([
  [-30, 0], [-0.5, 0], [0, 0.5], [0, 4.5], [-0.5, 5], [-30, 5],
]);
const diagP = diagProfile.extrude(40, 0, 0, [1, 1])
  .rotate([90, 0, 0]).rotate([0, 0, -45])
  .translate([14.142, 18.142, 0]);
const diagM = diagP.mirror([1, 0, 0]);
let body = shaft.add(flare.add(fork).intersect(diagP).intersect(diagM));

// ---- window slab: bridges z 0..1 (bottom) and 4.1..5 (top) ----
const slab = Manifold.cube([6, 9.1, 3.1], false).translate([-3, -4.1, 1.0]);
body = body.subtract(slab);

// ---- spool at (0,0): revolve profile (r,z) about Z ----
const spoolProfile = geom.fromPoints([
  [0, 0], [2.0, 0], [2.5, 0.5], [2.5, 1.5], [1.5, 2.5],
  [2.5, 3.5], [2.5, 4.5], [2.0, 5], [0, 5],
]);
const spool = spoolProfile.revolve(SEG);
body = body.add(spool);

// ---- curved slot (thigh trace shifted y-8; constant through Z) ----
const slotCS = geom.fromPoints([
  [2.44, 8.31], [2.50, 8.45], [1.20, 8.52], [0.31, 8.92], [-0.44, 8.89],
  [-1.20, 8.52], [-2.41, 8.50], [-2.44, 8.31], [-0.50, 7.67], [0.17, 7.63], [0.99, 7.80],
]);
const slot = slotCS.extrude(7, 0, 0, [1, 1]).translate([0, 0, -1]);
body = body.subtract(slot);

// ---- fork cavity: y 9..11.6 ----
const cavityXZ = CrossSection.circle(3.1, SEG).translate([0, 2.5])
  .add(CrossSection.square([5.0, 1.667], false).translate([-2.5, -1.0]))
  .add(CrossSection.square([5.6, 2.167], false).translate([-2.8, 3.833]));
let cavity = yPrism(cavityXZ, 9, 11.6);
// wall bump (material kept): vertical cylinder r2.0 at (0,7.45)
const bump = Manifold.cylinder(7, 2.0, 2.0, 64, false)
  .translate([0, 7.45, -1]);
cavity = cavity.subtract(bump);
body = body.subtract(cavity);

// ---- channel: y 11.6..14 (cut past the tip) ----
const channelXZ = CrossSection.circle(1.6, 64).translate([0, 2.5])
  .add(CrossSection.square([3.0, 3.5], false).translate([-1.5, 2.5]));
const channel = yPrism(channelXZ, 11.6, 15);
body = body.subtract(channel);

// ---- dimples: subtract LAST (bridge material overlaps the spool center) ----
const dimpleBot = Manifold.cylinder(0.5, 1.0, 0.5, 48, false);
const dimpleTop = Manifold.cylinder(0.5, 0.5, 1.0, 48, false).translate([0, 0, 4.5]);
body = body.subtract(dimpleBot).subtract(dimpleTop);

return body;
