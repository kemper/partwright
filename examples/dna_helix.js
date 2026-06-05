// DNA Double Helix — two antiparallel sugar-phosphate backbones spiralling
// around a common axis, joined by colored base-pair rungs. A molecular-biology
// subject unlike anything else in the catalog, and a clean showcase of building
// helical geometry from first principles (no helper sweep needed) plus
// self-coloring via api.label.
//
// Z-up, mm. The two strands are diametrically opposite at every height; each
// base-pair rung is therefore a single horizontal rod of length 2·R rotated to
// the strand angle — so the whole model welds into ONE connected component.
const { Manifold } = api;

const p = api.params({
  turns:    { type: 'number', default: 2.5, min: 1,  max: 5,  step: 0.5, label: 'Helical turns' },
  radius:   { type: 'number', default: 9,   min: 5,  max: 16, step: 1, unit: 'mm', label: 'Helix radius' },
  pitch:    { type: 'number', default: 16,  min: 8,  max: 28, step: 1, unit: 'mm', label: 'Pitch (rise/turn)' },
  perTurn:  { type: 'int',    default: 22,  min: 14, max: 30, label: 'Beads per turn' },
});

const R = p.radius;
const beadR = 2.0;                 // sugar-phosphate bead (overlaps its neighbors)
const rungR = 0.9;                 // base-pair rod
const stepsPerTurn = p.perTurn;
const steps = Math.round(p.turns * stepsPerTurn);
const rise = p.pitch / stepsPerTurn;
const deg = (rad) => (rad * 180) / Math.PI;

// --- Backbones: a chain of overlapping beads along each helix --------------
const strandA = [];
const strandB = [];
for (let i = 0; i <= steps; i++) {
  const theta = (i / stepsPerTurn) * Math.PI * 2;
  const z = i * rise;
  const x = R * Math.cos(theta), y = R * Math.sin(theta);
  strandA.push(Manifold.sphere(beadR, 12).translate([x, y, z]));
  strandB.push(Manifold.sphere(beadR, 12).translate([-x, -y, z])); // 180° opposite
}
const backboneA = api.label(Manifold.union(strandA), 'strandA', { color: '#e8743b' }); // phosphate orange
const backboneB = api.label(Manifold.union(strandB), 'strandB', { color: '#2bb6a8' }); // teal

// --- Base-pair rungs: every other step, cycling 4 base colors --------------
// A rung is a horizontal rod of length 2R (reaches both strands) centered on
// the axis, rotated to the strand angle and lifted to height z.
const BASES = [
  { name: 'adenine',  color: '#3fa34d' }, // green
  { name: 'thymine',  color: '#d63d4f' }, // red
  { name: 'cytosine', color: '#3b78c2' }, // blue
  { name: 'guanine',  color: '#e7b730' }, // yellow
];
const rungs = { adenine: [], thymine: [], cytosine: [], guanine: [] };
for (let i = 2; i < steps - 1; i += 2) {
  const theta = (i / stepsPerTurn) * Math.PI * 2;
  const z = i * rise;
  const base = BASES[(i / 2) % 4];
  const rod = Manifold.cylinder(2 * R, rungR, rungR, 10, true) // centered, spans -R..R along Z
    .rotate([0, 90, 0])                                         // now along X
    .rotate([0, 0, deg(theta)])                                 // align to the strand angle
    .translate([0, 0, z]);
  rungs[base.name].push(rod);
}
const rungParts = BASES
  .filter((b) => rungs[b.name].length)
  .map((b) => api.label(Manifold.union(rungs[b.name]), b.name, { color: b.color }));

// --- Assemble — one connected double helix ---------------------------------
const helix = api.expectUnion([backboneA, backboneB, ...rungParts], { expectComponents: 1 });
return helix;
