// frame_thigh_2x — measured reconstruction
// Architecture: Y-prismatic body (shaft oct2.5 / 45° flare / fork oct4)
//  + spool end at (0,0): revolved profile r2.5 with 45° V-groove to r1.5 @z2.5,
//    0.5 chamfers top/bottom, conical dimples r1->0 depth 1 both faces
//  + window slab cut z 1..4.1 between spool and shaft face y=5 (genus handle 1)
//  - curved slot (traced, through-Z, genus handle 2)
//  - fork cavity: Y-prism y 17..19.6 of [circle r3.1 c(0,2.5) U rect x2.5 low U rect x2.8 high]
//    minus wall bump (r2.0 arc c(0,15.45)) -> C-clip flex wall (genus handle 3)
//  - channel: Y-prism y 19.6..22 of [circle r1.6 c(0,2.5) U rect x1.5 upper]
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
const shaft = yPrism(oct(2.5), 0, 14.5);
const flare = yPrism(oct(2.5), 14.49, 14.5).add(yPrism(oct(4), 16.0, 16.01)).hull();
const fork = yPrism(oct(4), 16, 22);
// diagonal chamfer prism: the flare face x-y+12=0 recedes a full (z-4.5) in plan
// within the chamfer zones (true 45deg chamfer perpendicular to the tilted face).
// Profile in (d,z), d = plan distance along the face normal (1,-1)/sqrt2.
const diagProfile = geom.fromPoints([
  [-30, 0], [-0.5, 0], [0, 0.5], [0, 4.5], [-0.5, 5], [-30, 5],
]);
const diagP = diagProfile.extrude(40, 0, 0, [1, 1])
  .rotate([90, 0, 0]).rotate([0, 0, -45])
  .translate([14.142, 26.142, 0]);
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

// ---- curved slot (traced at z=2.5; constant through Z) ----
const slotCS = geom.fromPoints([
  [2.44, 16.31], [2.50, 16.45], [1.20, 16.52], [0.31, 16.92], [-0.44, 16.89],
  [-1.20, 16.52], [-2.41, 16.50], [-2.44, 16.31], [-0.50, 15.67], [0.17, 15.63], [0.99, 15.80],
]);
const slot = slotCS.extrude(7, 0, 0, [1, 1]).translate([0, 0, -1]);
body = body.subtract(slot);

// ---- fork cavity: y 17..19.6 ----
const cavityXZ = CrossSection.circle(3.1, SEG).translate([0, 2.5])
  .add(CrossSection.square([5.0, 1.667], false).translate([-2.5, -1.0]))
  .add(CrossSection.square([5.6, 2.167], false).translate([-2.8, 3.833]));
let cavity = yPrism(cavityXZ, 17, 19.6);
// wall bump (material kept): vertical cylinder r2.0 at (0,15.45)
const bump = Manifold.cylinder(7, 2.0, 2.0, 64, false)
  .translate([0, 15.45, -1]);
cavity = cavity.subtract(bump);
body = body.subtract(cavity);

// ---- channel: y 19.6..22 (cut past the tip) ----
const channelXZ = CrossSection.circle(1.6, 64).translate([0, 2.5])
  .add(CrossSection.square([3.0, 3.5], false).translate([-1.5, 2.5]));
const channel = yPrism(channelXZ, 19.6, 23);
body = body.subtract(channel);

// ---- dimples: subtract LAST (the bridge material overlaps the spool center) ----
const dimpleBot = Manifold.cylinder(0.5, 1.0, 0.5, 48, false);
const dimpleTop = Manifold.cylinder(0.5, 0.5, 1.0, 48, false).translate([0, 0, 4.5]);
body = body.subtract(dimpleBot).subtract(dimpleTop);

return body;
