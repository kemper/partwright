// Boolean operations demo
const { Manifold } = api;

// Create base shapes
const sphere = Manifold.sphere(6);
const cube = Manifold.cube([10, 10, 10], true);

// Intersection: rounded cube
const rounded = cube.intersect(sphere);

// Subtract cylindrical holes along each axis
const holeX = Manifold.cylinder(12, 2, 2).rotate([0, 90, 0]).translate([-6, 0, 0]);
const holeY = Manifold.cylinder(12, 2, 2).rotate([90, 0, 0]).translate([0, -6, 0]);
const holeZ = Manifold.cylinder(12, 2, 2).translate([0, 0, -6]);

const result = rounded.subtract(holeX).subtract(holeY).subtract(holeZ);

return result;
