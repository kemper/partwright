$fn = 40;
// Fuselage — tapered body via hull of three rings along +X (nose at +X).
hull() {
  translate([22, 0, 0]) rotate([0, 90, 0]) cylinder(h = 0.5, r = 3.0, center = true);
  translate([5, 0, 0]) rotate([0, 90, 0]) cylinder(h = 0.5, r = 4.0, center = true);
  translate([-22, 0, 1]) rotate([0, 90, 0]) cylinder(h = 0.5, r = 1.2, center = true);
}
// Engine cowling — moved to x=23 so it overlaps the fuselage nose (x=22).
translate([23, 0, 0]) rotate([0, 90, 0]) cylinder(h = 3, r1 = 3.3, r2 = 3.0, center = true);
// Propeller — moved to x=24.8 so the hub overlaps the cowling.
translate([24.8, 0, 0]) union() {
  rotate([0, 90, 0]) cylinder(h = 1.2, r = 0.9, center = true);
  cube([0.5, 1.2, 14], center = true);
  cube([0.5, 14, 1.2], center = true);
}
// Lower wing — slab through the belly.
translate([2, 0, -2.5]) cube([8, 44, 0.9], center = true);
// Upper wing — parallel slab above (joined to the lower wing by the struts).
translate([2, 0, 6]) cube([8, 44, 0.9], center = true);
// Struts — four posts joining the wings.
for (sy = [-14, 14], sx = [-1.5, 4.5])
  translate([sx, sy, 1.8]) cube([0.6, 0.6, 8.8], center = true);
// Tail — horizontal stabilizer + vertical fin (fin lowered to meet the stabilizer/fuselage).
translate([-22, 0, 1.5]) cube([5, 14, 0.5], center = true);
hull() {
  translate([-22, 0, 2]) cube([5, 0.5, 2], center = true);
  translate([-24, 0, 6]) cube([2, 0.5, 0.5], center = true);
}
