// Vintage biplane — sky-blue fuselage with twin canvas wings, a yellow nose
// cowling, a red tail, a dark propeller, and wooden interplane struts.
module label(name) { children(); }

$fn = 40;

// --- fuselage: tapered body via hull of three rings along +X (nose at +X) ---
label("fuselage") hull() {
  translate([22, 0, 0]) rotate([0, 90, 0]) cylinder(h=0.5, r=3.0, center=true);
  translate([ 5, 0, 0]) rotate([0, 90, 0]) cylinder(h=0.5, r=4.0, center=true);
  translate([-22, 0, 1]) rotate([0, 90, 0]) cylinder(h=0.5, r=1.2, center=true);
}

// --- engine cowling: short fat truncated cone at the nose ---
label("cowling") translate([24.2, 0, 0]) rotate([0, 90, 0])
  cylinder(h=3, r1=3.3, r2=3.0, center=true);

// --- propeller: hub plus two crossed blades at the very tip ---
label("propeller") translate([26.4, 0, 0]) union() {
  // hub: short cylinder pointing along +X (prop shaft axis)
  rotate([0, 90, 0]) cylinder(h=1.2, r=0.9, center=true);
  // vertical blade (long in Z, thin in X)
  cube([0.5, 1.2, 14], center=true);
  // horizontal blade (long in Y, thin in X)
  cube([0.5, 14, 1.2], center=true);
}

// --- lower wing: long thin slab through the belly ---
label("lower-wing") translate([2, 0, -2.5])
  cube([8, 44, 0.9], center=true);

// --- upper wing: parallel slab above the fuselage ---
label("upper-wing") translate([2, 0, 6])
  cube([8, 44, 0.9], center=true);

// --- struts: four vertical posts joining the wings ---
label("strut") union() {
  for (sy = [-14, 14], sx = [-1.5, 4.5])
    translate([sx, sy, 1.8]) cube([0.6, 0.6, 8.8], center=true);
}

// --- tail group: vertical fin + horizontal stabilizer ---
label("tail") union() {
  // horizontal stabilizer
  translate([-22, 0, 1.5]) cube([5, 14, 0.5], center=true);
  // vertical fin built from a hull so it sweeps up + back
  hull() {
    translate([-22, 0, 4]) cube([5, 0.5, 0.5], center=true);
    translate([-24, 0, 7]) cube([2, 0.5, 0.5], center=true);
  }
}
