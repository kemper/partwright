// Snowman — one of the rotating manifold-js starters. A single, self-colored
// model: each part is wrapped with api.label(shape, name, { color }) so it
// renders and exports in its own color with no separate paint step. Showcases
// stacked spheres welded into one solid, plus small boolean details (nose,
// coal eyes/buttons, a top hat) sunk into the body so they fuse cleanly.
//
// Z-up, mm. Each sphere overlaps the one below by a few mm so the unions weld;
// the details poke into the body for the same reason. Edit a value and re-run.
const { Manifold } = api;

const WHITE = '#f3f7fb';
const COAL = '#23262b';

// Three stacked snowballs, each smaller and overlapping the one below.
const base = api.label(Manifold.sphere(12, 64).translate([0, 0, 11]), 'base', { color: WHITE });
const belly = api.label(Manifold.sphere(9, 64).translate([0, 0, 27]), 'belly', { color: WHITE });
const head = api.label(Manifold.sphere(6.5, 64).translate([0, 0, 40]), 'head', { color: WHITE });

// Carrot nose — a small cone poking forward (−Y) out of the face.
const nose = api.label(
  Manifold.cylinder(7, 2.1, 0, 32).rotate([-90, 0, 0]).translate([0, -5.5, 41]),
  'nose', { color: '#ef8a2b' },
);

// Two coal eyes — small spheres half-sunk into the head.
const eyeL = api.label(Manifold.sphere(0.9, 24).translate([-2.4, -5.6, 43]), 'eyeL', { color: COAL });
const eyeR = api.label(Manifold.sphere(0.9, 24).translate([2.4, -5.6, 43]), 'eyeR', { color: COAL });

// Three coal buttons down the belly, each sunk into the front surface.
const buttons = [31, 27, 23].map((z, i) =>
  api.label(Manifold.sphere(1.1, 24).translate([0, -7.8, z]), 'button' + i, { color: COAL }),
);

// Top hat — a brim disc plus a crown cylinder, both sitting on the head.
const brim = api.label(Manifold.cylinder(1.2, 8, 8, 64).translate([0, 0, 45]), 'brim', { color: COAL });
const crown = api.label(Manifold.cylinder(8, 5, 5, 64).translate([0, 0, 45.5]), 'crown', { color: COAL });

return Manifold.union([base, belly, head, nose, eyeL, eyeR, ...buttons, brim, crown]);
