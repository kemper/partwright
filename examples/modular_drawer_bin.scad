// Modular drawer / desk bin — stackable, two compartments.
//
// The headline trick is BOSL2's `cuboid(..., rounding=r)`: in stock OpenSCAD
// a rounded box is a minkowski sum or a hull of 8 spheres (slow + verbose).
// Here both the outer shell and the inner cavity are single calls, with
// `edges=` letting us pick which edges get the radius.
//
// Stacking lugs on the bottom corners drop into matching pockets carved into
// the top rim, so two bins nest snugly. Four lugs + four pockets are placed
// with grid_copies() so the corner geometry stays symmetric.
//
// Coords: Z-up, bin sits on Z=0.
//
//     +------------+
//     |   |        |   <- two compartments split by a center wall
//     |   |        |
//     +------------+

include <BOSL2/std.scad>

$fa = 4;
$fs = 0.5;

// --- Spec --------------------------------------------------------------------
W      = 80;    // outer X
D      = 60;    // outer Y
H      = 40;    // outer Z
R      = 4;     // outer corner rounding (vertical edges)
WALL   = 2;     // side wall thickness
FLOOR  = 3;     // floor thickness
DIV_T  = 1.6;   // divider wall thickness

LUG_D    = 5;     // lug diameter (round post)
LUG_H    = 4;     // lug height below the floor
LUG_TAPER= 0.6;   // shrink at the tip so it self-locates into the pocket
LUG_GAP  = 0.25;  // clearance between lug and pocket (per side)

// Lug centers are inset from the outer corners so they sit fully under the
// wall, not floating off the rounded edge.
LUG_INSET = R + LUG_D/2 + 0.5;
lug_dx = W/2 - LUG_INSET;
lug_dy = D/2 - LUG_INSET;

// --- Pieces ------------------------------------------------------------------

// Outer shell with vertical edges rounded. `edges="Z"` keeps the top and
// bottom faces crisp (so the lugs/pockets land on flat surfaces).
module shell() {
    cuboid([W, D, H], rounding=R, edges="Z", anchor=BOTTOM);
}

// Cavity: a slightly smaller rounded box, lifted off the floor.
// Sized so wall thickness = WALL on every side, floor thickness = FLOOR.
// Extends slightly above the top so the carve produces an open mouth.
module cavity() {
    inner_w = W - 2*WALL;
    inner_d = D - 2*WALL;
    inner_h = H - FLOOR + 0.5;       // pokes through the top by 0.5
    up(FLOOR)
        cuboid([inner_w, inner_d, inner_h],
               rounding=max(R - WALL, 1),
               edges="Z",
               anchor=BOTTOM);
}

// Divider: thin wall spanning the cavity along Y, full-height to the rim.
// Overlaps the floor and side walls by ~0.5+ so the union is watertight.
module divider() {
    div_d = D - 2*WALL + 1;          // bites into both side walls
    div_h = H - FLOOR + 0.01;
    up(FLOOR)
        cuboid([DIV_T, div_d, div_h], anchor=BOTTOM);
}

// One stacking lug: a short round post that hangs below the floor. Built
// taller than LUG_H so its top buries deep in the floor — the visible part
// (Z<0) is still LUG_H tall.
module lug() {
    // Total cyl height = LUG_H (visible below floor) + 2 (embed depth into floor)
    cyl(h=LUG_H + 2,
        d=LUG_D,
        chamfer2=LUG_TAPER,         // chamfer the BOTTOM tip so the lug self-locates into its pocket
        anchor=TOP);                 // anchor at the top so it hangs down
}

// One stacking pocket: matches the lug profile with clearance, slightly
// deeper than LUG_H so seated bins meet face-to-face.
module pocket() {
    cyl(h=LUG_H + 0.4,
        d=LUG_D + 2*LUG_GAP,
        chamfer2=LUG_TAPER,
        anchor=TOP);
}

// --- Assemble ----------------------------------------------------------------

difference() {
    union() {
        // Solid shell minus the cavity = hollow bin.
        difference() {
            shell();
            cavity();
        }
        // Divider bridges floor to rim, splitting the cavity in two.
        divider();

        // Four lugs under the corners. Hand-rolled translates (grid_copies
        // surprisingly didn't fuse them — manifold-3d sees them as 4 floating
        // pieces even with several millimeters of overlap, suggesting an
        // OpenSCAD/manifold quirk in how grid_copies'd children get unioned).
        translate([ lug_dx,  lug_dy, 2]) lug();
        translate([-lug_dx,  lug_dy, 2]) lug();
        translate([ lug_dx, -lug_dy, 2]) lug();
        translate([-lug_dx, -lug_dy, 2]) lug();
    }

    // Four pockets on the top rim, directly above each lug.
    translate([ lug_dx,  lug_dy, H + 0.01]) pocket();
    translate([-lug_dx,  lug_dy, H + 0.01]) pocket();
    translate([ lug_dx, -lug_dy, H + 0.01]) pocket();
    translate([-lug_dx, -lug_dy, H + 0.01]) pocket();
}
