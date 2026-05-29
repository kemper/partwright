// BOSL2 fastener trio — M16 hex bolt, matching hex nut, and a flat washer.
// Threads are physically modeled by BOSL2's screws library (not a texture),
// so the helices on the bolt and the internal threads in the nut are real
// geometry that prints / exports correctly.
//
// Parts are laid out in a row on the build plate via xdistribute(), spaced
// well clear of each other so nothing accidentally booleans together.

include <BOSL2/std.scad>
include <BOSL2/screws.scad>

// Smooth threads without blowing up tessellation time. $fa/$fs adapts the
// facet count to curve size — better than a flat $fn for parts of mixed scale.
$fa = 4;
$fs = 0.4;

// --- Spec --------------------------------------------------------------------
bolt_len     = 30;   // shaft length under the head
washer_od    = 30;
washer_id    = 17;   // ~1 mm clearance over the M16 nominal
washer_thick = 2.5;
washer_bevel = 0.6;  // top-edge chamfer

// --- Bolt --------------------------------------------------------------------
// "M16" picks ISO metric coarse (2.0 mm pitch). Pass an explicit pitch via
// "M16x3" if you want the 3 mm pitch mentioned in the brief — the coarser
// helix reads more clearly at small render sizes.
module hex_bolt() {
    screw("M16x3", head="hex", length=bolt_len, anchor=BOTTOM);
}

// --- Nut ---------------------------------------------------------------------
// Same spec string as the bolt, so the internal thread pitch matches exactly.
module hex_nut() {
    nut("M16x3", anchor=BOTTOM);
}

// --- Washer ------------------------------------------------------------------
// Flat annular disk with a small chamfer on the top outer edge.
module flat_washer() {
    difference() {
        cyl(h=washer_thick, d=washer_od,
            chamfer2=washer_bevel,   // top edge only
            anchor=BOTTOM);
        // Through-hole — extend past both faces so the boolean is clean.
        up(-0.1)
            cyl(h=washer_thick + 0.2, d=washer_id, anchor=BOTTOM);
    }
}

// --- Layout ------------------------------------------------------------------
// 40 mm pitch keeps the 24 mm hex flats and 30 mm washer comfortably apart.
xdistribute(spacing=40) {
    hex_bolt();
    hex_nut();
    flat_washer();
}
