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
// Jimmies on the top tier — a handful of bright colors, deterministic seeds.
const SPRINKLES = ['#e0294b', '#f6c945', '#3fa9e8', '#5ad16a'];

const scale = p.diameter / 80; // keep sprinkle/fillet sizing proportional as the cake resizes

const tierH = 18;
const pieces = [];
let z = 0;
let topR = p.diameter / 2;
let topFrosting = null; // captured so we can scatter sprinkles on the top tier only

for (let i = 0; i < p.tiers; i++) {
  const r = (p.diameter / 2) * (1 - i * 0.16);
  topR = r;
  // Sponge layer — each tier gets its own labelled region so the colors stay
  // crisp across the boolean union.
  pieces.push(api.label(Manifold.cylinder(tierH, r, r, 64).translate([0, 0, z]), 'sponge' + i, { color: SPONGE }));
  // Frosting band straddling the top of the layer: a little wider and thin, and
  // overlapping the sponge so it fuses. Rounded BEFORE labelling — api.round
  // remeshes the surface and drops any labels baked into the input, so a
  // piece must be shaped first and colored last — so the sharp "hat box" rim
  // reads as soft piped icing instead. Every tier shares the 'frosting'
  // label, so they're one region driven by a single color param.
  let frostingPiece = Manifold.cylinder(tierH * 0.45, r * 1.03, r * 1.03, 64).translate([0, 0, z + tierH * 0.8]);
  frostingPiece = api.round(frostingPiece, { radius: 2.2 * scale, resolution: 96 });
  frostingPiece = api.label(frostingPiece, 'frosting', { color: p.frosting });
  pieces.push(frostingPiece);
  if (i === p.tiers - 1) topFrosting = frostingPiece;
  z += tierH;
}

// A cherry on top, dipping into the topmost frosting so it unions cleanly.
pieces.push(api.label(Manifold.sphere(topR * 0.16, 32).translate([0, 0, z + topR * 0.08]), 'cherry', { color: CHERRY }));

// Sprinkles: tiny rods lying flat on the top tier's frosting, scattered only
// on the upward-facing cap (where n[2] > 0.5 — the rounded band's shoulder
// faces outward, not up, so this keeps them off the sides). One scatter call
// per color, each with its own deterministic seed. Each instance is labelled
// BEFORE scatter transforms/unions it, and `api.label`'s originalID tagging
// survives translate/rotate/union, so the colors carry straight through.
const rodLen = 4 * scale;
const rodR = 0.7 * scale;
for (let i = 0; i < SPRINKLES.length; i++) {
  let rod = Manifold.cylinder(rodLen, rodR, rodR, 8).rotate([0, 90, 0]).translate([-rodLen / 2, 0, 0]);
  rod = api.label(rod, 'sprinkle' + i, { color: SPRINKLES[i] });
  const sprinkles = api.scatter(topFrosting, rod, {
    count: 45,
    seed: 101 + i,
    alignToNormal: true,
    spin: true,
    // Sink the rod's center just below the surface (less than its radius) so
    // most of it still pokes up and reads as a sprinkle, while the buried
    // half guarantees a fusing overlap with the frosting underneath.
    offset: -0.35 * scale,
    minSpacing: rodLen * 0.85,
    where: (_p, n) => n[2] > 0.5,
  });
  pieces.push(sprinkles);
}

let cake = pieces[0];
for (let i = 1; i < pieces.length; i++) cake = cake.add(pieces[i]);
return cake;
