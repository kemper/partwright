// Meshing spur-gear pair on a rounded base plate.
//
// Showcases BOSL2's `gears.scad`: a pair of involute spur gears whose pitch
// circles are tangent (computed with `gear_dist()`) and whose teeth are
// phased to interlock at the contact point. Hand-rolling involute tooth
// flanks in plain CSG is painful — BOSL2 makes it a one-liner per gear.
//
// One top-level union: base plate + two gears, then both axle bores and the
// matching through-holes in the plate are subtracted in one pass.

include <BOSL2/std.scad>
include <BOSL2/gears.scad>

$fn = 64;

// --- Gear parameters --------------------------------------------------------
circ_pitch  = 5;     // circular pitch (mm of pitch-circle arc per tooth)
teeth_small = 15;
teeth_large = 30;
thickness   = 6;     // gear face width
bore_small  = 4;     // axle hole diameter, small gear
bore_large  = 6;     // axle hole diameter, large gear

// --- Plate parameters -------------------------------------------------------
plate_thk   = 3;
plate_pad   = 6;     // extra room around the gears' tip circles

// --- Derived geometry -------------------------------------------------------
// Center-to-center distance for two external spur gears sharing circ_pitch.
center_dist = gear_dist(circ_pitch=circ_pitch,
                        teeth1=teeth_small, teeth2=teeth_large);

// Tip radii (for sizing the plate).
r_tip_small = (circ_pitch * teeth_small) / (2 * PI) + circ_pitch / PI;
r_tip_large = (circ_pitch * teeth_large) / (2 * PI) + circ_pitch / PI;

// Plate footprint covers both tip circles with `plate_pad` margin.
plate_w = center_dist + r_tip_small + r_tip_large + 2 * plate_pad;
plate_d = 2 * max(r_tip_small, r_tip_large) + 2 * plate_pad;

// Place the small gear at the origin, the large gear `center_dist` along +X.
x_small = 0;
x_large = center_dist;
// Plate is centered on the midpoint of the two axes so it's symmetric.
plate_cx = (x_small + x_large) / 2;

// Tooth phasing: rotate the small gear by half a tooth-pitch so a tooth on
// one gear lands in the gap between two teeth on the other at the contact
// point. For an even-toothed mate, half-a-pitch on the small gear is enough.
phase = 180 / teeth_small;

// --- Build ------------------------------------------------------------------
difference() {
  union() {
    // Base plate, centered on the gear-pair midline, sitting on Z=0.
    translate([plate_cx, 0, plate_thk / 2])
      cuboid([plate_w, plate_d, plate_thk], rounding=4, edges="Z");

    // Small gear: sits on top of the plate.
    translate([x_small, 0, plate_thk + thickness / 2])
      spur_gear(circ_pitch=circ_pitch, teeth=teeth_small,
                thickness=thickness, gear_spin=phase);

    // Large gear: shifted along +X by the meshing distance.
    translate([x_large, 0, plate_thk + thickness / 2])
      spur_gear(circ_pitch=circ_pitch, teeth=teeth_large,
                thickness=thickness);
  }

  // Axle bores, punched through both the gear and the plate beneath it.
  translate([x_small, 0, -0.1])
    cyl(h=plate_thk + thickness + 0.2, d=bore_small, anchor=BOTTOM);
  translate([x_large, 0, -0.1])
    cyl(h=plate_thk + thickness + 0.2, d=bore_large, anchor=BOTTOM);
}
