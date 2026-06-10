// Print-in-place barrel hinge — prints lying open flat on the bed and works
// straight off the printer, no assembly. One leaf carries an integral pin
// captive at both ends; the other leaf's knuckles are bored with clearance and
// wrap around it. Knuckle count, pin size, and the moving clearance are all
// parametric — built with api.joints.hinge.
const { joints } = api;

const p = api.params({
  width:     { type: 'number', default: 40,  min: 15,   max: 100, step: 5,    unit: 'mm', label: 'Hinge width' },
  leaf:      { type: 'number', default: 16,  min: 6,    max: 40,  step: 1,    unit: 'mm', label: 'Leaf depth' },
  thickness: { type: 'number', default: 3,   min: 1.2,  max: 6,   step: 0.2,  unit: 'mm', label: 'Leaf thickness' },
  knuckles:  { type: 'int',    default: 5,   min: 3,    max: 11,              label: 'Knuckles (odd)' },
  pinD:      { type: 'number', default: 4,   min: 2,    max: 8,   step: 0.5,  unit: 'mm', label: 'Pin diameter' },
  clearance: { type: 'number', default: 0.3, min: 0.15, max: 0.6, step: 0.05, unit: 'mm', label: 'Clearance' },
});

// The hinge needs an odd knuckle count (so the pin leaf owns both ends and the
// pin stays captive) — round an even slider value up rather than erroring.
const knuckles = p.knuckles % 2 === 0 ? p.knuckles + 1 : p.knuckles;

const hinge = joints.hinge({
  width: p.width,
  leaf: p.leaf,
  thickness: p.thickness,
  knuckles,
  pinD: p.pinD,
  clearance: p.clearance,
});

// hinge() returns ONE Manifold made of exactly two free components. Decompose
// so each leaf gets its own color: the pin leaf extends toward -Y, the wrap
// leaf toward +Y — tell them apart by bounding-box center.
let out = null;
for (const part of hinge.decompose()) {
  const bb = part.boundingBox();
  const isPinLeaf = (bb.min[1] + bb.max[1]) / 2 < 0;
  const colored = isPinLeaf
    ? api.label(part, 'pin leaf',  { color: '#c2703d' })
    : api.label(part, 'wrap leaf', { color: '#4f7da6' });
  out = out ? out.add(colored) : colored;
}
return out;
