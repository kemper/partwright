module label(name) { children(); }

$fn = 20;

// Terracotta pot — flared truncated cone sitting on the build plate.
label("pot") cylinder(h = 14, r1 = 9, r2 = 11, $fn = 32);

// Pot rim — a slightly wider thin disc capping the pot.
label("rim") translate([0, 0, 14]) cylinder(h = 1.6, r = 11.8, $fn = 32);

// Soil — dark disc resting just inside the rim.
label("soil") translate([0, 0, 14.2]) cylinder(h = 0.4, r = 10.5, $fn = 32);

// Cactus body — a stout vertical capsule (cylinder + dome on top).
label("body") translate([0, 0, 14.6]) union() {
  cylinder(h = 22, r = 5, $fn = 24);
  translate([0, 0, 22]) sphere(r = 5, $fn = 20);
}

// Right arm — short branch with a rounded tip.
label("arm-r") translate([3.6, 0, 24]) rotate([0, 50, 0]) union() {
  cylinder(h = 8, r = 2.2, $fn = 18);
  translate([0, 0, 8]) sphere(r = 2.2, $fn = 16);
}

// Left arm — mirror of the right, slightly higher and shorter.
label("arm-l") translate([-3.6, 0, 28]) rotate([0, -45, 0]) union() {
  cylinder(h = 6.5, r = 2.0, $fn = 18);
  translate([0, 0, 6.5]) sphere(r = 2.0, $fn = 16);
}

// Pink flower bud perched on top of the cactus.
label("flower") translate([0, 0, 32]) sphere(r = 1.8, $fn = 18);

// Smiley eyes — two tiny black spheres on the front of the body.
label("eyes") union() {
  translate([-1.8, -4.7, 22]) sphere(r = 0.55, $fn = 12);
  translate([ 1.8, -4.7, 22]) sphere(r = 0.55, $fn = 12);
}
