// 3-way pipe tee fitting — the plumbing/PVC kind.
//
// Geometry: a horizontal pipe runs along X (~80 mm long), a vertical pipe
// rises along +Z (~50 mm above the horizontal one). Both pipes are hollow,
// and their bores connect through the intersection so fluid can flow through
// the tee in all three directions. Each open end carries a slightly larger
// flared collar with a chamfered outer edge — the classic socket-fit look.
//
// Construction trick: build a single union of all OUTER solids (pipes +
// collars), then subtract a single union of all INNER bores. Because both
// inner cylinders subtract from the same outer mass, the two bores naturally
// merge into one connected cavity at the T-junction — no extra fiddling
// needed at the intersection.

include <BOSL2/std.scad>

$fn = 48;

// ---- Spec ------------------------------------------------------------------
pipe_od       = 30;    // outer diameter of the main pipes
pipe_id       = 24;    // inner bore diameter (3 mm wall)
horiz_len     = 80;    // length of horizontal arm (X axis)
vert_above    = 50;    // height of vertical arm ABOVE horizontal pipe surface

collar_od     = pipe_od + 6;   // flared collar slightly larger
collar_h      = 6;             // collar thickness along the pipe axis
collar_cham   = 1.2;           // outer-edge chamfer on the collar lip

// Derived: vertical pipe needs to dip below Z=0 so it overlaps the horizontal
// pipe's volume (≥0.5 mm). Drop the bottom to -pipe_od/2 - 1 for clean union.
vert_bot      = -pipe_od/2 - 1;          // ~ -16
vert_top      = pipe_od/2 + vert_above;  // ~ 65
vert_len      = vert_top - vert_bot;     // ~ 81

// Bores extend past the collar faces by `eps` so the boolean cuts cleanly
// through the outer skin (no zero-thickness slivers at the openings).
eps = 0.1;

// ---- Assembly --------------------------------------------------------------
difference() {
    union() {
        // Outer skin: horizontal pipe along X, vertical pipe along Z.
        // The vertical pipe's base sits at vert_bot so its volume overlaps
        // the horizontal pipe well past the 0.5 mm boolean-union threshold.
        xcyl(h=horiz_len, d=pipe_od);
        up(vert_bot) zcyl(h=vert_len, d=pipe_od, anchor=BOTTOM);

        // Three flared collars, one per open end. cyl() with `chamfer1`
        // bevels the anchor (outer/open) face only, leaving the inner face
        // flush against the pipe body for a clean union.
        right(horiz_len/2) xcyl(h=collar_h, d=collar_od, chamfer1=collar_cham, anchor=RIGHT);
        left (horiz_len/2) xcyl(h=collar_h, d=collar_od, chamfer1=collar_cham, anchor=LEFT);
        up   (vert_top)    zcyl(h=collar_h, d=collar_od, chamfer1=collar_cham, anchor=TOP);
    }

    // Inner bores — a single union, so the cavities merge at the T.
    union() {
        xcyl(h=horiz_len + 2*eps, d=pipe_id);
        up(vert_bot - eps) zcyl(h=vert_len + 2*eps, d=pipe_id, anchor=BOTTOM);
    }
}
