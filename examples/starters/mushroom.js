// Toadstool — one of the rotating manifold-js starters. A single, self-colored
// model: the cap, stem, and spots are each wrapped with api.label(shape, name,
// { color }) so they render and export in their own colors with no separate
// paint step. Showcases sculpting a dome by intersecting a sphere with a slab,
// an array of welded surface details, and a tapered stem — one printable solid.
//
// Z-up, mm. The stem pokes up into the cap and the spots sink into it so the
// boolean unions weld. Edit a value (try the spot count) and re-run.
const { Manifold } = api;

// Stem — a gently tapered cylinder standing on the plate (underside at z = 0).
const stem = api.label(Manifold.cylinder(17, 4.6, 3.4, 64), 'stem', { color: '#f3ead3' });

// Cap — the top half of a sphere (sphere ∩ upper slab), squashed a little in Z
// for a domed-toadstool profile, lowered so the stem sinks into its underside.
const dome = Manifold.sphere(12, 96)
  .intersect(Manifold.cube([26, 26, 12], true).translate([0, 0, 6]));
const cap = api.label(dome.scale([1, 1, 0.85]).translate([0, 0, 14]), 'cap', { color: '#d6453c' });

// White spots dotted over the dome — small flattened spheres sunk into the cap.
const spots = [];
const SPOTS = 7;
for (let i = 0; i < SPOTS; i++) {
  const a = (i / SPOTS) * 2 * Math.PI;
  const ring = 7.5;                      // how far out from the apex
  const x = ring * Math.cos(a), y = ring * Math.sin(a);
  const z = 14 + Math.sqrt(Math.max(0, 12 * 12 - ring * ring)) * 0.85 - 1.2;
  spots.push(api.label(
    Manifold.sphere(1.7, 32).scale([1, 1, 0.5]).translate([x, y, z]),
    'spot' + i, { color: '#fbf7ef' },
  ));
}
// One spot crowning the apex.
spots.push(api.label(Manifold.sphere(1.9, 32).scale([1, 1, 0.5]).translate([0, 0, 24]), 'spotTop', { color: '#fbf7ef' }));

return Manifold.union([stem, cap, ...spots]);
