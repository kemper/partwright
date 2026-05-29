$fn = 20;
cylinder(h = 14, r1 = 9, r2 = 11, $fn = 32); // pot
translate([0, 0, 13]) cylinder(h = 2.6, r = 11.8, $fn = 32); // rim
translate([0, 0, 14.2]) cylinder(h = 0.4, r = 10.5, $fn = 32); // soil
translate([0, 0, 12.6]) union() { // body
  cylinder(h = 24, r = 5, $fn = 24);
  translate([0, 0, 24]) sphere(r = 5, $fn = 20);
}
translate([3, 0, 24]) rotate([0, 50, 0]) union() { // arm-r
  cylinder(h = 8, r = 2.2, $fn = 18);
  translate([0, 0, 8]) sphere(r = 2.2, $fn = 16);
}
translate([-3, 0, 28]) rotate([0, -45, 0]) union() { // arm-l
  cylinder(h = 6.5, r = 2.0, $fn = 18);
  translate([0, 0, 6.5]) sphere(r = 2.0, $fn = 16);
}
translate([0, 0, 41]) sphere(r = 2.0, $fn = 18); // flower (pokes out of the dome apex)
translate([-1.6, -4.2, 22]) sphere(r = 1.0, $fn = 16); // eye L
translate([1.6, -4.2, 22]) sphere(r = 0.6, $fn = 12); // eye R
