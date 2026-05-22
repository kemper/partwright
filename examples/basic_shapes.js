// Basic shapes demo
// The 'api' object exposes the full manifold-3d API
const { Manifold } = api;

const box = Manifold.cube([10, 10, 10], true);
// No segment count — the cylinder follows your Curve quality setting (the Mesh
// button in the viewport), instead of being fixed at a coarse resolution.
const hole = Manifold.cylinder(6, 4, 4);
const result = box.subtract(hole);

// Always return the final Manifold object
return result;
