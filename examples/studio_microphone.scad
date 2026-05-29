$fn_hi = 56;
$fn_med = 32;
$fn_lo = 20;

// Stand base — wide domed disc.
union() {
  cylinder(h = 3, r = 18, $fn = $fn_hi);
  translate([0, 0, 3]) scale([1, 1, 0.35]) sphere(r = 16, $fn = $fn_hi);
}
// Vertical pole — extended up to z=46 so it runs INTO the mic body (z42+),
// structurally joining the upper assembly to the stand.
translate([0, 0, 3]) cylinder(h = 43, r = 2.2, $fn = $fn_med);

// Pivot cross-bar — joins the pole (r2.2) to the yoke ring (x=+-10) at z=41,
// so the shock-mount yoke is no longer floating.
translate([0, 0, 41]) cube([22, 1.5, 1.5], center = true);

// Yoke / shock-mount C-bracket.
translate([0, 0, 41]) difference() {
  rotate([90, 0, 0]) rotate_extrude($fn = $fn_med) translate([10, 0, 0]) square([2.5, 4], center = true);
  translate([0, 0, -6]) cube([30, 8, 12], center = true);
}
// Microphone body — capsule.
translate([0, 0, 45]) union() {
  cylinder(h = 22, r = 6, $fn = $fn_hi);
  translate([0, 0, -3]) cylinder(h = 3, r1 = 4.5, r2 = 6, $fn = $fn_hi);
  translate([0, 0, 22]) cylinder(h = 1.2, r = 6.6, $fn = $fn_hi);
}
// Wire grille — spherical mesh head.
translate([0, 0, 74]) difference() {
  sphere(r = 7.5, $fn = $fn_hi);
  for (z = [-5: 1.6: 5]) {
    translate([0, 0, z]) rotate([90, 0, 0]) cylinder(h = 20, r = 0.45, $fn = 12, center = true);
    translate([0, 0, z]) rotate([0, 90, 0]) cylinder(h = 20, r = 0.45, $fn = 12, center = true);
  }
}
// Brand badge — sunk so it straddles the body surface (y=-6) and stays fused.
translate([0, -5.5, 54]) rotate([90, 0, 0]) cylinder(h = 1.0, r = 2.2, $fn = $fn_med);

// Cable — drop from the body bottom (extended up to z=43 to overlap) + coil on base.
union() {
  translate([0, 0, 36]) cylinder(h = 7, r = 0.8, $fn = 16);
  translate([0, 0, 36]) sphere(r = 0.9, $fn = 16);
  for (i = [0: 3]) {
    translate([0, 0, 4 + i * 0.6]) rotate_extrude($fn = $fn_med) translate([3.2 + i * 0.3, 0, 0]) circle(r = 0.6, $fn = 12);
  }
}
