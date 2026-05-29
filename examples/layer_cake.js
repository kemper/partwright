// Layer cake — a self-coloring parametric model.
//
// Every part's color is declared right in the code via
// `api.label(shape, name, { color })`, so the cake renders AND exports colored
// with no separate paint pass, and the editor stays fully editable. The
// frosting color is a Customizer knob (a `color` param wired straight into a
// label), and the number of tiers is parametric — each new tier is born colored.
const { Manifold } = api;

const p = api.params({
  tiers:    { type: 'int',    default: 3,  min: 1,  max: 5,   label: 'Tiers' },
  diameter: { type: 'number', default: 80, min: 40, max: 160, step: 2, unit: 'mm', label: 'Base diameter' },
  frosting: { type: 'color',  default: '#ffd1dc', label: 'Frosting color' },
});

const SPONGE = '#c8843c'; // baked sponge brown
const CHERRY = '#d11a2a';

const tierH = 18;
const pieces = [];
let z = 0;
let topR = p.diameter / 2;

for (let i = 0; i < p.tiers; i++) {
  const r = (p.diameter / 2) * (1 - i * 0.16);
  topR = r;
  // Sponge layer — each tier gets its own labelled region so the colors stay
  // crisp across the boolean union.
  pieces.push(api.label(Manifold.cylinder(tierH, r, r, 64).translate([0, 0, z]), 'sponge' + i, { color: SPONGE }));
  // Frosting band straddling the top of the layer: a little wider and thin, and
  // overlapping the sponge so it fuses. Every tier shares the 'frosting' label,
  // so they're one region driven by a single color param.
  pieces.push(api.label(Manifold.cylinder(tierH * 0.45, r * 1.03, r * 1.03, 64).translate([0, 0, z + tierH * 0.8]), 'frosting', { color: p.frosting }));
  z += tierH;
}

// A cherry on top, dipping into the topmost frosting so it unions cleanly.
pieces.push(api.label(Manifold.sphere(topR * 0.16, 32).translate([0, 0, z + topR * 0.08]), 'cherry', { color: CHERRY }));

let cake = pieces[0];
for (let i = 1; i < pieces.length; i++) cake = cake.add(pieces[i]);
return cake;
