// Toy Rocket — one of the rotating manifold-js starters. A single, self-colored
// model (no separate paint step): every part is wrapped with api.label(shape,
// name, { color }) so the body, nose, fins, and window each render and export
// in their own color. Showcases cylinders, a cone, a polar-arrayed boolean
// union, and an inset detail — all welded into one printable solid on a pad.
//
// Z-up, mm. Parts overlap their neighbors by ≥0.5 mm so the boolean unions
// actually weld (touching-at-a-plane wouldn't). Edit a value and re-run.
const { Manifold } = api;

// Launch pad — a low disc the rocket sits flush on (its underside at z = 0).
const pad = api.label(Manifold.cylinder(2, 14, 14, 64).translate([0, 0, 0]), 'pad', { color: '#9aa3ad' });

// Body — a tall cylinder, dipping into the pad so the two weld.
const body = api.label(Manifold.cylinder(26, 8, 8, 64).translate([0, 0, 1.5]), 'body', { color: '#e3413f' });

// Nose cone — a cone (top radius 0) overlapping the body's top.
const nose = api.label(Manifold.cylinder(12, 8, 0, 64).translate([0, 0, 26]), 'nose', { color: '#f5f5f5' });

// Window — a small sphere half-sunk into the body so a colored porthole pokes out.
const window = api.label(Manifold.sphere(3.2, 48).translate([0, -7, 20]), 'window', { color: '#39b6e8' });

// Three fins in a polar array — each a thin box whose inner edge sinks into the
// body (welds) while its outer edge sticks out. rotate() spins copies to 120°.
const finBlank = Manifold.cube([13, 1.8, 10], false).translate([3, -0.9, 1.5]);
const fins = [0, 120, 240].map((a, i) =>
  api.label(finBlank.rotate([0, 0, a]), 'fin' + i, { color: '#2b6cb0' }),
);

return Manifold.union([pad, body, nose, window, ...fins]);
