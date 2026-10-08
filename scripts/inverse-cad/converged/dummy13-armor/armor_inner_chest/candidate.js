// armor_inner_chest — probe-driven primitive composition
// Frame: 2D polygons in (x, z_target); extrude local z, rotate([90,0,0]) maps
// local (x, v, w) -> target (x, -w, v). All features y-symmetric so sign-safe.
const { Manifold, CrossSection, geom } = api;

// --- outline (chest silhouette, traced at y=-3.25; verified stable y in [-3.5,3.5])
const outline = geom.fromPoints([
  [-9.0, 0.0], [9.0, 0.0], [9.5, 0.5], [9.5, 9.0], [8.5, 10.0], [6.0, 10.0],
  [4.0, 6.0], [-4.0, 6.0], [-6.0, 10.0], [-8.5, 10.0], [-9.5, 9.0], [-9.5, 0.5],
]);
const body = outline.extrude(8, 0, 0, [1, 1]).translate([0, 0, -4]);

// --- cavity cross-prism, |y|<2.5 exactly (measured step walls at y=+-2.5):
// everything except wings: |x|<4.6 all z, plus |x|<8.1 below z=3.2
const cavity = geom.fromPoints([
  [-8.1, -1.0], [8.1, -1.0], [8.1, 3.2], [4.6, 3.2], [4.6, 11.0],
  [-4.6, 11.0], [-4.6, 3.2], [-8.1, 3.2],
]).extrude(5, 0, 0, [1, 1]).translate([0, 0, -2.5]);

let solid = body.subtract(cavity).rotate([90, 0, 0]); // -> target frame

// --- inner clearance cylinder r=3.1 about target Z (ray-fit: y(x)=sqrt(3.1^2-x^2), z-invariant)
const innerCyl = Manifold.cylinder(9, 3.1, 3.1, 48).translate([0, 0, -1]);
solid = solid.subtract(innerCyl);

// --- central rect tunnel through both plates (x +-1.6, z 1.9..5.3), overshoot y
const centralHole = Manifold.cube([3.2, 9, 3.4]).translate([-1.6, -4.5, 1.9]);
solid = solid.subtract(centralHole);

// --- 4 slot grooves: X-axis cylinders, center (y=+-4.4983, z=5), r=1.0477,
// x in [4.8,7.2] and mirror (flat ends; circle verified at 4 y-samples)
const slotR = 1.0477, slotY = 4.4983, slotZ = 5.0;
const slotProto = Manifold.cylinder(2.4, slotR, slotR, 48).rotate([0, 90, 0]);
for (const sx of [4.8, -7.2]) {
  for (const sy of [slotY, -slotY]) {
    solid = solid.subtract(slotProto.translate([sx, sy, slotZ]));
  }
}

// --- face chamfers on side walls only: 45deg planes |x|+|y|=13 (wall 9.5 at |y|=3.5 -> 9.0 at |y|=4)
// rotated cube faces sit at (x+y)/sqrt(2) = +-8 about its center -> inner plane x+y = 2cc - 8*sqrt(2) = 13
const wedgeProto = Manifold.cube([16, 16, 12], true).rotate([0, 0, 45]).translate([0, 0, 5]);
const cc = (13 + 8 * Math.SQRT2) / 2;
for (const [mx, my] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
  solid = solid.subtract(wedgeProto.translate([mx * cc, my * cc, 0]));
}

return solid;
