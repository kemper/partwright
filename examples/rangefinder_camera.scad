module label(name) { children(); }

// Camera body: a rounded box that includes the top plate cap
label("body") union() {
  translate([-40, -12,  2]) cube([80, 24, 26]);
  translate([0, 0, 28]) cube([80, 24, 4], true);
}

// Lens barrel (front of camera) -- pointing +Y, mounted on body front
label("lens")
  translate([0, 12, 15])
    rotate([-90, 0, 0])
      difference() {
        union() {
          cylinder(h = 22, r1 = 11, r2 = 10, $fn = 48);
          translate([0, 0, 22]) cylinder(h = 3, r = 12, $fn = 48);
          translate([0, 0, -2]) cylinder(h = 2, r = 12, $fn = 48);
        }
        translate([0, 0, 18]) cylinder(h = 8, r = 8, $fn = 48);
      }

// Front glass element (dark, recessed inside the lens barrel)
label("glass")
  translate([0, 33, 15])
    rotate([-90, 0, 0])
      cylinder(h = 1, r = 7.5, $fn = 48);

// Shutter release button on the top plate
label("shutter")
  translate([28, 0, 31]) cylinder(h = 3, r = 3, $fn = 32);

// Rangefinder / viewfinder windows -- two small rectangles set into the front
label("viewfinder") union() {
  // main viewfinder window
  translate([-26, 11.5, 26]) cube([10, 2, 5], true);
  // rangefinder window
  translate([18, 11.5, 26]) cube([8, 2, 5], true);
}

// Wind lever knob on the right side of the top plate
label("wind")
  translate([34, -7, 31])
    cylinder(h = 4, r = 4, $fn = 32);
