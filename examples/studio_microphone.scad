module label(name) { children(); }

// --- Classic studio microphone on a desk stand ---
// All paint regions live at the top level so SCAD label provenance survives.

$fn_hi  = 56;
$fn_med = 32;
$fn_lo  = 20;

// Stand base — a wide, slightly domed disc on the floor
label("base") union() {
    cylinder(h = 3, r = 18, $fn = $fn_hi);
    translate([0, 0, 3]) scale([1, 1, 0.35])
        sphere(r = 16, $fn = $fn_hi);
}

// Vertical pole rising from the base
label("pole") translate([0, 0, 3])
    cylinder(h = 38, r = 2.2, $fn = $fn_med);

// Yoke / shock mount — a U-shaped bracket that cradles the mic body.
// The difference stays inside the single label so provenance survives.
label("yoke") translate([0, 0, 41]) difference() {
    rotate([90, 0, 0])
        rotate_extrude($fn = $fn_med)
            translate([10, 0, 0]) square([2.5, 4], center = true);
    translate([0, 0, -6]) cube([30, 8, 12], center = true);
}

// Microphone body — the cylindrical capsule that hangs in the yoke.
label("body") translate([0, 0, 45]) union() {
    cylinder(h = 22, r = 6, $fn = $fn_hi);
    translate([0, 0, -3]) cylinder(h = 3, r1 = 4.5, r2 = 6, $fn = $fn_hi);
    translate([0, 0, 22]) cylinder(h = 1.2, r = 6.6, $fn = $fn_hi);
}

// Wire grille — spherical mesh head with crossed cuts that read as wire mesh.
label("grille") translate([0, 0, 74]) difference() {
    sphere(r = 7.5, $fn = $fn_hi);
    for (z = [-5 : 1.6 : 5]) {
        translate([0, 0, z]) rotate([90, 0, 0])
            cylinder(h = 20, r = 0.45, $fn = 12, center = true);
        translate([0, 0, z]) rotate([0, 90, 0])
            cylinder(h = 20, r = 0.45, $fn = 12, center = true);
    }
}

// Brand badge — a small disc on the front of the mic body
label("badge") translate([0, -6.1, 54])
    rotate([90, 0, 0])
        cylinder(h = 0.6, r = 2.2, $fn = $fn_med);

// Cable — a short drop from the bottom of the mic plus stacked coil rings on the base.
label("cable") union() {
    translate([0, 0, 36]) cylinder(h = 6, r = 0.8, $fn = 16);
    translate([0, 0, 36]) sphere(r = 0.9, $fn = 16);
    for (i = [0 : 3]) {
        translate([0, 0, 4 + i * 0.6])
            rotate_extrude($fn = $fn_med)
                translate([3.2 + i * 0.3, 0, 0]) circle(r = 0.6, $fn = 12);
    }
}
