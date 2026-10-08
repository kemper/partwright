// frame_neck — Dummy 13 neck: two balls r=3 (y=0, y=10), mid sphere r=2.45 @ y=5,
// neck cylinder r=1.5 along Y, octagonal shaft prism y 3..7, clipped z >= -2.5.
const { Manifold, CrossSection, geom } = api;

const SEG = 128;

// joint balls, kit-exact r=3.000
const ball1 = Manifold.sphere(3.0, SEG);
const ball2 = Manifold.sphere(3.0, SEG).translate([0, 10, 0]);

// mid bulge sphere (probed: r=2.45 @ [0,5,0], rms 0)
const bulge = Manifold.sphere(2.45, SEG).translate([0, 5, 0]);

// neck cylinder r=1.5 along Y, y 0..10 (buried at ends inside balls)
const neckCyl = Manifold.cylinder(10, 1.5, 1.5, SEG).rotate([-90, 0, 0]);

// shaft: octagonal profile in (x,z), extruded along Y from 3 to 7
// x=±1.5 for |z|<=2.2, 45° chamfer to ±1.2 at z=±2.5
const prof = geom.fromPoints([
  [1.5, -2.2], [1.5, 2.2], [1.2, 2.5], [-1.2, 2.5],
  [-1.5, 2.2], [-1.5, -2.2], [-1.2, -2.5], [1.2, -2.5],
]);
const shaft = prof.extrude(4, 0, 0, [1, 1]).rotate([90, 0, 0]).translate([0, 7, 0]);

let solid = ball1.add(ball2).add(bulge).add(neckCyl).add(shaft);

// build-plate clip: keep z >= -2.5
const clip = Manifold.cube([20, 30, 5], false).translate([-10, -8, -7.5]);
solid = solid.subtract(clip);

return solid;
