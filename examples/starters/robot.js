// Desk Robot — one of the rotating manifold-js starters. A single, self-colored
// model: head, eyes, mouth, ears, and antenna are each wrapped with
// api.label(shape, name, { color }) so they render and export in their own
// colors with no separate paint step. Showcases a rounded box built from the
// convex hull of eight corner spheres, plus welded inset details — one solid.
//
// Z-up, mm. The eyes/mouth/ears sink into the head and the antenna plugs into
// the top so the boolean unions weld. Edit a value and re-run.
const { Manifold } = api;

// Rounded head — convex hull of eight small corner spheres (manifold's quick
// fillet-a-box trick). Half-extents hx/hy/hz, corner radius r.
const r = 2.5, hx = 11, hy = 8, hz = 9;
const s = Manifold.sphere(r, 32);
const corners = [];
for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
  corners.push(s.translate([sx * hx, sy * hy, sz * hz]));
}
const head = api.label(Manifold.hull(corners).translate([0, 0, hz + r]), 'head', { color: '#b9c2cc' });

// Two glowing eyes — cylinders standing proud of the face (−Y), their backs
// buried in the head so they weld. The −Y face sits at y = −(hy + r).
const eye = (x) => Manifold.cylinder(2.5, 3.2, 3.2, 48).rotate([-90, 0, 0]).translate([x, -hy - r - 2.5, hz + r + 2]);
const eyeL = api.label(eye(-4.5), 'eyeL', { color: '#39e0d0' });
const eyeR = api.label(eye(4.5), 'eyeR', { color: '#39e0d0' });

// Mouth — a thin dark grille bar straddling the lower face.
const mouth = api.label(Manifold.cube([10, 2, 2.4], true).translate([0, -hy - r, hz + r - 4]), 'mouth', { color: '#2b3038' });

// Ears — short knobs centered on each side, their inner ends buried in the head.
const ear = (x) => Manifold.cylinder(4, 2, 2, 32, true).rotate([0, 90, 0]).translate([x, 0, hz + r + 1]);
const earL = api.label(ear(-hx - 1.5), 'earL', { color: '#f2b134' });
const earR = api.label(ear(hx + 1.5), 'earR', { color: '#f2b134' });

// Antenna — a stalk plugged into the crown, topped with a red bulb.
const stalk = api.label(Manifold.cylinder(7, 0.9, 0.9, 24).translate([0, 0, 2 * hz + r]), 'stalk', { color: '#7a828c' });
const bulb = api.label(Manifold.sphere(2, 32).translate([0, 0, 2 * hz + r + 7]), 'bulb', { color: '#e8413f' });

return Manifold.union([head, eyeL, eyeR, mouth, earL, earR, stalk, bulb]);
