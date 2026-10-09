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

// Derived: the vertical pipe starts on the run's centreline (Z=0). Its base
// disc lies entirely inside the horizontal pipe's solid, so the union is clean
// and nothing pokes out below the run pipe.
vert_bot      = 0;
vert_top      = pipe_od/2 + vert_above;  // ~ 65
vert_len      = vert_top - vert_bot;     // ~ 81

// Bores extend past the collar faces by `eps` so the boolean cuts cleanly
// through the outer skin (no zero-thickness slivers at the openings).
eps = 0.1;

// ---- Assembly --------------------------------------------------------------
difference() {
    union() {
        // Outer skin: horizontal pipe along X, vertical pipe along Z.
        // The vertical pipe's base sits on the run's centreline, deep inside
        // the horizontal pipe's volume.
        xcyl(h=horiz_len, d=pipe_od);
        up(vert_bot) zcyl(h=vert_len, d=pipe_od, anchor=BOTTOM);

        // Three flared collars, one per open end. cyl() chamfer1 is the -X/-Z
        // end and chamfer2 the +X/+Z end, so the outer (open) lip is chamfer2
        // on the right and top collars and chamfer1 on the left one; the inner
        // face stays flush against the pipe body for a clean union.
        right(horiz_len/2) xcyl(h=collar_h, d=collar_od, chamfer2=collar_cham, anchor=RIGHT);
        left (horiz_len/2) xcyl(h=collar_h, d=collar_od, chamfer1=collar_cham, anchor=LEFT);
        up   (vert_top)    zcyl(h=collar_h, d=collar_od, chamfer2=collar_cham, anchor=TOP);
    }

    // Inner bores — a single union, so the cavities merge at the T.
    union() {
        xcyl(h=horiz_len + 2*eps, d=pipe_id);
        // Starts at the run's centreline (inside the horizontal bore), so it
        // opens into the run without punching through the run's underside.
        up(vert_bot) zcyl(h=vert_len + eps, d=pipe_id, anchor=BOTTOM);
    }
}
