// Smooth Rubber Duck — plain Manifold primitives (spheres/ellipsoids only,
// no api.sdf) fused with api.smoothWeld so the classic bathtub-duck seams
// disappear, then nudged into shape with api.sculpt (a pulled-up tail
// feather, a flattened bill). Painted afterward with geometric api.paint.*
// descriptors, since smoothWeld's remeshed output doesn't carry labels.
const { Manifold } = api;

api.material('satin');

// --- Body: a squashed ellipsoid ~40 units wide -----------------------------
const body = Manifold.sphere(20, 64)
  .scale([1, 0.82, 0.78])
  .translate([0, 2, 15]);

// --- Head: sphere offset up and toward the front (duck faces -Y) -----------
const head = Manifold.sphere(12, 48).translate([0, -14, 25]);

// --- Beak base: a squashed sphere overlapping the front of the head --------
const beakBase = Manifold.sphere(6, 32)
  .scale([0.68, 1.45, 0.52])
  .translate([0, -24, 22]);

// Fuse body + head + beak into one smooth surface (seams grow a ~3.5-unit fillet).
let duck = api.smoothWeld([body, head, beakBase], { radius: 3.5 });

// --- Sculpt: pull a small, gently rounded tail bump out of the rear --------
duck = api.sculpt.grab(duck, {
  at: [0, 15, 26],
  radius: 12,
  offset: [0, 4, 5],
});

// --- Sculpt: flatten the top of the bill for the classic duck-bill look ----
duck = api.sculpt.flatten(duck, {
  at: [0, -25, 25.5],
  radius: 5.5,
  normal: [0, 0, 1],
  strength: 0.6,
});

// --- Flat base so the duck sits on the print plate -------------------------
const plate = Manifold.cube([120, 120, 120]).translate([-60, -60, 0]);
duck = duck.intersect(plate);

// Refine before painting so the eye/bill boundaries snap to a finer grid
// (crisper edges than the levelSet remesh's native ~0.6-unit triangles).
duck = duck.refine(2);

// --- Paint: yellow body, orange bill, black eyes ----------------------------
api.paint.box({
  min: [-25, -40, -1],
  max: [25, 46, 46],
  color: '#f6c81a',
});
api.paint.box({
  min: [-4.5, -34, 12],
  max: [4.5, -19, 26],
  color: '#ff8a1f',
});
api.paint.box({ min: [4, -24, 27.5], max: [6.5, -21, 30], color: '#161616' });
api.paint.box({ min: [-6.5, -24, 27.5], max: [-4, -21, 30], color: '#161616' });

return duck;
