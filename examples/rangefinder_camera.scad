// Camera body — rounded box + top plate cap.
union() {
  translate([-40, -12, 2]) cube([80, 24, 26]);
  translate([0, 0, 28]) cube([80, 24, 4], true);
}
// Lens barrel — base extended to y=10 so it bites 2mm into the body front (y=12).
translate([0, 10, 15]) rotate([-90, 0, 0]) difference() {
  union() {
    cylinder(h = 22, r1 = 11, r2 = 10, $fn = 48);
    translate([0, 0, 22]) cylinder(h = 3, r = 12, $fn = 48);
    translate([0, 0, -2]) cylinder(h = 2, r = 12, $fn = 48);
  }
  translate([0, 0, 18]) cylinder(h = 8, r = 8, $fn = 48);
}
// Front glass — solid plug filling the lens bore (y28..35), so no sealed
// cavity is left behind a thin disc. Fuses to the bore wall.
translate([0, 28, 15]) rotate([-90, 0, 0]) cylinder(h = 7, r = 8.7, $fn = 48);
// Shutter button — lowered to z=28 so it overlaps the top plate (z26..30).
translate([28, 0, 28]) cylinder(h = 3, r = 3, $fn = 32);
// Viewfinder windows — set into the front face.
union() {
  translate([-26, 11.5, 26]) cube([10, 2, 5], true);
  translate([18, 11.5, 26]) cube([8, 2, 5], true);
}
// Wind lever knob — lowered to z=28 so it overlaps the top plate.
translate([34, -7, 28]) cylinder(h = 4, r = 4, $fn = 32);
