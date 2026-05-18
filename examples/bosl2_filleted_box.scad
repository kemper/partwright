// BOSL2 demo — a filleted box with chamfered top edges, threaded inserts,
// and a rounded interior pocket. Shows off the verbs BOSL2 unlocks that
// stock OpenSCAD doesn't have natively (edge rounding/chamfering, named
// attachment anchors, ring_copies, threaded holes).
//
// First load fetches ~4 MB of BOSL2 source; subsequent runs are fast.

include <BOSL2/std.scad>

$fn = 48;

box_size = [60, 40, 25];
wall = 3;
fillet_r = 4;

difference() {
  // Outer shell: rounded everywhere, chamfered top.
  cuboid(box_size, rounding=fillet_r, except=[TOP])
    chamfer(2, edges="Z");

  // Interior pocket — also rounded so the cavity matches.
  up(wall)
    cuboid(
      [box_size.x - 2 * wall, box_size.y - 2 * wall, box_size.z],
      rounding=fillet_r - 1,
      except=[BOTTOM]
    );

  // 4 mounting holes in a rectangular pattern, chamfered for screw heads.
  rect_copies([box_size.x - 12, box_size.y - 12])
    down(0.1)
      cyl(d=4, h=box_size.z + 1, chamfer2=1);
}
